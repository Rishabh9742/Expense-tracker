import type { Metadata } from "next";
import { subMonths } from "date-fns";
import { requireUser } from "@/lib/session";
import { money, Decimal } from "@/lib/money";
import { resolveRange } from "@/lib/dates";
import { cashFlow } from "@/lib/finance/aggregate";
import { getBudgetsWithStatus, unassigned } from "@/server/services/budgets";
import { aggOpts, categoryTotals, getCategoryMap, loadTxns } from "@/server/services/analytics";
import { BudgetsView } from "@/components/budgets/budgets-view";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const p = user.prefs;
  const month = resolveRange("this_month", p.timezone);
  const threeMonthsStart = subMonths(month.from, 3);
  const [budgets, monthTxns, history, cats] = await Promise.all([
    getBudgetsWithStatus(user.id, p),
    loadTxns(user.id, month.from, month.to),
    loadTxns(user.id, threeMonthsStart, month.from),
    getCategoryMap(user.id),
  ]);
  const income = cashFlow(monthTxns, aggOpts(p)).income;

  // Recommendations: top categories by 3-month average spending that have no budget yet.
  const budgeted = new Set(budgets.map((b) => b.budget.categoryId).filter(Boolean));
  const avg = categoryTotals(history, aggOpts(p), cats);
  const suggestions = [...avg.entries()]
    .filter(([k, v]) => k && !budgeted.has(k) && v.gt(0) && cats.get(k)?.kind === "EXPENSE")
    .map(([k, v]) => ({ categoryId: k!, name: cats.get(k!)!.name, icon: cats.get(k!)!.icon, monthlyAverage: money(v.div(3).toDecimalPlaces(0)) }))
    .sort((a, b) => Number(b.monthlyAverage) - Number(a.monthlyAverage))
    .slice(0, 4);

  return (
    <BudgetsView
      autoNew={sp.new === "1"}
      monthLabel={month.label}
      income={money(income)}
      unassigned={money(unassigned(income, budgets))}
      allocated={money(budgets.filter((b) => b.budget.period === "MONTHLY" && b.budget.scope !== "OVERALL").reduce((a, b) => a.plus(b.status.budgeted), new Decimal(0)))}
      suggestions={suggestions}
      budgets={budgets.map(({ budget: b, period, status: s }) => ({
        id: b.id,
        name: b.name,
        scope: b.scope,
        method: b.method,
        period: b.period,
        amount: money(b.amount),
        percentOfIncome: b.percentOfIncome?.toString() ?? null,
        categoryId: b.categoryId,
        categoryIcon: b.category?.icon ?? null,
        categoryColor: b.category?.color ?? null,
        accountId: b.accountId,
        accountName: b.account?.name ?? null,
        merchant: b.merchant,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate?.toISOString() ?? null,
        alertLevels: b.alertLevels,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        budgeted: money(s.budgeted),
        rollover: money(s.rollover),
        available: money(s.available),
        spent: money(s.spent),
        remaining: money(s.remaining),
        percentUsed: s.percentUsed,
        daysLeft: s.daysLeft,
        dailyAllowance: money(s.dailyAllowance),
        forecast: money(s.forecast),
        forecastOver: s.forecastOver,
        level: s.level,
        thresholdReached: s.thresholdReached,
      }))}
    />
  );
}
