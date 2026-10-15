import { Decimal, dec, type DecimalLike } from "@/lib/money";

export type PayoffStrategy = "avalanche" | "snowball" | "custom";

export interface DebtInput {
  id: string;
  name: string;
  balance: DecimalLike;
  /** APR in percent; null when unknown */
  apr: DecimalLike | null;
  minimumPayment: DecimalLike | null;
  customOrder?: number;
}

export interface DebtPayoffResult {
  strategy: PayoffStrategy;
  months: number | null; // null = does not pay off within horizon
  totalInterest: Decimal;
  totalPaid: Decimal;
  perDebt: { id: string; name: string; payoffMonth: number | null; interest: Decimal }[];
  schedule: { month: number; totalBalance: Decimal }[];
  warnings: string[];
  isEstimate: true;
}

/**
 * Month-by-month payoff simulation. Interest accrues monthly at APR/12 on the
 * opening balance. Each month every debt receives its minimum; the extra budget
 * plus freed-up minimums from paid-off debts go to the target debt chosen by the
 * strategy. Results are estimates: real lenders compound daily, change rates, and
 * apply fees.
 */
export function simulatePayoff(debts: DebtInput[], strategy: PayoffStrategy, extraMonthly: DecimalLike = 0, horizonMonths = 600): DebtPayoffResult {
  const warnings: string[] = [];
  const state = debts
    .filter((d) => dec(d.balance).gt(0))
    .map((d) => {
      if (d.apr === null || d.apr === undefined) warnings.push(`${d.name}: interest rate unknown — assumed 0%, so payoff is optimistic.`);
      if (!d.minimumPayment || dec(d.minimumPayment).lte(0)) warnings.push(`${d.name}: no minimum payment set — only extra payments are applied.`);
      return {
        id: d.id,
        name: d.name,
        balance: dec(d.balance),
        monthlyRate: dec(d.apr ?? 0).div(100).div(12),
        min: dec(d.minimumPayment ?? 0),
        order: d.customOrder ?? 0,
        apr: dec(d.apr ?? 0),
        interest: new Decimal(0),
        payoffMonth: null as number | null,
      };
    });

  const extra = dec(extraMonthly);
  const totalBudget = state.reduce((a, d) => a.plus(d.min), new Decimal(0)).plus(extra);
  const order = () => {
    const open = state.filter((d) => d.balance.gt(0));
    if (strategy === "avalanche") return open.sort((a, b) => b.apr.comparedTo(a.apr) || a.balance.comparedTo(b.balance));
    if (strategy === "snowball") return open.sort((a, b) => a.balance.comparedTo(b.balance) || b.apr.comparedTo(a.apr));
    return open.sort((a, b) => a.order - b.order);
  };

  let totalInterest = new Decimal(0);
  let totalPaid = new Decimal(0);
  const schedule: { month: number; totalBalance: Decimal }[] = [
    { month: 0, totalBalance: state.reduce((a, d) => a.plus(d.balance), new Decimal(0)) },
  ];
  let month = 0;
  while (state.some((d) => d.balance.gt(0)) && month < horizonMonths) {
    month++;
    // accrue interest
    for (const d of state) {
      if (d.balance.lte(0)) continue;
      const i = d.balance.times(d.monthlyRate).toDecimalPlaces(2);
      d.balance = d.balance.plus(i);
      d.interest = d.interest.plus(i);
      totalInterest = totalInterest.plus(i);
    }
    let pool = totalBudget;
    // minimums
    for (const d of state) {
      if (d.balance.lte(0)) continue;
      const pay = Decimal.min(d.min, d.balance, pool);
      d.balance = d.balance.minus(pay);
      pool = pool.minus(pay);
      totalPaid = totalPaid.plus(pay);
    }
    // extra + freed minimums to targets in order
    for (const d of order()) {
      if (pool.lte(0)) break;
      const pay = Decimal.min(pool, d.balance);
      d.balance = d.balance.minus(pay);
      pool = pool.minus(pay);
      totalPaid = totalPaid.plus(pay);
    }
    for (const d of state) if (d.balance.lte(0) && d.payoffMonth === null) d.payoffMonth = month;
    schedule.push({ month, totalBalance: state.reduce((a, d) => a.plus(Decimal.max(d.balance, 0)), new Decimal(0)) });
    // Divergence guard: payments don't cover interest.
    if (month === 24 && schedule[24].totalBalance.gte(schedule[0].totalBalance)) {
      warnings.push("Payments do not cover accruing interest — balances are not decreasing.");
      break;
    }
  }
  const done = state.every((d) => d.balance.lte(0));
  if (!done && month >= horizonMonths) warnings.push(`Not paid off within ${horizonMonths / 12} years at this payment level.`);
  return {
    strategy,
    months: done ? month : null,
    totalInterest,
    totalPaid,
    perDebt: state.map((d) => ({ id: d.id, name: d.name, payoffMonth: d.payoffMonth, interest: d.interest })),
    schedule,
    warnings,
    isEstimate: true,
  };
}

/** Months remaining for a single amortizing loan; null when payment doesn't cover interest. */
export function monthsToPayoff(balance: DecimalLike, aprPercent: DecimalLike, payment: DecimalLike): number | null {
  const b = dec(balance);
  const p = dec(payment);
  const r = dec(aprPercent).div(100).div(12);
  if (b.lte(0)) return 0;
  if (p.lte(0)) return null;
  if (r.isZero()) return b.div(p).ceil().toNumber();
  if (p.lte(b.times(r))) return null;
  // n = -ln(1 - rB/P) / ln(1 + r)
  const n = new Decimal(1).minus(r.times(b).div(p)).ln().negated().div(new Decimal(1).plus(r).ln());
  return n.ceil().toNumber();
}
