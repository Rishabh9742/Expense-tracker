import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks, differenceInCalendarDays, startOfMonth, startOfWeek } from "date-fns";
import type { BudgetMethod, BudgetPeriod } from "@prisma/client";
import { Decimal, dec, type DecimalLike } from "@/lib/money";

export interface Period {
  start: Date;
  end: Date; // exclusive
}

export interface BudgetDef {
  period: BudgetPeriod;
  method: BudgetMethod;
  amount: DecimalLike;
  percentOfIncome?: DecimalLike | null;
  startDate: Date;
  endDate?: Date | null;
}

/** The budget period containing `at`, in the user's timezone. */
export function budgetPeriodAt(def: Pick<BudgetDef, "period" | "startDate" | "endDate">, at: Date, tz: string, weekStartsOn: 0 | 1 = 1): Period {
  const local = new TZDate(at, tz);
  switch (def.period) {
    case "WEEKLY": {
      const s = startOfWeek(local, { weekStartsOn });
      return { start: new Date(s.getTime()), end: new Date(addWeeks(s, 1).getTime()) };
    }
    case "MONTHLY": {
      const s = startOfMonth(local);
      return { start: new Date(s.getTime()), end: new Date(addMonths(s, 1).getTime()) };
    }
    case "CUSTOM": {
      const end = def.endDate ?? addMonths(def.startDate, 1);
      return { start: def.startDate, end: new Date(addDays(new TZDate(end, tz), 1).getTime()) };
    }
  }
}

export function previousPeriod(def: Pick<BudgetDef, "period" | "startDate" | "endDate">, p: Period, tz: string, weekStartsOn: 0 | 1 = 1): Period | null {
  if (def.period === "CUSTOM") return null;
  const prevAt = new Date(p.start.getTime() - 1);
  if (prevAt < def.startDate) return null;
  return budgetPeriodAt(def, prevAt, tz, weekStartsOn);
}

export function usesRollover(method: BudgetMethod): boolean {
  return method === "ROLLOVER" || method === "ENVELOPE";
}

/** Base amount allocated for a single period (before rollover). */
export function baseAllocation(def: BudgetDef, periodIncome: DecimalLike, override?: DecimalLike | null): Decimal {
  if (override !== null && override !== undefined) return dec(override);
  if (def.method === "PERCENTAGE" && def.percentOfIncome != null) {
    return dec(periodIncome).times(dec(def.percentOfIncome)).div(100).toDecimalPlaces(2);
  }
  return dec(def.amount);
}

export interface BudgetStatus {
  budgeted: Decimal;
  rollover: Decimal;
  available: Decimal;
  spent: Decimal;
  remaining: Decimal;
  percentUsed: number;
  daysTotal: number;
  daysElapsed: number;
  daysLeft: number;
  /** remaining / days left (0 if over budget) */
  dailyAllowance: Decimal;
  /** linear projection to end of period */
  forecast: Decimal;
  forecastOver: boolean;
  level: "ok" | "watch" | "warning" | "over";
  /** highest configured alert threshold reached */
  thresholdReached: number | null;
}

export function budgetStatus(input: {
  budgeted: DecimalLike;
  rollover?: DecimalLike;
  spent: DecimalLike;
  period: Period;
  now: Date;
  alertLevels?: number[];
}): BudgetStatus {
  const budgeted = dec(input.budgeted);
  const rollover = dec(input.rollover ?? 0);
  const available = budgeted.plus(rollover);
  const spent = dec(input.spent);
  const remaining = available.minus(spent);
  const daysTotal = Math.max(1, differenceInCalendarDays(input.period.end, input.period.start));
  const clampedNow = input.now < input.period.start ? input.period.start : input.now > input.period.end ? input.period.end : input.now;
  // Count today as elapsed so the forecast doesn't divide by zero on day one.
  const daysElapsed = Math.min(daysTotal, Math.max(1, Math.ceil((clampedNow.getTime() - input.period.start.getTime()) / 86400000)));
  const daysLeft = Math.max(0, daysTotal - daysElapsed + (input.now < input.period.end ? 1 : 0));
  const dailyAllowance = remaining.gt(0) && daysLeft > 0 ? remaining.div(daysLeft).toDecimalPlaces(2) : new Decimal(0);
  const ended = input.now >= input.period.end;
  const forecast = ended ? spent : spent.div(daysElapsed).times(daysTotal).toDecimalPlaces(2);
  const percentUsed = available.lte(0) ? (spent.gt(0) ? 100 : 0) : spent.div(available).times(100).toDecimalPlaces(1).toNumber();
  const levels = [...(input.alertLevels ?? [50, 75, 90, 100])].sort((a, b) => a - b);
  let thresholdReached: number | null = null;
  for (const l of levels) if (percentUsed >= l) thresholdReached = l;
  const level = percentUsed >= 100 ? "over" : percentUsed >= 90 ? "warning" : percentUsed >= 75 || forecast.gt(available) ? "watch" : "ok";
  return {
    budgeted,
    rollover,
    available,
    spent,
    remaining,
    percentUsed,
    daysTotal,
    daysElapsed,
    daysLeft,
    dailyAllowance,
    forecast,
    forecastOver: forecast.gt(available),
    level,
    thresholdReached,
  };
}

/**
 * Rollover carried into the current period, computed over up to `maxPeriods`
 * prior periods. Unused funds carry forward; overspending carries forward as a
 * negative balance for ENVELOPE budgets and is floored at zero for ROLLOVER.
 */
export function computeRollover(
  method: BudgetMethod,
  history: { allocated: DecimalLike; spent: DecimalLike }[], // oldest first
): Decimal {
  if (!usesRollover(method)) return new Decimal(0);
  let carry = new Decimal(0);
  for (const h of history) {
    carry = carry.plus(dec(h.allocated)).minus(dec(h.spent));
    if (method === "ROLLOVER" && carry.lt(0)) carry = new Decimal(0);
  }
  return carry;
}
