import { addMonths, differenceInCalendarMonths } from "date-fns";
import { Decimal, dec, type DecimalLike } from "@/lib/money";

export interface GoalProjection {
  saved: Decimal;
  target: Decimal;
  remaining: Decimal;
  percent: number;
  /** contribution required per month to hit target date (null without target date) */
  requiredMonthly: Decimal | null;
  /** projected completion with the planned monthly contribution */
  projectedDate: Date | null;
  monthsToGoal: number | null;
  onTrack: boolean | null;
}

export function projectGoal(input: {
  saved: DecimalLike;
  target: DecimalLike;
  monthlyContribution?: DecimalLike | null;
  targetDate?: Date | null;
  now?: Date;
}): GoalProjection {
  const now = input.now ?? new Date();
  const saved = dec(input.saved);
  const target = dec(input.target);
  const remaining = Decimal.max(target.minus(saved), 0);
  const percent = target.lte(0) ? 100 : Math.min(100, saved.div(target).times(100).toDecimalPlaces(1).toNumber());
  let requiredMonthly: Decimal | null = null;
  if (input.targetDate) {
    const months = Math.max(1, differenceInCalendarMonths(input.targetDate, now));
    requiredMonthly = remaining.div(months).toDecimalPlaces(2);
  }
  const monthly = dec(input.monthlyContribution ?? 0);
  let monthsToGoal: number | null = null;
  let projectedDate: Date | null = null;
  if (remaining.isZero()) {
    monthsToGoal = 0;
    projectedDate = now;
  } else if (monthly.gt(0)) {
    monthsToGoal = remaining.div(monthly).ceil().toNumber();
    projectedDate = addMonths(now, monthsToGoal);
  }
  const onTrack =
    input.targetDate && projectedDate ? projectedDate <= input.targetDate : input.targetDate && remaining.isZero() ? true : input.targetDate ? false : null;
  return { saved, target, remaining, percent, requiredMonthly, projectedDate, monthsToGoal, onTrack };
}
