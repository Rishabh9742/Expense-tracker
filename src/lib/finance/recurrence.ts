import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks, addYears } from "date-fns";
import type { Frequency } from "@prisma/client";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMIANNUAL: "Every 6 months",
  YEARLY: "Yearly",
  CUSTOM: "Custom",
};

/**
 * The n-th occurrence (0-based) of a schedule anchored at `start`. Anchoring to the
 * start date (instead of repeatedly adding to the previous date) avoids month-end drift:
 * Jan 31 → Feb 28 → Mar 31, not Mar 28.
 */
export function nthOccurrence(start: Date, frequency: Frequency, interval: number, n: number, tz = "UTC"): Date {
  const s = new TZDate(start, tz);
  const k = Math.max(1, interval);
  let d: Date;
  switch (frequency) {
    case "DAILY":
      d = addDays(s, n * k);
      break;
    case "WEEKLY":
      d = addWeeks(s, n * k);
      break;
    case "BIWEEKLY":
      d = addWeeks(s, n * 2);
      break;
    case "MONTHLY":
      d = addMonths(s, n * k);
      break;
    case "QUARTERLY":
      d = addMonths(s, n * 3);
      break;
    case "SEMIANNUAL":
      d = addMonths(s, n * 6);
      break;
    case "YEARLY":
      d = addYears(s, n * k);
      break;
    case "CUSTOM":
      d = addDays(s, n * k);
      break;
  }
  return new Date(d.getTime());
}

/** Occurrences within [from, to). */
export function occurrencesBetween(
  start: Date,
  frequency: Frequency,
  interval: number,
  from: Date,
  to: Date,
  end?: Date | null,
  tz = "UTC",
  limit = 1000,
): Date[] {
  const out: Date[] = [];
  for (let n = 0; n < 100000 && out.length < limit; n++) {
    const d = nthOccurrence(start, frequency, interval, n, tz);
    if (d >= to || (end && d > end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** First occurrence strictly after `after`. */
export function nextOccurrenceAfter(start: Date, frequency: Frequency, interval: number, after: Date, tz = "UTC"): Date {
  for (let n = 0; n < 100000; n++) {
    const d = nthOccurrence(start, frequency, interval, n, tz);
    if (d > after) return d;
  }
  throw new Error("Could not compute next occurrence");
}

/** Approximate number of occurrences per month, used for monthly-equivalent totals. */
export function monthlyFactor(frequency: Frequency, interval = 1): number {
  switch (frequency) {
    case "DAILY":
      return 30.4375 / Math.max(1, interval);
    case "WEEKLY":
      return 52 / 12 / Math.max(1, interval);
    case "BIWEEKLY":
      return 26 / 12;
    case "MONTHLY":
      return 1 / Math.max(1, interval);
    case "QUARTERLY":
      return 1 / 3;
    case "SEMIANNUAL":
      return 1 / 6;
    case "YEARLY":
      return 1 / 12 / Math.max(1, interval);
    case "CUSTOM":
      return 30.4375 / Math.max(1, interval);
  }
}
