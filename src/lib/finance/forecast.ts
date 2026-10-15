import { addDays } from "date-fns";
import { Decimal, dec, type DecimalLike } from "@/lib/money";

export interface ScheduledEvent {
  date: Date;
  /** signed base-currency amount: inflows positive, outflows negative */
  amount: DecimalLike;
  label: string;
  kind: "income" | "bill" | "subscription" | "debt" | "savings" | "recurring" | "adjustment";
}

export interface ForecastPoint {
  date: Date;
  balance: Decimal;
  events: { label: string; amount: Decimal; kind: ScheduledEvent["kind"] }[];
}

export interface ForecastResult {
  points: ForecastPoint[];
  lowest: { date: Date; balance: Decimal };
  shortfalls: { date: Date; balance: Decimal }[];
  endBalance: Decimal;
  totalInflows: Decimal;
  totalOutflows: Decimal;
  assumptions: string[];
}

/**
 * Daily cash-flow projection: starting balance + scheduled events + a flat daily
 * discretionary spend estimate (derived from history by the caller).
 * This is an estimate, never a guarantee.
 */
export function forecastCashFlow(input: {
  startBalance: DecimalLike;
  start: Date;
  days: number;
  events: ScheduledEvent[];
  dailyDiscretionary: DecimalLike;
  threshold?: DecimalLike;
}): ForecastResult {
  let balance = dec(input.startBalance);
  const daily = dec(input.dailyDiscretionary).abs();
  const threshold = dec(input.threshold ?? 0);
  const points: ForecastPoint[] = [];
  const shortfalls: { date: Date; balance: Decimal }[] = [];
  let totalIn = new Decimal(0);
  let totalOut = new Decimal(0);
  let lowest = { date: input.start, balance };
  const sorted = [...input.events].sort((a, b) => a.date.getTime() - b.date.getTime());
  let idx = 0;
  for (let i = 0; i < input.days; i++) {
    const dayStart = addDays(input.start, i);
    const dayEnd = addDays(input.start, i + 1);
    const events: ForecastPoint["events"] = [];
    while (idx < sorted.length && sorted[idx].date < dayEnd) {
      const e = sorted[idx++];
      if (e.date < dayStart) continue;
      const amt = dec(e.amount);
      balance = balance.plus(amt);
      if (amt.gt(0)) totalIn = totalIn.plus(amt);
      else totalOut = totalOut.plus(amt.abs());
      events.push({ label: e.label, amount: amt, kind: e.kind });
    }
    balance = balance.minus(daily);
    totalOut = totalOut.plus(daily);
    points.push({ date: dayStart, balance, events });
    if (balance.lt(lowest.balance)) lowest = { date: dayStart, balance };
    const prev = points.length > 1 ? points[points.length - 2].balance : dec(input.startBalance);
    if (balance.lt(threshold) && prev.gte(threshold)) shortfalls.push({ date: dayStart, balance });
  }
  return {
    points,
    lowest,
    shortfalls,
    endBalance: balance,
    totalInflows: totalIn,
    totalOutflows: totalOut,
    assumptions: [
      `Daily discretionary spending of ${daily.toFixed(2)} (average of non-recurring expenses over the last 90 days).`,
      "Scheduled income, bills, subscriptions, debt minimums and goal contributions occur on their next expected dates at their expected amounts.",
      "Variable bills and income use their most recent expected amount.",
      "Does not include interest, investment returns, or unrecorded transactions.",
      "Card purchases are counted on the day they're made; if your card statement is also tracked as a bill, the forecast is on the conservative side.",
    ],
  };
}

export function sumEvents(events: ScheduledEvent[]): Decimal {
  return events.reduce((a, e) => a.plus(dec(e.amount)), new Decimal(0));
}
