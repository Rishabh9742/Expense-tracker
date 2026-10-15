import type { Metadata } from "next";
import { subDays } from "date-fns";
import { requireUser } from "@/lib/session";
import { money, dec } from "@/lib/money";
import { formatLocal, parseLocalDate } from "@/lib/dates";
import { getForecast, type ForecastSources } from "@/server/services/planning";
import { getAccountsWithBalances, liquidBalance } from "@/server/services/balances";
import { ForecastView } from "@/components/reports/forecast-view";

export const metadata: Metadata = { title: "Cash-flow Forecast" };

const SOURCES: (keyof ForecastSources)[] = ["recurring", "bills", "subscriptions", "debts", "goals", "discretionary"];

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const days = [30, 60, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const off = new Set(typeof sp.off === "string" ? sp.off.split(",") : []);
  const sources = Object.fromEntries(SOURCES.map((k) => [k, !off.has(k)])) as unknown as ForecastSources;
  const tz = user.prefs.timezone;
  const rawAdj = Array.isArray(sp.adj) ? sp.adj : typeof sp.adj === "string" ? [sp.adj] : [];
  const adjustments = rawAdj
    .slice(0, 20)
    .map((a) => {
      const [d, amt, ...label] = a.split("|");
      try {
        if (!/^-?\d+(\.\d+)?$/.test(amt)) return null;
        return { date: parseLocalDate(d, tz), amount: amt, label: label.join("|").slice(0, 60) || "Adjustment", raw: a };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const p = user.prefs;
  const prefs = { baseCurrency: p.baseCurrency, timezone: tz, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable };
  const fc = await getForecast(user.id, prefs, days, sources, adjustments);

  // Historical liquid balance for the previous 30 days (facts), shown before the forecast.
  const histPoints: { label: string; actual: number | null; forecast: number | null }[] = [];
  for (let i = 30; i >= 1; i -= 3) {
    const at = subDays(new Date(), i);
    const accts = await getAccountsWithBalances(user.id, p.baseCurrency, { asOf: at, includePending: p.includePending });
    histPoints.push({ label: formatLocal(at, tz, "d MMM"), actual: liquidBalance(accts).total.toDecimalPlaces(2).toNumber(), forecast: null });
  }
  const today = fc.startBalance.toDecimalPlaces(2).toNumber();
  histPoints.push({ label: "Today", actual: today, forecast: today });
  const step = days > 30 ? 3 : 1;
  const forecastPoints = fc.points.filter((_, i) => i % step === step - 1 || i === fc.points.length - 1).map((pt) => ({ label: formatLocal(pt.date, tz, "d MMM"), actual: null, forecast: pt.balance.toDecimalPlaces(2).toNumber() }));

  const upcoming = fc.events.filter((e) => dec(e.amount).lt(0)).slice(0, 25);

  return (
    <ForecastView
      days={days}
      off={[...off]}
      adjustments={adjustments.map((a) => ({ raw: a.raw, date: a.date.toISOString(), amount: a.amount, label: a.label }))}
      startBalance={money(fc.startBalance)}
      endBalance={money(fc.endBalance)}
      lowest={{ date: fc.lowest.date.toISOString(), balance: money(fc.lowest.balance) }}
      shortfalls={fc.shortfalls.map((s) => ({ date: s.date.toISOString(), balance: money(s.balance) }))}
      totalInflows={money(fc.totalInflows)}
      totalOutflows={money(fc.totalOutflows)}
      dailyDiscretionary={money(fc.dailyDiscretionary)}
      assumptions={fc.assumptions}
      missingRates={fc.missingRates}
      chart={[...histPoints, ...forecastPoints]}
      events={upcoming.map((e) => ({ date: e.date.toISOString(), label: e.label, kind: e.kind, amount: dec(e.amount).toFixed(2) }))}
      inflows={fc.events.filter((e) => dec(e.amount).gt(0)).slice(0, 15).map((e) => ({ date: e.date.toISOString(), label: e.label, kind: e.kind, amount: dec(e.amount).toFixed(2) }))}
    />
  );
}
