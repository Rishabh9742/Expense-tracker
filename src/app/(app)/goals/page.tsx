import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/money";
import { getGoals } from "@/server/services/planning";
import { GoalsView } from "@/components/planning/goals-view";

export const metadata: Metadata = { title: "Savings Goals" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const p = user.prefs;
  const goals = await getGoals(user.id, { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable });
  return (
    <GoalsView
      autoNew={sp.new === "1"}
      goals={goals.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        icon: g.icon,
        targetAmount: money(g.targetAmount),
        currency: g.currency,
        manualBalance: money(g.manualBalance),
        targetDate: g.targetDate?.toISOString() ?? null,
        linkedAccountId: g.linkedAccountId,
        linkedAccountName: g.linkedAccount?.name ?? null,
        monthlyContribution: g.monthlyContribution ? money(g.monthlyContribution) : null,
        priority: g.priority,
        saved: money(g.saved),
        manualSaved: money(g.manualSaved),
        accountSaved: g.accountSaved ? money(g.accountSaved) : null,
        savedBasis: g.savedBasis,
        percent: g.projection.percent,
        remaining: money(g.projection.remaining),
        requiredMonthly: g.projection.requiredMonthly ? money(g.projection.requiredMonthly) : null,
        projectedDate: g.projection.projectedDate?.toISOString() ?? null,
        onTrack: g.projection.onTrack,
        contributions: g.contributions.map((c) => ({ id: c.id, amount: money(c.amount), date: c.date.toISOString(), note: c.note })),
      }))}
    />
  );
}
