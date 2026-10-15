import { Decimal, parseAmount } from "@/lib/money";
import { parseLocalDateTime } from "@/lib/dates";

export const DATE_FORMATS = ["auto", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "DD.MM.YYYY", "DD MMM YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface ColumnMapping {
  date: number;
  description: number;
  /** single signed amount column, OR debit/credit pair */
  amount?: number | null;
  debit?: number | null;
  credit?: number | null;
  merchant?: number | null;
  category?: number | null;
  notes?: number | null;
  type?: number | null;
}

export interface ImportOptions {
  dateFormat: DateFormat;
  decimalSeparator: "." | ",";
  /** if true, positive amounts in the single amount column are expenses (credit card exports) */
  invertSign: boolean;
  timezone: string;
  hasHeader: boolean;
}

export interface ParsedRow {
  row: number; // 1-based line number in file
  date: Date;
  description: string;
  merchant: string | null;
  amount: Decimal; // signed: negative = outflow
  categoryName: string | null;
  notes: string | null;
  typeHint: string | null;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Returns YYYY-MM-DD[THH:mm] or null. */
export function parseDateString(raw: unknown, fmt: DateFormat): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
  }
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const time = /(\d{1,2}):(\d{2})/.exec(s);
  const t = time ? `T${pad(Number(time[1]))}:${time[2]}` : "";
  const out = (y: number, m: number, d: number) => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}${t}` : null);
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[A-Za-z]*[\s-,]+(\d{2,4})/.exec(s);

  switch (fmt) {
    case "YYYY-MM-DD":
      return iso ? out(+iso[1], +iso[2], +iso[3]) : null;
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
    case "DD.MM.YYYY":
      return dmy ? out(year(dmy[3]), +dmy[2], +dmy[1]) : null;
    case "MM/DD/YYYY":
      return dmy ? out(year(dmy[3]), +dmy[1], +dmy[2]) : null;
    case "DD MMM YYYY": {
      if (!named) return null;
      const m = MONTHS[named[2].toLowerCase()];
      return m ? out(year(named[3]), m, +named[1]) : null;
    }
    case "auto": {
      if (iso) return out(+iso[1], +iso[2], +iso[3]);
      if (named) {
        const m = MONTHS[named[2].toLowerCase()];
        return m ? out(year(named[3]), m, +named[1]) : null;
      }
      if (dmy) {
        const a = +dmy[1];
        const b = +dmy[2];
        // Ambiguous when both ≤ 12: prefer day-first (most of the world); detectDateFormat refines this per file.
        if (a > 12) return out(year(dmy[3]), b, a);
        if (b > 12) return out(year(dmy[3]), a, b);
        return out(year(dmy[3]), b, a);
      }
      return null;
    }
  }
}

/** Inspect a column of date strings and pick the format that parses all of them. */
export function detectDateFormat(samples: string[]): DateFormat {
  const candidates: DateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD MMM YYYY"];
  for (const f of candidates) {
    if (samples.length && samples.every((s) => parseDateString(s, f) !== null)) return f;
  }
  return "auto";
}

export function guessMapping(header: string[]): Partial<ColumnMapping> {
  const find = (...names: RegExp[]) => {
    const i = header.findIndex((h) => names.some((n) => n.test(h.trim().toLowerCase())));
    return i >= 0 ? i : null;
  };
  return {
    date: find(/^date$/, /transaction date/, /txn date/, /posted/, /value date/, /date/) ?? undefined,
    description: find(/^description$/, /narration/, /particulars/, /details/, /memo/, /description/, /payee/) ?? undefined,
    amount: find(/^amount$/, /amount \(/, /^amt$/, /amount/),
    debit: find(/debit/, /withdrawal/, /^dr$/, /money out/, /paid out/),
    credit: find(/credit/, /deposit/, /^cr$/, /money in/, /paid in/),
    merchant: find(/merchant/, /payee/),
    category: find(/category/),
    notes: find(/notes?$/, /remarks?/),
    type: find(/^type$/, /transaction type/),
  };
}

export interface ValidationResult {
  rows: ParsedRow[];
  errors: RowError[];
  /** rows with any error — the import is blocked while this is > 0 */
  invalidCount: number;
}

/**
 * Validates every data row. Nothing is committed by this function; the caller refuses
 * to commit while any required field is invalid, so a file is either fully clean
 * (minus rows the user chose to skip) or not imported at all.
 */
export function validateRows(data: string[][], mapping: ColumnMapping, opts: ImportOptions): ValidationResult {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const invalid = new Set<number>();
  const start = opts.hasHeader ? 1 : 0;
  const cell = (r: string[], i: number | null | undefined) => (i === null || i === undefined || i < 0 ? "" : (r[i] ?? "").toString().trim());

  for (let i = start; i < data.length; i++) {
    const r = data[i];
    const line = i + 1;
    if (!r || r.every((c) => !String(c ?? "").trim())) continue; // blank line
    const err = (field: string, message: string, value?: string) => {
      errors.push({ row: line, field, message, value });
      invalid.add(line);
    };

    const rawDate = cell(r, mapping.date);
    const ymd = parseDateString(rawDate, opts.dateFormat);
    if (!ymd) err("date", rawDate ? "Unrecognized date" : "Date is required", rawDate);

    const description = cell(r, mapping.description);
    if (!description) err("description", "Description is required");
    else if (description.length > 500) err("description", "Description is longer than 500 characters");

    let amount: Decimal | null = null;
    if (mapping.amount !== null && mapping.amount !== undefined && mapping.amount >= 0) {
      const raw = cell(r, mapping.amount);
      amount = parseAmount(raw, opts.decimalSeparator);
      if (amount === null) err("amount", raw ? "Unrecognized amount" : "Amount is required", raw);
      else if (opts.invertSign) amount = amount.negated();
    } else {
      const rd = cell(r, mapping.debit);
      const rc = cell(r, mapping.credit);
      const d = rd ? parseAmount(rd, opts.decimalSeparator) : null;
      const c = rc ? parseAmount(rc, opts.decimalSeparator) : null;
      if (rd && d === null) err("debit", "Unrecognized debit amount", rd);
      if (rc && c === null) err("credit", "Unrecognized credit amount", rc);
      if (!rd && !rc) err("amount", "Debit or credit amount is required");
      if ((d === null || d.isZero()) && (c === null || c.isZero()) && (rd || rc) && !invalid.has(line)) {
        // both zero — treat as zero amount which is invalid
        err("amount", "Amount is zero");
      }
      if (!invalid.has(line)) amount = (c ?? new Decimal(0)).abs().minus((d ?? new Decimal(0)).abs());
    }
    if (amount && amount.isZero() && !invalid.has(line)) err("amount", "Amount is zero");
    if (amount && amount.abs().gt("1e13")) err("amount", "Amount is unrealistically large");

    if (invalid.has(line) || !ymd || !amount) continue;
    let date: Date;
    try {
      date = parseLocalDateTime(ymd, opts.timezone);
    } catch {
      err("date", "Unrecognized date", rawDate);
      continue;
    }
    rows.push({
      row: line,
      date,
      description,
      merchant: cell(r, mapping.merchant) || null,
      amount,
      categoryName: cell(r, mapping.category) || null,
      notes: cell(r, mapping.notes) || null,
      typeHint: cell(r, mapping.type) || null,
    });
  }
  return { rows, errors, invalidCount: invalid.size };
}

export const CSV_TEMPLATE =
  "date,description,amount,merchant,category,notes\n" +
  "2026-01-05,Monthly salary,85000.00,Acme Corp,Salary,\n" +
  "2026-01-06,Groceries,-2450.50,FreshMart,Groceries,weekly shop\n" +
  "2026-01-07,Coffee,-180.00,Blue Tokai,Dining,\n";
