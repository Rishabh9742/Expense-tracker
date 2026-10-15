import { addDays, endOfMonth, subDays, subMonths } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { db } from "@/lib/db";
import { getRate, rateCache } from "@/lib/fx";
import { Decimal, dec } from "@/lib/money";
import { monthlyFactor, occurrencesBetween } from "@/lib/finance/recurrence";
import { projectGoal } from "@/lib/finance/goals";
import { computeNetWorth } from "@/lib/finance/networth";
import { forecastCashFlow, type ScheduledEvent } from "@/lib/finance/forecast";
import { cashFlow } from "@/lib/finance/aggregate";
import { getAccountsWithBalances, liquidBalance } from "./balances";
import { loadTxns } from "./analytics";
import { startOfDayTz } from "@/lib/dates";
import { normalizeMerchant } from "@/lib/finance/duplicates";

interface Prefs {
  baseCurrency: string;
  timezone: string;
  includePending: boolean;
  excludeReimbursable: boolean;
}

// ───────────── Subscriptions ─────────────

export async function getSubscriptionsSummary(userId: string, prefs: Prefs) {
  const subs = await db.subscription.findMany({
    where: { userId },
    include: { category: true, account: { select: { id: true, name: true } } },
    orderBy: [{ status: "asc" }, { nextDate: "asc" }],
  });
  const conv = rateCache(userId, prefs.baseCurrency);
  let monthly = new Decimal(0);
  let missing = 0;
  const rows = [];
  for (const s of subs) {
    const base = await conv(s.amount, s.currency);
    const monthlyBase = base ? base.times(monthlyFactor(s.frequency, s.interval)).toDecimalPlaces(2) : null;
    if (s.status === "ACTIVE") {
      if (monthlyBase) monthly = monthly.plus(monthlyBase);
      else missing++;
    }
    rows.push({ ...s, baseAmount: base, monthlyBase });
  }
  const now = new Date();
  const upcoming = rows.filter((s) => s.status === "ACTIVE" && s.nextDate >= startOfDayTz(now, prefs.timezone) && s.nextDate <= addDays(now, 30));
  const recentlyChanged = rows.filter((s) => s.amountChangedAt && s.amountChangedAt >= subDays(now, 90));
  return { rows, monthlyTotal: monthly, annualTotal: monthly.times(12), upcoming, recentlyChanged, missingRates: missing };
}

// ───────────── Bills ─────────────

export type BillState = "paid" | "due-soon" | "upcoming" | "overdue";

export async function getBills(userId: string, prefs: Prefs, horizonDays = 45) {
  const bills = await db.bill.findMany({
    where: { userId, active: true },
    include: { category: true, account: { select: { id: true, name: true } }, payments: { orderBy: { dueDate: "desc" }, take: 6 } },
    orderBy: { nextDueDate: "asc" },
  });
  const today = startOfDayTz(new Date(), prefs.timezone);
  const conv = rateCache(userId, prefs.baseCurrency);
  const rows = [];
  let monthlyObligation = new Decimal(0);
  for (const b of bills) {
    const base = await conv(b.amount, b.currency);
    if (base) monthlyObligation = monthlyObligation.plus(base.times(monthlyFactor(b.frequency, b.interval)));
    const daysUntil = Math.round((b.nextDueDate.getTime() - today.getTime()) / 86400000);
    const state: BillState = daysUntil < 0 ? "overdue" : daysUntil <= b.reminderDays ? "due-soon" : "upcoming";
    const lastPayment = b.payments[0] ?? null;
    rows.push({ ...b, baseAmount: base, daysUntil, state, lastPayment });
  }
  // Calendar occurrences in the horizon
  const calendar: { billId: string; name: string; date: Date; amount: Decimal; currency: string; state: BillState }[] = [];
  const horizon = addDays(today, horizonDays);
  for (const r of rows) {
    const occ = occurrencesBetween(r.nextDueDate, r.frequency, r.interval, subDays(today, 31), horizon, null, prefs.timezone, 12);
    for (const d of occ) {
      const state: BillState = d.getTime() === r.nextDueDate.getTime() ? r.state : d < r.nextDueDate ? "paid" : "upcoming";
      calendar.push({ billId: r.id, name: r.name, date: d, amount: dec(r.amount), currency: r.currency, state });
    }
  }
  calendar.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { rows, calendar, monthlyObligation: monthlyObligation.toDecimalPlaces(2), overdue: rows.filter((r) => r.state === "overdue").length };
}

// ───────────── Goals ─────────────

export async function getGoals(userId: string, prefs: Prefs) {
  const goals = await db.savingsGoal.findMany({
    where: { userId, archived: false },
    include: { contributions: { orderBy: { date: "desc" }, take: 24 }, linkedAccount: true },
    orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
  });
  const linkedIds = goals.map((g) => g.linkedAccountId).filter((x): x is string => !!x);
  const balances = linkedIds.length ? await getAccountsWithBalances(userId, prefs.baseCurrency, { accountIds: linkedIds, includeClosed: true }) : [];
  const balMap = new Map(balances.map((b) => [b.id, b]));
  const out = [];
  for (const g of goals) {
    const contributed = g.contributions.reduce((a, c) => a.plus(dec(c.amount)), new Decimal(0));
    const manualSaved = dec(g.manualBalance).plus(contributed);
    let accountSaved: Decimal | null = null;
    if (g.linkedAccountId && balMap.has(g.linkedAccountId)) {
      const acct = balMap.get(g.linkedAccountId)!;
      const r = await getRate(acct.currency, g.currency, new Date(), userId);
      accountSaved = r ? acct.balance.times(r.rate).toDecimalPlaces(2) : null;
    }
    const saved = accountSaved ?? manualSaved;
    const projection = projectGoal({ saved, target: g.targetAmount, monthlyContribution: g.monthlyContribution, targetDate: g.targetDate });
    out.push({ ...g, saved, manualSaved, accountSaved, savedBasis: accountSaved !== null ? ("linked-account" as const) : ("manual" as const), projection });
  }
  return out;
}

// ───────────── Debts ─────────────

export async function getDebts(userId: string, prefs: Prefs) {
  const debts = await db.debt.findMany({
    where: { userId },
    include: { payments: { orderBy: { date: "desc" }, take: 24 }, linkedAccount: true },
    orderBy: [{ closedAt: "asc" }, { customOrder: "asc" }, { createdAt: "asc" }],
  });
  const linkedIds = debts.map((d) => d.linkedAccountId).filter((x): x is string => !!x);
  const balances = linkedIds.length ? await getAccountsWithBalances(userId, prefs.baseCurrency, { accountIds: linkedIds, includeClosed: true }) : [];
  const balMap = new Map(balances.map((b) => [b.id, b]));
  const conv = rateCache(userId, prefs.baseCurrency);
  const rows = [];
  let total = new Decimal(0);
  let totalMin = new Decimal(0);
  for (const d of debts) {
    // A linked liability account is the source of truth for the outstanding balance.
    const acct = d.linkedAccountId ? balMap.get(d.linkedAccountId) : undefined;
    const balance = acct ? acct.balance.negated() : dec(d.currentBalance);
    const base = await conv(balance, acct?.currency ?? d.currency);
    const paid = dec(d.originalPrincipal).minus(balance);
    const progress = dec(d.originalPrincipal).gt(0) ? Math.max(0, Math.min(100, paid.div(dec(d.originalPrincipal)).times(100).toDecimalPlaces(1).toNumber())) : 0;
    if (!d.closedAt && base) total = total.plus(base);
    if (!d.closedAt && d.minimumPayment) totalMin = totalMin.plus((await conv(d.minimumPayment, d.currency)) ?? 0);
    rows.push({ ...d, balance, baseBalance: base, progress, balanceSource: acct ? ("account" as const) : ("manual" as const) });
  }
  return { rows, total, totalMinimum: totalMin };
}

// ───────────── Net worth ─────────────

async function netWorthAt(userId: string, prefs: Prefs, at: Date) {
  const [accounts, assets, debts] = await Promise.all([
    getAccountsWithBalances(userId, prefs.baseCurrency, { asOf: at, includeClosed: true, includePending: prefs.includePending }),
    db.asset.findMany({ where: { userId, archived: false }, include: { valuations: { where: { date: { lte: at } }, orderBy: { date: "desc" }, take: 1 } } }),
    db.debt.findMany({ where: { userId, OR: [{ closedAt: null }, { closedAt: { gt: at } }] }, include: { payments: { where: { date: { gte: at } } } } }),
  ]);
  const conv = rateCache(userId, prefs.baseCurrency);
  const assetRows = [];
  for (const a of assets) {
    const v = a.valuations[0];
    if (!v) continue;
    assetRows.push({ id: a.id, name: a.name, type: a.type, baseValue: await conv(v.value, a.currency, at), value: dec(v.value), currency: a.currency, valuedAt: v.date });
  }
  const debtRows = [];
  for (const d of debts) {
    if (d.createdAt > at && !d.startDate) continue;
    // Approximate past balance: current balance + payments made since (principal portion when known).
    const since = d.payments.reduce((acc, p) => acc.plus(dec(p.principal ?? p.amount)), new Decimal(0));
    const bal = dec(d.currentBalance).plus(since);
    debtRows.push({ id: d.id, name: d.name, baseBalance: await conv(bal, d.currency, at), linkedAccountId: d.linkedAccountId, closed: !!d.closedAt && d.closedAt <= at });
  }
  const result = computeNetWorth({
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, baseBalance: a.baseBalance, includeInNetWorth: a.includeInNetWorth })),
    assets: assetRows,
    debts: debtRows,
  });
  return { result, accounts, assets: assetRows, debts: debtRows };
}

export async function getNetWorth(userId: string, prefs: Prefs) {
  return netWorthAt(userId, prefs, new Date());
}

export async function getNetWorthHistory(userId: string, prefs: Prefs, months = 12) {
  const now = new TZDate(new Date(), prefs.timezone);
  const points = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthEnd = i === 0 ? new Date() : new Date(addDays(endOfMonth(subMonths(now, i)), 0).getTime() + 1);
    const { result } = await netWorthAt(userId, prefs, monthEnd);
    points.push({
      date: monthEnd,
      label: new TZDate(subMonths(now, i), prefs.timezone).toLocaleDateString("en", { month: "short", year: "2-digit" }),
      assets: result.totalAssets,
      liabilities: result.totalLiabilities,
      netWorth: result.netWorth,
    });
  }
  return points;
}

// ───────────── Forecast ─────────────

export interface ForecastSources {
  recurring: boolean;
  bills: boolean;
  subscriptions: boolean;
  debts: boolean;
  goals: boolean;
  discretionary: boolean;
}

export async function getForecast(
  userId: string,
  prefs: Prefs,
  days: number,
  sources: ForecastSources,
  adjustments: { date: Date; amount: string; label: string }[] = [],
) {
  const now = new Date();
  const start = startOfDayTz(now, prefs.timezone);
  const end = addDays(start, days);
  const conv = rateCache(userId, prefs.baseCurrency);
  const events: ScheduledEvent[] = [];

  const [accounts, recurring, bills, subs, debts, goals, history] = await Promise.all([
    getAccountsWithBalances(userId, prefs.baseCurrency, { includePending: prefs.includePending }),
    db.recurringTransaction.findMany({ where: { userId, active: true }, include: { account: true } }),
    db.bill.findMany({ where: { userId, active: true } }),
    db.subscription.findMany({ where: { userId, status: "ACTIVE" } }),
    db.debt.findMany({ where: { userId, closedAt: null, minimumPayment: { not: null } } }),
    db.savingsGoal.findMany({ where: { userId, archived: false, monthlyContribution: { not: null }, linkedAccountId: { not: null } } }),
    loadTxns(userId, subDays(start, 90), start),
  ]);
  const liquid = liquidBalance(accounts);
  const liquidIds = new Set(accounts.filter((a) => ["CASH", "CHECKING", "SAVINGS", "DIGITAL_WALLET"].includes(a.type)).map((a) => a.id));

  if (sources.recurring) {
    for (const r of recurring) {
      if (r.type === "TRANSFER" || r.type === "ADJUSTMENT") continue;
      for (const d of occurrencesBetween(r.nextDate, r.frequency, r.interval, start, end, r.endDate, prefs.timezone, 100)) {
        const base = await conv(r.amount, r.account.currency, now);
        if (!base) continue;
        events.push({ date: d, amount: r.type === "EXPENSE" ? base.negated() : base, label: r.name, kind: r.type === "INCOME" ? "income" : "recurring" });
      }
    }
  }
  if (sources.bills) {
    for (const b of bills) {
      for (const d of occurrencesBetween(b.nextDueDate, b.frequency, b.interval, start, end, null, prefs.timezone, 100)) {
        const base = await conv(b.amount, b.currency, now);
        if (base) events.push({ date: d, amount: base.negated(), label: b.name, kind: "bill" });
      }
      // Overdue bills are assumed to be paid today.
      if (b.nextDueDate < start) {
        const base = await conv(b.amount, b.currency, now);
        if (base) events.push({ date: start, amount: base.negated(), label: `${b.name} (overdue)`, kind: "bill" });
      }
    }
  }
  if (sources.subscriptions) {
    for (const s of subs) {
      for (const d of occurrencesBetween(s.nextDate, s.frequency, s.interval, start, end, s.endDate, prefs.timezone, 100)) {
        const base = await conv(s.amount, s.currency, now);
        if (base) events.push({ date: d, amount: base.negated(), label: s.name, kind: "subscription" });
      }
    }
  }
  if (sources.debts) {
    for (const d of debts) {
      if (!d.dueDay) continue;
      const local = new TZDate(start, prefs.timezone);
      const first = new TZDate(local.getFullYear(), local.getMonth(), Math.min(d.dueDay, 28), prefs.timezone);
      for (const occ of occurrencesBetween(new Date(first.getTime()), "MONTHLY", 1, start, end, null, prefs.timezone, 12)) {
        const base = await conv(d.minimumPayment!, d.currency, now);
        if (base) events.push({ date: occ, amount: base.negated(), label: `${d.name} minimum`, kind: "debt" });
      }
    }
  }
  if (sources.goals) {
    for (const g of goals) {
      // Contributions into a linked account outside the liquid set leave the liquid balance.
      if (g.linkedAccountId && liquidIds.has(g.linkedAccountId)) continue;
      const local = new TZDate(start, prefs.timezone);
      const first = new TZDate(local.getFullYear(), local.getMonth() + 1, 1, prefs.timezone);
      for (const occ of occurrencesBetween(new Date(first.getTime()), "MONTHLY", 1, start, end, null, prefs.timezone, 12)) {
        const base = await conv(g.monthlyContribution!, g.currency, now);
        if (base) events.push({ date: occ, amount: base.negated(), label: `${g.name} contribution`, kind: "savings" });
      }
    }
  }
  for (const a of adjustments) events.push({ date: a.date, amount: a.amount, label: a.label, kind: "adjustment" });

  // Discretionary: net expenses over the last 90 days, excluding anything already scheduled above
  // (recurring-generated rows and payments to known subscription/bill merchants) to avoid double counting.
  const scheduledKeys = new Set(
    [...subs.map((s) => s.merchant || s.name), ...bills.map((b) => b.name), ...recurring.map((r) => r.merchant || r.name)]
      .map((x) => normalizeMerchant(x))
      .filter(Boolean),
  );
  const discretionaryTxns = history.filter((t) => !t.recurringId && !scheduledKeys.has(normalizeMerchant(t.merchant || t.description)));
  const cf = cashFlow(discretionaryTxns, { includePending: prefs.includePending, excludeReimbursable: prefs.excludeReimbursable });
  const daily = sources.discretionary ? Decimal.max(cf.expenses, 0).div(90).toDecimalPlaces(2) : new Decimal(0);

  const result = forecastCashFlow({ startBalance: liquid.total, start, days, events, dailyDiscretionary: daily, threshold: 0 });
  return { ...result, startBalance: liquid.total, missingRates: liquid.missing, events: events.sort((a, b) => a.date.getTime() - b.date.getTime()), dailyDiscretionary: daily };
}
