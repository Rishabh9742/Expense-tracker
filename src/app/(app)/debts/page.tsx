import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/money";
import { getDebts } from "@/server/services/planning";
import { DebtsView } from "@/components/planning/debts-view";

export const metadata: Metadata = { title: "Debts & Loans" };

export default async function DebtsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const p = user.prefs;
  const { rows, total, totalMinimum } = await getDebts(user.id, { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable });
  return (
    <DebtsView
      autoNew={sp.new === "1"}
      total={money(total)}
      totalMinimum={money(totalMinimum)}
      debts={rows.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        lender: d.lender,
        currency: d.currency,
        originalPrincipal: money(d.originalPrincipal),
        currentBalance: money(d.currentBalance),
        balance: money(d.balance),
        baseBalance: d.baseBalance ? money(d.baseBalance) : null,
        balanceSource: d.balanceSource,
        interestRate: d.interestRate?.toString() ?? null,
        minimumPayment: d.minimumPayment ? money(d.minimumPayment) : null,
        dueDay: d.dueDay,
        startDate: d.startDate?.toISOString() ?? null,
        termMonths: d.termMonths,
        linkedAccountId: d.linkedAccountId,
        linkedAccountName: d.linkedAccount?.name ?? null,
        customOrder: d.customOrder,
        notes: d.notes,
        closedAt: d.closedAt?.toISOString() ?? null,
        progress: d.progress,
        payments: d.payments.map((x) => ({ id: x.id, date: x.date.toISOString(), amount: money(x.amount), principal: x.principal ? money(x.principal) : null, interest: x.interest ? money(x.interest) : null, isExtra: x.isExtra })),
      }))}
    />
  );
}
