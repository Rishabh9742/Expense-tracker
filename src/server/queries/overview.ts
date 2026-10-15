import { addDays, subDays } from "date-fns";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import { previousRange, startOfDayTz, type DateRange } from "@/lib/dates";
import { Decimal, dec, formatMoney, money } from "@/lib/money";
import { cashFlow, findUnusual, percentChange } from "@/lib/finance/aggregate";
import { aggOpts, cashFlowSeries, categoryTotals, getCategoryMap, loadTxns, toSlices } from "@/server/services/analytics";
import { getAccountsWithBalances, liquidBalance } from "@/server/services/balances";
import { getBudgetsWithStatus } from "@/server/services/budgets";
import { getBills, getGoals, getNetWorth, getSubscriptionsSummary } from "@/server/services/planning";
import { TXN_INCLUDE, toTxnDTO } from "@/lib/dto";

export const WIDGETS = [
  { id: "cashflow", label: "Cash flow" },
  { id: "categories", label: "Spending by category" },
  { id: "budgets", label: "Budget progress" },
  { id: "insights", label: "Insights" },
  { id: "recent", label: "Recent transactions" },
  { id: "bills", label: "Upcoming bills" },
  { id: "goals", label: "Savings goals" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "accounts", label: "Accounts" },
  { id: "timeline", label: "Activity timeline" },
] as const;
export type WidgetId = (typeof WIDGETS)[number]["id"];

export function resolveLayout(saved: unknown): { id: WidgetId; hidden: boolean }[] {
  const ids = WIDGETS.map((w) => w.id) as string[];
  const arr = Array.isArray(saved) ? (saved as { id: string; hidden: boolean }[]).filter((x) => ids.includes(x.id)) : [];
  const seen = new Set(arr.map((a) => a.id));
  return [...arr, ...WIDGETS.filter((w) => !seen.has(w.id)).map((w) => ({ id: w.id, hidden: false }))] as { id: WidgetId; hidden: boolean }[];
}

export async function getOverviewData(user: CurrentUser, range: DateRange) {
  const p = user.prefs;
  const opts = aggOpts(p);
  const fm = (v: Decimal | string | number) => formatMoney(v, p.baseCurrency, { locale: p.locale });
  const now = new Date();
  // For a period still in progress, compare against the same elapsed span of the previous
  // period (e.g. 1–15 Oct vs 1–15 Sep), not the whole previous period.
  const fullPrev = previousRange(range);
  const inProgress = range.to > now && range.from < now;
  const prev = inProgress ? { ...fullPrev, to: new Date(Math.min(fullPrev.to.getTime(), fullPrev.from.getTime() + (now.getTime() - range.from.getTime()))) } : fullPrev;
  const prefs = { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable };

  const [txns, prevTxns, cats, accounts, budgets, bills, goals, subs, nw, recentRows, txnCount, history] = await Promise.all([
    loadTxns(user.id, range.from, range.to),
    loadTxns(user.id, prev.from, prev.to),
    getCategoryMap(user.id),
    getAccountsWithBalances(user.id, p.baseCurrency, { includePending: p.includePending }),
    getBudgetsWithStatus(user.id, p, now),
    getBills(user.id, prefs, 30),
    getGoals(user.id, prefs),
    getSubscriptionsSummary(user.id, prefs),
    getNetWorth(user.id, prefs),
    db.transaction.findMany({ where: { userId: user.id, deletedAt: null }, include: TXN_INCLUDE, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 7 }),
    db.transaction.count({ where: { userId: user.id, deletedAt: null } }),
    db.transaction.findMany({
      where: { userId: user.id, deletedAt: null, type: "EXPENSE", baseAmount: { not: null }, date: { gte: subDays(range.from, 180), lt: range.from } },
      select: { categoryId: true, baseAmount: true },
    }),
  ]);

  const cf = cashFlow(txns, opts);
  const prevCf = cashFlow(prevTxns, opts);
  const catMap = categoryTotals(txns, opts, cats);
  const prevCatMap = categoryTotals(prevTxns, opts, cats);
  const slices = toSlices(catMap, cats);
  const series = cashFlowSeries(txns, range.from, range.to, range.tz, opts);
  const liquid = liquidBalance(accounts);

  // Budget utilization across monthly budgets
  const totalBudgeted = budgets.reduce((a, b) => a.plus(b.status.available), new Decimal(0));
  const totalSpent = budgets.reduce((a, b) => a.plus(b.status.spent), new Decimal(0));
  const utilization = totalBudgeted.gt(0) ? totalSpent.div(totalBudgeted).times(100).toDecimalPlaces(1).toNumber() : null;

  // Unusual spending in range
  const unusual = findUnusual(
    txns.filter((t) => t.type === "EXPENSE" && t.baseAmount != null).map((t) => ({ id: t.id, categoryId: t.categoryId, base: dec(t.baseAmount) })),
    history.map((h) => ({ categoryId: h.categoryId, base: dec(h.baseAmount) })),
  )
    .slice(0, 3)
    .map((u) => {
      const t = txns.find((x) => x.id === u.id)!;
      return { id: t.id, description: t.description, amount: money(dec(t.baseAmount).abs()), median: money(u.median), date: t.date.toISOString(), category: t.categoryId ? cats.get(t.categoryId)?.name ?? null : null };
    });

  // Deterministic insights
  const insights: { tone: "positive" | "negative" | "neutral" | "warning"; text: string }[] = [];
  const spendChange = percentChange(cf.expenses, prevCf.expenses);
  if (spendChange !== null && cf.count > 0) {
    insights.push({
      tone: spendChange > 5 ? "negative" : spendChange < -5 ? "positive" : "neutral",
      text: `Spending is ${spendChange > 0 ? "up" : "down"} ${Math.abs(spendChange).toFixed(1)}% ${inProgress ? "versus the same point in the previous period" : "versus the previous period"} (${fm(prevCf.expenses)} → ${fm(cf.expenses)}).`,
    });
  }
  let biggest: { name: string; delta: Decimal; pct: number | null } | null = null;
  for (const [k, v] of catMap) {
    const before = prevCatMap.get(k) ?? new Decimal(0);
    const delta = v.minus(before);
    if (delta.gt(0) && (!biggest || delta.gt(biggest.delta))) biggest = { name: k ? cats.get(k)?.name ?? "Uncategorized" : "Uncategorized", delta, pct: percentChange(v, before) };
  }
  if (biggest && biggest.delta.gt(0)) insights.push({ tone: "warning", text: `${biggest.name} increased the most: +${fm(biggest.delta)}${biggest.pct !== null ? ` (${biggest.pct > 0 ? "+" : ""}${biggest.pct}%)` : ""}.` });
  if (cf.savingsRate !== null) insights.push({ tone: cf.savingsRate >= 20 ? "positive" : cf.savingsRate < 0 ? "negative" : "neutral", text: `You kept ${cf.savingsRate}% of your income this period${cf.savingsRate >= 20 ? " — a healthy savings rate." : cf.savingsRate < 0 ? ", meaning spending exceeded income." : "."}` });
  const over = budgets.filter((b) => b.status.level === "over");
  const atRisk = budgets.filter((b) => b.status.level !== "over" && b.status.forecastOver);
  if (over.length) insights.push({ tone: "negative", text: `${over.map((b) => b.budget.name).slice(0, 3).join(", ")} ${over.length === 1 ? "is" : "are"} over budget.` });
  if (atRisk.length) insights.push({ tone: "warning", text: `At the current pace, ${atRisk.map((b) => b.budget.name).slice(0, 3).join(", ")} will exceed ${atRisk.length === 1 ? "its" : "their"} budget by period end.` });
  if (subs.monthlyTotal.gt(0) && cf.income.gt(0)) {
    const share = subs.monthlyTotal.div(cf.income).times(100).toDecimalPlaces(1).toNumber();
    insights.push({ tone: "neutral", text: `Subscriptions cost ${fm(subs.monthlyTotal)} per month (${fm(subs.annualTotal)} a year) — ${share}% of this period's income.` });
  }

  // Timeline: transactions + goal contributions + debt payments + bill payments (latest first)
  const since = subDays(now, 30);
  const [contribs, debtPays, billPays] = await Promise.all([
    db.goalContribution.findMany({ where: { goal: { userId: user.id }, date: { gte: since } }, include: { goal: { select: { name: true, currency: true } } }, orderBy: { date: "desc" }, take: 5 }),
    db.debtPayment.findMany({ where: { debt: { userId: user.id }, date: { gte: since } }, include: { debt: { select: { name: true, currency: true } } }, orderBy: { date: "desc" }, take: 5 }),
    db.billPayment.findMany({ where: { bill: { userId: user.id }, paidAt: { gte: since } }, include: { bill: { select: { name: true, currency: true } } }, orderBy: { paidAt: "desc" }, take: 5 }),
  ]);
  const timeline = [
    ...recentRows.slice(0, 5).map((t) => ({ kind: t.type.toLowerCase(), title: t.description, amount: t.amount.toString(), currency: t.currency, date: t.date.toISOString() })),
    ...contribs.map((c) => ({ kind: "goal", title: `Contribution to ${c.goal.name}`, amount: c.amount.toString(), currency: c.goal.currency, date: c.date.toISOString() })),
    ...debtPays.map((d) => ({ kind: "debt", title: `Payment to ${d.debt.name}`, amount: d.amount.negated().toString(), currency: d.debt.currency, date: d.date.toISOString() })),
    ...billPays.map((b) => ({ kind: "bill", title: `${b.bill.name} paid`, amount: b.amount.negated().toString(), currency: b.bill.currency, date: b.paidAt.toISOString() })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  const today = startOfDayTz(now, p.timezone);
  return {
    range: { key: range.key, label: range.label, from: range.from.toISOString(), to: range.to.toISOString() },
    isEmpty: txnCount === 0 && accounts.length === 0,
    hasAccounts: accounts.length > 0,
    txnCount,
    summary: {
      liquid: money(liquid.total),
      liquidMissing: liquid.missing,
      income: money(cf.income),
      expenses: money(cf.expenses),
      refunds: money(cf.refunds),
      net: money(cf.net),
      savingsRate: cf.savingsRate,
      prevSavingsRate: prevCf.savingsRate,
      incomeChange: percentChange(cf.income, prevCf.income),
      expenseChange: spendChange,
      netWorth: money(nw.result.netWorth),
      liabilities: money(nw.result.totalLiabilities),
      assets: money(nw.result.totalAssets),
      utilization,
      unconverted: cf.unconverted,
      prevExpenses: money(prevCf.expenses),
      comparisonLabel: inProgress ? "vs same point last period" : "vs previous period",
    },
    series: series.map((s) => ({ key: s.key, label: s.label, income: s.income.toDecimalPlaces(2).toNumber(), expenses: s.expenses.toDecimalPlaces(2).toNumber() })),
    seriesGranularity: series.length > 0 && series.length <= 45 && range.to.getTime() - range.from.getTime() <= 46 * 86400000 ? "day" : "period",
    categories: slices.slice(0, 8).map((s) => ({ ...s, amount: money(s.amount), prev: money(prevCatMap.get(s.categoryId) ?? 0) })),
    categoryTotal: money(cf.expenses),
    budgets: budgets.slice(0, 5).map((b) => ({
      id: b.budget.id,
      name: b.budget.name,
      icon: b.budget.category?.icon ?? "piggy-bank",
      color: b.budget.category?.color ?? "other",
      available: money(b.status.available),
      spent: money(b.status.spent),
      remaining: money(b.status.remaining),
      percent: b.status.percentUsed,
      level: b.status.level,
      daysLeft: b.status.daysLeft,
      forecastOver: b.status.forecastOver,
    })),
    budgetCount: budgets.length,
    recent: recentRows.map(toTxnDTO),
    bills: bills.rows
      .filter((b) => b.nextDueDate <= addDays(today, 30))
      .slice(0, 5)
      .map((b) => ({ id: b.id, name: b.name, amount: money(b.amount), currency: b.currency, dueDate: b.nextDueDate.toISOString(), daysUntil: b.daysUntil, state: b.state, isVariable: b.isVariable })),
    billsMonthly: money(bills.monthlyObligation),
    goals: goals.slice(0, 4).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      saved: money(g.saved),
      target: money(g.targetAmount),
      currency: g.currency,
      percent: g.projection.percent,
      basis: g.savedBasis,
      onTrack: g.projection.onTrack,
      targetDate: g.targetDate?.toISOString() ?? null,
    })),
    subscriptions: {
      monthly: money(subs.monthlyTotal),
      annual: money(subs.annualTotal),
      activeCount: subs.rows.filter((s) => s.status === "ACTIVE").length,
      upcoming: subs.upcoming.slice(0, 4).map((s) => ({ id: s.id, name: s.name, amount: money(s.amount), currency: s.currency, nextDate: s.nextDate.toISOString() })),
      changed: subs.recentlyChanged.length,
    },
    accounts: accounts.slice(0, 6).map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: money(a.balance), baseBalance: a.baseBalance ? money(a.baseBalance) : null, institution: a.institution })),
    insights,
    unusual,
    timeline,
    layout: resolveLayout(p.dashboardLayout),
    onboarding: {
      dismissed: p.onboardingDismissed,
      hasAccount: accounts.length > 0,
      hasTransaction: txnCount > 0,
      hasBudget: budgets.length > 0,
      hasGoal: goals.length > 0,
      hasImport: (await db.importBatch.count({ where: { userId: user.id } })) > 0,
    },
  };
}

export type OverviewData = Awaited<ReturnType<typeof getOverviewData>>;
