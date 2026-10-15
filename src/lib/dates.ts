import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
} from "date-fns";

export const RANGE_KEYS = [
  "today",
  "this_week",
  "this_month",
  "last_month",
  "last_3_months",
  "last_6_months",
  "this_year",
  "custom",
] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  this_year: "This year",
  custom: "Custom range",
};

export interface DateRange {
  key: RangeKey;
  /** inclusive start instant */
  from: Date;
  /** exclusive end instant */
  to: Date;
  label: string;
  tz: string;
}

/** Midnight in `tz` for the calendar day containing `date`. */
export function startOfDayTz(date: Date, tz: string): Date {
  return new Date(startOfDay(new TZDate(date, tz)).getTime());
}

/** Parse a YYYY-MM-DD calendar date as local midnight in `tz`. */
export function parseLocalDate(ymd: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return new Date(new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), tz).getTime());
}

/** Parse a YYYY-MM-DDTHH:mm wall-clock time in `tz`. */
export function parseLocalDateTime(value: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) throw new Error(`Invalid date/time: ${value}`);
  return new Date(
    new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 12), Number(m[5] ?? 0), tz).getTime(),
  );
}

export function toLocalYmd(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "yyyy-MM-dd");
}

export function toLocalDateTimeInput(date: Date, tz: string): string {
  return format(new TZDate(date, tz), "yyyy-MM-dd'T'HH:mm");
}

export function formatLocal(date: Date, tz: string, pattern = "d MMM yyyy"): string {
  return format(new TZDate(date, tz), pattern);
}

export function resolveRange(
  key: RangeKey,
  tz: string,
  now: Date = new Date(),
  custom?: { from?: string; to?: string },
  weekStartsOn: 0 | 1 = 1,
): DateRange {
  const local = new TZDate(now, tz);
  const mk = (from: Date, to: Date, label: string): DateRange => ({
    key,
    from: new Date(from.getTime()),
    to: new Date(to.getTime()),
    label,
    tz,
  });
  switch (key) {
    case "today": {
      const s = startOfDay(local);
      return mk(s, addDays(s, 1), format(s, "EEE, d MMM yyyy"));
    }
    case "this_week": {
      const s = startOfWeek(local, { weekStartsOn });
      return mk(s, addDays(s, 7), `Week of ${format(s, "d MMM")}`);
    }
    case "this_month": {
      const s = startOfMonth(local);
      return mk(s, addMonths(s, 1), format(s, "MMMM yyyy"));
    }
    case "last_month": {
      const s = startOfMonth(subMonths(local, 1));
      return mk(s, addMonths(s, 1), format(s, "MMMM yyyy"));
    }
    case "last_3_months": {
      const s = startOfMonth(subMonths(local, 2));
      return mk(s, addMonths(startOfMonth(local), 1), `${format(s, "MMM")} – ${format(local, "MMM yyyy")}`);
    }
    case "last_6_months": {
      const s = startOfMonth(subMonths(local, 5));
      return mk(s, addMonths(startOfMonth(local), 1), `${format(s, "MMM yyyy")} – ${format(local, "MMM yyyy")}`);
    }
    case "this_year": {
      const s = startOfYear(local);
      return mk(s, new TZDate(local.getFullYear() + 1, 0, 1, tz), format(s, "yyyy"));
    }
    case "custom": {
      const from = custom?.from ? parseLocalDate(custom.from, tz) : startOfMonth(local);
      const toDay = custom?.to ? parseLocalDate(custom.to, tz) : startOfDay(local);
      const to = addDays(new TZDate(toDay, tz), 1);
      if (to <= from) throw new Error("Custom range end must be after start");
      return mk(
        from,
        to,
        `${format(new TZDate(from, tz), "d MMM yyyy")} – ${format(new TZDate(toDay, tz), "d MMM yyyy")}`,
      );
    }
  }
}

/** The equally sized period immediately before `range` (month-aligned for month ranges). */
export function previousRange(range: DateRange): DateRange {
  const tz = range.tz;
  const from = new TZDate(range.from, tz);
  const to = new TZDate(range.to, tz);
  const monthAligned =
    from.getDate() === 1 && to.getDate() === 1 && from.getHours() === 0 && to.getHours() === 0 && range.key !== "this_week";
  if (monthAligned) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    const pFrom = subMonths(from, months);
    return { key: "custom", from: new Date(pFrom.getTime()), to: new Date(from.getTime()), label: `Previous ${months} mo`, tz };
  }
  const days = differenceInCalendarDays(to, from);
  const pFrom = addDays(from, -days);
  return { key: "custom", from: new Date(pFrom.getTime()), to: new Date(from.getTime()), label: `Previous ${days} days`, tz };
}

/** Month buckets (local tz) covering [from, to). */
export function monthBuckets(from: Date, to: Date, tz: string): { start: Date; end: Date; label: string; key: string }[] {
  const out: { start: Date; end: Date; label: string; key: string }[] = [];
  let cur = startOfMonth(new TZDate(from, tz));
  while (cur < to) {
    const next = addMonths(cur, 1);
    out.push({ start: new Date(cur.getTime()), end: new Date(next.getTime()), label: format(cur, "MMM yy"), key: format(cur, "yyyy-MM") });
    cur = next;
  }
  return out;
}

/** Day or week buckets depending on range length. */
export function timeBuckets(from: Date, to: Date, tz: string): { start: Date; end: Date; label: string; key: string }[] {
  const days = differenceInCalendarDays(to, from);
  if (days > 120) return monthBuckets(from, to, tz);
  const step = days > 45 ? 7 : 1;
  const out: { start: Date; end: Date; label: string; key: string }[] = [];
  let cur = startOfDay(new TZDate(from, tz));
  while (cur < to) {
    const next = addDays(cur, step);
    out.push({
      start: new Date(cur.getTime()),
      end: new Date(Math.min(next.getTime(), to.getTime())),
      label: format(cur, "d MMM"),
      key: format(cur, "yyyy-MM-dd"),
    });
    cur = next;
  }
  return out;
}

export function daysBetween(a: Date, b: Date): number {
  return differenceInCalendarDays(b, a);
}

export { endOfDay };
