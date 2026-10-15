"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip } from "recharts";
import { AlertTriangle, ArrowLeft, Info, Plus, X, CircleCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Checkbox, Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { MetricCard, Notice } from "@/components/finance/primitives";
import { ChartFrame, ChartLegend } from "@/components/charts/charts";
import { todayYmd } from "@/components/schedules/shared";

const SOURCE_LABELS: Record<string, string> = {
  recurring: "Recurring income & expenses",
  bills: "Bills",
  subscriptions: "Subscriptions",
  debts: "Debt minimum payments",
  goals: "Planned savings contributions",
  discretionary: "Typical day-to-day spending",
};

interface Ev {
  date: string;
  label: string;
  kind: string;
  amount: string;
}

export function ForecastView(props: {
  days: number;
  off: string[];
  adjustments: { raw: string; date: string; amount: string; label: string }[];
  startBalance: string;
  endBalance: string;
  lowest: { date: string; balance: string };
  shortfalls: { date: string; balance: string }[];
  totalInflows: string;
  totalOutflows: string;
  dailyDiscretionary: string;
  assumptions: string[];
  missingRates: string[];
  chart: { label: string; actual: number | null; forecast: number | null }[];
  events: Ev[];
  inflows: Ev[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = useFormat();
  const [adjDate, setAdjDate] = React.useState(todayYmd());
  const [adjAmt, setAdjAmt] = React.useState("");
  const [adjLabel, setAdjLabel] = React.useState("");
  const update = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mut(p);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const toggle = (k: string, on: boolean) =>
    update((p) => {
      const off = new Set(props.off);
      if (on) off.delete(k);
      else off.add(k);
      if (off.size) p.set("off", [...off].join(","));
      else p.delete("off");
    });

  return (
    <div>
      <Link href="/reports" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Reports
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold">Cash-flow forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">A projection of your available balance — an estimate based on the assumptions below, not a guarantee.</p>
        </div>
        <Tabs value={String(props.days)} onValueChange={(v) => update((p) => p.set("days", v))}>
          <TabsList>
            <TabsTrigger value="30">30 days</TabsTrigger>
            <TabsTrigger value="60">60 days</TabsTrigger>
            <TabsTrigger value="90">90 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {props.missingRates.length > 0 && <Notice tone="warning" className="mb-4">Excluded (no exchange rate): {props.missingRates.join(", ")}</Notice>}
      {props.shortfalls.length > 0 ? (
        <Notice tone="negative" className="mb-4" icon={<AlertTriangle />}>
          Possible shortfall: your available balance may drop below zero around {f.date(props.shortfalls[0].date, { day: "numeric", month: "long" })} (≈ {f.money(props.shortfalls[0].balance)}). Review upcoming obligations below.
        </Notice>
      ) : (
        <Notice tone="positive" className="mb-4" icon={<CircleCheck />}>
          No shortfall projected in the next {props.days} days with these assumptions.
        </Notice>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Available today" value={<Money value={props.startBalance} />} sub={<span>Fact · cash, bank & wallets</span>} />
        <MetricCard label={`Projected in ${props.days} days`} value={<Money value={props.endBalance} tone={Number(props.endBalance) < 0 ? "negative" : "neutral"} />} sub={<span>Estimate</span>} />
        <MetricCard label="Lowest point" value={<Money value={props.lowest.balance} tone={Number(props.lowest.balance) < 0 ? "negative" : "neutral"} />} sub={<span>around {f.date(props.lowest.date, { day: "numeric", month: "short" })}</span>} />
        <MetricCard label="Expected in / out" value={<span className="text-[17px]"><Money value={props.totalInflows} tone="positive" /> / <Money value={props.totalOutflows} /></span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader>
            <div>
              <CardTitle>Available balance</CardTitle>
              <CardDescription>Solid line: recorded history (last 30 days). Dashed line: forecast.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ChartFrame
              description={`Available balance, past 30 days actual and next ${props.days} days forecast`}
              height={280}
              toolbar={<ChartLegend series={[{ key: "a", label: "Actual", color: "var(--chart-1)" }, { key: "f", label: "Forecast", color: "var(--chart-1)", dashed: true }]} />}
              table={{ columns: ["Date", "Actual", "Forecast"], rows: props.chart.map((c) => [c.label, c.actual === null ? "—" : f.money(c.actual), c.forecast === null ? "—" : f.money(c.forecast)]) }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={props.chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => f.money(v, undefined, { compact: true })} />
                  <ReferenceLine y={0} stroke="var(--chart-expense)" strokeDasharray="2 3" />
                  <ReferenceLine x="Today" stroke="var(--border-strong)" label={{ value: "Today", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)" }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-lg">
                          <p className="mb-1 font-medium">{String(label)}</p>
                          {payload
                            .filter((x) => x.value !== null && x.value !== undefined)
                            .map((x) => (
                              <p key={String(x.dataKey)} className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{x.dataKey === "actual" ? "Actual" : "Forecast (estimate)"}</span>
                                <span className="num font-medium">{f.money(Number(x.value))}</span>
                              </p>
                            ))}
                        </div>
                      ) : null
                    }
                  />
                  <Line type="monotone" dataKey="actual" stroke="var(--chart-1)" strokeWidth={2} dot={false} connectNulls={false} animationDuration={400} />
                  <Line type="monotone" dataKey="forecast" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} animationDuration={400} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Include in forecast</CardTitle>
              <CardDescription>Toggle sources to test scenarios</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {Object.entries(SOURCE_LABELS).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={!props.off.includes(k)} onCheckedChange={(c) => toggle(k, !!c)} /> {l}
              </label>
            ))}
            <p className="pt-1 text-meta text-muted-foreground">Typical day-to-day spending: {f.money(props.dailyDiscretionary)} per day.</p>
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[13px] font-medium">Your adjustments</p>
              {props.adjustments.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {props.adjustments.map((a) => (
                    <li key={a.raw} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1 text-[12.5px]">
                      <span className="truncate">
                        {f.date(a.date, { day: "numeric", month: "short" })} · {a.label}
                      </span>
                      <span className="flex items-center gap-1">
                        <Money value={a.amount} showSign />
                        <button aria-label={`Remove ${a.label}`} onClick={() => update((p) => { const all = p.getAll("adj").filter((x) => x !== a.raw); p.delete("adj"); all.forEach((x) => p.append("adj", x)); })} className="rounded p-0.5 hover:bg-surface-3">
                          <X className="size-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="grid grid-cols-2 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!/^-?\d+(\.\d+)?$/.test(adjAmt.trim())) return;
                  update((p) => p.append("adj", `${adjDate}|${adjAmt.trim()}|${adjLabel.trim() || "Adjustment"}`));
                  setAdjAmt("");
                  setAdjLabel("");
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="adj-d" className="text-[11.5px] text-muted-foreground">Date</Label>
                  <Input id="adj-d" type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} className="h-8 px-2 text-[12.5px]" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adj-a" className="text-[11.5px] text-muted-foreground">Amount (± )</Label>
                  <Input id="adj-a" inputMode="decimal" placeholder="-15000" value={adjAmt} onChange={(e) => setAdjAmt(e.target.value)} className="num h-8 px-2 text-[12.5px]" />
                </div>
                <Input aria-label="Adjustment label" placeholder="e.g. Bonus, car repair" value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} className="col-span-2 h-8 text-[12.5px]" />
                <Button type="submit" size="sm" className="col-span-2">
                  <Plus /> Add adjustment
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle>Upcoming obligations</CardTitle>
          </CardHeader>
          <CardContent>
            <EventList events={props.events} empty="No scheduled outflows in this window." />
          </CardContent>
        </Card>
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle>Expected inflows</CardTitle>
          </CardHeader>
          <CardContent>
            <EventList events={props.inflows} empty="No scheduled income. Add a salary schedule under Bills & Recurring." />
          </CardContent>
        </Card>
        <Card className="lg:col-span-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-4 text-muted-foreground" /> Assumptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
              {props.assumptions.map((a) => (
                <li key={a}>{a.replace(/(\d+\.\d{2})/, (m) => f.money(m))}</li>
              ))}
              <li>History (solid line) comes from your recorded transactions; everything after today is a projection.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EventList({ events, empty }: { events: Ev[]; empty: string }) {
  const f = useFormat();
  if (!events.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {events.map((e, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="min-w-0">
            <span className="block truncate font-medium">{e.label}</span>
            <span className="text-[11.5px] text-muted-foreground">
              {f.date(e.date, { weekday: "short", day: "numeric", month: "short" })} · {e.kind}
            </span>
          </span>
          <Money value={e.amount} showSign />
        </li>
      ))}
    </ul>
  );
}
