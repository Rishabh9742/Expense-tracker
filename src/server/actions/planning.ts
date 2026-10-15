"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { dec, Decimal } from "@/lib/money";
import { parseLocalDate } from "@/lib/dates";
import { amountString, currencyCode, optionalAmount, optionalId, zodFieldErrors } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";
import { createTransaction } from "@/server/services/transactions";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const optYmd = ymd.optional().nullable().or(z.literal(""));
const positive = amountString.refine((a) => Number(a) > 0, "Must be greater than zero");

// ───────────── Goals ─────────────

const goalSchema = z.object({
  name: z.string().trim().min(1, "Name your goal").max(80),
  kind: z.enum(["EMERGENCY", "TRAVEL", "EDUCATION", "GADGET", "VEHICLE", "HOME", "MAJOR", "CUSTOM"]),
  icon: z.string().max(40),
  targetAmount: positive,
  currency: currencyCode,
  manualBalance: amountString,
  targetDate: optYmd,
  linkedAccountId: optionalId,
  monthlyContribution: optionalAmount,
  priority: z.coerce.number().int().min(1).max(3),
});
export type GoalFormValues = z.input<typeof goalSchema>;

export async function saveGoalAction(id: string | null, values: GoalFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = goalSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.linkedAccountId && !(await db.account.findFirst({ where: { id: v.linkedAccountId, userId: user.id } }))) return { ok: false, error: "Account not found" };
  const data = {
    ...v,
    targetDate: v.targetDate ? parseLocalDate(v.targetDate, user.prefs.timezone) : null,
    monthlyContribution: v.monthlyContribution ?? null,
  };
  if (id) {
    const r = await db.savingsGoal.updateMany({ where: { id, userId: user.id }, data });
    if (!r.count) return { ok: false, error: "Goal not found" };
  } else {
    id = (await db.savingsGoal.create({ data: { ...data, userId: user.id } })).id;
  }
  await audit(user.id, "goal.save", "SavingsGoal", id, { after: data });
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.savingsGoal.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "goal.delete", "SavingsGoal", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveGoalAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.savingsGoal.updateMany({ where: { id, userId: user.id }, data: { archived: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Records a contribution (or withdrawal, negative). For goals linked to an account,
 * the user can also record the real transfer from another account into it — in that case
 * the goal's progress comes from the account balance, so no manual contribution row is added.
 */
export async function addContributionAction(values: { goalId: string; amount: string; date: string; note?: string; fromAccountId?: string | null }): Promise<ActionResult> {
  const user = await requireUser();
  const goal = await db.savingsGoal.findFirst({ where: { id: values.goalId, userId: user.id } });
  if (!goal) return { ok: false, error: "Goal not found" };
  const amt = amountString.safeParse(values.amount);
  if (!amt.success || Number(amt.data) === 0) return { ok: false, error: "Enter an amount" };
  const date = parseLocalDate(values.date, user.prefs.timezone);
  if (goal.linkedAccountId) {
    if (!values.fromAccountId) return { ok: false, error: "This goal tracks a linked account. Choose the account the money came from to record the transfer." };
    if (Number(amt.data) < 0) return { ok: false, error: "To withdraw, record a transfer out of the linked account on the Transactions page." };
    const t = await createTransaction(
      user.id,
      { accountId: values.fromAccountId, type: "TRANSFER", toAccountId: goal.linkedAccountId, date: new Date(date.getTime() + 12 * 3600_000), description: `Contribution to ${goal.name}`, amount: amt.data, categoryId: (await db.category.findFirst({ where: { userId: user.id, name: "Savings", kind: "TRANSFER" } }))?.id ?? null },
      { baseCurrency: user.prefs.baseCurrency },
    );
    await audit(user.id, "goal.contribution", "SavingsGoal", goal.id, { after: { amount: amt.data, transactionId: t.id } });
  } else {
    await db.goalContribution.create({ data: { goalId: goal.id, amount: amt.data, date, note: values.note?.slice(0, 200) || null } });
    await audit(user.id, "goal.contribution", "SavingsGoal", goal.id, { after: { amount: amt.data } });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────── Debts ─────────────

const debtSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  type: z.enum(["CREDIT_CARD", "PERSONAL_LOAN", "EDUCATION_LOAN", "VEHICLE_LOAN", "MORTGAGE", "OTHER"]),
  lender: z.string().trim().max(80).optional().nullable(),
  currency: currencyCode,
  originalPrincipal: positive,
  currentBalance: amountString.refine((a) => Number(a) >= 0, "Can't be negative"),
  interestRate: optionalAmount.refine((a) => a === undefined || (Number(a) >= 0 && Number(a) <= 100), "APR between 0 and 100"),
  minimumPayment: optionalAmount,
  dueDay: z.coerce.number().int().min(1).max(31).optional().nullable().or(z.literal("").transform(() => null)),
  startDate: optYmd,
  termMonths: z.coerce.number().int().min(1).max(600).optional().nullable().or(z.literal("").transform(() => null)),
  linkedAccountId: optionalId,
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type DebtFormValues = z.input<typeof debtSchema>;

export async function saveDebtAction(id: string | null, values: DebtFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = debtSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.linkedAccountId) {
    const a = await db.account.findFirst({ where: { id: v.linkedAccountId, userId: user.id } });
    if (!a) return { ok: false, error: "Account not found" };
    if (a.type !== "LOAN" && a.type !== "CREDIT_CARD") return { ok: false, error: "Only loan or credit-card accounts can be linked", fieldErrors: { linkedAccountId: ["Choose a loan or card account"] } };
  }
  const data = {
    ...v,
    lender: v.lender || null,
    notes: v.notes || null,
    interestRate: v.interestRate ?? null,
    minimumPayment: v.minimumPayment ?? null,
    dueDay: v.dueDay ?? null,
    termMonths: v.termMonths ?? null,
    startDate: v.startDate ? parseLocalDate(v.startDate, user.prefs.timezone) : null,
  };
  if (id) {
    const r = await db.debt.updateMany({ where: { id, userId: user.id }, data });
    if (!r.count) return { ok: false, error: "Debt not found" };
  } else {
    const count = await db.debt.count({ where: { userId: user.id } });
    id = (await db.debt.create({ data: { ...data, userId: user.id, customOrder: count } })).id;
  }
  await audit(user.id, "debt.save", "Debt", id, { after: data });
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteDebtAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.debt.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "debt.delete", "Debt", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reorderDebtsAction(ids: string[]): Promise<ActionResult> {
  const user = await requireUser();
  await db.$transaction(ids.slice(0, 100).map((id, i) => db.debt.updateMany({ where: { id, userId: user.id }, data: { customOrder: i } })));
  revalidatePath("/debts");
  return { ok: true };
}

const paymentSchema = z.object({
  debtId: z.string().max(40),
  amount: positive,
  interest: optionalAmount,
  date: ymd,
  isExtra: z.boolean(),
  fromAccountId: optionalId,
  note: z.string().max(200).optional().nullable(),
});

/**
 * Records a debt payment. For a debt mirrored by a liability account, the payment is recorded
 * as a transfer into that account (so the account balance, and therefore the debt, goes down).
 * For a manually tracked debt, the principal portion reduces the stored balance and an expense
 * can optionally be recorded.
 */
export async function recordDebtPaymentAction(values: z.input<typeof paymentSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the payment details", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const debt = await db.debt.findFirst({ where: { id: v.debtId, userId: user.id } });
  if (!debt) return { ok: false, error: "Debt not found" };
  const amount = dec(v.amount);
  const interest = v.interest ? dec(v.interest) : null;
  if (interest && interest.gt(amount)) return { ok: false, error: "Interest can't exceed the payment" };
  const principal = interest ? amount.minus(interest) : amount;
  const date = parseLocalDate(v.date, user.prefs.timezone);
  let transactionId: string | null = null;
  if (v.fromAccountId) {
    const debtCat = await db.category.findFirst({ where: { userId: user.id, name: "Debt Payments" } });
    const t = debt.linkedAccountId
      ? await createTransaction(user.id, { accountId: v.fromAccountId, type: "TRANSFER", toAccountId: debt.linkedAccountId, date: new Date(date.getTime() + 12 * 3600_000), description: `Payment — ${debt.name}`, amount }, { baseCurrency: user.prefs.baseCurrency })
      : await createTransaction(
          user.id,
          { accountId: v.fromAccountId, type: "EXPENSE", date: new Date(date.getTime() + 12 * 3600_000), description: `Payment — ${debt.name}`, merchant: debt.lender, amount, categoryId: debtCat?.id ?? null, categorySource: debtCat ? "USER" : undefined },
          { baseCurrency: user.prefs.baseCurrency },
        );
    transactionId = t.id;
  }
  await db.$transaction(async (tx) => {
    await tx.debtPayment.create({ data: { debtId: debt.id, date, amount, principal, interest, isExtra: v.isExtra, note: v.note || null, transactionId } });
    if (!debt.linkedAccountId) {
      const newBal = Decimal.max(dec(debt.currentBalance).minus(principal), 0);
      await tx.debt.update({ where: { id: debt.id }, data: { currentBalance: newBal, ...(newBal.isZero() ? { closedAt: new Date() } : {}) } });
    }
  });
  await audit(user.id, "debt.payment", "Debt", debt.id, { after: { amount: amount.toString(), principal: principal.toString(), transactionId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────── Assets (net worth) ─────────────

const assetSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  type: z.enum(["PROPERTY", "VEHICLE", "INVESTMENT", "CASH", "OTHER"]),
  currency: currencyCode,
  value: amountString.refine((a) => Number(a) >= 0, "Value can't be negative"),
  valuedOn: ymd,
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type AssetFormValues = z.input<typeof assetSchema>;

export async function saveAssetAction(id: string | null, values: AssetFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = assetSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const date = new Date(`${v.valuedOn}T00:00:00Z`);
  if (id) {
    const a = await db.asset.findFirst({ where: { id, userId: user.id } });
    if (!a) return { ok: false, error: "Asset not found" };
    await db.asset.update({ where: { id }, data: { name: v.name, type: v.type, currency: v.currency, notes: v.notes || null } });
  } else {
    id = (await db.asset.create({ data: { userId: user.id, name: v.name, type: v.type, currency: v.currency, notes: v.notes || null } })).id;
  }
  await db.assetValuation.upsert({ where: { assetId_date: { assetId: id, date } }, create: { assetId: id, date, value: v.value }, update: { value: v.value } });
  await audit(user.id, "asset.save", "Asset", id, { after: v });
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function addValuationAction(assetId: string, value: string, valuedOn: string): Promise<ActionResult> {
  const user = await requireUser();
  const a = await db.asset.findFirst({ where: { id: assetId, userId: user.id } });
  if (!a) return { ok: false, error: "Asset not found" };
  const parsed = amountString.safeParse(value);
  if (!parsed.success || Number(parsed.data) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(valuedOn)) return { ok: false, error: "Enter a valid value and date" };
  const date = new Date(`${valuedOn}T00:00:00Z`);
  await db.assetValuation.upsert({ where: { assetId_date: { assetId, date } }, create: { assetId, date, value: parsed.data }, update: { value: parsed.data } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAssetAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.asset.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "asset.delete", "Asset", id);
  revalidatePath("/", "layout");
  return { ok: true };
}
