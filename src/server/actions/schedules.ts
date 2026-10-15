"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { dec } from "@/lib/money";
import { parseLocalDate } from "@/lib/dates";
import { nextOccurrenceAfter } from "@/lib/finance/recurrence";
import { amountString, currencyCode, optionalId, zodFieldErrors } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";
import { createTransaction } from "@/server/services/transactions";
import { processRecurring } from "@/server/services/jobs";

const FREQS = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY", "CUSTOM"] as const;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const optYmd = ymd.optional().nullable().or(z.literal(""));

async function ownedRefs(userId: string, accountId?: string | null, categoryId?: string | null) {
  if (accountId && !(await db.account.findFirst({ where: { id: accountId, userId } }))) return "Account not found";
  if (categoryId && !(await db.category.findFirst({ where: { id: categoryId, userId } }))) return "Category not found";
  return null;
}

// ───────────── Subscriptions ─────────────

const subSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  merchant: z.string().trim().max(120).optional().nullable(),
  amount: amountString.refine((a) => Number(a) > 0, "Amount must be positive"),
  currency: currencyCode,
  frequency: z.enum(FREQS),
  interval: z.coerce.number().int().min(1).max(365),
  nextDate: ymd,
  startDate: ymd,
  endDate: optYmd,
  accountId: optionalId,
  categoryId: optionalId,
  reminderDays: z.coerce.number().int().min(0).max(30),
  cancellationNotes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
});
export type SubscriptionFormValues = z.input<typeof subSchema>;

export async function saveSubscriptionAction(id: string | null, values: SubscriptionFormValues, detected = false): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = subSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const refErr = await ownedRefs(user.id, v.accountId, v.categoryId);
  if (refErr) return { ok: false, error: refErr };
  const tz = user.prefs.timezone;
  const data = {
    ...v,
    merchant: v.merchant || null,
    cancellationNotes: v.cancellationNotes || null,
    nextDate: parseLocalDate(v.nextDate, tz),
    startDate: parseLocalDate(v.startDate, tz),
    endDate: v.endDate ? parseLocalDate(v.endDate, tz) : null,
  };
  if (id) {
    const before = await db.subscription.findFirst({ where: { id, userId: user.id } });
    if (!before) return { ok: false, error: "Subscription not found" };
    const priceChanged = !dec(before.amount).eq(dec(v.amount));
    await db.subscription.update({
      where: { id },
      data: { ...data, ...(priceChanged ? { previousAmount: before.amount, amountChangedAt: new Date() } : {}) },
    });
    await audit(user.id, "subscription.update", "Subscription", id, { before, after: data });
  } else {
    const s = await db.subscription.create({ data: { ...data, userId: user.id, detected } });
    id = s.id;
    await audit(user.id, "subscription.create", "Subscription", id, { after: data });
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteSubscriptionAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.subscription.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "subscription.delete", "Subscription", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setSubscriptionStatusAction(id: string, status: "ACTIVE" | "PAUSED" | "CANCELLED"): Promise<ActionResult> {
  const user = await requireUser();
  // Records the user's decision only. Finora does not contact the merchant or cancel anything.
  await db.subscription.updateMany({ where: { id, userId: user.id }, data: { status } });
  await audit(user.id, "subscription.status", "Subscription", id, { after: { status } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────── Bills ─────────────

const billSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  kind: z.enum(["RENT", "UTILITIES", "PHONE_INTERNET", "INSURANCE", "LOAN", "CREDIT_CARD", "MEMBERSHIP", "EDUCATION", "OTHER"]),
  amount: amountString.refine((a) => Number(a) > 0, "Amount must be positive"),
  currency: currencyCode,
  isVariable: z.boolean(),
  frequency: z.enum(FREQS),
  interval: z.coerce.number().int().min(1).max(365),
  nextDueDate: ymd,
  accountId: optionalId,
  categoryId: optionalId,
  reminderDays: z.coerce.number().int().min(0).max(30),
  autopay: z.boolean(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type BillFormValues = z.input<typeof billSchema>;

export async function saveBillAction(id: string | null, values: BillFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = billSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const refErr = await ownedRefs(user.id, v.accountId, v.categoryId);
  if (refErr) return { ok: false, error: refErr };
  const data = { ...v, notes: v.notes || null, nextDueDate: parseLocalDate(v.nextDueDate, user.prefs.timezone) };
  if (id) {
    const r = await db.bill.updateMany({ where: { id, userId: user.id }, data });
    if (!r.count) return { ok: false, error: "Bill not found" };
    await audit(user.id, "bill.update", "Bill", id, { after: data });
  } else {
    const b = await db.bill.create({ data: { ...data, userId: user.id } });
    id = b.id;
    await audit(user.id, "bill.create", "Bill", id, { after: data });
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteBillAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.bill.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "bill.delete", "Bill", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Records that a bill was paid (Finora never initiates payments). Optionally records the
 * expense transaction, then advances the due date to the next occurrence.
 */
export async function markBillPaidAction(values: { billId: string; amount: string; paidOn: string; recordTransaction: boolean; accountId: string | null }): Promise<ActionResult> {
  const user = await requireUser();
  const bill = await db.bill.findFirst({ where: { id: values.billId, userId: user.id } });
  if (!bill) return { ok: false, error: "Bill not found" };
  const amt = amountString.safeParse(values.amount);
  if (!amt.success || Number(amt.data) <= 0) return { ok: false, error: "Enter the amount paid" };
  const paidAt = parseLocalDate(values.paidOn, user.prefs.timezone);
  let transactionId: string | null = null;
  if (values.recordTransaction) {
    const accountId = values.accountId ?? bill.accountId;
    if (!accountId) return { ok: false, error: "Choose the account the bill was paid from" };
    const t = await createTransaction(
      user.id,
      { accountId, type: "EXPENSE", date: new Date(paidAt.getTime() + 12 * 3600_000), description: bill.name, merchant: bill.name, amount: amt.data, categoryId: bill.categoryId, categorySource: bill.categoryId ? "USER" : undefined },
      { baseCurrency: user.prefs.baseCurrency },
    );
    transactionId = t.id;
  }
  const late = paidAt.getTime() > bill.nextDueDate.getTime() + 86400000;
  await db.$transaction([
    db.billPayment.upsert({
      where: { billId_dueDate: { billId: bill.id, dueDate: bill.nextDueDate } },
      create: { billId: bill.id, dueDate: bill.nextDueDate, paidAt, amount: amt.data, transactionId, late },
      update: { paidAt, amount: amt.data, transactionId, late },
    }),
    db.bill.update({
      where: { id: bill.id },
      data: { nextDueDate: nextOccurrenceAfter(bill.nextDueDate, bill.frequency, bill.interval, bill.nextDueDate, user.prefs.timezone), ...(bill.isVariable ? { amount: amt.data } : {}) },
    }),
  ]);
  await audit(user.id, "bill.paid", "Bill", bill.id, { after: { amount: amt.data, paidOn: values.paidOn, late, transactionId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────── Recurring transactions (salary, rent, SIPs…) ─────────────

const recSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
    accountId: z.string().min(1, "Choose an account").max(40),
    categoryId: optionalId,
    merchant: z.string().trim().max(120).optional().nullable(),
    amount: amountString.refine((a) => Number(a) > 0, "Amount must be positive"),
    isVariable: z.boolean(),
    frequency: z.enum(FREQS),
    interval: z.coerce.number().int().min(1).max(365),
    startDate: ymd,
    endDate: optYmd,
    autoCreate: z.boolean(),
    postAsCleared: z.boolean(),
  });
export type RecurringFormValues = z.input<typeof recSchema>;

export async function saveRecurringAction(id: string | null, values: RecurringFormValues): Promise<ActionResult<{ id: string; created?: number }>> {
  const user = await requireUser();
  const parsed = recSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.type === "TRANSFER") return { ok: false, error: "Use a bill or goal contribution for scheduled transfers." };
  const refErr = await ownedRefs(user.id, v.accountId, v.categoryId);
  if (refErr) return { ok: false, error: refErr };
  const tz = user.prefs.timezone;
  const startDate = parseLocalDate(v.startDate, tz);
  // Schedules post at midday local time to stay on the right calendar day.
  const anchor = new Date(startDate.getTime() + 12 * 3600_000);
  const data = {
    name: v.name,
    type: v.type,
    accountId: v.accountId,
    categoryId: v.categoryId,
    merchant: v.merchant || null,
    amount: v.amount,
    isVariable: v.isVariable,
    frequency: v.frequency,
    interval: v.interval,
    startDate: anchor,
    endDate: v.endDate ? parseLocalDate(v.endDate, tz) : null,
    autoCreate: v.autoCreate,
    status: v.postAsCleared ? "POSTED" : "PENDING",
  };
  if (id) {
    const before = await db.recurringTransaction.findFirst({ where: { id, userId: user.id } });
    if (!before) return { ok: false, error: "Schedule not found" };
    const now = new Date();
    const nextDate = anchor > now ? anchor : nextOccurrenceAfter(anchor, v.frequency, v.interval, before.lastRunAt ?? new Date(now.getTime() - 86400000), tz);
    await db.recurringTransaction.update({ where: { id }, data: { ...data, nextDate } });
    await audit(user.id, "recurring.update", "RecurringTransaction", id, { before, after: data });
  } else {
    const r = await db.recurringTransaction.create({ data: { ...data, nextDate: anchor, userId: user.id } });
    id = r.id;
    await audit(user.id, "recurring.create", "RecurringTransaction", id, { after: data });
  }
  // Generate any occurrences already due (e.g. a start date in the past).
  const res = v.autoCreate ? await processRecurring(user.id) : { created: 0 };
  revalidatePath("/", "layout");
  return { ok: true, data: { id, created: res.created } };
}

export async function toggleRecurringAction(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUser();
  await db.recurringTransaction.updateMany({ where: { id, userId: user.id }, data: { active } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRecurringAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  // Already-created transactions are kept; they just lose the schedule link.
  await db.recurringTransaction.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "recurring.delete", "RecurringTransaction", id);
  revalidatePath("/", "layout");
  return { ok: true };
}
