import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import { RANGE_KEYS, toLocalYmd, previousRange, resolveRange, type DateRange, type RangeKey } from "@/lib/dates";
import { Decimal, dec, formatMoney } from "@/lib/money";
import { cashFlow, percentChange, spendingByCategory } from "@/lib/finance/aggregate";
import { aggOpts, getCategoryMap, loadTxns, rollUpToParents, type CategoryInfo } from "@/server/services/analytics";
import { getAccountsWithBalances, liquidBalance } from "@/server/services/balances";
import { getBudgetsWithStatus } from "@/server/services/budgets";
import { getBills, getGoals, getSubscriptionsSummary } from "@/server/services/planning";

/**
 * Read-only analytical tools. Every number is computed deterministically from the
 * user's own records (scoped by user id) — the language model only chooses which tool
 * to call and explains the result. No tool writes data, and no SQL is ever generated.
 */

export const PERIODS = [...RANGE_KEYS.filter((k) => k !== "custom"), "last_quarter", "this_quarter"] as const;
export type Period = (typeof PERIODS)[number];

export interface Basis {
  period: string;
  from: string;
  to: string;
  currency: string;
  calculation: string;
}

export interface ToolResult {
  data: unknown;
  basis: Basis;
}

export function resolvePeriod(period: string | null | undefined, user: CurrentUser): DateRange {
  const tz = user.prefs.timezone;
  const now = new TZDate(new Date(), tz);
  if (period === "last_quarter" || period === "this_quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const startQ = period === "this_quarter" ? q : q - 1;
    const year = now.getFullYear() + Math.floor(startQ / 4);
    const qq = ((startQ % 4) + 4) % 4;
    const from = new TZDate(year, qq * 3, 1, tz);
    const to = new TZDate(year, qq * 3 + 3, 1, tz);
    return { key: "custom", from: new Date(from.getTime()), to: new Date(to.getTime()), label: `Q${qq + 1} ${year}`, tz };
  }
  const key = (RANGE_KEYS as readonly string[]).includes(period ?? "") ? (period as RangeKey) : "this_month";
  return resolveRange(key, tz, new Date(), undefined, user.prefs.weekStartsOn === 0 ? 0 : 1);
}

const SYNONYMS: Record<string, string[]> = {
  food: ["groceries", "dining", "restaurants", "coffee", "food delivery"],
  eating: ["dining", "restaurants", "food delivery"],
  transport: ["transportation", "fuel", "rideshare", "public transit", "parking"],
  transportation: ["transportation", "fuel", "rideshare", "public transit", "parking"],
  travel: ["travel"],
  bills: ["utilities", "phone & internet", "electricity", "water"],
  health: ["healthcare"],
  medical: ["healthcare"],
  entertainment: ["entertainment", "subscriptions"],
  rent: ["housing", "rent"],
};

/** Map a free-text category name to the user's category ids (including subcategories). */
export function matchCategories(name: string, cats: Map<string, CategoryInfo>): { ids: Set<string>; names: string[] } {
  const q = name.trim().toLowerCase();
  const targets = new Set([q, ...(SYNONYMS[q] ?? [])]);
  const ids = new Set<string>();
  const names: string[] = [];
  for (const c of cats.values()) {
    const n = c.name.toLowerCase();
    if ([...targets].some((t) => n === t || n.includes(t) || (t.length > 3 && t.includes(n)))) {
      ids.add(c.id);
      names.push(c.name);
    }
  }
  for (const c of cats.values()) if (c.parentId && ids.has(c.parentId)) ids.add(c.id);
  return { ids, names: [...new Set(names)] };
}

function basis(user: CurrentUser, range: DateRange, calculation: string): Basis {
  return {
    period: range.label,
    // Calendar dates in the user's time zone (not UTC), inclusive of the last day.
    from: toLocalYmd(range.from, user.prefs.timezone),
    to: toLocalYmd(new Date(range.to.getTime() - 1), user.prefs.timezone),
    currency: user.prefs.baseCurrency,
    calculation,
  };
}

const CALC_SPEND = "Net spending = expenses − refunds/reimbursements, in base currency. Transfers between your own accounts and balance adjustments are excluded.";

export async function spendingSummary(user: CurrentUser, input: { period: string | null; category: string | null }): Promise<ToolResult> {
  const range = resolvePeriod(input.period, user);
  const opts = aggOpts(user.prefs);
  const [txns, cats] = await Promise.all([loadTxns(user.id, range.from, range.to), getCategoryMap(user.id)]);
  const cf = cashFlow(txns, opts);
  const byCat = rollUpToParents(spendingByCategory(txns, opts), cats);
  let categoryResult: unknown = null;
  if (input.category) {
    const m = matchCategories(input.category, cats);
    const raw = spendingByCategory(txns, opts);
    let total = new Decimal(0);
    for (const [k, v] of raw) if (k && m.ids.has(k)) total = total.plus(v);
    categoryResult = { query: input.category, matched_categories: m.names, net_spending: total.toFixed(2), matched: m.names.length > 0 };
  }
  return {
    data: {
      income: cf.income.toFixed(2),
      net_spending: cf.expenses.toFixed(2),
      refunds: cf.refunds.toFixed(2),
      net_cash_flow: cf.net.toFixed(2),
      savings_rate_percent: cf.savingsRate,
      transactions_counted: cf.count,
      excluded_missing_exchange_rate: cf.unconverted,
      top_categories: [...byCat.entries()]
        .filter(([, v]) => v.gt(0))
        .sort((a, b) => b[1].comparedTo(a[1]))
        .slice(0, 8)
        .map(([k, v]) => ({ category: k ? cats.get(k)?.name ?? "Uncategorized" : "Uncategorized", net_spending: v.toFixed(2) })),
      category: categoryResult,
    },
    basis: basis(user, range, CALC_SPEND),
  };
}

export async function comparePeriods(user: CurrentUser, input: { period: string | null; compare_to: string | null }): Promise<ToolResult> {
  const a = resolvePeriod(input.period ?? "this_month", user);
  const b = input.compare_to ? resolvePeriod(input.compare_to, user) : previousRange(a);
  const opts = aggOpts(user.prefs);
  const [ta, tb, cats] = await Promise.all([loadTxns(user.id, a.from, a.to), loadTxns(user.id, b.from, b.to), getCategoryMap(user.id)]);
  const ca = cashFlow(ta, opts);
  const cb = cashFlow(tb, opts);
  const ma = rollUpToParents(spendingByCategory(ta, opts), cats);
  const mb = rollUpToParents(spendingByCategory(tb, opts), cats);
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  const changes = [...keys]
    .map((k) => {
      const x = ma.get(k) ?? new Decimal(0);
      const y = mb.get(k) ?? new Decimal(0);
      return { category: k ? cats.get(k)?.name ?? "Uncategorized" : "Uncategorized", current: x.toFixed(2), previous: y.toFixed(2), change: x.minus(y).toFixed(2), change_percent: percentChange(x, y) };
    })
    .sort((p, q) => Number(q.change) - Number(p.change));
  return {
    data: {
      current_period: a.label,
      comparison_period: b.label,
      income: { current: ca.income.toFixed(2), previous: cb.income.toFixed(2), change_percent: percentChange(ca.income, cb.income) },
      net_spending: { current: ca.expenses.toFixed(2), previous: cb.expenses.toFixed(2), change_percent: percentChange(ca.expenses, cb.expenses) },
      net_cash_flow: { current: ca.net.toFixed(2), previous: cb.net.toFixed(2) },
      biggest_increases: changes.filter((c) => Number(c.change) > 0).slice(0, 5),
      biggest_decreases: changes.filter((c) => Number(c.change) < 0).reverse().slice(0, 5),
    },
    basis: { ...basis(user, a, `${CALC_SPEND} Compared with ${b.label}.`) },
  };
}

export async function budgetStatus(user: CurrentUser): Promise<ToolResult> {
  const budgets = await getBudgetsWithStatus(user.id, user.prefs);
  const month = resolvePeriod("this_month", user);
  return {
    data: {
      budgets: budgets.map((b) => ({
        name: b.budget.name,
        period: `${b.period.start.toISOString().slice(0, 10)} to ${new Date(b.period.end.getTime() - 1).toISOString().slice(0, 10)}`,
        method: b.budget.method,
        budgeted: b.status.available.toFixed(2),
        spent: b.status.spent.toFixed(2),
        remaining: b.status.remaining.toFixed(2),
        percent_used: b.status.percentUsed,
        daily_allowance: b.status.dailyAllowance.toFixed(2),
        days_left: b.status.daysLeft,
        forecast_end_of_period: b.status.forecast.toFixed(2),
        status: b.status.level,
      })),
      total_remaining: budgets.reduce((a, b) => a.plus(b.status.remaining), new Decimal(0)).toFixed(2),
      count: budgets.length,
    },
    basis: basis(user, month, "Spent = net spending within each budget's scope for its current period; available = allocation + rollover. Forecast is a linear projection of the current pace."),
  };
}

export async function subscriptionsSummary(user: CurrentUser): Promise<ToolResult> {
  const p = user.prefs;
  const s = await getSubscriptionsSummary(user.id, { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable });
  const active = s.rows.filter((r) => r.status === "ACTIVE");
  const month = resolvePeriod("this_month", user);
  return {
    data: {
      monthly_total: s.monthlyTotal.toFixed(2),
      annual_total: s.annualTotal.toFixed(2),
      subscriptions: active
        .sort((a, b) => dec(b.monthlyBase ?? 0).comparedTo(dec(a.monthlyBase ?? 0)))
        .map((r) => ({
          name: r.name,
          amount: r.amount.toFixed(2),
          currency: r.currency,
          frequency: r.frequency,
          monthly_equivalent_base: r.monthlyBase?.toFixed(2) ?? null,
          share_of_total_percent: r.monthlyBase && !s.monthlyTotal.isZero() ? r.monthlyBase.div(s.monthlyTotal).times(100).toDecimalPlaces(1).toNumber() : null,
          next_renewal: r.nextDate.toISOString().slice(0, 10),
          recently_changed_price: !!r.amountChangedAt,
        })),
    },
    basis: basis(user, month, "Active subscriptions converted to a monthly equivalent (weekly × 52/12, yearly ÷ 12, etc.) in base currency."),
  };
}

export async function upcomingBills(user: CurrentUser, input: { days: number | null }): Promise<ToolResult> {
  const p = user.prefs;
  const days = Math.min(90, Math.max(1, input.days ?? 14));
  const b = await getBills(user.id, { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable }, days);
  const now = new Date();
  const range: DateRange = { key: "custom", from: now, to: addDays(now, days), label: `Next ${days} days`, tz: p.timezone };
  return {
    data: {
      bills: b.rows
        .filter((r) => r.daysUntil <= days)
        .map((r) => ({ name: r.name, amount: r.amount.toFixed(2), currency: r.currency, due_date: r.nextDueDate.toISOString().slice(0, 10), days_until_due: r.daysUntil, status: r.state, amount_varies: r.isVariable, autopay_at_bank: r.autopay })),
      overdue_count: b.overdue,
      monthly_obligations: b.monthlyObligation.toFixed(2),
    },
    basis: basis(user, range, "Active bills with a due date in the window. 'overdue' means the due date passed without being marked paid."),
  };
}

export async function goalsStatus(user: CurrentUser): Promise<ToolResult> {
  const p = user.prefs;
  const goals = await getGoals(user.id, { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable });
  return {
    data: {
      goals: goals.map((g) => ({
        name: g.name,
        target: g.targetAmount.toFixed(2),
        saved: g.saved.toFixed(2),
        currency: g.currency,
        percent: g.projection.percent,
        progress_source: g.savedBasis === "linked-account" ? "actual linked account balance" : "manually recorded contributions",
        target_date: g.targetDate?.toISOString().slice(0, 10) ?? null,
        required_monthly: g.projection.requiredMonthly?.toFixed(2) ?? null,
        planned_monthly: g.monthlyContribution?.toFixed(2) ?? null,
        projected_completion: g.projection.projectedDate?.toISOString().slice(0, 10) ?? null,
        on_track: g.projection.onTrack,
      })),
    },
    basis: basis(user, resolvePeriod("this_month", user), "Projected completion assumes the planned monthly contribution continues with no interest."),
  };
}

export async function accountBalances(user: CurrentUser): Promise<ToolResult> {
  const accts = await getAccountsWithBalances(user.id, user.prefs.baseCurrency, { includePending: user.prefs.includePending });
  const liquid = liquidBalance(accts);
  const now = new Date();
  return {
    data: {
      accounts: accts.map((a) => ({ name: a.name, type: a.type, currency: a.currency, balance: a.balance.toFixed(2), balance_in_base: a.baseBalance?.toFixed(2) ?? null })),
      available_cash_total_base: liquid.total.toFixed(2),
    },
    basis: { period: "Current", from: toLocalYmd(now, user.prefs.timezone), to: toLocalYmd(now, user.prefs.timezone), currency: user.prefs.baseCurrency, calculation: "Balance = opening balance + all recorded transactions. Available cash = cash, checking, savings and wallets." },
  };
}

export async function simulateCategoryChange(user: CurrentUser, input: { category: string; percent_change: number; period: string | null }): Promise<ToolResult> {
  // Use the last 3 complete months as the baseline unless a period is given.
  const tz = user.prefs.timezone;
  const now = new TZDate(new Date(), tz);
  const baseline: DateRange = input.period
    ? resolvePeriod(input.period, user)
    : { key: "custom", from: new Date(new TZDate(now.getFullYear(), now.getMonth() - 3, 1, tz).getTime()), to: new Date(new TZDate(now.getFullYear(), now.getMonth(), 1, tz).getTime()), label: "Last 3 full months", tz };
  const months = Math.max(1, Math.round((baseline.to.getTime() - baseline.from.getTime()) / (30.44 * 86400000)));
  const opts = aggOpts(user.prefs);
  const [txns, cats] = await Promise.all([loadTxns(user.id, baseline.from, baseline.to), getCategoryMap(user.id)]);
  const m = matchCategories(input.category, cats);
  let total = new Decimal(0);
  for (const [k, v] of spendingByCategory(txns, opts)) if (k && m.ids.has(k)) total = total.plus(v);
  const monthly = total.div(months);
  const pct = new Decimal(input.percent_change);
  const delta = monthly.times(pct).div(100);
  const cf = cashFlow(txns, opts);
  const avgNet = cf.net.div(months);
  return {
    data: {
      category_query: input.category,
      matched_categories: m.names,
      baseline_monthly_spending: monthly.toFixed(2),
      percent_change: input.percent_change,
      new_monthly_spending: monthly.plus(delta).toFixed(2),
      monthly_difference: delta.negated().toFixed(2),
      annual_difference: delta.negated().times(12).toFixed(2),
      current_average_monthly_net_cash_flow: avgNet.toFixed(2),
      projected_average_monthly_net_cash_flow: avgNet.minus(delta).toFixed(2),
      is_estimate: true,
    },
    basis: basis(user, baseline, `Monthly average of ${baseline.label} (${months} month${months === 1 ? "" : "s"}) of net spending in the matched categories, scaled by the percent change. A hypothetical scenario, not a forecast.`),
  };
}

export async function savingsCapacity(user: CurrentUser): Promise<ToolResult> {
  const tz = user.prefs.timezone;
  const now = new TZDate(new Date(), tz);
  const range: DateRange = { key: "custom", from: new Date(new TZDate(now.getFullYear(), now.getMonth() - 3, 1, tz).getTime()), to: new Date(new TZDate(now.getFullYear(), now.getMonth(), 1, tz).getTime()), label: "Last 3 full months", tz };
  const opts = aggOpts(user.prefs);
  const [txns, cats, budgets] = await Promise.all([loadTxns(user.id, range.from, range.to), getCategoryMap(user.id), getBudgetsWithStatus(user.id, user.prefs)]);
  const cf = cashFlow(txns, opts);
  let essential = new Decimal(0);
  for (const [k, v] of spendingByCategory(txns, opts)) {
    const c = k ? cats.get(k) : undefined;
    if (c && (c.isEssential || (c.parentId && cats.get(c.parentId)?.isEssential))) essential = essential.plus(v);
  }
  const monthlyBudgeted = budgets.filter((b) => b.budget.period === "MONTHLY" && b.budget.scope !== "OVERALL").reduce((a, b) => a.plus(b.status.budgeted), new Decimal(0));
  const avgIncome = cf.income.div(3);
  const avgSpend = cf.expenses.div(3);
  return {
    data: {
      average_monthly_income: avgIncome.toFixed(2),
      average_monthly_net_spending: avgSpend.toFixed(2),
      average_monthly_essential_spending: essential.div(3).toFixed(2),
      average_monthly_surplus: avgIncome.minus(avgSpend).toFixed(2),
      total_monthly_budgeted: monthlyBudgeted.toFixed(2),
      income_minus_budgets: monthlyBudgeted.gt(0) ? avgIncome.minus(monthlyBudgeted).toFixed(2) : null,
    },
    basis: basis(user, range, "Averages over the last 3 full months. Surplus = income − net spending. 'Income minus budgets' assumes you spend exactly your monthly budgets."),
  };
}

export async function searchTransactions(user: CurrentUser, input: { query: string; period: string | null; limit: number | null }): Promise<ToolResult> {
  const range = resolvePeriod(input.period ?? "last_3_months", user);
  const q = input.query.slice(0, 80);
  const rows = await db.transaction.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      date: { gte: range.from, lt: range.to },
      OR: [{ description: { contains: q, mode: "insensitive" } }, { merchant: { contains: q, mode: "insensitive" } }],
    },
    select: { date: true, description: true, merchant: true, amount: true, currency: true, type: true, baseAmount: true, category: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: Math.min(25, Math.max(1, input.limit ?? 10)),
  });
  const total = rows.reduce((a, r) => (r.type === "EXPENSE" && r.baseAmount ? a.plus(dec(r.baseAmount).abs()) : r.type === "REFUND" && r.baseAmount ? a.minus(dec(r.baseAmount)) : a), new Decimal(0));
  return {
    data: {
      matches: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), description: r.description, merchant: r.merchant, amount: r.amount.toFixed(2), currency: r.currency, type: r.type, category: r.category?.name ?? null })),
      shown: rows.length,
      net_spending_of_shown: total.toFixed(2),
    },
    basis: basis(user, range, `Transactions whose description or merchant contains “${q}”, newest first (up to ${Math.min(25, input.limit ?? 10)}).`),
  };
}

// ───────────── Tool registry (JSON Schemas for the model) ─────────────

const periodSchema = { type: ["string", "null"], enum: [...PERIODS, null], description: `Date range. One of: ${PERIODS.join(", ")}. Null = this_month.` };

export const TOOL_DEFS = [
  {
    name: "spending_summary",
    description: "Income, net spending, net cash flow, savings rate and top categories for a period; optionally the net spending for one category (free-text name, e.g. 'food', 'dining', 'transportation').",
    input_schema: { type: "object", properties: { period: periodSchema, category: { type: ["string", "null"], description: "Category name to total, or null" } }, required: ["period", "category"], additionalProperties: false },
  },
  {
    name: "compare_periods",
    description: "Compare income, spending and per-category changes between two periods. If compare_to is null, compares with the immediately preceding period of the same length.",
    input_schema: { type: "object", properties: { period: periodSchema, compare_to: periodSchema }, required: ["period", "compare_to"], additionalProperties: false },
  },
  { name: "budget_status", description: "Current status of every active budget: budgeted, spent, remaining, % used, daily allowance and forecast.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "subscriptions_summary", description: "Active subscriptions sorted by monthly cost, with monthly and annual totals.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  {
    name: "upcoming_bills",
    description: "Bills due within the next N days, including overdue ones.",
    input_schema: { type: "object", properties: { days: { type: ["integer", "null"], description: "Window in days (1-90). Null = 14." } }, required: ["days"], additionalProperties: false },
  },
  { name: "goals_status", description: "Savings goals with progress, required monthly contribution and projected completion.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "account_balances", description: "Current balance of every active account and total available cash.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  {
    name: "simulate_category_change",
    description: "What-if: effect of changing spending in a category by a percentage (negative = reduce) on monthly and annual cash flow, based on recent averages.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string" }, percent_change: { type: "number", description: "e.g. -15 for a 15% reduction" }, period: { ...periodSchema, description: "Baseline period; null = last 3 full months" } },
      required: ["category", "percent_change", "period"],
      additionalProperties: false,
    },
  },
  { name: "savings_capacity", description: "Average monthly income, spending, essential spending and surplus over the last 3 full months, plus total monthly budgets — for 'how much can I save' questions.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  {
    name: "search_transactions",
    description: "Find individual transactions by description or merchant text.",
    input_schema: { type: "object", properties: { query: { type: "string" }, period: periodSchema, limit: { type: ["integer", "null"] } }, required: ["query", "period", "limit"], additionalProperties: false },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

export async function runTool(user: CurrentUser, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const n = (k: string) => (typeof input[k] === "number" ? (input[k] as number) : null);
  switch (name) {
    case "spending_summary":
      return spendingSummary(user, { period: s("period"), category: s("category") });
    case "compare_periods":
      return comparePeriods(user, { period: s("period"), compare_to: s("compare_to") });
    case "budget_status":
      return budgetStatus(user);
    case "subscriptions_summary":
      return subscriptionsSummary(user);
    case "upcoming_bills":
      return upcomingBills(user, { days: n("days") });
    case "goals_status":
      return goalsStatus(user);
    case "account_balances":
      return accountBalances(user);
    case "simulate_category_change":
      return simulateCategoryChange(user, { category: s("category") ?? "", percent_change: n("percent_change") ?? 0, period: s("period") });
    case "savings_capacity":
      return savingsCapacity(user);
    case "search_transactions":
      return searchTransactions(user, { query: s("query") ?? "", period: s("period"), limit: n("limit") });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function fmt(user: CurrentUser, v: string | number | Decimal | null | undefined, currency?: string) {
  if (v === null || v === undefined) return "—";
  return formatMoney(v, currency ?? user.prefs.baseCurrency, { locale: user.prefs.locale });
}

