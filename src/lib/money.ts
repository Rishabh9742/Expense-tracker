import Decimal from "decimal.js";

// Authoritative arithmetic always goes through decimal.js. Numbers are only
// produced at the very edge (charts, display) via toNumber().
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export type DecimalLike = Decimal | string | number | { toString(): string } | null | undefined;

export function dec(value: DecimalLike): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return new Decimal(value);
  }
  return new Decimal(value.toString());
}

export function sum(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

export const ZERO = new Decimal(0);

export const SUPPORTED_CURRENCIES = [
  { code: "INR", name: "Indian Rupee" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "AED", name: "UAE Dirham" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "HKD", name: "Hong Kong Dollar" },
] as const;

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** Round to the currency's minor unit using banker's rounding. */
export function roundMoney(value: DecimalLike, currency = "USD"): Decimal {
  return dec(value).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_EVEN);
}

/** Serialize for transport to client components (exact string). */
export function money(value: DecimalLike): string {
  return dec(value).toFixed(4);
}

export interface FormatOptions {
  locale?: string;
  compact?: boolean;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  hideCurrency?: boolean;
}

export function formatMoney(value: DecimalLike, currency: string, opts: FormatOptions = {}): string {
  const d = dec(value);
  const digits = minorUnits(currency);
  const fmt = new Intl.NumberFormat(opts.locale ?? "en-IN", {
    style: opts.hideCurrency ? "decimal" : "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: opts.compact ? 0 : digits,
    maximumFractionDigits: opts.compact ? 1 : digits,
    notation: opts.compact ? "compact" : "standard",
    signDisplay: opts.signDisplay ?? "auto",
  });
  // Display boundary: Intl requires a number. Values are pre-rounded so no precision is lost visibly.
  return fmt.format(d.toDecimalPlaces(digits).toNumber());
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Safe percentage (0-100+) of part/whole; null when whole is zero. */
export function percentOf(part: DecimalLike, whole: DecimalLike): number | null {
  const w = dec(whole);
  if (w.isZero()) return null;
  return dec(part).div(w).times(100).toDecimalPlaces(2).toNumber();
}

/**
 * Parse a user- or file-supplied amount string. Handles thousands separators,
 * currency symbols, parentheses for negatives, trailing minus, and Dr/Cr suffixes.
 * Returns null if the string isn't a valid amount.
 */
export function parseAmount(raw: unknown, decimalSeparator: "." | "," = "."): Decimal | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? new Decimal(raw) : null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const drcr = s.match(/\s*(dr|cr)\.?$/i);
  if (drcr) {
    if (drcr[1].toLowerCase() === "dr") negative = !negative;
    s = s.slice(0, drcr.index).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  // strip currency symbols/codes and spaces
  s = s.replace(/[A-Za-z₹$€£¥\s ']/g, "");
  if (decimalSeparator === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const d = new Decimal(s);
  return negative ? d.negated() : d;
}
