import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { getAccountsWithBalances } from "@/server/services/balances";
import { money } from "@/lib/money";
import { AccountsView } from "@/components/accounts/accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const accounts = await getAccountsWithBalances(user.id, user.prefs.baseCurrency, { includeClosed: true, includePending: user.prefs.includePending });
  return (
    <AccountsView
      autoNew={sp.new === "1"}
      baseCurrency={user.prefs.baseCurrency}
      bankSyncConfigured={!!process.env.BANK_SYNC_PROVIDER}
      accounts={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        institution: a.institution,
        status: a.status,
        notes: a.notes,
        balance: money(a.balance),
        baseBalance: a.baseBalance ? money(a.baseBalance) : null,
        openingBalance: money(a.openingBalance),
        openingDate: a.openingDate.toISOString(),
        lastReconciledAt: a.lastReconciledAt?.toISOString() ?? null,
        includeInNetWorth: a.includeInNetWorth,
        transactionCount: a.transactionCount,
        isLiability: a.isLiability,
        isSample: a.isSample,
      }))}
    />
  );
}
