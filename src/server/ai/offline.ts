import type { CurrentUser } from "@/lib/session";
import { runTool, fmt, type ToolResult } from "./tools";

/**
 * Deterministic question router used when no AI provider is configured or the user
 * hasn't consented to sending data to one. It recognizes common questions, runs the
 * same read-only tools, and answers from templates — no language model involved.
 */

export interface AssistantAnswer {
  answer: string;
  calls: { name: string; input: Record<string, unknown>; result: ToolResult }[];
  mode: "ai" | "offline";
  notice?: string;
}

function parsePeriod(q: string): string | null {
  const s = q.toLowerCase();
  if (/last quarter|previous quarter/.test(s)) return "last_quarter";
  if (/this quarter/.test(s)) return "this_quarter";
  if (/last month|previous month/.test(s)) return "last_month";
  if (/this week/.test(s)) return "this_week";
  if (/today/.test(s)) return "today";
  if (/last (3|three) months/.test(s)) return "last_3_months";
  if (/last (6|six) months/.test(s)) return "last_6_months";
  if (/this year|year to date|ytd/.test(s)) return "this_year";
  if (/this month/.test(s)) return "this_month";
  return null;
}

function parseCategory(q: string): string | null {
  const m = q.toLowerCase().match(/\b(?:on|for|in)\s+([a-z][a-z &]{2,30}?)(?:\s+(?:this|last|in|during|over|since|compared|vs)\b|[?.!,]|$)/);
  if (!m) return null;
  const c = m[1].trim();
  if (/^(the|my|a|this|last|average)$/.test(c)) return null;
  return c;
}

export async function answerOffline(user: CurrentUser, question: string): Promise<AssistantAnswer> {
  const q = question.toLowerCase();
  const calls: AssistantAnswer["calls"] = [];
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await runTool(user, name, input);
    calls.push({ name, input, result });
    return result;
  };
  const f = (v: string | number | null | undefined, c?: string) => fmt(user, v, c);
  const period = parsePeriod(q);

  // What-if scenarios
  const pct = q.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct && /(reduc|cut|lower|decreas|spend less|increas|what if|what would)/.test(q)) {
    const category = parseCategory(q) ?? q.match(/(?:reduc\w*|cut\w*|lower\w*)\s+(?:my\s+)?([a-z]+)/)?.[1] ?? "dining";
    const sign = /(increas|more)/.test(q) && !/(reduc|cut|lower|less|decreas)/.test(q) ? 1 : -1;
    const r = await call("simulate_category_change", { category, percent_change: sign * Number(pct[1]), period: null });
    const d = r.data as { matched_categories: string[]; baseline_monthly_spending: string; new_monthly_spending: string; monthly_difference: string; annual_difference: string };
    if (!d.matched_categories.length) return { answer: `I couldn't find a category matching “${category}”. Try the exact name from your Categories page.`, calls, mode: "offline" };
    return {
      answer: `If you ${sign < 0 ? "reduced" : "increased"} **${d.matched_categories.join(", ")}** spending by ${pct[1]}%, your typical month would go from **${f(d.baseline_monthly_spending)}** to **${f(d.new_monthly_spending)}** — about **${f(d.monthly_difference)}** per month, or **${f(d.annual_difference)}** over a year.\n\nThis is a scenario based on your recent average, not a guarantee.`,
      calls,
      mode: "offline",
    };
  }

  if (/subscription/.test(q)) {
    const r = await call("subscriptions_summary", {});
    const d = r.data as { monthly_total: string; annual_total: string; subscriptions: { name: string; monthly_equivalent_base: string | null; share_of_total_percent: number | null }[] };
    if (!d.subscriptions.length) return { answer: "You don't have any active subscriptions tracked yet. The Subscriptions page can detect recurring charges from your history.", calls, mode: "offline" };
    const top = d.subscriptions.slice(0, 5).map((s, i) => `${i + 1}. **${s.name}** — ${f(s.monthly_equivalent_base)}/month${s.share_of_total_percent !== null ? ` (${s.share_of_total_percent}%)` : ""}`);
    return { answer: `Your active subscriptions cost **${f(d.monthly_total)}** per month (**${f(d.annual_total)}** a year). The largest:\n\n${top.join("\n")}`, calls, mode: "offline" };
  }

  if (/\bbills?\b|due|overdue/.test(q)) {
    const r = await call("upcoming_bills", { days: 30 });
    const d = r.data as { bills: { name: string; amount: string; currency: string; due_date: string; days_until_due: number; status: string }[]; overdue_count: number };
    if (!d.bills.length) return { answer: "No bills are due in the next 30 days.", calls, mode: "offline" };
    const attention = d.bills.filter((b) => b.status === "overdue" || b.status === "due-soon");
    const lines = d.bills.slice(0, 8).map((b) => `- **${b.name}** — ${f(b.amount, b.currency)} · ${b.status === "overdue" ? `overdue by ${-b.days_until_due} days` : `due ${b.due_date} (${b.days_until_due === 0 ? "today" : `in ${b.days_until_due} days`})`}`);
    return { answer: `${attention.length ? `**${attention.length}** bill${attention.length === 1 ? " needs" : "s need"} attention now.` : "Nothing is overdue or due soon."}\n\n${lines.join("\n")}`, calls, mode: "offline" };
  }

  if (/budget/.test(q)) {
    const r = await call("budget_status", {});
    const d = r.data as { budgets: { name: string; remaining: string; percent_used: number; days_left: number; status: string; daily_allowance: string }[]; total_remaining: string };
    if (!d.budgets.length) return { answer: "You haven't set up any budgets yet. Create one on the Budgets page to track what's left.", calls, mode: "offline" };
    const lines = d.budgets.map((b) => `- **${b.name}**: ${Number(b.remaining) >= 0 ? `${f(b.remaining)} left` : `over by ${f(String(-Number(b.remaining)))}`} (${b.percent_used}% used, ${b.days_left} days left${Number(b.remaining) > 0 ? `, ${f(b.daily_allowance)}/day` : ""})`);
    return { answer: `Across your budgets, **${f(d.total_remaining)}** remains this period.\n\n${lines.join("\n")}`, calls, mode: "offline" };
  }

  if (/(how much|what).*(save|saving)|savings capacity|afford to save/.test(q)) {
    const r = await call("savings_capacity", {});
    const d = r.data as { average_monthly_income: string; average_monthly_net_spending: string; average_monthly_surplus: string; income_minus_budgets: string | null };
    return {
      answer: `Over the last 3 full months you earned about **${f(d.average_monthly_income)}** and spent **${f(d.average_monthly_net_spending)}** per month, leaving roughly **${f(d.average_monthly_surplus)}** a month.${d.income_minus_budgets ? ` If you spent exactly your budgets, about **${f(d.income_minus_budgets)}** a month would be left to save.` : ""}\n\nA common approach is to save a fixed amount of that surplus right after payday. This is informational, not financial advice.`,
      calls,
      mode: "offline",
    };
  }

  if (/goal/.test(q)) {
    const r = await call("goals_status", {});
    const d = r.data as { goals: { name: string; saved: string; target: string; currency: string; percent: number; on_track: boolean | null; required_monthly: string | null }[] };
    if (!d.goals.length) return { answer: "You don't have any savings goals yet.", calls, mode: "offline" };
    return { answer: d.goals.map((g) => `- **${g.name}**: ${f(g.saved, g.currency)} of ${f(g.target, g.currency)} (${g.percent}%)${g.on_track === false && g.required_monthly ? ` — behind; needs ${f(g.required_monthly, g.currency)}/month` : g.on_track ? " — on track" : ""}`).join("\n"), calls, mode: "offline" };
  }

  if (/balance|how much money do i have|net worth|accounts?/.test(q)) {
    const r = await call("account_balances", {});
    const d = r.data as { accounts: { name: string; balance: string; currency: string }[]; available_cash_total_base: string };
    return { answer: `You have **${f(d.available_cash_total_base)}** available across cash, bank and wallet accounts.\n\n${d.accounts.map((a) => `- ${a.name}: ${f(a.balance, a.currency)}`).join("\n")}`, calls, mode: "offline" };
  }

  if (/compar|versus|\bvs\b|increased the most|went up|changed/.test(q)) {
    const r = await call("compare_periods", { period: period ?? "this_month", compare_to: null });
    const d = r.data as { current_period: string; comparison_period: string; net_spending: { current: string; previous: string; change_percent: number | null }; income: { current: string; previous: string }; biggest_increases: { category: string; change: string; change_percent: number | null }[] };
    const inc = d.biggest_increases[0];
    return {
      answer: `In **${d.current_period}** you spent **${f(d.net_spending.current)}** versus **${f(d.net_spending.previous)}** in ${d.comparison_period}${d.net_spending.change_percent !== null ? ` (${d.net_spending.change_percent > 0 ? "+" : ""}${d.net_spending.change_percent}%)` : ""}. Income was ${f(d.income.current)} vs ${f(d.income.previous)}.${inc ? `\n\nThe category that increased the most was **${inc.category}** (+${f(inc.change)}${inc.change_percent !== null ? `, ${inc.change_percent > 0 ? "+" : ""}${inc.change_percent}%` : ""}).` : ""}`,
      calls,
      mode: "offline",
    };
  }

  if (/spen[dt]|cost|paid|expens|how much/.test(q)) {
    const category = parseCategory(q);
    const r = await call("spending_summary", { period: period ?? "this_month", category });
    const d = r.data as { net_spending: string; income: string; category: { matched_categories: string[]; net_spending: string; matched: boolean } | null };
    if (category && d.category) {
      if (!d.category.matched) return { answer: `I couldn't find a category matching “${category}”. Total net spending for ${r.basis.period} was **${f(d.net_spending)}**.`, calls, mode: "offline" };
      return { answer: `You spent **${f(d.category.net_spending)}** on ${d.category.matched_categories.join(", ")} in ${r.basis.period} (net of refunds).`, calls, mode: "offline" };
    }
    return { answer: `Your net spending in ${r.basis.period} was **${f(d.net_spending)}**, against income of **${f(d.income)}**.`, calls, mode: "offline" };
  }

  return {
    answer:
      "I can answer questions about your spending, budgets, bills, subscriptions, goals and balances. Try:\n\n- How much did I spend on food this month?\n- Which category increased the most?\n- How much money remains in my monthly budget?\n- What would happen if I reduced dining by 15%?",
    calls,
    mode: "offline",
  };
}
