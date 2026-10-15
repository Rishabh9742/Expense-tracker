import type { Account } from "@prisma/client";
import { db } from "@/lib/db";
import { getRate } from "@/lib/fx";
import { Decimal, dec } from "@/lib/money";
import { isLiabilityAccount } from "@/lib/finance/networth";

export interface AccountWithBalance extends Account {
  balance: Decimal;
  baseBalance: Decimal | null;
  rateSource: string | null;
  transactionCount: number;
  isLiability: boolean;
}

/**
 * Transaction-based balances, optionally as of a moment (exclusive).
 * balance = openingBalance + Σ own signed amounts + Σ incoming transfer credits.
 */
export async function getAccountsWithBalances(
  userId: string,
  baseCurrency: string,
  opts: { includePending?: boolean; asOf?: Date; includeClosed?: boolean; accountIds?: string[] } = {},
): Promise<AccountWithBalance[]> {
  const accounts = await db.account.findMany({
    where: {
      userId,
      ...(opts.includeClosed ? {} : { status: "ACTIVE" }),
      ...(opts.accountIds?.length ? { id: { in: opts.accountIds } } : {}),
      ...(opts.asOf ? { openingDate: { lt: opts.asOf } } : {}),
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  if (!accounts.length) return [];
  const ids = accounts.map((a) => a.id);
  const statusFilter = opts.includePending === false ? { status: "CLEARED" as const } : {};
  const dateFilter = opts.asOf ? { date: { lt: opts.asOf } } : {};
  const [own, incoming] = await Promise.all([
    db.transaction.groupBy({
      by: ["accountId"],
      where: { userId, deletedAt: null, accountId: { in: ids }, ...statusFilter, ...dateFilter },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["toAccountId"],
      where: { userId, deletedAt: null, toAccountId: { in: ids }, ...statusFilter, ...dateFilter },
      _sum: { toAmount: true },
      _count: { _all: true },
    }),
  ]);
  const ownMap = new Map(own.map((o) => [o.accountId, o]));
  const inMap = new Map(incoming.map((o) => [o.toAccountId!, o]));
  const at = opts.asOf ?? new Date();
  const out: AccountWithBalance[] = [];
  for (const a of accounts) {
    const o = ownMap.get(a.id);
    const i = inMap.get(a.id);
    const balance = dec(a.openingBalance).plus(dec(o?._sum.amount)).plus(dec(i?._sum.toAmount));
    const rate = await getRate(a.currency, baseCurrency, at, userId);
    out.push({
      ...a,
      balance,
      baseBalance: rate ? balance.times(rate.rate).toDecimalPlaces(4) : null,
      rateSource: rate?.source ?? null,
      transactionCount: (o?._count._all ?? 0) + (i?._count._all ?? 0),
      isLiability: isLiabilityAccount(a.type),
    });
  }
  return out;
}

/** Liquid balance: cash, checking, savings and wallets (excludes cards, loans, investments). */
export function liquidBalance(accounts: AccountWithBalance[]): { total: Decimal; missing: string[] } {
  let total = new Decimal(0);
  const missing: string[] = [];
  for (const a of accounts) {
    if (!["CASH", "CHECKING", "SAVINGS", "DIGITAL_WALLET"].includes(a.type)) continue;
    if (a.baseBalance === null) missing.push(a.name);
    else total = total.plus(a.baseBalance);
  }
  return { total, missing };
}
