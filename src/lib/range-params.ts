import { RANGE_KEYS, resolveRange, type DateRange, type RangeKey } from "@/lib/dates";

export function rangeFromParams(
  sp: Record<string, string | string[] | undefined>,
  tz: string,
  weekStartsOn: number,
  fallback: RangeKey = "this_month",
): DateRange {
  const raw = typeof sp.range === "string" ? sp.range : fallback;
  const key = (RANGE_KEYS as readonly string[]).includes(raw) ? (raw as RangeKey) : fallback;
  try {
    return resolveRange(key, tz, new Date(), { from: typeof sp.from === "string" ? sp.from : undefined, to: typeof sp.to === "string" ? sp.to : undefined }, weekStartsOn === 0 ? 0 : 1);
  } catch {
    return resolveRange(fallback, tz, new Date(), undefined, weekStartsOn === 0 ? 0 : 1);
  }
}
