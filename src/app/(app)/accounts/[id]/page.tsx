import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addDays, subDays } from "date-fns";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { dec, money } from "@/lib/money";
import { formatLocal, startOfDayTz } from "@/lib/dates";
import { TXN_INCLUDE, toTxnDTO } from "@/lib/dto";
import { getAccountsWithBalances } from "@/server/services/balances";
import { AccountDetail } from "@/components/accounts/account-detail";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [acct] = await getAccountsWithBalances(user.id, user.prefs.baseCurrency, { accountIds: [id], includeClosed: true, includePending: user.prefs.includePending });
  if (!acct) notFound();

  const tz = user.prefs.timezone;
  const start = startOfDayTz(subDays(new Date(), 89), tz);
  const [txns, before, cleared] = await Promise.all([
    db.transaction.findMany({
      where: { userId: user.id, deletedAt: null, OR: [{ accountId: id }, { toAccountId: id }] },
      include: TXN_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    // Balance at the start of the chart window
    getAccountsWithBalances(user.id, user.prefs.baseCurrency, { accountIds: [id], asOf: start, includeClosed: true, includePending: user.prefs.includePending }),
    getAccountsWithBalances(user.id, user.prefs.baseCurrency, { accountIds: [id], includeClosed: true, includePending: false }),
  ]);
  const windowTxns = await db.transaction.findMany({
    where: { userId: user.id, deletedAt: null, date: { gte: start }, OR: [{ accountId: id }, { toAccountId: id }], ...(user.prefs.includePending ? {} : { status: "CLEARED" }) },
    select: { date: true, amount: true, accountId: true, toAccountId: true, toAmount: true },
    orderBy: { date: "asc" },
  });
  // Opened before the window → start from its balance then; otherwise start at zero and add the opening balance on its day.
  let running = before[0]?.balance ?? dec(0);
  const history: { label: string; balance: number }[] = [];
  let idx = 0;
  for (let i = 0; i < 90; i++) {
    const dayStart = addDays(start, i);
    const dayEnd = addDays(start, i + 1);
    if (acct.openingDate >= dayStart && acct.openingDate < dayEnd) running = running.plus(acct.openingBalance);
    while (idx < windowTxns.length && windowTxns[idx].date < dayEnd) {
      const t = windowTxns[idx++];
      if (t.accountId === id) running = running.plus(t.amount);
      if (t.toAccountId === id) running = running.plus(t.toAmount ?? 0);
    }
    history.push({ label: formatLocal(dayStart, tz, "d MMM"), balance: (acct.isLiability ? running.negated() : running).toDecimalPlaces(2).toNumber() });
  }

  return (
    <AccountDetail
      account={{
        id: acct.id,
        name: acct.name,
        type: acct.type,
        currency: acct.currency,
        institution: acct.institution,
        status: acct.status,
        balance: money(acct.balance),
        clearedBalance: money(cleared[0]?.balance ?? acct.balance),
        baseBalance: acct.baseBalance ? money(acct.baseBalance) : null,
        lastReconciledAt: acct.lastReconciledAt?.toISOString() ?? null,
        reconciledBalance: acct.reconciledBalance ? money(acct.reconciledBalance) : null,
        isLiability: acct.isLiability,
        notes: acct.notes,
        pendingCount: txns.filter((t) => t.status === "PENDING").length,
      }}
      history={history}
      transactions={txns.map(toTxnDTO)}
      baseCurrency={user.prefs.baseCurrency}
    />
  );
}
