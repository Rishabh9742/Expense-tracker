"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, ChartColumn, Download, FileText, LineChart as LineIcon, Sheet, Telescope } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ProgressBar, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, Delta, EmptyState, MetricCard, Notice, PageHeader } from "@/components/finance/primitives";
import { CashFlowChart, DonutChart, LineSeriesChart, SingleBarChart } from "@/components/charts/charts";
import { slotVar } from "@/components/finance/icons";
import { useAppData } from "@/components/shell/app-shell";
import type { ReportData } from "@/server/queries/reports";
import { cn } from "@/lib/utils";

export function ReportsView({ data, tab }: { data: ReportData; tab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = useFormat();
  const { accounts, categories } = useAppData();
  const s = data.summary;
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const drill = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ from: new Date(data.range.from).toLocaleDateString("en-CA", { timeZone: f.timezone }), to: new Date(new Date(data.range.to).getTime() - 1).toLocaleDateString("en-CA", { timeZone: f.timezone }), ...extra });
    if (sp.get("account")) p.set("accountId", sp.get("account")!);
    return `/transactions?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(sp.toString());
  const empty = s.count === 0;

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description={`${data.range.label} · amounts in ${f.currency} · transfers excluded, refunds net against spending`}
        actions={
          <>
            <Button size="sm" asChild>
              <Link href="/reports/forecast">
                <Telescope /> Forecast
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/export?${exportQs.toString()}&format=pdf`}>
                    <FileText /> PDF report
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/export?${exportQs.toString()}&format=xlsx`}>
                    <Sheet /> Excel (XLSX)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/export?${exportQs.toString()}&format=csv`}>
                    <Sheet /> CSV
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1 sm:w-56">
          <Label htmlFor="rf-acct" className="text-meta text-muted-foreground">
            Account
          </Label>
          <NativeSelect id="rf-acct" value={sp.get("account") ?? ""} onChange={(e) => setParam("account", e.target.value || null)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full space-y-1 sm:w-56">
          <Label htmlFor="rf-cat" className="text-meta text-muted-foreground">
            Category
          </Label>
          <NativeSelect id="rf-cat" value={sp.get("category") ?? ""} onChange={(e) => setParam("category", e.target.value || null)}>
            <option value="">All categories</option>
            {categories
              .filter((c) => !c.parentId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </NativeSelect>
        </div>
      </div>

      {s.unconverted > 0 && <Notice tone="warning" className="mb-4">{s.unconverted} transactions lack an exchange rate and are excluded.</Notice>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Income" value={<Money value={s.income} />} sub={<><Delta value={s.incomeChange} /> <span className="text-subtle-foreground">vs prior period</span></>} />
        <MetricCard label="Net spending" value={<Money value={s.expenses} />} sub={<><Delta value={s.expenseChange} goodWhen="down" /> <span className="text-subtle-foreground">refunds <Money value={s.refunds} className="text-meta" /></span></>} />
        <MetricCard label="Net cash flow" value={<Money value={s.net} showSign />} />
        <MetricCard label="Savings rate" value={<span className="num">{s.savingsRate === null ? "—" : `${s.savingsRate}%`}</span>} sub={<span>Prior: {s.prevLabel}</span>} />
      </div>

      {empty ? (
        <Card>
          <EmptyState icon={<ChartColumn />} title="No data for this range" description="Pick a different date range or filters, or add transactions to see reports." action={<Button size="sm" asChild><Link href="/transactions">Go to transactions</Link></Button>} />
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setParam("tab", v)}>
          <div className="mb-4 overflow-x-auto">
            <TabsList>
              <TabsTrigger value="overview">Cash flow</TabsTrigger>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="merchants">Merchants</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
              <TabsTrigger value="budgets">Budgets & goals</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-12">
              <CardHeader>
                <div>
                  <CardTitle>Income vs expenses</CardTitle>
                  <CardDescription>Per month · click “Show table” for exact values</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <CashFlowChart data={data.monthly} mode="bars" height={300} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-6">
              <CardHeader>
                <div>
                  <CardTitle>Monthly net cash flow</CardTitle>
                  <CardDescription>Income minus net spending · click a bar to see its transactions</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <SingleBarChart
                  data={data.monthly.map((m) => ({ label: m.label, value: m.net, key: m.key }))}
                  valueLabel="Net"
                  color="var(--chart-income)"
                  description="Net cash flow per month; negative months are shown in the expense colour"
                  onSelect={(key) => {
                    const [y, mo] = key.split("-").map(Number);
                    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
                    router.push(`/transactions?from=${key}-01&to=${key}-${String(last).padStart(2, "0")}`);
                  }}
                />
              </CardContent>
            </Card>
            <Card className="lg:col-span-6">
              <CardHeader>
                <div>
                  <CardTitle>Savings rate</CardTitle>
                  <CardDescription>Share of income kept each month</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {data.monthly.map((m) => (
                    <li key={m.key} className="grid grid-cols-[56px_1fr_56px] items-center gap-3 text-[13px]">
                      <span className="text-muted-foreground">{m.label}</span>
                      <ProgressBar value={Math.max(0, m.savingsRate ?? 0)} tone={m.savingsRate !== null && m.savingsRate < 0 ? "negative" : "positive"} label={`${m.label} savings rate`} size="sm" />
                      <span className={cn("num text-right", m.savingsRate !== null && m.savingsRate < 0 && "text-negative")}>{m.savingsRate === null ? "—" : `${m.savingsRate}%`}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Spending by category</CardTitle>
                  <CardDescription>Subcategories rolled into parents · compared with {s.prevLabel}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-[220px_1fr]">
                <div className="flex justify-center">
                  <DonutChart
                    size={210}
                    total={Number(s.expenses)}
                    slices={[
                      ...data.categories.slice(0, 7).map((c) => ({ name: c.name, amount: Number(c.amount), color: c.color, percent: c.percent })),
                      ...(data.categories.length > 7
                        ? [{ name: "Other", amount: data.categories.slice(7).reduce((a, c) => a + Number(c.amount), 0), color: "other", percent: Math.round(data.categories.slice(7).reduce((a, c) => a + c.percent, 0) * 10) / 10 }]
                        : []),
                    ]}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">Spending by category</caption>
                    <thead className="text-left text-[12px] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 font-medium">Category</th>
                        <th className="py-2 text-right font-medium">Share</th>
                        <th className="py-2 text-right font-medium">Amount</th>
                        <th className="hidden py-2 text-right font-medium sm:table-cell">Previous</th>
                        <th className="py-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.categories.map((c) => (
                        <tr key={c.categoryId ?? "none"} className="group border-b border-border last:border-0 hover:bg-surface-2/50">
                          <td className="py-2">
                            <Link href={drill({ categoryId: c.categoryId ?? "none" })} className="flex items-center gap-2 font-medium hover:underline">
                              <span className="size-2.5 rounded-[3px]" style={{ background: slotVar(c.color) }} aria-hidden />
                              {c.name}
                              <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                            </Link>
                          </td>
                          <td className="num py-2 text-right text-muted-foreground">{c.percent}%</td>
                          <td className="py-2 text-right font-medium"><Money value={c.amount} /></td>
                          <td className="hidden py-2 text-right text-muted-foreground sm:table-cell"><Money value={c.prev} tone="muted" /></td>
                          <td className="py-2 text-right"><Delta value={c.change} goodWhen="down" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="merchants">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Top merchants</CardTitle>
                  <CardDescription>By net spending · click to see transactions</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {data.merchants.length === 0 ? (
                  <EmptyState compact icon={<ChartColumn />} title="No merchant data" description="Add merchants to transactions to see this breakdown." />
                ) : (
                  <ul className="space-y-3">
                    {data.merchants.map((m) => {
                      const max = Number(data.merchants[0].total);
                      return (
                        <li key={m.name}>
                          <Link href={drill({ q: m.name === "Unknown merchant" ? "" : m.name })} className="block rounded-md hover:bg-surface-2/50">
                            <div className="mb-1 flex justify-between gap-2 text-[13px]">
                              <span className="truncate font-medium">{m.name}</span>
                              <span className="shrink-0 text-muted-foreground">
                                {m.count}× · avg <Money value={m.average} className="text-[12.5px]" /> · <Money value={m.total} className="font-medium text-foreground" />
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-surface-3">
                              <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(Number(m.total) / max) * 100}%` }} />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trends" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Weekly spending</CardTitle>
                  <CardDescription>Net spending per week (Monday start)</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <SingleBarChart data={data.weekly} valueLabel="Spent" description="Net spending per week" color="var(--chart-1)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Year over year</CardTitle>
                  <CardDescription>Monthly spending this year vs same months last year</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <LineSeriesChart
                  data={data.yoy}
                  series={[
                    { key: "thisYear", label: "This period", color: "var(--chart-1)" },
                    { key: "lastYear", label: "Year before", color: "var(--chart-2)", dashed: true },
                  ]}
                  description="Monthly spending compared with the same month a year earlier"
                />
              </CardContent>
            </Card>
            <SplitCard
              title="Essential vs discretionary"
              description="Based on categories marked essential"
              a={{ label: "Essential", value: data.essential.essential, color: "var(--chart-1)" }}
              b={{ label: "Discretionary", value: data.essential.discretionary, color: "var(--chart-2)" }}
              footer={<>Mark categories as essential on the <Link className="underline" href="/categories">Categories</Link> page.</>}
            />
            <SplitCard
              title="Recurring vs one-off"
              description="Recurring = scheduled or paid to a tracked subscription"
              a={{ label: "Recurring", value: data.recurringSplit.recurring, color: "var(--chart-5)" }}
              b={{ label: "One-off", value: data.recurringSplit.nonRecurring, color: "var(--chart-3)" }}
            />
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Subscription charges</CardTitle>
                  <CardDescription>Monthly charges from merchants you track as subscriptions</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {data.subTrend.some((x) => x.value > 0) ? (
                  <SingleBarChart data={data.subTrend} valueLabel="Charged" description="Subscription charges per month" color="var(--chart-5)" height={200} />
                ) : (
                  <EmptyState compact icon={<ChartColumn />} title="No subscription charges found" description="Track subscriptions so Finora can match their charges." />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="income" className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-5">
              <CardHeader>
                <div>
                  <CardTitle>Income sources</CardTitle>
                  <CardDescription>Genuine earnings only — refunds & transfers excluded</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {data.income.sources.length === 0 ? (
                  <EmptyState compact icon={<LineIcon />} title="No income in this range" />
                ) : (
                  <ul className="space-y-3">
                    {data.income.sources.map((src) => (
                      <li key={src.name} className="flex items-center gap-3 text-[13px]">
                        <CategoryIcon icon={src.icon} color={src.color} className="size-7" />
                        <span className="flex-1 font-medium">{src.name}</span>
                        <span className="num text-muted-foreground">{src.percent}%</span>
                        <Money value={src.amount} className="w-28 text-right font-medium" />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-[13px]">
                  <div>
                    <p className="text-meta text-muted-foreground">Average per month</p>
                    <Money value={data.income.averageMonthly} className="font-semibold" />
                  </div>
                  <div>
                    <p className="text-meta text-muted-foreground">Variability</p>
                    <p className="font-semibold">{data.income.volatility === null ? "—" : `±${data.income.volatility}%`}</p>
                  </div>
                  <div>
                    <p className="text-meta text-muted-foreground">Scheduled per cycle</p>
                    <Money value={data.income.expectedMonthly} className="font-semibold" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-7">
              <CardHeader>
                <div>
                  <CardTitle>Monthly income</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <SingleBarChart data={data.monthly.map((m) => ({ label: m.label, value: m.income }))} valueLabel="Income" color="var(--chart-income)" description="Income per month" />
              </CardContent>
            </Card>
            <IncomeForecast average={Number(data.income.averageMonthly)} />
          </TabsContent>

          <TabsContent value="budgets" className="grid gap-4 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Budget adherence</CardTitle>
                  <CardDescription>% of each budget used in recent periods (100% = exactly on budget)</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {data.adherence.length === 0 ? (
                  <EmptyState compact icon={<ChartColumn />} title="No budgets yet" action={<Button size="sm" asChild><Link href="/budgets?new=1">Create budget</Link></Button>} />
                ) : (
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">Budget adherence by period</caption>
                    <thead className="text-[12px] text-muted-foreground">
                      <tr>
                        <th className="py-2 text-left font-medium">Budget</th>
                        {data.adherence[0].periods.map((p, i) => (
                          <th key={i} className="py-2 text-center font-medium">
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.adherence.map((b) => (
                        <tr key={b.name} className="border-t border-border">
                          <td className="py-2 font-medium">{b.name}</td>
                          {b.periods.map((p, i) => (
                            <td key={i} className="px-1 py-2 text-center">
                              <span
                                className={cn(
                                  "num inline-block min-w-12 rounded-md px-1.5 py-0.5 text-[12px]",
                                  p.percent === null ? "text-subtle-foreground" : p.percent > 100 ? "bg-negative-soft text-negative" : p.percent > 90 ? "bg-warning-soft text-warning" : "bg-positive-soft text-positive",
                                )}
                              >
                                {p.percent === null ? "—" : `${p.percent}%`}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Net worth growth</CardTitle>
                  <CardDescription>Month-end net worth, last 12 months</CardDescription>
                </div>
                <Link href="/net-worth" className="text-meta font-medium text-muted-foreground hover:text-foreground">
                  Details
                </Link>
              </CardHeader>
              <CardContent>
                <LineSeriesChart data={data.netWorth} series={[{ key: "netWorth", label: "Net worth", color: "var(--chart-1)" }]} areaKey="nwr" height={220} description="Net worth at each month end" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Debt repayment progress</CardTitle>
                  <CardDescription>Share of original principal repaid</CardDescription>
                </div>
                <Link href="/debts" className="text-meta font-medium text-muted-foreground hover:text-foreground">
                  Details
                </Link>
              </CardHeader>
              <CardContent>
                {data.debts.length === 0 ? (
                  <EmptyState compact icon={<ChartColumn />} title="No open debts" />
                ) : (
                  <ul className="space-y-3.5">
                    {data.debts.map((d) => (
                      <li key={d.name}>
                        <div className="mb-1 flex justify-between text-[13px]">
                          <span className="font-medium">{d.name}</span>
                          <span className="text-muted-foreground">
                            {d.progress}% · <Money value={d.balance} currency={d.currency} /> left
                          </span>
                        </div>
                        <ProgressBar value={d.progress} tone="positive" label={`${d.name} ${d.progress}% repaid`} size="sm" />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function SplitCard({ title, description, a, b, footer }: { title: string; description: string; a: { label: string; value: string; color: string }; b: { label: string; value: string; color: string }; footer?: React.ReactNode }) {
  const total = Number(a.value) + Number(b.value);
  const pa = total > 0 ? (Number(a.value) / total) * 100 : 0;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${a.label} ${pa.toFixed(0)}%, ${b.label} ${(100 - pa).toFixed(0)}%`}>
          <div style={{ width: `${pa}%`, background: a.color }} />
          <div style={{ width: `${100 - pa}%`, background: b.color }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          {[a, b].map((x, i) => (
            <div key={x.label}>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2.5 rounded-[3px]" style={{ background: x.color }} aria-hidden /> {x.label}
              </p>
              <p className="mt-0.5">
                <Money value={x.value} className="font-semibold" /> <span className="num text-meta text-muted-foreground">{total > 0 ? `${(i === 0 ? pa : 100 - pa).toFixed(0)}%` : ""}</span>
              </p>
            </div>
          ))}
        </div>
        {footer && <p className="mt-3 text-meta text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

function IncomeForecast({ average }: { average: number }) {
  const f = useFormat();
  const [base, setBase] = React.useState(String(Math.round(average)));
  const [growth, setGrowth] = React.useState("0");
  const [months, setMonths] = React.useState(6);
  const b = Number(base) || 0;
  const g = Number(growth) || 0;
  const now = new Date();
  const rows = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return { label: d.toLocaleDateString("en", { month: "short", year: "2-digit" }), value: Math.round(b * Math.pow(1 + g / 100, i + 1) * 100) / 100 };
  });
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <Card className="lg:col-span-12">
      <CardHeader>
        <div>
          <CardTitle>Income forecast</CardTitle>
          <CardDescription>Based on your own assumptions — not a prediction or guarantee</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="if-base">Monthly income assumption</Label>
            <Input id="if-base" inputMode="decimal" className="num" value={base} onChange={(e) => setBase(e.target.value)} />
            <p className="text-meta text-muted-foreground">Defaults to your average of {f.money(average)}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="if-growth">Change per month (%)</Label>
            <Input id="if-growth" inputMode="decimal" className="num" value={growth} onChange={(e) => setGrowth(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="if-months">Months ahead</Label>
            <NativeSelect id="if-months" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value="3">3</option>
              <option value="6">6</option>
              <option value="12">12</option>
            </NativeSelect>
          </div>
          <p className="rounded-md bg-surface-2 p-3 text-[13px]">
            Projected total: <span className="num font-semibold">{f.money(total)}</span>
          </p>
        </div>
        <SingleBarChart data={rows} valueLabel="Projected income" color="var(--chart-income)" description="Projected monthly income from your assumptions" height={230} />
      </CardContent>
    </Card>
  );
}
