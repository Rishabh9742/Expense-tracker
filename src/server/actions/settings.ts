"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, clientIp } from "@/lib/session";
import { audit } from "@/lib/audit";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { hashPassword, passwordSchema, signOut } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { recomputeBaseAmounts } from "@/server/services/transactions";
import { deleteUserFiles } from "@/lib/storage";
import type { ActionResult } from "@/lib/utils";

export async function saveThemeAction(theme: string): Promise<void> {
  const user = await requireUser();
  if (!["light", "dark", "system"].includes(theme)) return;
  await db.userPreferences.update({ where: { userId: user.id }, data: { theme } });
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await requireUser();
  await db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

const currencyEnum = z.enum(SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]]);

const prefsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseCurrency: currencyEnum,
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  weekStartsOn: z.coerce.number().int().min(0).max(1),
  includePending: z.boolean(),
  excludeReimbursable: z.boolean(),
});

export async function savePreferencesAction(values: z.input<typeof prefsSchema>): Promise<ActionResult<{ recomputed?: number; missing?: number }>> {
  const user = await requireUser();
  const parsed = prefsSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  const { name, ...prefs } = parsed.data;
  const before = user.prefs;
  await db.user.update({ where: { id: user.id }, data: { name } });
  await db.userPreferences.update({ where: { userId: user.id }, data: prefs });
  let result: { updated: number; missing: number } | undefined;
  if (before.baseCurrency !== prefs.baseCurrency) {
    result = await recomputeBaseAmounts(user.id, prefs.baseCurrency);
  }
  await audit(user.id, "settings.update", "UserPreferences", before.id, { before, after: prefs });
  revalidatePath("/", "layout");
  return { ok: true, data: result ? { recomputed: result.updated, missing: result.missing } : {} };
}

const notifSchema = z.object({
  notifyEmail: z.boolean(),
  quietHoursStart: z.number().int().min(0).max(23).nullable(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable(),
  billReminderDays: z.number().int().min(0).max(30),
  lowBalanceThreshold: z.string().regex(/^\d{0,13}(\.\d{1,4})?$/).nullable(),
  budgetAlertLevels: z.array(z.number().int().min(1).max(200)).max(6),
  alertsEnabled: z.record(z.string(), z.boolean()),
});

export async function saveNotificationPrefsAction(values: z.input<typeof notifSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = notifSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Invalid notification settings" };
  const v = parsed.data;
  await db.userPreferences.update({
    where: { userId: user.id },
    data: { ...v, lowBalanceThreshold: v.lowBalanceThreshold ? v.lowBalanceThreshold : null },
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveAiPrefsAction(values: { aiEnabled: boolean; aiAutoCategorize: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const enabled = !!values.aiEnabled;
  await db.userPreferences.update({
    where: { userId: user.id },
    data: { aiEnabled: enabled, aiAutoCategorize: enabled && !!values.aiAutoCategorize, aiConsentAt: enabled ? new Date() : null },
  });
  await audit(user.id, enabled ? "ai.consent_granted" : "ai.consent_revoked", "UserPreferences", user.prefs.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveRetentionAction(values: { auditRetentionDays: number; notificationRetentionDays: number }): Promise<ActionResult> {
  const user = await requireUser();
  const a = Math.max(30, Math.min(3650, Math.round(values.auditRetentionDays)));
  const n = Math.max(7, Math.min(3650, Math.round(values.notificationRetentionDays)));
  await db.userPreferences.update({ where: { userId: user.id }, data: { auditRetentionDays: a, notificationRetentionDays: n } });
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveDashboardLayoutAction(layout: { id: string; hidden: boolean }[]): Promise<ActionResult> {
  const user = await requireUser();
  const safe = z.array(z.object({ id: z.string().max(40), hidden: z.boolean() })).max(30).safeParse(layout);
  if (!safe.success) return { ok: false, error: "Invalid layout" };
  await db.userPreferences.update({ where: { userId: user.id }, data: { dashboardLayout: safe.data } });
  revalidatePath("/");
  return { ok: true };
}

export async function dismissOnboardingAction(): Promise<void> {
  const user = await requireUser();
  await db.userPreferences.update({ where: { userId: user.id }, data: { onboardingDismissed: true } });
  revalidatePath("/");
}

export async function changePasswordAction(values: { current: string; next: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(values.next);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const row = await db.user.findUnique({ where: { id: user.id } });
  if (!row?.passwordHash || !(await bcrypt.compare(values.current, row.passwordHash))) return { ok: false, error: "Current password is incorrect" };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data) } });
  await audit(user.id, "auth.password_changed", "User", user.id, { ip: await clientIp() });
  return { ok: true };
}

const rateSchema = z.object({
  base: currencyEnum,
  quote: currencyEnum,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.string().regex(/^\d{1,9}(\.\d{1,8})?$/).refine((r) => Number(r) > 0, "Rate must be positive"),
});

export async function addManualRateAction(values: z.input<typeof rateSchema>): Promise<ActionResult<{ fixed: number }>> {
  const user = await requireUser();
  const parsed = rateSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.base === v.quote) return { ok: false, error: "Choose two different currencies" };
  const date = new Date(`${v.date}T00:00:00Z`);
  const existing = await db.exchangeRate.findFirst({ where: { userId: user.id, base: v.base, quote: v.quote, date } });
  if (existing) await db.exchangeRate.update({ where: { id: existing.id }, data: { rate: v.rate } });
  else await db.exchangeRate.create({ data: { userId: user.id, base: v.base, quote: v.quote, date, rate: v.rate, source: "manual" } });
  await audit(user.id, "fx.manual_rate", "ExchangeRate", null, { after: v });
  const r = await recomputeBaseAmounts(user.id, user.prefs.baseCurrency, true);
  revalidatePath("/", "layout");
  return { ok: true, data: { fixed: r.updated - r.missing } };
}

export async function deleteManualRateAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.exchangeRate.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/settings");
  return { ok: true };
}

/** Permanently deletes the account and every row and file belonging to it. */
export async function deleteAccountAction(values: { password: string; confirm: string }): Promise<ActionResult> {
  const user = await requireUser();
  if (values.confirm !== "DELETE") return { ok: false, error: 'Type DELETE to confirm' };
  const row = await db.user.findUnique({ where: { id: user.id } });
  if (!row?.passwordHash || !(await bcrypt.compare(values.password, row.passwordHash))) return { ok: false, error: "Password is incorrect" };
  await deleteUserFiles(user.id);
  await db.user.delete({ where: { id: user.id } }); // cascades to all owned records
  await signOut({ redirectTo: "/login?deleted=1" });
  return { ok: true };
}

export async function clearSampleDataAction(): Promise<ActionResult<{ removed: number }>> {
  const user = await requireUser();
  const t = await db.transaction.deleteMany({ where: { userId: user.id, isSample: true } });
  const a = await db.account.deleteMany({ where: { userId: user.id, isSample: true } });
  await audit(user.id, "sample.clear", "User", user.id, { after: { transactions: t.count, accounts: a.count } });
  revalidatePath("/", "layout");
  return { ok: true, data: { removed: t.count + a.count } };
}

