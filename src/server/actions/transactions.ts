"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseLocalDateTime } from "@/lib/dates";
import { rateLimit } from "@/lib/rate-limit";
import { transactionSchema, zodFieldErrors, type TransactionFormValues } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";
import {
  createTransaction,
  rememberMerchantCategory,
  restoreTransactions,
  ServiceError,
  softDeleteTransactions,
  undoTransactionEdit,
  updateTransaction,
  type TransactionInput,
} from "@/server/services/transactions";
import { audit } from "@/lib/audit";
import { TXN_INCLUDE, toTxnDTO, type TxnDTO } from "@/lib/dto";

function toInput(v: z.output<typeof transactionSchema>, tz: string): TransactionInput {
  return {
    type: v.type,
    amount: v.amount,
    description: v.description,
    date: parseLocalDateTime(v.date, tz),
    accountId: v.accountId,
    toAccountId: v.toAccountId,
    toAmount: v.toAmount ?? null,
    categoryId: v.categoryId,
    merchant: v.merchant,
    status: v.status,
    paymentMethod: v.paymentMethod,
    notes: v.notes,
    isReimbursable: v.isReimbursable,
    originalAmount: v.originalAmount ?? null,
    originalCurrency: v.originalAmount ? v.originalCurrency : null,
    tags: v.tags ? v.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    splits: v.splits?.length ? v.splits : undefined,
  };
}

function fail(e: unknown): ActionResult<never> {
  if (e instanceof ServiceError) return { ok: false, error: e.message, fieldErrors: e.field ? { [e.field]: [e.message] } : undefined };
  console.error(e);
  return { ok: false, error: "Something went wrong. Your changes were not saved." };
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function createTransactionAction(values: TransactionFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!rateLimit(`txn:${user.id}`, 120, 60_000).ok) return { ok: false, error: "Too many requests — slow down a little." };
  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  try {
    const t = await createTransaction(user.id, toInput(parsed.data, user.prefs.timezone), { baseCurrency: user.prefs.baseCurrency });
    refresh();
    return { ok: true, data: { id: t.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateTransactionAction(id: string, values: TransactionFormValues): Promise<ActionResult<{ auditId: string; suggestRule?: { merchant: string; categoryId: string } }>> {
  const user = await requireUser();
  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  try {
    const before = await db.transaction.findFirst({ where: { id, userId: user.id }, select: { categoryId: true, merchant: true, description: true } });
    const { auditId, updated } = await updateTransaction(user.id, id, toInput(parsed.data, user.prefs.timezone), user.prefs.baseCurrency);
    refresh();
    const corrected = before && updated.categoryId && before.categoryId !== updated.categoryId;
    return {
      ok: true,
      data: { auditId, suggestRule: corrected ? { merchant: updated.merchant || updated.description, categoryId: updated.categoryId! } : undefined },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function undoEditAction(auditId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await undoTransactionEdit(user.id, auditId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTransactionsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requireUser();
  const parsed = z.array(z.string().max(40)).min(1).max(1000).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Nothing selected" };
  const count = await softDeleteTransactions(user.id, parsed.data);
  refresh();
  return { ok: true, data: { count } };
}

export async function restoreTransactionsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requireUser();
  const count = await restoreTransactions(user.id, ids.slice(0, 1000));
  refresh();
  return { ok: true, data: { count } };
}

export async function duplicateTransactionAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const t = await db.transaction.findFirst({ where: { id, userId: user.id, deletedAt: null }, include: { splits: true, tags: { include: { tag: true } } } });
  if (!t) return { ok: false, error: "Transaction not found" };
  try {
    const copy = await createTransaction(
      user.id,
      {
        accountId: t.accountId,
        type: t.type,
        date: new Date(),
        description: t.description,
        merchant: t.merchant,
        amount: t.type === "ADJUSTMENT" ? t.amount : t.amount.abs(),
        categoryId: t.categoryId,
        categorySource: t.categoryId ? "USER" : undefined,
        toAccountId: t.toAccountId,
        toAmount: t.toAmount,
        status: t.status,
        paymentMethod: t.paymentMethod,
        notes: t.notes,
        isReimbursable: t.isReimbursable,
        tags: t.tags.map((x) => x.tag.name),
        splits: t.splits.length ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount })) : undefined,
      },
      { baseCurrency: user.prefs.baseCurrency },
    );
    refresh();
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().max(40)).min(1).max(1000),
  categoryId: optionalStr(),
  accountId: optionalStr(),
  status: z.enum(["CLEARED", "PENDING"]).optional(),
  addTag: z.string().trim().max(40).optional(),
  isReimbursable: z.boolean().optional(),
});
function optionalStr() {
  return z.string().max(40).optional();
}

/** Bulk edit / bulk categorization. Only applies the fields provided. */
export async function bulkUpdateAction(values: z.input<typeof bulkSchema>): Promise<ActionResult<{ count: number }>> {
  const user = await requireUser();
  const parsed = bulkSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Invalid bulk update" };
  const v = parsed.data;
  const owned = await db.transaction.findMany({ where: { userId: user.id, id: { in: v.ids }, deletedAt: null }, select: { id: true, type: true, accountId: true } });
  const ids = owned.map((o) => o.id);
  if (!ids.length) return { ok: false, error: "No matching transactions" };
  if (v.categoryId) {
    const cat = await db.category.findFirst({ where: { id: v.categoryId, userId: user.id } });
    if (!cat) return { ok: false, error: "Category not found" };
  }
  if (v.accountId) {
    const acct = await db.account.findFirst({ where: { id: v.accountId, userId: user.id } });
    if (!acct) return { ok: false, error: "Account not found" };
    // Moving between currencies would invalidate amounts; only allow same-currency moves.
    const currencies = await db.account.findMany({ where: { id: { in: [...new Set(owned.map((o) => o.accountId))] } }, select: { currency: true } });
    if (currencies.some((c) => c.currency !== acct.currency)) return { ok: false, error: "Can only move transactions between accounts with the same currency" };
  }
  const result = await db.$transaction(async (tx) => {
    const r = await tx.transaction.updateMany({
      where: { id: { in: ids }, userId: user.id },
      data: {
        ...(v.categoryId ? { categoryId: v.categoryId, categorySource: "USER", categoryConfidence: null, needsReview: false } : {}),
        ...(v.accountId ? { accountId: v.accountId } : {}),
        ...(v.status ? { status: v.status } : {}),
        ...(v.isReimbursable !== undefined ? { isReimbursable: v.isReimbursable } : {}),
      },
    });
    if (v.categoryId) await tx.transactionSplit.deleteMany({ where: { transactionId: { in: ids } } });
    if (v.addTag) {
      const tag = await tx.tag.upsert({ where: { userId_name: { userId: user.id, name: v.addTag } }, create: { userId: user.id, name: v.addTag }, update: {} });
      await tx.transactionTag.createMany({ data: ids.map((transactionId) => ({ transactionId, tagId: tag.id })), skipDuplicates: true });
    }
    return r.count;
  });
  await audit(user.id, "transaction.bulk_update", "Transaction", null, { after: { ...v, ids, count: ids.length } });
  refresh();
  return { ok: true, data: { count: result } };
}

export async function confirmCategoryAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await db.transaction.updateMany({ where: { id, userId: user.id }, data: { needsReview: false, categorySource: "USER", categoryConfidence: null } });
  refresh();
  return { ok: true };
}

/** User explicitly approves "always categorize this merchant as X". */
export async function createMerchantRuleAction(merchant: string, categoryId: string, applyToExisting: boolean): Promise<ActionResult<{ updated: number }>> {
  const user = await requireUser();
  try {
    const mapping = await rememberMerchantCategory(user.id, merchant, categoryId);
    let updated = 0;
    if (mapping && applyToExisting) {
      // Only uncategorized or non-user-confirmed rows are changed, and the count is reported back.
      const candidates = await db.transaction.findMany({
        where: { userId: user.id, deletedAt: null, categorySource: { not: "USER" }, type: { in: ["EXPENSE", "INCOME", "REFUND"] } },
        select: { id: true, merchant: true, description: true },
      });
      const { normalizeMerchant } = await import("@/lib/finance/duplicates");
      const ids = candidates.filter((c) => normalizeMerchant(c.merchant || c.description) === mapping.merchant).map((c) => c.id);
      if (ids.length) {
        const r = await db.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId, categorySource: "MERCHANT", categoryConfidence: 1, needsReview: false } });
        updated = r.count;
      }
    }
    await audit(user.id, "rule.merchant_mapping", "MerchantMapping", mapping?.id ?? null, { after: { merchant, categoryId, applyToExisting, updated } });
    refresh();
    return { ok: true, data: { updated } };
  } catch (e) {
    return fail(e);
  }
}

export async function getTransactionDetail(id: string): Promise<TxnDTO | null> {
  const user = await requireUser();
  const t = await db.transaction.findFirst({ where: { id, userId: user.id, deletedAt: null }, include: TXN_INCLUDE });
  return t ? toTxnDTO(t) : null;
}
