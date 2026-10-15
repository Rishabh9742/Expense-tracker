import { Prisma, type CategorySource, type TransactionStatus, type TransactionType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getRate } from "@/lib/fx";
import { Decimal, dec, sum, type DecimalLike } from "@/lib/money";
import { categorize, REVIEW_CONFIDENCE_THRESHOLD, type RuleLike } from "@/lib/finance/categorize";
import { normalizeMerchant } from "@/lib/finance/duplicates";

export class ServiceError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

export interface TransactionInput {
  accountId: string;
  type: TransactionType;
  date: Date;
  description: string;
  merchant?: string | null;
  /** Magnitude for EXPENSE/INCOME/REFUND/TRANSFER; signed for ADJUSTMENT */
  amount: DecimalLike;
  categoryId?: string | null;
  categorySource?: CategorySource;
  categoryConfidence?: number | null;
  toAccountId?: string | null;
  toAmount?: DecimalLike | null;
  originalAmount?: DecimalLike | null;
  originalCurrency?: string | null;
  status?: TransactionStatus;
  paymentMethod?: string | null;
  notes?: string | null;
  isReimbursable?: boolean;
  tags?: string[];
  splits?: { categoryId: string | null; amount: DecimalLike; note?: string | null }[];
  recurringId?: string | null;
  occurrenceDate?: Date | null;
  importBatchId?: string | null;
  importHash?: string | null;
  isSample?: boolean;
  /** skip automatic categorization */
  noAutoCategorize?: boolean;
}

export function signedAmount(type: TransactionType, amount: DecimalLike): Decimal {
  const a = dec(amount);
  switch (type) {
    case "EXPENSE":
    case "TRANSFER":
      return a.abs().negated();
    case "INCOME":
    case "REFUND":
      return a.abs();
    case "ADJUSTMENT":
      return a;
  }
}

export type Categorizer = (input: { description: string; merchant?: string | null; amount: DecimalLike }) => ReturnType<typeof categorize>;

/** Load rules, merchant mappings and confirmed history once, then categorize many rows. */
export async function loadCategorizer(userId: string): Promise<Categorizer> {
  const [rules, maps, history] = await Promise.all([
    db.transactionRule.findMany({ where: { userId, active: true } }),
    db.merchantMapping.findMany({ where: { userId, confirmed: true } }),
    db.transaction.findMany({
      where: { userId, deletedAt: null, categoryId: { not: null }, categorySource: { in: ["USER", "RULE", "MERCHANT"] } },
      select: { merchant: true, description: true, categoryId: true },
      orderBy: { date: "desc" },
      take: 3000,
    }),
  ]);
  const merchantMap = new Map(maps.map((m) => [m.merchant, m.categoryId]));
  const hist = new Map<string, Map<string, number>>();
  for (const h of history) {
    const k = normalizeMerchant(h.merchant || h.description);
    if (!k || !h.categoryId) continue;
    const m = hist.get(k) ?? new Map<string, number>();
    m.set(h.categoryId, (m.get(h.categoryId) ?? 0) + 1);
    hist.set(k, m);
  }
  const ruleLikes: RuleLike[] = rules.map((r) => ({ ...r, amountMin: r.amountMin, amountMax: r.amountMax }));
  return (input) => categorize(input, ruleLikes, merchantMap, hist);
}

async function assertOwned(userId: string, ids: { accountIds: string[]; categoryIds: string[] }, client: Prisma.TransactionClient | typeof db = db) {
  const accounts = ids.accountIds.length
    ? await client.account.findMany({ where: { userId, id: { in: ids.accountIds } }, select: { id: true, currency: true, status: true } })
    : [];
  if (accounts.length !== new Set(ids.accountIds).size) throw new ServiceError("Account not found", "accountId");
  const cats = ids.categoryIds.length ? await client.category.count({ where: { userId, id: { in: ids.categoryIds } } }) : 0;
  if (cats !== new Set(ids.categoryIds).size) throw new ServiceError("Category not found", "categoryId");
  return new Map(accounts.map((a) => [a.id, a]));
}

interface ResolvedTxn {
  data: Omit<Prisma.TransactionUncheckedCreateInput, "userId">;
  splits: { categoryId: string | null; amount: Decimal; note?: string | null }[] | undefined;
  tags: string[] | undefined;
}

async function resolve(userId: string, input: TransactionInput, baseCurrency: string, categorizer?: Categorizer): Promise<ResolvedTxn> {
  const description = input.description.trim();
  if (!description) throw new ServiceError("Description is required", "description");
  const magnitude = dec(input.amount);
  if (magnitude.isZero()) throw new ServiceError("Amount cannot be zero", "amount");
  if (input.type !== "ADJUSTMENT" && magnitude.isNegative()) throw new ServiceError("Enter a positive amount and choose the type", "amount");

  const splitCats = (input.splits ?? []).map((s) => s.categoryId).filter((x): x is string => !!x);
  const accounts = await assertOwned(userId, {
    accountIds: [input.accountId, ...(input.toAccountId ? [input.toAccountId] : [])],
    categoryIds: [...(input.categoryId ? [input.categoryId] : []), ...splitCats],
  });
  const account = accounts.get(input.accountId)!;
  const amount = signedAmount(input.type, magnitude);

  // Transfers
  let toAmount: Decimal | null = null;
  let toBaseAmount: Decimal | null = null;
  if (input.type === "TRANSFER") {
    if (!input.toAccountId) throw new ServiceError("Choose the destination account", "toAccountId");
    if (input.toAccountId === input.accountId) throw new ServiceError("Source and destination must differ", "toAccountId");
    const to = accounts.get(input.toAccountId)!;
    if (input.toAmount !== null && input.toAmount !== undefined && dec(input.toAmount).gt(0)) toAmount = dec(input.toAmount);
    else if (to.currency === account.currency) toAmount = magnitude.abs();
    else {
      const r = await getRate(account.currency, to.currency, input.date, userId);
      if (!r) throw new ServiceError(`No ${account.currency}→${to.currency} rate available. Enter the amount received.`, "toAmount");
      toAmount = magnitude.abs().times(r.rate).toDecimalPlaces(4);
    }
    const tr = await getRate(to.currency, baseCurrency, input.date, userId);
    toBaseAmount = tr ? toAmount.times(tr.rate).toDecimalPlaces(4) : null;
  }

  // Base-currency conversion (stored with provenance)
  const rate = await getRate(account.currency, baseCurrency, input.date, userId);
  const baseAmount = rate ? amount.times(rate.rate).toDecimalPlaces(4) : null;

  // Splits
  let splits: ResolvedTxn["splits"];
  if (input.splits && input.splits.length > 0) {
    if (input.type !== "EXPENSE" && input.type !== "REFUND" && input.type !== "INCOME") throw new ServiceError("Only income, expenses and refunds can be split", "splits");
    if (input.splits.length < 2) throw new ServiceError("A split needs at least two parts", "splits");
    splits = input.splits.map((s) => ({ categoryId: s.categoryId, amount: dec(s.amount).abs(), note: s.note }));
    if (splits.some((s) => s.amount.isZero())) throw new ServiceError("Split amounts must be greater than zero", "splits");
    const total = sum(splits.map((s) => s.amount));
    if (!total.eq(magnitude.abs())) throw new ServiceError(`Split parts add up to ${total.toFixed(2)} but the transaction is ${magnitude.abs().toFixed(2)}`, "splits");
  }

  // Categorization
  let categoryId = input.categoryId ?? null;
  let categorySource: CategorySource = input.categorySource ?? (categoryId ? "USER" : "NONE");
  let categoryConfidence = input.categoryConfidence ?? null;
  let merchant = input.merchant?.trim() || null;
  if (!categoryId && !splits && !input.noAutoCategorize && input.type !== "TRANSFER" && input.type !== "ADJUSTMENT") {
    const c = (categorizer ?? (await loadCategorizer(userId)))({ description, merchant, amount: magnitude });
    if (c.categoryId) {
      categoryId = c.categoryId;
      categorySource = c.source;
      categoryConfidence = c.confidence;
      if (c.merchant && !merchant) merchant = c.merchant;
    }
  }
  const needsReview =
    (input.type === "EXPENSE" || input.type === "INCOME" || input.type === "REFUND") && !splits &&
    (!categoryId || (categoryConfidence !== null && categoryConfidence < REVIEW_CONFIDENCE_THRESHOLD && categorySource !== "USER"));

  return {
    data: {
      accountId: input.accountId,
      type: input.type,
      status: input.status ?? "CLEARED",
      date: input.date,
      description: description.slice(0, 500),
      merchant: merchant?.slice(0, 200) ?? null,
      amount,
      currency: account.currency,
      originalAmount: input.originalAmount != null && input.originalCurrency ? dec(input.originalAmount).abs() : null,
      originalCurrency: input.originalAmount != null && input.originalCurrency ? input.originalCurrency.toUpperCase() : null,
      baseAmount,
      baseCurrency,
      fxRate: rate?.rate ?? null,
      fxRateDate: rate?.date ?? null,
      fxRateSource: rate?.source ?? null,
      toAccountId: input.type === "TRANSFER" ? input.toAccountId : null,
      toAmount,
      toBaseAmount,
      categoryId: splits ? null : categoryId,
      categorySource: splits ? "USER" : categorySource,
      categoryConfidence: splits ? null : categoryConfidence,
      needsReview,
      paymentMethod: input.paymentMethod?.trim() || null,
      notes: input.notes?.trim() || null,
      isReimbursable: input.type === "EXPENSE" ? !!input.isReimbursable : false,
      recurringId: input.recurringId ?? null,
      occurrenceDate: input.occurrenceDate ?? null,
      importBatchId: input.importBatchId ?? null,
      importHash: input.importHash ?? null,
      isSample: !!input.isSample,
    },
    splits,
    tags: input.tags?.map((t) => t.trim()).filter(Boolean).slice(0, 20),
  };
}

async function upsertTags(tx: Prisma.TransactionClient, userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of [...new Set(names.map((n) => n.slice(0, 40)))]) {
    const tag = await tx.tag.upsert({ where: { userId_name: { userId, name } }, create: { userId, name }, update: {} });
    ids.push(tag.id);
  }
  return ids;
}

export async function createTransaction(
  userId: string,
  input: TransactionInput,
  opts: { baseCurrency: string; categorizer?: Categorizer; skipAudit?: boolean } = { baseCurrency: "INR" },
) {
  const r = await resolve(userId, input, opts.baseCurrency, opts.categorizer);
  return db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        ...r.data,
        userId,
        splits: r.splits ? { create: r.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, note: s.note ?? null })) } : undefined,
      },
    });
    if (r.tags?.length) {
      const tagIds = await upsertTags(tx, userId, r.tags);
      await tx.transactionTag.createMany({ data: tagIds.map((tagId) => ({ transactionId: created.id, tagId })) });
    }
    if (!opts.skipAudit) await audit(userId, "transaction.create", "Transaction", created.id, { after: created }, tx);
    return created;
  });
}

const FULL_INCLUDE = { splits: true, tags: { include: { tag: true } } } satisfies Prisma.TransactionInclude;

export async function updateTransaction(userId: string, id: string, input: TransactionInput, baseCurrency: string) {
  const before = await db.transaction.findFirst({ where: { id, userId, deletedAt: null }, include: FULL_INCLUDE });
  if (!before) throw new ServiceError("Transaction not found");
  const r = await resolve(userId, { ...input, noAutoCategorize: true, recurringId: before.recurringId, occurrenceDate: before.occurrenceDate, importBatchId: before.importBatchId, importHash: before.importHash, isSample: before.isSample }, baseCurrency);
  const categoryChanged = before.categoryId !== r.data.categoryId;
  return db.$transaction(async (tx) => {
    await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
    await tx.transactionTag.deleteMany({ where: { transactionId: id } });
    const updated = await tx.transaction.update({
      where: { id },
      data: {
        ...r.data,
        // A manual edit confirms the category
        categorySource: categoryChanged || input.categoryId ? (r.splits ? "USER" : input.categoryId ? "USER" : r.data.categorySource) : before.categorySource,
        categoryConfidence: input.categoryId ? null : r.data.categoryConfidence,
        needsReview: input.categoryId ? false : r.data.needsReview,
        splits: r.splits ? { create: r.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, note: s.note ?? null })) } : undefined,
      },
    });
    if (r.tags?.length) {
      const tagIds = await upsertTags(tx, userId, r.tags);
      await tx.transactionTag.createMany({ data: tagIds.map((tagId) => ({ transactionId: id, tagId })) });
    }
    const log = await tx.auditLog.create({
      data: {
        userId,
        action: "transaction.update",
        entityType: "Transaction",
        entityId: id,
        before: JSON.parse(JSON.stringify(before)),
        after: JSON.parse(JSON.stringify(updated)),
      },
    });
    return { updated, auditId: log.id };
  });
}

export async function softDeleteTransactions(userId: string, ids: string[]) {
  const now = new Date();
  const res = await db.transaction.updateMany({ where: { userId, id: { in: ids }, deletedAt: null }, data: { deletedAt: now } });
  await audit(userId, "transaction.delete", "Transaction", ids.length === 1 ? ids[0] : null, { after: { ids, deletedAt: now } });
  return res.count;
}

export async function restoreTransactions(userId: string, ids: string[]) {
  const res = await db.transaction.updateMany({ where: { userId, id: { in: ids }, deletedAt: { not: null } }, data: { deletedAt: null } });
  await audit(userId, "transaction.restore", "Transaction", ids.length === 1 ? ids[0] : null, { after: { ids } });
  return res.count;
}

/** Undo a single edit by restoring the audited "before" snapshot. */
export async function undoTransactionEdit(userId: string, auditId: string) {
  const log = await db.auditLog.findFirst({ where: { id: auditId, userId, action: "transaction.update" } });
  if (!log?.before || !log.entityId) throw new ServiceError("Nothing to undo");
  type Snap = Record<string, unknown> & { splits?: { categoryId: string | null; amount: string; note: string | null }[]; tags?: { tagId: string }[] };
  const b = log.before as Snap;
  const id = log.entityId;
  const exists = await db.transaction.findFirst({ where: { id, userId } });
  if (!exists) throw new ServiceError("Transaction no longer exists");
  const pick = <T,>(k: string) => b[k] as T;
  const d = (k: string) => (b[k] === null || b[k] === undefined ? null : new Prisma.Decimal(String(b[k])));
  const t = (k: string) => (b[k] ? new Date(String(b[k])) : null);
  await db.$transaction(async (tx) => {
    await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
    await tx.transactionTag.deleteMany({ where: { transactionId: id } });
    await tx.transaction.update({
      where: { id },
      data: {
        accountId: pick<string>("accountId"),
        type: pick<TransactionType>("type"),
        status: pick<TransactionStatus>("status"),
        date: t("date")!,
        description: pick<string>("description"),
        merchant: pick<string | null>("merchant"),
        amount: d("amount")!,
        currency: pick<string>("currency"),
        originalAmount: d("originalAmount"),
        originalCurrency: pick<string | null>("originalCurrency"),
        baseAmount: d("baseAmount"),
        baseCurrency: pick<string | null>("baseCurrency"),
        fxRate: d("fxRate"),
        fxRateDate: t("fxRateDate"),
        fxRateSource: pick<string | null>("fxRateSource"),
        toAccountId: pick<string | null>("toAccountId"),
        toAmount: d("toAmount"),
        toBaseAmount: d("toBaseAmount"),
        categoryId: pick<string | null>("categoryId"),
        categorySource: pick<CategorySource>("categorySource"),
        categoryConfidence: pick<number | null>("categoryConfidence"),
        needsReview: pick<boolean>("needsReview"),
        paymentMethod: pick<string | null>("paymentMethod"),
        notes: pick<string | null>("notes"),
        isReimbursable: pick<boolean>("isReimbursable"),
        splits: b.splits?.length ? { create: b.splits.map((s) => ({ categoryId: s.categoryId, amount: new Prisma.Decimal(s.amount), note: s.note })) } : undefined,
      },
    });
    if (b.tags?.length) await tx.transactionTag.createMany({ data: b.tags.map((x) => ({ transactionId: id, tagId: x.tagId })), skipDuplicates: true });
    await tx.auditLog.create({ data: { userId, action: "transaction.undo", entityType: "Transaction", entityId: id, before: log.after ?? undefined, after: log.before ?? undefined } });
  });
}

/** Recompute base-currency amounts (after a base currency change or new manual rates). */
export async function recomputeBaseAmounts(userId: string, baseCurrency: string, onlyMissing = false) {
  const txns = await db.transaction.findMany({
    where: { userId, ...(onlyMissing ? { baseAmount: null } : {}) },
    select: { id: true, amount: true, currency: true, date: true, toAmount: true, toAccount: { select: { currency: true } } },
  });
  let missing = 0;
  for (const t of txns) {
    const r = await getRate(t.currency, baseCurrency, t.date, userId);
    let toBase: Decimal | null = null;
    if (t.toAmount && t.toAccount) {
      const tr = await getRate(t.toAccount.currency, baseCurrency, t.date, userId);
      toBase = tr ? dec(t.toAmount).times(tr.rate).toDecimalPlaces(4) : null;
    }
    if (!r) missing++;
    await db.transaction.update({
      where: { id: t.id },
      data: {
        baseCurrency,
        baseAmount: r ? dec(t.amount).times(r.rate).toDecimalPlaces(4) : null,
        fxRate: r?.rate ?? null,
        fxRateDate: r?.date ?? null,
        fxRateSource: r?.source ?? null,
        toBaseAmount: toBase,
      },
    });
  }
  return { updated: txns.length, missing };
}

/** Learn from a correction: store an explicit merchant mapping (user-approved). */
export async function rememberMerchantCategory(userId: string, merchantOrDescription: string, categoryId: string) {
  const key = normalizeMerchant(merchantOrDescription);
  if (!key) return null;
  const cat = await db.category.findFirst({ where: { id: categoryId, userId } });
  if (!cat) throw new ServiceError("Category not found");
  return db.merchantMapping.upsert({
    where: { userId_merchant: { userId, merchant: key } },
    create: { userId, merchant: key, categoryId },
    update: { categoryId, confirmed: true },
  });
}
