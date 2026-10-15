import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { money, Decimal, dec } from "@/lib/money";
import { resolveRange } from "@/lib/dates";
import { cashFlow } from "@/lib/finance/aggregate";
import { aiConfigured, aiModel } from "@/server/ai/provider";
import { emailConfigured } from "@/server/services/email";
import { getAccountsWithBalances } from "@/server/services/balances";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const p = user.prefs;
  const [rates, logs, membership, myAccounts, sampleCount, lastJob] = await Promise.all([
    db.exchangeRate.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 50 }),
    db.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, action: true, entityType: true, createdAt: true, ip: true } }),
    db.householdMember.findFirst({ where: { userId: user.id }, include: { household: { include: { members: { include: { user: { select: { name: true, email: true } } } } } } } }),
    db.account.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, name: true, householdId: true } }),
    db.transaction.count({ where: { userId: user.id, isSample: true } }),
    db.jobRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  // Household summary: only accounts explicitly shared with the household are included.
  let household = null;
  if (membership) {
    const h = membership.household;
    const shared = await db.account.findMany({ where: { householdId: h.id, status: "ACTIVE" }, include: { user: { select: { name: true, email: true } } } });
    const month = resolveRange("this_month", p.timezone);
    const txns = shared.length
      ? await db.transaction.findMany({
          where: { deletedAt: null, accountId: { in: shared.map((a) => a.id) }, date: { gte: month.from, lt: month.to } },
          select: { type: true, status: true, amount: true, baseAmount: true, isReimbursable: true },
        })
      : [];
    const cf = cashFlow(txns, p);
    // Balances are computed per owner (each owner's own data scope), then filtered to shared accounts.
    const balances = new Map<string, { balance: Decimal; currency: string }>();
    for (const ownerId of [...new Set(shared.map((a) => a.userId))]) {
      const rows = await getAccountsWithBalances(ownerId, p.baseCurrency, { accountIds: shared.filter((a) => a.userId === ownerId).map((a) => a.id) });
      for (const r of rows) balances.set(r.id, { balance: r.balance, currency: r.currency });
    }
    household = {
      id: h.id,
      name: h.name,
      isOwner: h.ownerId === user.id,
      myRole: membership.role,
      myMemberId: membership.id,
      members: h.members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role })),
      sharedAccounts: shared.map((a) => ({ id: a.id, name: a.name, owner: a.user.name ?? a.user.email, balance: money(balances.get(a.id)?.balance ?? dec(0)), currency: a.currency })),
      monthSpending: money(cf.expenses),
      monthIncome: money(cf.income),
      monthLabel: month.label,
    };
  }

  return (
    <SettingsView
      profile={{ name: user.name ?? "", email: user.email }}
      prefs={{
        baseCurrency: p.baseCurrency,
        timezone: p.timezone,
        locale: p.locale,
        weekStartsOn: p.weekStartsOn,
        includePending: p.includePending,
        excludeReimbursable: p.excludeReimbursable,
        notifyEmail: p.notifyEmail,
        quietHoursStart: p.quietHoursStart,
        quietHoursEnd: p.quietHoursEnd,
        billReminderDays: p.billReminderDays,
        lowBalanceThreshold: p.lowBalanceThreshold?.toString() ?? "",
        budgetAlertLevels: p.budgetAlertLevels,
        alertsEnabled: (p.alertsEnabled as Record<string, boolean> | null) ?? {},
        aiEnabled: p.aiEnabled,
        aiAutoCategorize: p.aiAutoCategorize,
        aiConsentAt: p.aiConsentAt?.toISOString() ?? null,
        auditRetentionDays: p.auditRetentionDays,
        notificationRetentionDays: p.notificationRetentionDays,
      }}
      integrations={{
        ai: aiConfigured() ? `Anthropic · ${aiModel()}` : null,
        email: emailConfigured(),
        fx: (process.env.FX_PROVIDER ?? "frankfurter") === "none" ? null : "Frankfurter (European Central Bank reference rates)",
        bank: process.env.BANK_SYNC_PROVIDER || null,
        lastJob: lastJob ? { at: lastJob.startedAt.toISOString(), ok: lastJob.ok, name: lastJob.name } : null,
      }}
      rates={rates.map((r) => ({ id: r.id, base: r.base, quote: r.quote, date: r.date.toISOString().slice(0, 10), rate: r.rate.toString() }))}
      logs={logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
      household={household}
      myAccounts={myAccounts}
      sampleCount={sampleCount}
    />
  );
}
