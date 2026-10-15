import { addDays, subDays } from "date-fns";
import { db } from "@/lib/db";
import { Decimal, dec, type DecimalLike } from "@/lib/money";

export interface Rate {
  rate: Decimal;
  date: Date;
  source: string;
}

const PROVIDER_SOURCE = "frankfurter.app (ECB reference)";

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function fetchProviderRate(base: string, quote: string, day: Date): Promise<Rate | null> {
  if ((process.env.FX_PROVIDER ?? "frankfurter") === "none") return null;
  const url = `${process.env.FX_API_URL ?? "https://api.frankfurter.app"}/${day.toISOString().slice(0, 10)}?from=${base}&to=${quote}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const r = body.rates?.[quote];
    if (!r || !body.date) return null;
    // Provider returns the nearest business day on or before the requested date.
    const rateDate = new Date(`${body.date}T00:00:00Z`);
    const rate = new Decimal(String(r));
    await db.exchangeRate
      .create({ data: { base, quote, date: rateDate, rate, source: PROVIDER_SOURCE, userId: null } })
      .catch(() => undefined); // ignore unique races
    return { rate, date: rateDate, source: PROVIDER_SOURCE };
  } catch {
    return null;
  }
}

/**
 * Exchange rate base→quote for `at`. Priority: user's manual rate (≤7 days old),
 * cached provider rate (≤4 days old, covers weekends/holidays), live provider lookup.
 * Returns null when no rate is available — callers must not add unconverted amounts.
 */
export async function getRate(base: string, quote: string, at: Date, userId?: string): Promise<Rate | null> {
  base = base.toUpperCase();
  quote = quote.toUpperCase();
  if (base === quote) return { rate: new Decimal(1), date: utcDay(at), source: "identity" };
  const day = utcDay(at);
  const future = day > new Date() ? utcDay(new Date()) : day;

  if (userId) {
    const manual = await db.exchangeRate.findFirst({
      where: { userId, date: { lte: addDays(future, 0), gte: subDays(future, 7) }, OR: [{ base, quote }, { base: quote, quote: base }] },
      orderBy: { date: "desc" },
    });
    if (manual) {
      const rate = manual.base === base ? dec(manual.rate) : new Decimal(1).div(dec(manual.rate));
      return { rate, date: manual.date, source: "manual" };
    }
  }

  const cached = await db.exchangeRate.findFirst({
    where: { userId: null, base, quote, date: { lte: future, gte: subDays(future, 4) } },
    orderBy: { date: "desc" },
  });
  if (cached) return { rate: dec(cached.rate), date: cached.date, source: cached.source };

  const inverse = await db.exchangeRate.findFirst({
    where: { userId: null, base: quote, quote: base, date: { lte: future, gte: subDays(future, 4) } },
    orderBy: { date: "desc" },
  });
  if (inverse) return { rate: new Decimal(1).div(dec(inverse.rate)), date: inverse.date, source: inverse.source };

  return fetchProviderRate(base, quote, future);
}

export async function convert(amount: DecimalLike, from: string, to: string, at: Date, userId?: string) {
  const r = await getRate(from, to, at, userId);
  if (!r) return null;
  return { value: dec(amount).times(r.rate).toDecimalPlaces(4), ...r };
}

/** Batch-friendly cache for converting many values to base within one request. */
export function rateCache(userId: string, baseCurrency: string) {
  const memo = new Map<string, Promise<Rate | null>>();
  return async (amount: DecimalLike, currency: string, at: Date = new Date()): Promise<Decimal | null> => {
    if (currency === baseCurrency) return dec(amount);
    const k = `${currency}|${at.toISOString().slice(0, 10)}`;
    if (!memo.has(k)) memo.set(k, getRate(currency, baseCurrency, at, userId));
    const r = await memo.get(k)!;
    return r ? dec(amount).times(r.rate).toDecimalPlaces(4) : null;
  };
}
