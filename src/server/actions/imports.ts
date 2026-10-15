"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { getRate } from "@/lib/fx";
import { DATE_FORMATS, detectDateFormat, guessMapping, validateRows, type ColumnMapping, type RowError } from "@/lib/finance/import";
import { importHash } from "@/lib/finance/duplicates";
import type { ActionResult } from "@/lib/utils";
import { loadCategorizer } from "@/server/services/transactions";
import { parseImportFile } from "@/server/services/import-files";

export interface InspectResult {
  format: string;
  fileName: string;
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: Partial<ColumnMapping>;
  dateFormat: string;
  fixedMapping: boolean;
}

async function readFile(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to import");
  return { name: file.name.slice(0, 200), buf: Buffer.from(await file.arrayBuffer()) };
}

export async function inspectImportAction(form: FormData): Promise<ActionResult<InspectResult>> {
  const user = await requireUser();
  if (!rateLimit(`import:${user.id}`, 30, 60_000).ok) return { ok: false, error: "Too many uploads — wait a minute." };
  try {
    const { name, buf } = await readFile(form);
    const parsed = await parseImportFile(name, buf);
    if (parsed.rows.length < 2) return { ok: false, error: "The file has no data rows." };
    const headers = parsed.rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    const mapping = parsed.fixedMapping ? { date: 0, description: 1, amount: 2, merchant: 3 } : guessMapping(headers);
    const dateCol = mapping.date ?? 0;
    return {
      ok: true,
      data: {
        format: parsed.format,
        fileName: name,
        headers,
        sample: parsed.rows.slice(1, 8),
        rowCount: parsed.rows.length - 1,
        mapping,
        dateFormat: detectDateFormat(parsed.rows.slice(1, 60).map((r) => r[dateCol] ?? "").filter(Boolean)),
        fixedMapping: parsed.fixedMapping,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Couldn't read this file" };
  }
}

const optsSchema = z.object({
  accountId: z.string().min(1, "Choose the account these transactions belong to").max(40),
  mapping: z.object({
    date: z.number().int().min(0),
    description: z.number().int().min(0),
    amount: z.number().int().min(-1).nullable().optional(),
    debit: z.number().int().min(-1).nullable().optional(),
    credit: z.number().int().min(-1).nullable().optional(),
    merchant: z.number().int().min(-1).nullable().optional(),
    category: z.number().int().min(-1).nullable().optional(),
    notes: z.number().int().min(-1).nullable().optional(),
  }),
  dateFormat: z.enum(DATE_FORMATS),
  decimalSeparator: z.enum([".", ","]),
  invertSign: z.boolean(),
  skipDuplicates: z.boolean(),
  skipInvalid: z.boolean(),
});
export type ImportOptionsInput = z.infer<typeof optsSchema>;

export interface PreviewRow {
  row: number;
  date: string;
  description: string;
  merchant: string | null;
  amount: string;
  category: string | null;
  categorySource: string;
  status: "new" | "duplicate";
}

async function prepare(userId: string, form: FormData, tz: string) {
  const raw = form.get("options");
  const parsedOpts = optsSchema.safeParse(JSON.parse(typeof raw === "string" ? raw : "{}"));
  if (!parsedOpts.success) throw new Error(parsedOpts.error.issues[0]?.message ?? "Invalid import options");
  const o = parsedOpts.data;
  const m = o.mapping;
  if ((m.amount ?? -1) < 0 && (m.debit ?? -1) < 0 && (m.credit ?? -1) < 0) throw new Error("Map an amount column, or debit/credit columns");
  const account = await db.account.findFirst({ where: { id: o.accountId, userId } });
  if (!account) throw new Error("Account not found");
  const { name, buf } = await readFile(form);
  const file = await parseImportFile(name, buf);
  const mapping: ColumnMapping = {
    date: m.date,
    description: m.description,
    amount: (m.amount ?? -1) >= 0 ? m.amount : null,
    debit: (m.debit ?? -1) >= 0 ? m.debit : null,
    credit: (m.credit ?? -1) >= 0 ? m.credit : null,
    merchant: (m.merchant ?? -1) >= 0 ? m.merchant : null,
    category: (m.category ?? -1) >= 0 ? m.category : null,
    notes: (m.notes ?? -1) >= 0 ? m.notes : null,
  };
  const v = validateRows(file.rows, mapping, { dateFormat: o.dateFormat, decimalSeparator: o.decimalSeparator, invertSign: o.invertSign, timezone: tz, hasHeader: true });

  // Duplicate detection: against existing transactions and within the file itself.
  const hashes = v.rows.map((r) => importHash({ accountId: account.id, date: r.date, amount: r.amount, description: r.description }));
  const existing = await db.transaction.findMany({ where: { userId, importHash: { in: hashes }, deletedAt: null }, select: { importHash: true } });
  // Manually entered rows have no importHash; also compare by date/amount/description for the account.
  const minDate = v.rows.reduce((a, r) => (r.date < a ? r.date : a), new Date(8.64e15));
  const manual = v.rows.length
    ? await db.transaction.findMany({ where: { userId, accountId: account.id, deletedAt: null, importHash: null, date: { gte: new Date(minDate.getTime() - 86400000) } }, select: { date: true, amount: true, description: true } })
    : [];
  const known = new Set([...existing.map((e) => e.importHash), ...manual.map((t) => importHash({ accountId: account.id, date: t.date, amount: t.amount, description: t.description }))]);
  const seen = new Set<string>();
  const dupFlags = hashes.map((h) => {
    const dup = known.has(h) || seen.has(h);
    seen.add(h);
    return dup;
  });

  // Category mapping: file category names → user categories; else the rules/merchant/history engine.
  const cats = await db.category.findMany({ where: { userId }, select: { id: true, name: true, kind: true } });
  const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const categorize = await loadCategorizer(userId);
  const prepared = v.rows.map((r, i) => {
    const type = r.amount.isNegative() ? ("EXPENSE" as const) : /refund|reversal|cashback|chargeback/i.test(r.description) ? ("REFUND" as const) : ("INCOME" as const);
    let categoryId: string | null = null;
    let categorySource: "IMPORT" | "RULE" | "MERCHANT" | "HISTORY" | "NONE" = "NONE";
    let confidence: number | null = null;
    if (r.categoryName) {
      const c = byName.get(r.categoryName.toLowerCase());
      if (c) {
        categoryId = c.id;
        categorySource = "IMPORT";
        confidence = 1;
      }
    }
    if (!categoryId) {
      const c = categorize({ description: r.description, merchant: r.merchant, amount: r.amount });
      if (c.categoryId) {
        categoryId = c.categoryId;
        categorySource = c.source as typeof categorySource;
        confidence = c.confidence;
      }
    }
    return { ...r, type, categoryId, categorySource, confidence, hash: hashes[i], duplicate: dupFlags[i] };
  });
  return { o, account, file, fileName: name, errors: v.errors, invalidCount: v.invalidCount, prepared, catName: new Map(cats.map((c) => [c.id, c.name])) };
}

export async function previewImportAction(form: FormData): Promise<ActionResult<{ rows: PreviewRow[]; total: number; valid: number; duplicates: number; errors: RowError[]; invalidRows: number }>> {
  const user = await requireUser();
  try {
    const p = await prepare(user.id, form, user.prefs.timezone);
    return {
      ok: true,
      data: {
        rows: p.prepared.slice(0, 200).map((r) => ({
          row: r.row,
          date: r.date.toISOString(),
          description: r.description,
          merchant: r.merchant,
          amount: r.amount.toFixed(2),
          category: r.categoryId ? p.catName.get(r.categoryId) ?? null : null,
          categorySource: r.categorySource,
          status: r.duplicate ? "duplicate" : "new",
        })),
        total: p.file.rows.length - 1,
        valid: p.prepared.length,
        duplicates: p.prepared.filter((r) => r.duplicate).length,
        errors: p.errors.slice(0, 500),
        invalidRows: p.invalidCount,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Commits an import atomically. Refuses to import anything while rows have invalid
 * required fields unless the user explicitly chose to skip those rows (and they're
 * recorded in the batch's error report). Duplicates are skipped unless included.
 */
export async function commitImportAction(form: FormData): Promise<ActionResult<{ batchId: string; imported: number; skipped: number }>> {
  const user = await requireUser();
  if (!rateLimit(`import-commit:${user.id}`, 10, 60_000).ok) return { ok: false, error: "Too many imports — wait a minute." };
  try {
    const p = await prepare(user.id, form, user.prefs.timezone);
    if (p.invalidCount > 0 && !p.o.skipInvalid) {
      return { ok: false, error: `${p.invalidCount} row${p.invalidCount === 1 ? " has" : "s have"} invalid required fields. Fix the file, or choose to skip invalid rows. Nothing was imported.` };
    }
    const toImport = p.prepared.filter((r) => !(p.o.skipDuplicates && r.duplicate));
    if (!toImport.length) return { ok: false, error: "There are no new transactions to import." };

    // Convert to base currency (one rate lookup per day).
    const base = user.prefs.baseCurrency;
    const rateMemo = new Map<string, Awaited<ReturnType<typeof getRate>>>();
    const rateFor = async (d: Date) => {
      const k = d.toISOString().slice(0, 10);
      if (!rateMemo.has(k)) rateMemo.set(k, await getRate(p.account.currency, base, d, user.id));
      return rateMemo.get(k)!;
    };
    const data: Prisma.TransactionCreateManyInput[] = [];
    for (const r of toImport) {
      const rate = await rateFor(r.date);
      data.push({
        userId: user.id,
        accountId: p.account.id,
        type: r.type,
        status: "CLEARED",
        date: r.date,
        description: r.description.slice(0, 500),
        merchant: r.merchant?.slice(0, 200) ?? null,
        amount: r.amount.toFixed(4),
        currency: p.account.currency,
        baseAmount: rate ? r.amount.times(rate.rate).toDecimalPlaces(4).toFixed(4) : null,
        baseCurrency: base,
        fxRate: rate?.rate.toString() ?? null,
        fxRateDate: rate?.date ?? null,
        fxRateSource: rate?.source ?? null,
        categoryId: r.categoryId,
        categorySource: r.categorySource,
        categoryConfidence: r.confidence,
        needsReview: !r.categoryId || (r.confidence !== null && r.confidence < 0.8),
        notes: r.notes,
        importHash: r.hash,
      });
    }
    const skipped = p.prepared.length - toImport.length + p.invalidCount;
    const batch = await db.$transaction(async (tx) => {
      const b = await tx.importBatch.create({
        data: {
          userId: user.id,
          accountId: p.account.id,
          fileName: p.fileName,
          format: p.file.format,
          rowCount: p.file.rows.length - 1,
          importedCount: data.length,
          skippedCount: skipped,
          errorReport: p.errors.length ? (p.errors as unknown as Prisma.InputJsonValue) : undefined,
          mapping: p.o.mapping as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.transaction.createMany({ data: data.map((d) => ({ ...d, importBatchId: b.id })) });
      return b;
    }, { timeout: 60_000 });
    await audit(user.id, "import.commit", "ImportBatch", batch.id, { after: { file: p.fileName, imported: data.length, skipped } });
    revalidatePath("/", "layout");
    return { ok: true, data: { batchId: batch.id, imported: data.length, skipped } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Safely removes every transaction created by an import batch. */
export async function rollbackImportAction(batchId: string): Promise<ActionResult<{ removed: number }>> {
  const user = await requireUser();
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId: user.id } });
  if (!batch) return { ok: false, error: "Import not found" };
  if (batch.status === "ROLLED_BACK") return { ok: false, error: "This import was already rolled back" };
  const removed = await db.$transaction(async (tx) => {
    const r = await tx.transaction.deleteMany({ where: { userId: user.id, importBatchId: batchId } });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
    return r.count;
  });
  await audit(user.id, "import.rollback", "ImportBatch", batchId, { after: { removed } });
  revalidatePath("/", "layout");
  return { ok: true, data: { removed } };
}
