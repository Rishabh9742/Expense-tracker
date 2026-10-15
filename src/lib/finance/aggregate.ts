import type { TransactionStatus, TransactionType } from "@prisma/client";
import { Decimal, dec, sum, type DecimalLike } from "@/lib/money";

/**
 * Minimal transaction shape for all cash-flow math. `baseAmount` is the signed
 * amount converted into the user's base currency; null means the conversion rate
 * was unavailable and the row is excluded (and counted in `unconverted`).
 */
export interface TxnLike {
  id?: string;
  type: TransactionType;
  status?: TransactionStatus;
  amount: DecimalLike;
  baseAmount: DecimalLike | null;
  categoryId?: string | null;
  merchant?: string | null;
  isReimbursable?: boolean;
  date?: Date;
  splits?: { categoryId: string | null; amount: DecimalLike }[];
}

export interface AggregateOptions {
  includePending?: boolean;
  excludeReimbursable?: boolean;
}

export interface CashFlow {
  income: Decimal;
  /** Gross expenses before refunds */
  grossExpenses: Decimal;
  refunds: Decimal;
  /** Net spending = gross expenses − refunds */
  expenses: Decimal;
  net: Decimal;
  /** % of income kept: (income − expenses) / income */
  savingsRate: number | null;
  unconverted: number;
  count: number;
}

function included(t: TxnLike, opts: AggregateOptions): boolean {
  if (opts.includePending === false && t.status === "PENDING") return false;
  if (opts.excludeReimbursable && t.type === "EXPENSE" && t.isReimbursable) return false;
  return true;
}

export function cashFlow(txns: TxnLike[], opts: AggregateOptions = {}): CashFlow {
  let income = new Decimal(0);
  let gross = new Decimal(0);
  let refunds = new Decimal(0);
  let unconverted = 0;
  let count = 0;
  for (const t of txns) {
    if (!included(t, opts)) continue;
    // Transfers and adjustments move money but are neither earnings nor spending.
    if (t.type === "TRANSFER" || t.type === "ADJUSTMENT") continue;
    if (t.baseAmount === null || t.baseAmount === undefined) {
      unconverted++;
      continue;
    }
    const b = dec(t.baseAmount);
    count++;
    if (t.type === "INCOME") income = income.plus(b);
    else if (t.type === "EXPENSE") gross = gross.plus(b.negated());
    else if (t.type === "REFUND") refunds = refunds.plus(b);
  }
  const expenses = gross.minus(refunds);
  const net = income.minus(expenses);
  const savingsRate = income.isZero() ? null : net.div(income).times(100).toDecimalPlaces(1).toNumber();
  return { income, grossExpenses: gross, refunds, expenses, net, savingsRate, unconverted, count };
}

/**
 * Net spending per category in base currency. Split transactions are distributed
 * across their split categories proportionally to the base conversion. Refunds
 * reduce their category's spending.
 */
export function spendingByCategory(txns: TxnLike[], opts: AggregateOptions = {}): Map<string | null, Decimal> {
  const out = new Map<string | null, Decimal>();
  const add = (k: string | null, v: Decimal) => out.set(k, (out.get(k) ?? new Decimal(0)).plus(v));
  for (const t of txns) {
    if (!included(t, opts)) continue;
    if (t.type !== "EXPENSE" && t.type !== "REFUND") continue;
    if (t.baseAmount === null || t.baseAmount === undefined) continue;
    const base = dec(t.baseAmount);
    const sign = t.type === "EXPENSE" ? -1 : 1; // spending is positive
    const magnitude = base.abs();
    if (t.splits && t.splits.length > 0) {
      const native = dec(t.amount).abs();
      const ratio = native.isZero() ? new Decimal(0) : magnitude.div(native);
      for (const s of t.splits) {
        const part = dec(s.amount).abs().times(ratio);
        add(s.categoryId ?? null, sign === -1 ? part : part.negated());
      }
    } else {
      add(t.categoryId ?? null, sign === -1 ? magnitude : magnitude.negated());
    }
  }
  return out;
}

export function incomeByCategory(txns: TxnLike[], opts: AggregateOptions = {}): Map<string | null, Decimal> {
  const out = new Map<string | null, Decimal>();
  for (const t of txns) {
    if (!included(t, opts) || t.type !== "INCOME" || t.baseAmount == null) continue;
    const k = t.categoryId ?? null;
    out.set(k, (out.get(k) ?? new Decimal(0)).plus(dec(t.baseAmount)));
  }
  return out;
}

export function spendingByMerchant(txns: TxnLike[], opts: AggregateOptions = {}): Map<string, { total: Decimal; count: number }> {
  const out = new Map<string, { total: Decimal; count: number }>();
  for (const t of txns) {
    if (!included(t, opts)) continue;
    if ((t.type !== "EXPENSE" && t.type !== "REFUND") || t.baseAmount == null) continue;
    const key = (t.merchant ?? "").trim() || "Unknown merchant";
    const cur = out.get(key) ?? { total: new Decimal(0), count: 0 };
    const v = dec(t.baseAmount).abs();
    cur.total = t.type === "EXPENSE" ? cur.total.plus(v) : cur.total.minus(v);
    if (t.type === "EXPENSE") cur.count++;
    out.set(key, cur);
  }
  return out;
}

/** Account-currency balance: opening + own signed amounts + incoming transfer credits. */
export function accountBalance(
  openingBalance: DecimalLike,
  own: { amount: DecimalLike; status?: TransactionStatus }[],
  incoming: { toAmount: DecimalLike | null; status?: TransactionStatus }[],
  includePending = true,
): Decimal {
  const ok = (s?: TransactionStatus) => includePending || s !== "PENDING";
  return dec(openingBalance)
    .plus(sum(own.filter((t) => ok(t.status)).map((t) => t.amount)))
    .plus(sum(incoming.filter((t) => ok(t.status)).map((t) => t.toAmount ?? 0)));
}

/** Percent change from previous to current; null when previous is zero. */
export function percentChange(current: DecimalLike, previous: DecimalLike): number | null {
  const p = dec(previous);
  if (p.isZero()) return null;
  return dec(current).minus(p).div(p.abs()).times(100).toDecimalPlaces(1).toNumber();
}

/**
 * Flags expenses that are unusually large for their category: above
 * max(median × 3, mean + 3σ) of that category's history, with at least 5 samples.
 */
export function findUnusual(
  current: { id: string; categoryId: string | null; base: Decimal }[],
  history: { categoryId: string | null; base: Decimal }[],
): { id: string; threshold: Decimal; median: Decimal }[] {
  const byCat = new Map<string | null, Decimal[]>();
  for (const h of history) {
    const arr = byCat.get(h.categoryId) ?? [];
    arr.push(h.base.abs());
    byCat.set(h.categoryId, arr);
  }
  const stats = new Map<string | null, { median: Decimal; threshold: Decimal }>();
  for (const [k, arr] of byCat) {
    if (arr.length < 5) continue;
    const sorted = [...arr].sort((a, b) => a.comparedTo(b));
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).div(2);
    const mean = sum(sorted).div(sorted.length);
    const variance = sum(sorted.map((x) => x.minus(mean).pow(2))).div(sorted.length);
    const sd = variance.sqrt();
    const threshold = Decimal.max(median.times(3), mean.plus(sd.times(3)));
    stats.set(k, { median, threshold });
  }
  const out: { id: string; threshold: Decimal; median: Decimal }[] = [];
  for (const c of current) {
    const s = stats.get(c.categoryId);
    if (s && c.base.abs().gt(s.threshold)) out.push({ id: c.id, ...s });
  }
  return out;
}
