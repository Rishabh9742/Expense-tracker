import type { Category, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal, dec } from "@/lib/money";
import { cashFlow, spendingByCategory, type AggregateOptions, type TxnLike } from "@/lib/finance/aggregate";
import { timeBuckets, monthBuckets } from "@/lib/dates";

export interface TxnFilter {
  accountIds?: string[];
  categoryIds?: string[];
  merchant?: string;
}

export interface LoadedTxn extends TxnLike {
  id: string;
  date: Date;
  accountId: string;
  description: string;
  merchant: string | null;
  recurringId: string | null;
  categoryId: string | null;
  toAccountId: string | null;
}

/** Load the minimal fields needed for aggregation in [from, to). */
export async function loadTxns(userId: string, from: Date, to: Date, filter: TxnFilter = {}): Promise<LoadedTxn[]> {
  const where: Prisma.TransactionWhereInput = {
    userId,
    deletedAt: null,
    date: { gte: from, lt: to },
    ...(filter.accountIds?.length ? { accountId: { in: filter.accountIds } } : {}),
    ...(filter.merchant ? { merchant: { equals: filter.merchant, mode: "insensitive" } } : {}),
    ...(filter.categoryIds?.length
      ? { OR: [{ categoryId: { in: filter.categoryIds } }, { splits: { some: { categoryId: { in: filter.categoryIds } } } }] }
      : {}),
  };
  const rows = await db.transaction.findMany({
    where,
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      baseAmount: true,
      categoryId: true,
      merchant: true,
      description: true,
      isReimbursable: true,
      date: true,
      accountId: true,
      recurringId: true,
      toAccountId: true,
      splits: { select: { categoryId: true, amount: true } },
    },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ ...r, amount: r.amount, baseAmount: r.baseAmount }));
}

export function aggOpts(prefs: { includePending: boolean; excludeReimbursable: boolean }): AggregateOptions {
  return { includePending: prefs.includePending, excludeReimbursable: prefs.excludeReimbursable };
}

export type CategoryInfo = Pick<Category, "id" | "name" | "icon" | "color" | "parentId" | "kind" | "isEssential">;

export async function getCategoryMap(userId: string): Promise<Map<string, CategoryInfo>> {
  const cats = await db.category.findMany({
    where: { userId },
    select: { id: true, name: true, icon: true, color: true, parentId: true, kind: true, isEssential: true },
  });
  return new Map(cats.map((c) => [c.id, c]));
}

/** Roll subcategory totals into their top-level parent. */
export function rollUpToParents(map: Map<string | null, Decimal>, cats: Map<string, CategoryInfo>): Map<string | null, Decimal> {
  const out = new Map<string | null, Decimal>();
  for (const [k, v] of map) {
    const parent = k ? cats.get(k)?.parentId ?? k : null;
    out.set(parent, (out.get(parent) ?? new Decimal(0)).plus(v));
  }
  return out;
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  amount: Decimal;
  percent: number;
}

export function toSlices(map: Map<string | null, Decimal>, cats: Map<string, CategoryInfo>): CategorySlice[] {
  const total = [...map.values()].reduce((a, b) => (b.gt(0) ? a.plus(b) : a), new Decimal(0));
  return [...map.entries()]
    .filter(([, v]) => v.gt(0))
    .map(([k, v]) => {
      const c = k ? cats.get(k) : undefined;
      return {
        categoryId: k,
        name: c?.name ?? "Uncategorized",
        icon: c?.icon ?? "circle-dashed",
        color: c?.color ?? "other",
        amount: v,
        percent: total.isZero() ? 0 : v.div(total).times(100).toDecimalPlaces(1).toNumber(),
      };
    })
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

/** Income / expense series bucketed by day, week or month depending on range length. */
export function cashFlowSeries(txns: LoadedTxn[], from: Date, to: Date, tz: string, opts: AggregateOptions, monthly = false) {
  const buckets = monthly ? monthBuckets(from, to, tz) : timeBuckets(from, to, tz);
  let bi = 0;
  const grouped: LoadedTxn[][] = buckets.map(() => []);
  for (const t of txns) {
    while (bi < buckets.length - 1 && t.date >= buckets[bi].end) bi++;
    if (t.date >= buckets[bi].start && t.date < buckets[bi].end) grouped[bi].push(t);
    else {
      const idx = buckets.findIndex((b) => t.date >= b.start && t.date < b.end);
      if (idx >= 0) grouped[idx].push(t);
    }
  }
  return buckets.map((b, i) => {
    const cf = cashFlow(grouped[i], opts);
    return { key: b.key, label: b.label, start: b.start, income: cf.income, expenses: cf.expenses, net: cf.net };
  });
}

export function summarize(txns: LoadedTxn[], opts: AggregateOptions) {
  return cashFlow(txns, opts);
}

export function categoryTotals(txns: LoadedTxn[], opts: AggregateOptions, cats: Map<string, CategoryInfo>, rollUp = true) {
  const raw = spendingByCategory(txns, opts);
  return rollUp ? rollUpToParents(raw, cats) : raw;
}

export function n(d: Decimal | null | undefined): number {
  return d ? d.toDecimalPlaces(2).toNumber() : 0;
}

export { dec };
