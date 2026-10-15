"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { optionalAmount, optionalId, zodFieldErrors } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";
import { ruleMatches } from "@/lib/finance/categorize";
import { ICON_NAMES, COLOR_SLOTS } from "@/components/finance/icons";

const catSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  icon: z.string().refine((i) => ICON_NAMES.includes(i), "Unknown icon"),
  color: z.string().refine((c) => (COLOR_SLOTS as readonly string[]).includes(c), "Unknown colour"),
  parentId: optionalId,
  monthlyTarget: optionalAmount,
  isEssential: z.boolean(),
});
export type CategoryFormValues = z.input<typeof catSchema>;

export async function saveCategoryAction(id: string | null, values: CategoryFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = catSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.parentId) {
    const parent = await db.category.findFirst({ where: { id: v.parentId, userId: user.id } });
    if (!parent) return { ok: false, error: "Parent category not found" };
    if (parent.parentId) return { ok: false, error: "Subcategories can only be one level deep" };
    if (parent.id === id) return { ok: false, error: "A category can't be its own parent" };
    v.kind = parent.kind;
  }
  const data = { ...v, monthlyTarget: v.monthlyTarget ?? null };
  try {
    if (id) {
      const before = await db.category.findFirst({ where: { id, userId: user.id } });
      if (!before) return { ok: false, error: "Category not found" };
      if (v.parentId && (await db.category.count({ where: { parentId: id } })) > 0) return { ok: false, error: "This category has subcategories, so it can't become a subcategory" };
      await db.category.update({ where: { id }, data });
      await audit(user.id, "category.update", "Category", id, { before, after: data });
    } else {
      const c = await db.category.create({ data: { ...data, userId: user.id } });
      id = c.id;
      await audit(user.id, "category.create", "Category", id, { after: data });
    }
  } catch {
    return { ok: false, error: "A category with this name already exists here", fieldErrors: { name: ["Already exists"] } };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function archiveCategoryAction(id: string, archived: boolean): Promise<ActionResult> {
  const user = await requireUser();
  await db.category.updateMany({ where: { userId: user.id, OR: [{ id }, { parentId: id }] }, data: { archived } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCategoryAction(id: string, reassignTo: string | null): Promise<ActionResult<{ moved: number }>> {
  const user = await requireUser();
  const cat = await db.category.findFirst({ where: { id, userId: user.id }, include: { children: { select: { id: true } } } });
  if (!cat) return { ok: false, error: "Category not found" };
  const ids = [id, ...cat.children.map((c) => c.id)];
  if (reassignTo && (ids.includes(reassignTo) || !(await db.category.findFirst({ where: { id: reassignTo, userId: user.id } })))) return { ok: false, error: "Choose a different category to move transactions to" };
  const moved = await db.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({ where: { userId: user.id, categoryId: { in: ids } }, data: { categoryId: reassignTo, categorySource: reassignTo ? "USER" : "NONE", needsReview: !reassignTo } });
    await tx.transactionSplit.updateMany({ where: { categoryId: { in: ids }, transaction: { userId: user.id } }, data: { categoryId: reassignTo } });
    await tx.category.deleteMany({ where: { id: { in: ids }, userId: user.id } });
    return r.count;
  });
  await audit(user.id, "category.delete", "Category", id, { before: cat, after: { reassignTo, moved } });
  revalidatePath("/", "layout");
  return { ok: true, data: { moved } };
}

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  field: z.enum(["DESCRIPTION", "MERCHANT"]),
  operator: z.enum(["CONTAINS", "EQUALS", "STARTS_WITH", "REGEX"]),
  value: z.string().trim().min(1, "Enter text to match").max(200),
  amountMin: optionalAmount,
  amountMax: optionalAmount,
  categoryId: z.string().min(1, "Choose a category").max(40),
  setMerchant: z.string().trim().max(120).optional().nullable(),
  priority: z.coerce.number().int().min(1).max(1000),
});
export type RuleFormValues = z.input<typeof ruleSchema>;

async function matchingTxns(userId: string, rule: z.output<typeof ruleSchema>, onlyUnconfirmed: boolean) {
  const candidates = await db.transaction.findMany({
    where: { userId, deletedAt: null, type: { in: ["EXPENSE", "INCOME", "REFUND"] }, splits: { none: {} }, ...(onlyUnconfirmed ? { categorySource: { not: "USER" } } : {}) },
    select: { id: true, description: true, merchant: true, amount: true, categoryId: true },
    take: 20000,
  });
  return candidates.filter((t) => ruleMatches({ id: "x", ...rule, active: true, amountMin: rule.amountMin ?? null, amountMax: rule.amountMax ?? null }, { description: t.description, merchant: t.merchant, amount: t.amount }));
}

/** Preview how many existing transactions a rule would affect before anything changes. */
export async function previewRuleAction(values: RuleFormValues): Promise<ActionResult<{ total: number; wouldChange: number; examples: string[] }>> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Complete the rule first", fieldErrors: zodFieldErrors(parsed.error) };
  const matches = await matchingTxns(user.id, parsed.data, true);
  return {
    ok: true,
    data: {
      total: matches.length,
      wouldChange: matches.filter((m) => m.categoryId !== parsed.data.categoryId).length,
      examples: [...new Set(matches.map((m) => m.merchant || m.description))].slice(0, 5),
    },
  };
}

export async function saveRuleAction(id: string | null, values: RuleFormValues, applyToExisting: boolean): Promise<ActionResult<{ updated: number }>> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (!(await db.category.findFirst({ where: { id: v.categoryId, userId: user.id } }))) return { ok: false, error: "Category not found" };
  if (v.operator === "REGEX") {
    try {
      new RegExp(v.value);
    } catch {
      return { ok: false, error: "Invalid regular expression", fieldErrors: { value: ["Invalid pattern"] } };
    }
  }
  const data = { ...v, amountMin: v.amountMin ?? null, amountMax: v.amountMax ?? null, setMerchant: v.setMerchant || null };
  if (id) {
    const r = await db.transactionRule.updateMany({ where: { id, userId: user.id }, data });
    if (!r.count) return { ok: false, error: "Rule not found" };
  } else {
    const r = await db.transactionRule.create({ data: { ...data, userId: user.id } });
    id = r.id;
  }
  let updated = 0;
  if (applyToExisting) {
    // Only rows not explicitly categorized by the user are changed, and the count is reported.
    const matches = await matchingTxns(user.id, v, true);
    const ids = matches.filter((m) => m.categoryId !== v.categoryId).map((m) => m.id);
    if (ids.length) {
      const r = await db.transaction.updateMany({
        where: { id: { in: ids } },
        data: { categoryId: v.categoryId, categorySource: "RULE", categoryConfidence: 1, needsReview: false, ...(v.setMerchant ? { merchant: v.setMerchant } : {}) },
      });
      updated = r.count;
    }
  }
  await audit(user.id, "rule.save", "TransactionRule", id, { after: { ...data, applyToExisting, updated } });
  revalidatePath("/", "layout");
  return { ok: true, data: { updated } };
}

export async function toggleRuleAction(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUser();
  await db.transactionRule.updateMany({ where: { id, userId: user.id }, data: { active } });
  revalidatePath("/categories");
  return { ok: true };
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.transactionRule.deleteMany({ where: { id, userId: user.id } });
  await audit(user.id, "rule.delete", "TransactionRule", id);
  revalidatePath("/categories");
  return { ok: true };
}

export async function deleteMerchantMappingAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.merchantMapping.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/categories");
  return { ok: true };
}
