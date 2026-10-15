import type { Frequency } from "@prisma/client";
import { addDays } from "date-fns";
import { Decimal, dec, type DecimalLike } from "@/lib/money";
import { normalizeMerchant } from "./duplicates";

export interface RecurringCandidate {
  key: string;
  merchant: string;
  frequency: Frequency;
  averageInterval: number;
  lastAmount: Decimal;
  averageAmount: Decimal;
  lastDate: Date;
  nextDate: Date;
  occurrences: number;
  priceChange: { from: Decimal; to: Decimal; percent: number } | null;
  confidence: number;
  categoryId: string | null;
  accountId: string;
}

const FREQ_WINDOWS: { freq: Frequency; days: number; tolerance: number }[] = [
  { freq: "WEEKLY", days: 7, tolerance: 1.5 },
  { freq: "BIWEEKLY", days: 14, tolerance: 2 },
  { freq: "MONTHLY", days: 30.4, tolerance: 4 },
  { freq: "QUARTERLY", days: 91, tolerance: 8 },
  { freq: "YEARLY", days: 365, tolerance: 15 },
];

/**
 * Finds merchants charged at a regular cadence with stable-ish amounts. Candidates are
 * only suggestions — the UI asks the user to confirm before creating a subscription.
 */
export function detectRecurring(
  txns: { date: Date; amount: DecimalLike; merchant?: string | null; description: string; categoryId: string | null; accountId: string }[],
  minOccurrences = 3,
): RecurringCandidate[] {
  const groups = new Map<string, typeof txns>();
  for (const t of txns) {
    const key = normalizeMerchant(t.merchant || t.description);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < minOccurrences) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) intervals.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const match = FREQ_WINDOWS.find((w) => Math.abs(avg - w.days) <= w.tolerance);
    if (!match) continue;
    const regular = intervals.filter((d) => Math.abs(d - match.days) <= match.tolerance * 1.5).length / intervals.length;
    if (regular < 0.7) continue;
    const amounts = sorted.map((t) => dec(t.amount).abs());
    const avgAmt = amounts.reduce((a, b) => a.plus(b), new Decimal(0)).div(amounts.length);
    const maxDev = amounts.reduce((m, a) => Decimal.max(m, a.minus(avgAmt).abs()), new Decimal(0));
    const stable = avgAmt.isZero() ? false : maxDev.div(avgAmt).lte(0.35);
    if (!stable) continue;
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const lastAmt = dec(last.amount).abs();
    const prevAmt = dec(prev.amount).abs();
    let priceChange: RecurringCandidate["priceChange"] = null;
    if (!lastAmt.eq(prevAmt) && !prevAmt.isZero()) {
      priceChange = { from: prevAmt, to: lastAmt, percent: lastAmt.minus(prevAmt).div(prevAmt).times(100).toDecimalPlaces(1).toNumber() };
    }
    out.push({
      key,
      merchant: last.merchant || last.description,
      frequency: match.freq,
      averageInterval: Math.round(avg * 10) / 10,
      lastAmount: lastAmt,
      averageAmount: avgAmt.toDecimalPlaces(2),
      lastDate: last.date,
      nextDate: addDays(last.date, Math.round(match.days)),
      occurrences: sorted.length,
      priceChange,
      confidence: Math.min(0.99, Math.round((regular * 0.7 + Math.min(sorted.length, 6) / 6 * 0.3) * 100) / 100),
      categoryId: last.categoryId,
      accountId: last.accountId,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
