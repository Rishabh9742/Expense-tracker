"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { parseLocalDate } from "@/lib/dates";
import { amountString, optionalId, zodFieldErrors } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";

const budgetSchema = z
  .object({
    name: z.string().trim().min(1, "Name this budget").max(80),
    scope: z.enum(["OVERALL", "CATEGORY", "ACCOUNT", "MERCHANT"]),
    method: z.enum(["FIXED", "ZERO_BASED", "ENVELOPE", "PERCENTAGE", "ROLLOVER"]),
    period: z.enum(["WEEKLY", "MONTHLY", "CUSTOM"]),
    amount: amountString,
    percentOfIncome: z.string().trim().optional().nullable(),
    categoryId: optionalId,
    accountId: optionalId,
    merchant: z.string().trim().max(120).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
    alertLevels: z.array(z.number().int().min(1).max(200)).max(6),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "CATEGORY" && !v.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    if (v.scope === "ACCOUNT" && !v.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "Choose an account" });
    if (v.scope === "MERCHANT" && !v.merchant) ctx.addIssue({ code: "custom", path: ["merchant"], message: "Enter a merchant" });
    if (v.period === "CUSTOM" && !v.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Custom budgets need an end date" });
    if (v.method === "PERCENTAGE") {
      const p = Number(v.percentOfIncome);
      if (!v.percentOfIncome || !(p > 0 && p <= 100)) ctx.addIssue({ code: "custom", path: ["percentOfIncome"], message: "Enter a percentage between 0 and 100" });
    } else if (!(Number(v.amount) > 0)) ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero" });
  });
export type BudgetFormValues = z.input<typeof budgetSchema>;

export async function saveBudgetAction(id: string | null, values: BudgetFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = budgetSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.categoryId && !(await db.category.findFirst({ where: { id: v.categoryId, userId: user.id } }))) return { ok: false, error: "Category not found" };
  if (v.accountId && !(await db.account.findFirst({ where: { id: v.accountId, userId: user.id } }))) return { ok: false, error: "Account not found" };
  const tz = user.prefs.timezone;
  const data = {
    name: v.name,
    scope: v.scope,
    method: v.method,
    period: v.period,
    amount: v.method === "PERCENTAGE" ? "0" : v.amount,
    percentOfIncome: v.method === "PERCENTAGE" ? v.percentOfIncome : null,
    categoryId: v.scope === "CATEGORY" ? v.categoryId : null,
    accountId: v.scope === "ACCOUNT" ? v.accountId : null,
    merchant: v.scope === "MERCHANT" ? v.merchant : null,
    startDate: parseLocalDate(v.startDate, tz),
    endDate: v.endDate ? parseLocalDate(v.endDate, tz) : null,
    alertLevels: [...new Set(v.alertLevels)].sort((a, b) => a - b),
  };
  if (id) {
    const before = await db.budget.findFirst({ where: { id, userId: user.id } });
    if (!before) return { ok: false, error: "Budget not found" };
    await db.budget.update({ where: { id }, data });
    await audit(user.id, "budget.update", "Budget", id, { before, after: data });
  } else {
    const b = await db.budget.create({ data: { ...data, userId: user.id } });
    id = b.id;
    await audit(user.id, "budget.create", "Budget", id, { after: data });
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteBudgetAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const r = await db.budget.deleteMany({ where: { id, userId: user.id } });
  if (!r.count) return { ok: false, error: "Budget not found" };
  await audit(user.id, "budget.delete", "Budget", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Envelope funding / one-off override of a single period's allocation. */
export async function setPeriodAllocationAction(budgetId: string, periodStart: string, periodEnd: string, allocated: string | null): Promise<ActionResult> {
  const user = await requireUser();
  const b = await db.budget.findFirst({ where: { id: budgetId, userId: user.id } });
  if (!b) return { ok: false, error: "Budget not found" };
  const start = new Date(periodStart);
  if (allocated === null) {
    await db.budgetAllocation.deleteMany({ where: { budgetId, periodStart: start } });
  } else {
    const parsed = amountString.safeParse(allocated);
    if (!parsed.success || Number(parsed.data) < 0) return { ok: false, error: "Enter a valid amount" };
    await db.budgetAllocation.upsert({
      where: { budgetId_periodStart: { budgetId, periodStart: start } },
      create: { budgetId, periodStart: start, periodEnd: new Date(periodEnd), allocated: parsed.data },
      update: { allocated: parsed.data },
    });
  }
  await audit(user.id, "budget.allocation", "Budget", budgetId, { after: { periodStart, allocated } });
  revalidatePath("/", "layout");
  return { ok: true };
}
