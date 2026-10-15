"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { dec } from "@/lib/money";
import { parseLocalDate } from "@/lib/dates";
import { isLiabilityAccount } from "@/lib/finance/networth";
import { amountString, currencyCode, zodFieldErrors } from "@/lib/validators";
import type { ActionResult } from "@/lib/utils";
import { createTransaction } from "@/server/services/transactions";
import { getAccountsWithBalances } from "@/server/services/balances";

const ACCOUNT_TYPES = ["CASH", "CHECKING", "SAVINGS", "CREDIT_CARD", "DIGITAL_WALLET", "INVESTMENT", "LOAN", "OTHER"] as const;

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name your account").max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyCode,
  /** For liability accounts this is the amount owed (positive). */
  openingBalance: amountString,
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  institution: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  includeInNetWorth: z.boolean().default(true),
  status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).default("ACTIVE"),
});
export type AccountFormValues = z.input<typeof accountSchema>;

function storedOpening(type: (typeof ACCOUNT_TYPES)[number], amount: string) {
  const d = dec(amount);
  return isLiabilityAccount(type) ? d.abs().negated() : d;
}

export async function saveAccountAction(id: string | null, values: AccountFormValues): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const data = {
    name: v.name,
    type: v.type,
    currency: v.currency,
    openingBalance: storedOpening(v.type, v.openingBalance),
    openingDate: parseLocalDate(v.openingDate, user.prefs.timezone),
    institution: v.institution || null,
    notes: v.notes || null,
    includeInNetWorth: v.includeInNetWorth,
    status: v.status,
  };
  if (id) {
    const before = await db.account.findFirst({ where: { id, userId: user.id } });
    if (!before) return { ok: false, error: "Account not found" };
    if (before.currency !== v.currency) {
      const count = await db.transaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }], deletedAt: null } });
      if (count > 0) return { ok: false, error: "Currency can't change once an account has transactions.", fieldErrors: { currency: ["Locked — account has transactions"] } };
    }
    const updated = await db.account.update({ where: { id }, data });
    await audit(user.id, "account.update", "Account", id, { before, after: updated });
    revalidatePath("/", "layout");
    return { ok: true, data: { id } };
  }
  const created = await db.account.create({ data: { ...data, userId: user.id } });
  await audit(user.id, "account.create", "Account", created.id, { after: created });
  revalidatePath("/", "layout");
  return { ok: true, data: { id: created.id } };
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const acct = await db.account.findFirst({ where: { id, userId: user.id } });
  if (!acct) return { ok: false, error: "Account not found" };
  const count = await db.transaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } });
  if (count > 0) return { ok: false, error: `This account has ${count} transaction${count === 1 ? "" : "s"}. Archive it instead to keep your history accurate.` };
  await db.account.delete({ where: { id } });
  await audit(user.id, "account.delete", "Account", id, { before: acct });
  revalidatePath("/", "layout");
  return { ok: true };
}

const reconcileSchema = z.object({
  accountId: z.string().max(40),
  statementBalance: amountString,
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createAdjustment: z.boolean(),
});

/**
 * Reconciliation: compare the statement balance with Finora's cleared balance as of the
 * statement date. If they differ and the user agrees, record an ADJUSTMENT for the
 * difference (never counted as income or spending) and mark the account reconciled.
 */
export async function reconcileAccountAction(values: z.input<typeof reconcileSchema>): Promise<ActionResult<{ difference: string; adjusted: boolean }>> {
  const user = await requireUser();
  const parsed = reconcileSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the statement balance and date." };
  const v = parsed.data;
  const acct = await db.account.findFirst({ where: { id: v.accountId, userId: user.id } });
  if (!acct) return { ok: false, error: "Account not found" };
  const asOf = new Date(parseLocalDate(v.statementDate, user.prefs.timezone).getTime() + 86400000);
  const [row] = await getAccountsWithBalances(user.id, user.prefs.baseCurrency, { accountIds: [acct.id], asOf, includePending: false, includeClosed: true });
  const statement = isLiabilityAccount(acct.type) ? dec(v.statementBalance).abs().negated() : dec(v.statementBalance);
  const current = row?.balance ?? dec(acct.openingBalance);
  const diff = statement.minus(current);
  let adjusted = false;
  if (!diff.isZero() && v.createAdjustment) {
    await createTransaction(
      user.id,
      {
        accountId: acct.id,
        type: "ADJUSTMENT",
        date: new Date(asOf.getTime() - 60_000),
        description: `Reconciliation adjustment (${v.statementDate})`,
        amount: diff,
        status: "CLEARED",
        notes: `Statement balance ${statement.toFixed(2)}; Finora cleared balance ${current.toFixed(2)}.`,
      },
      { baseCurrency: user.prefs.baseCurrency },
    );
    adjusted = true;
  }
  if (diff.isZero() || adjusted) {
    await db.account.update({ where: { id: acct.id }, data: { lastReconciledAt: asOf, reconciledBalance: statement } });
  }
  await audit(user.id, "account.reconcile", "Account", acct.id, { after: { statement: statement.toString(), current: current.toString(), diff: diff.toString(), adjusted } });
  revalidatePath("/", "layout");
  return { ok: true, data: { difference: diff.toString(), adjusted } };
}

/** Manual balance update: records an adjustment so the balance stays transaction-based and auditable. */
export async function setBalanceAction(accountId: string, newBalance: string): Promise<ActionResult<{ difference: string }>> {
  const user = await requireUser();
  const parsed = amountString.safeParse(newBalance);
  if (!parsed.success) return { ok: false, error: "Enter a valid balance" };
  const acct = await db.account.findFirst({ where: { id: accountId, userId: user.id } });
  if (!acct) return { ok: false, error: "Account not found" };
  const [row] = await getAccountsWithBalances(user.id, user.prefs.baseCurrency, { accountIds: [acct.id], includeClosed: true });
  const target = isLiabilityAccount(acct.type) ? dec(parsed.data).abs().negated() : dec(parsed.data);
  const diff = target.minus(row.balance);
  if (diff.isZero()) return { ok: true, data: { difference: "0" } };
  await createTransaction(
    user.id,
    { accountId: acct.id, type: "ADJUSTMENT", date: new Date(), description: "Manual balance update", amount: diff, status: "CLEARED" },
    { baseCurrency: user.prefs.baseCurrency },
  );
  revalidatePath("/", "layout");
  return { ok: true, data: { difference: diff.toString() } };
}
