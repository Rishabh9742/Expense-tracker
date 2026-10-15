import { Prisma } from "@prisma/client";
import { addDays, subDays } from "date-fns";
import { db } from "@/lib/db";
import { dec, formatMoney } from "@/lib/money";
import { nextOccurrenceAfter, occurrencesBetween } from "@/lib/finance/recurrence";
import { findPossibleDuplicates } from "@/lib/finance/duplicates";
import { findUnusual } from "@/lib/finance/aggregate";
import { formatLocal, startOfDayTz } from "@/lib/dates";
import { createTransaction, loadCategorizer } from "./transactions";
import { getBudgetsWithStatus } from "./budgets";
import { getAccountsWithBalances } from "./balances";
import { getGoals } from "./planning";
import { sendEmail, emailConfigured } from "./email";

// ───────────── Recurring generation ─────────────

/**
 * Creates transactions for every due occurrence of active auto-create schedules.
 * Idempotent: (recurringId, occurrenceDate) is unique, so reruns after a crash or
 * restart never duplicate rows. Expected-only schedules (autoCreate=false) are advanced
 * by the notification job once their window passes.
 */
export async function processRecurring(userId?: string, now = new Date()) {
  const due = await db.recurringTransaction.findMany({
    where: { active: true, autoCreate: true, nextDate: { lte: now }, ...(userId ? { userId } : {}) },
    include: { user: { include: { preferences: true } } },
    take: 500,
  });
  let created = 0;
  for (const r of due) {
    const prefs = r.user.preferences;
    const base = prefs?.baseCurrency ?? "INR";
    const tz = prefs?.timezone ?? "UTC";
    const occ = occurrencesBetween(r.startDate, r.frequency, r.interval, r.nextDate, new Date(now.getTime() + 1), r.endDate, tz, 60);
    const categorizer = await loadCategorizer(r.userId);
    let last: Date | null = null;
    for (const d of occ) {
      try {
        await createTransaction(
          r.userId,
          {
            accountId: r.accountId,
            type: r.type,
            date: d,
            description: r.name,
            merchant: r.merchant,
            amount: r.type === "ADJUSTMENT" ? dec(r.amount) : dec(r.amount).abs(),
            categoryId: r.categoryId,
            categorySource: r.categoryId ? "USER" : undefined,
            status: r.status === "POSTED" ? "CLEARED" : "PENDING",
            recurringId: r.id,
            occurrenceDate: d,
            notes: r.isVariable ? "Generated from a variable schedule — confirm the actual amount." : null,
          },
          { baseCurrency: base, categorizer, skipAudit: true },
        );
        created++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
      last = d;
    }
    const next = last ? nextOccurrenceAfter(r.startDate, r.frequency, r.interval, last, tz) : r.nextDate;
    const finished = r.endDate ? next > r.endDate : false;
    await db.recurringTransaction.update({ where: { id: r.id }, data: { nextDate: next, lastRunAt: now, active: !finished } });
  }
  return { schedules: due.length, created };
}

/** Roll subscription renewal dates forward once they pass (tracking only — no charges are made). */
export async function advanceSubscriptions(userId?: string, now = new Date()) {
  const subs = await db.subscription.findMany({ where: { status: "ACTIVE", nextDate: { lt: subDays(now, 1) }, ...(userId ? { userId } : {}) } });
  for (const s of subs) {
    const next = nextOccurrenceAfter(s.startDate, s.frequency, s.interval, subDays(now, 1));
    const ended = s.endDate && next > s.endDate;
    await db.subscription.update({ where: { id: s.id }, data: { nextDate: next, ...(ended ? { status: "CANCELLED" } : {}) } });
  }
  return subs.length;
}

// ───────────── Notifications ─────────────

interface NewNote {
  kind: string;
  severity: "info" | "warning" | "critical" | "success";
  title: string;
  body: string;
  href?: string;
  dedupeKey: string;
}

function inQuietHours(start: number | null, end: number | null, tz: string, now: Date): boolean {
  if (start === null || end === null || start === end) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function generateNotifications(userId: string, now = new Date()) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { preferences: true } });
  if (!user?.preferences) return { created: 0 };
  const p = user.preferences;
  const enabled = (p.alertsEnabled as Record<string, boolean> | null) ?? {};
  const on = (k: string) => enabled[k] !== false;
  const tz = p.timezone;
  const today = startOfDayTz(now, tz);
  const base = p.baseCurrency;
  const fmt = (v: Prisma.Decimal | string | number, c = base) => formatMoney(v, c, { locale: p.locale });
  const notes: NewNote[] = [];

  if (on("budget")) {
    const budgets = await getBudgetsWithStatus(userId, p, now);
    for (const { budget, period, status } of budgets) {
      const levels = (budget.alertLevels.length ? budget.alertLevels : p.budgetAlertLevels).filter((l) => status.percentUsed >= l);
      const level = levels.length ? Math.max(...levels) : null;
      if (level === null) continue;
      notes.push({
        kind: "BUDGET",
        severity: level >= 100 ? "critical" : level >= 90 ? "warning" : "info",
        title: level >= 100 ? `${budget.name} budget exceeded` : `${budget.name} budget at ${level}%`,
        body: `${fmt(status.spent.toString())} of ${fmt(status.available.toString())} used (${status.percentUsed}%). ${status.remaining.gte(0) ? `${fmt(status.remaining.toString())} left for ${status.daysLeft} days.` : `Over by ${fmt(status.remaining.abs().toString())}.`}`,
        href: "/budgets",
        dedupeKey: `budget:${budget.id}:${period.start.toISOString().slice(0, 10)}:${level}`,
      });
    }
  }

  if (on("bills")) {
    const bills = await db.bill.findMany({ where: { userId, active: true, nextDueDate: { lte: addDays(today, 14) } } });
    for (const b of bills) {
      const days = Math.round((b.nextDueDate.getTime() - today.getTime()) / 86400000);
      if (days < 0) {
        notes.push({ kind: "BILL", severity: "critical", title: `${b.name} is overdue`, body: `${fmt(b.amount, b.currency)} was due ${formatLocal(b.nextDueDate, tz)}. Mark it paid once settled.`, href: "/bills", dedupeKey: `bill-overdue:${b.id}:${b.nextDueDate.toISOString().slice(0, 10)}` });
      } else if (days <= b.reminderDays) {
        notes.push({ kind: "BILL", severity: "warning", title: `${b.name} due ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`, body: `${b.isVariable ? "About " : ""}${fmt(b.amount, b.currency)} due ${formatLocal(b.nextDueDate, tz)}.`, href: "/bills", dedupeKey: `bill:${b.id}:${b.nextDueDate.toISOString().slice(0, 10)}` });
      }
    }
  }

  if (on("subscriptions")) {
    const subs = await db.subscription.findMany({ where: { userId, status: "ACTIVE", nextDate: { gte: today, lte: addDays(today, 14) } } });
    for (const s of subs) {
      const days = Math.round((s.nextDate.getTime() - today.getTime()) / 86400000);
      if (days <= s.reminderDays) {
        notes.push({ kind: "SUBSCRIPTION", severity: "info", title: `${s.name} renews ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`, body: `${fmt(s.amount, s.currency)} on ${formatLocal(s.nextDate, tz)}.`, href: "/subscriptions", dedupeKey: `sub:${s.id}:${s.nextDate.toISOString().slice(0, 10)}` });
      }
    }
  }

  if (on("lowBalance") && p.lowBalanceThreshold) {
    const accounts = await getAccountsWithBalances(userId, base, { includePending: p.includePending });
    for (const a of accounts) {
      if (!["CHECKING", "SAVINGS", "CASH", "DIGITAL_WALLET"].includes(a.type) || a.baseBalance === null) continue;
      if (a.baseBalance.lt(dec(p.lowBalanceThreshold))) {
        notes.push({ kind: "LOW_BALANCE", severity: "warning", title: `Low balance in ${a.name}`, body: `Balance is ${fmt(a.balance, a.currency)}, below your ${fmt(p.lowBalanceThreshold)} threshold.`, href: `/accounts/${a.id}`, dedupeKey: `low:${a.id}:${today.toISOString().slice(0, 10)}` });
      }
    }
  }

  if (on("missingIncome")) {
    // Expected (not auto-created) income that hasn't arrived 3 days after its date.
    const expected = await db.recurringTransaction.findMany({ where: { userId, active: true, autoCreate: false, type: "INCOME", nextDate: { lt: subDays(now, 3) } }, include: { account: true } });
    for (const r of expected) {
      const amt = dec(r.amount);
      const match = await db.transaction.findFirst({
        where: {
          userId,
          deletedAt: null,
          type: "INCOME",
          accountId: r.accountId,
          date: { gte: subDays(r.nextDate, 5), lte: addDays(r.nextDate, 5) },
          amount: r.isVariable ? { gt: 0 } : { gte: amt.times(0.8).toFixed(4), lte: amt.times(1.2).toFixed(4) },
        },
      });
      if (match) {
        if (!match.recurringId) await db.transaction.update({ where: { id: match.id }, data: { recurringId: r.id } }).catch(() => undefined);
      } else {
        notes.push({ kind: "MISSING_INCOME", severity: "warning", title: `${r.name} hasn't arrived`, body: `Expected about ${fmt(r.amount, r.account.currency)} on ${formatLocal(r.nextDate, tz)} in ${r.account.name}.`, href: "/bills", dedupeKey: `missing:${r.id}:${r.nextDate.toISOString().slice(0, 10)}` });
      }
      await db.recurringTransaction.update({ where: { id: r.id }, data: { nextDate: nextOccurrenceAfter(r.startDate, r.frequency, r.interval, r.nextDate, tz), lastRunAt: now } });
    }
  }

  if (on("goals")) {
    const goals = await getGoals(userId, p);
    for (const g of goals) {
      const reached = [25, 50, 75, 100].filter((m) => g.projection.percent >= m);
      if (!reached.length) continue;
      const m = Math.max(...reached);
      notes.push({ kind: "GOAL", severity: "success", title: m === 100 ? `${g.name} goal reached` : `${g.name} is ${m}% funded`, body: `${fmt(g.saved, g.currency)} of ${fmt(g.targetAmount, g.currency)} saved.`, href: "/goals", dedupeKey: `goal:${g.id}:${m}` });
    }
  }

  const recent = await db.transaction.findMany({
    where: { userId, deletedAt: null, date: { gte: subDays(now, 14) } },
    select: { id: true, accountId: true, date: true, amount: true, description: true, merchant: true, type: true, categoryId: true, baseAmount: true },
  });
  if (on("duplicates")) {
    for (const [a, b] of findPossibleDuplicates(recent)) {
      const t = recent.find((x) => x.id === b)!;
      notes.push({ kind: "DUPLICATE", severity: "info", title: "Possible duplicate transaction", body: `“${t.description}” for ${fmt(t.amount.abs())} appears twice within two days.`, href: `/transactions?q=${encodeURIComponent(t.description.slice(0, 40))}`, dedupeKey: `dup:${a}:${b}` });
    }
  }
  if (on("unusual")) {
    const history = await db.transaction.findMany({
      where: { userId, deletedAt: null, type: "EXPENSE", baseAmount: { not: null }, date: { gte: subDays(now, 180), lt: subDays(now, 7) } },
      select: { categoryId: true, baseAmount: true },
    });
    const current = recent.filter((t) => t.type === "EXPENSE" && t.baseAmount && t.date >= subDays(now, 7));
    const flagged = findUnusual(
      current.map((t) => ({ id: t.id, categoryId: t.categoryId, base: dec(t.baseAmount) })),
      history.map((h) => ({ categoryId: h.categoryId, base: dec(h.baseAmount) })),
    );
    for (const f of flagged) {
      const t = current.find((x) => x.id === f.id)!;
      notes.push({ kind: "UNUSUAL", severity: "warning", title: "Unusually large expense", body: `“${t.description}” (${fmt(dec(t.baseAmount).abs())}) is well above your typical ${fmt(f.median)} for this category.`, href: `/transactions?q=${encodeURIComponent(t.description.slice(0, 40))}`, dedupeKey: `unusual:${t.id}` });
    }
  }

  let created = 0;
  const quiet = inQuietHours(p.quietHoursStart, p.quietHoursEnd, tz, now);
  for (const n of notes) {
    try {
      const row = await db.notification.create({ data: { userId, ...n } });
      created++;
      if (p.notifyEmail && emailConfigured() && !quiet && (n.severity === "warning" || n.severity === "critical")) {
        const sent = await sendEmail(user.email, `Finora: ${n.title}`, n.body);
        if (sent) await db.notification.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
      }
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return { created };
}

// ───────────── Retention ─────────────

export async function applyRetention(userId: string, now = new Date()) {
  const p = await db.userPreferences.findUnique({ where: { userId } });
  if (!p) return;
  await db.auditLog.deleteMany({ where: { userId, createdAt: { lt: subDays(now, p.auditRetentionDays) } } });
  await db.notification.deleteMany({ where: { userId, readAt: { not: null }, createdAt: { lt: subDays(now, p.notificationRetentionDays) } } });
  // Soft-deleted transactions are purged after 30 days (undo window).
  await db.transaction.deleteMany({ where: { userId, deletedAt: { lt: subDays(now, 30) } } });
}

/** Everything the worker does for one user. */
export async function runUserJobs(userId: string, now = new Date()) {
  const r = await processRecurring(userId, now);
  await advanceSubscriptions(userId, now);
  const n = await generateNotifications(userId, now);
  await applyRetention(userId, now);
  return { ...r, notifications: n.created };
}

const lastRun = new Map<string, number>();
/** Opportunistic per-request maintenance so the app stays current even without the worker. */
export async function maybeRunUserJobs(userId: string) {
  const last = lastRun.get(userId) ?? 0;
  if (Date.now() - last < 5 * 60_000) return;
  lastRun.set(userId, Date.now());
  try {
    await runUserJobs(userId);
  } catch (e) {
    console.error("[jobs] user maintenance failed", e);
  }
}
