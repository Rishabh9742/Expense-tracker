import type { Prisma } from "@prisma/client";
import { subDays } from "date-fns";
import { db } from "@/lib/db";
import { parseLocalDate } from "@/lib/dates";
import { TXN_INCLUDE, toTxnDTO } from "@/lib/dto";
import { findPossibleDuplicates } from "@/lib/finance/duplicates";
import { cashFlow } from "@/lib/finance/aggregate";
import { money } from "@/lib/money";

export const PAGE_SIZE = 50;
const SORTS = ["date", "amount", "description", "merchant", "account", "category"] as const;
type Sort = (typeof SORTS)[number];

export interface TxnQuery {
  q?: string;
  type?: string;
  accountId?: string;
  categoryId?: string;
  tag?: string;
  min?: string;
  max?: string;
  from?: string;
  to?: string;
  status?: string;
  review?: string;
  dupes?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export function parseTxnQuery(sp: Record<string, string | string[] | undefined>): TxnQuery {
  const out: TxnQuery = {};
  for (const k of ["q", "type", "accountId", "categoryId", "tag", "min", "max", "from", "to", "status", "review", "dupes", "sort", "dir", "page"] as const) {
    const v = sp[k];
    if (typeof v === "string" && v.length <= 200) out[k] = v;
  }
  return out;
}

export async function buildWhere(userId: string, q: TxnQuery, tz: string): Promise<Prisma.TransactionWhereInput> {
  const and: Prisma.TransactionWhereInput[] = [{ userId, deletedAt: null }];
  if (q.q) {
    const term = q.q.trim();
    and.push({
      OR: [
        { description: { contains: term, mode: "insensitive" } },
        { merchant: { contains: term, mode: "insensitive" } },
        { notes: { contains: term, mode: "insensitive" } },
        { tags: { some: { tag: { name: { equals: term.replace(/^#/, ""), mode: "insensitive" } } } } },
      ],
    });
  }
  if (q.type && ["EXPENSE", "INCOME", "TRANSFER", "REFUND", "ADJUSTMENT"].includes(q.type)) and.push({ type: q.type as Prisma.EnumTransactionTypeFilter["equals"] });
  if (q.accountId) and.push({ OR: [{ accountId: q.accountId }, { toAccountId: q.accountId }] });
  if (q.categoryId === "none") and.push({ categoryId: null, splits: { none: {} }, type: { in: ["EXPENSE", "INCOME", "REFUND"] } });
  else if (q.categoryId) {
    const all = await db.category.findMany({ where: { userId }, select: { id: true, parentId: true } });
    const ids = new Set([q.categoryId]);
    for (const c of all) if (c.parentId === q.categoryId) ids.add(c.id);
    and.push({ OR: [{ categoryId: { in: [...ids] } }, { splits: { some: { categoryId: { in: [...ids] } } } }] });
  }
  if (q.tag) and.push({ tags: { some: { tag: { name: q.tag } } } });
  // Amount filters compare magnitudes
  if (q.min && !Number.isNaN(Number(q.min))) and.push({ OR: [{ amount: { gte: q.min } }, { amount: { lte: `-${q.min}` } }] });
  if (q.max && !Number.isNaN(Number(q.max))) and.push({ amount: { gte: `-${q.max}`, lte: q.max } });
  try {
    if (q.from) and.push({ date: { gte: parseLocalDate(q.from, tz) } });
    if (q.to) and.push({ date: { lt: new Date(parseLocalDate(q.to, tz).getTime() + 86400000) } });
  } catch {}
  if (q.status === "PENDING" || q.status === "CLEARED") and.push({ status: q.status });
  if (q.review === "1") and.push({ needsReview: true });
  return { AND: and };
}

function orderBy(q: TxnQuery): Prisma.TransactionOrderByWithRelationInput[] {
  const sort: Sort = (SORTS as readonly string[]).includes(q.sort ?? "") ? (q.sort as Sort) : "date";
  const dir: Prisma.SortOrder = q.dir === "asc" ? "asc" : "desc";
  switch (sort) {
    case "amount":
      return [{ amount: dir }, { date: "desc" }];
    case "description":
      return [{ description: dir }, { date: "desc" }];
    case "merchant":
      return [{ merchant: { sort: dir, nulls: "last" } }, { date: "desc" }];
    case "account":
      return [{ account: { name: dir } }, { date: "desc" }];
    case "category":
      return [{ category: { name: dir } }, { date: "desc" }];
    default:
      return [{ date: dir }, { createdAt: dir }];
  }
}

export async function queryTransactions(userId: string, q: TxnQuery, tz: string, prefs: { includePending: boolean; excludeReimbursable: boolean }) {
  const where = await buildWhere(userId, q, tz);
  const page = Math.max(1, Math.min(10000, Number(q.page) || 1));

  if (q.dupes === "1") {
    const recent = await db.transaction.findMany({
      where: { ...where, date: { gte: subDays(new Date(), 365) } },
      select: { id: true, accountId: true, date: true, amount: true, description: true, merchant: true },
    });
    const ids = [...new Set(findPossibleDuplicates(recent).flat())];
    const rows = await db.transaction.findMany({ where: { id: { in: ids } }, include: TXN_INCLUDE, orderBy: [{ amount: "asc" }, { date: "desc" }] });
    return { rows: rows.map(toTxnDTO), total: rows.length, page: 1, pages: 1, totals: null };
  }

  const [rows, total, agg] = await Promise.all([
    db.transaction.findMany({ where, include: TXN_INCLUDE, orderBy: orderBy(q), skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.transaction.count({ where }),
    db.transaction.findMany({ where, select: { type: true, status: true, amount: true, baseAmount: true, isReimbursable: true }, take: 20000 }),
  ]);
  const cf = cashFlow(agg, prefs);
  return {
    rows: rows.map(toTxnDTO),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    totals: { income: money(cf.income), expenses: money(cf.expenses), net: money(cf.net), unconverted: cf.unconverted },
  };
}
