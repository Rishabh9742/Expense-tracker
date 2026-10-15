"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table2, ChartLine } from "lucide-react";
import { useFormat } from "@/components/finance/format";
import { slotVar } from "@/components/finance/icons";
import { cn } from "@/lib/utils";

/* ───────── Shared pieces ───────── */

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground", className)} aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden>
            <line x1="1" y1="4" x2="15" y2="4" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={s.dashed ? "3 3" : undefined} />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipCard({ title, rows }: { title: string; rows: { label: string; value: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-[12px] font-medium text-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <svg width="12" height="6" aria-hidden>
                <line x1="1" y1="3" x2="11" y2="3" stroke={r.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={r.dashed ? "2.5 2.5" : undefined} />
              </svg>
              {r.label}
            </span>
            <span className="num font-medium text-foreground">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Toggle between chart and an accessible data table. */
export function ChartFrame({
  title,
  description,
  table,
  children,
  height = 260,
  toolbar,
}: {
  title?: string;
  description: string;
  table: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  height?: number;
  toolbar?: React.ReactNode;
}) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {toolbar ?? <span />}
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-pressed={asTable}
        >
          {asTable ? <ChartLine className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div className="scrollbar-thin overflow-auto rounded-lg border border-border" style={{ maxHeight: height }}>
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">{title ?? description}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={cn("px-3 py-2 font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={cn("px-3 py-1.5", j === 0 ? "text-left" : "num text-right")}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={description} style={{ height }}>
          {children}
        </div>
      )}
      <figcaption className="sr-only">{description}</figcaption>
    </figure>
  );
}

function useAxisMoney() {
  const f = useFormat();
  return (v: number) => f.money(v, undefined, { compact: true });
}

/* ───────── Cash flow ───────── */

export interface CashPoint {
  label: string;
  income: number;
  expenses: number;
}

const INCOME: SeriesDef = { key: "income", label: "Income", color: "var(--chart-income)" };
const EXPENSE: SeriesDef = { key: "expenses", label: "Expenses", color: "var(--chart-expense)", dashed: true };

export function CashFlowChart({ data, mode, height = 280 }: { data: CashPoint[]; mode: "cumulative" | "bars"; height?: number }) {
  const f = useFormat();
  const axis = useAxisMoney();
  const plotted = React.useMemo(() => {
    if (mode !== "cumulative") return data;
    let i = 0;
    let e = 0;
    return data.map((d) => {
      i += d.income;
      e += d.expenses;
      return { label: d.label, income: Math.round(i * 100) / 100, expenses: Math.round(e * 100) / 100 };
    });
  }, [data, mode]);
  const totalIn = data.reduce((a, d) => a + d.income, 0);
  const totalOut = data.reduce((a, d) => a + d.expenses, 0);
  const description = `${mode === "cumulative" ? "Cumulative income and expenses" : "Income and expenses per period"}. Total income ${f.money(totalIn)}, total expenses ${f.money(totalOut)}.`;

  const tooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string | number; value?: number }[]; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    const inc = payload.find((p) => p.dataKey === "income")?.value ?? 0;
    const exp = payload.find((p) => p.dataKey === "expenses")?.value ?? 0;
    return (
      <TooltipCard
        title={`${label}${mode === "cumulative" ? " · running total" : ""}`}
        rows={[
          { label: "Income", value: f.money(inc), color: INCOME.color },
          { label: "Expenses", value: f.money(exp), color: EXPENSE.color, dashed: true },
          { label: "Net", value: f.money(inc - exp, undefined, { signDisplay: "exceptZero" }), color: "transparent" },
        ]}
      />
    );
  };

  return (
    <ChartFrame
      description={description}
      height={height}
      toolbar={<ChartLegend series={[INCOME, EXPENSE]} />}
      table={{ columns: ["Period", "Income", "Expenses", "Net"], rows: data.map((d) => [d.label, f.money(d.income), f.money(d.expenses), f.money(d.income - d.expenses)]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {mode === "cumulative" ? (
          <AreaChart data={plotted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="g-income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-income)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-income)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={axis} width={64} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <RTooltip content={tooltip} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            <Area type="monotone" dataKey="income" stroke="var(--chart-income)" strokeWidth={2} fill="url(#g-income)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={500} />
            <Area type="monotone" dataKey="expenses" stroke="var(--chart-expense)" strokeWidth={2} strokeDasharray="5 4" fill="transparent" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={500} />
          </AreaChart>
        ) : (
          <BarChart data={plotted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={axis} width={64} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <RTooltip content={tooltip} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="expenses" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ───────── Category donut ───────── */

export interface Slice {
  name: string;
  amount: number;
  color: string;
  percent: number;
}

export function DonutChart({ slices, total, size = 180, centerLabel = "Spent" }: { slices: Slice[]; total: number; size?: number; centerLabel?: string }) {
  const f = useFormat();
  const [active, setActive] = React.useState<number | null>(null);
  const shown = active !== null ? slices[active] : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Spending by category: ${slices.map((s) => `${s.name} ${s.percent}%`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="amount"
            nameKey="name"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={slices.length > 1 ? 1.5 : 0}
            cornerRadius={3}
            stroke="var(--surface)"
            strokeWidth={2}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
            animationDuration={500}
            isAnimationActive
          >
            {slices.map((s, i) => (
              <Cell key={s.name} fill={slotVar(s.color)} opacity={active === null || active === i ? 1 : 0.35} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="max-w-[70%] truncate text-meta text-muted-foreground">{shown ? shown.name : centerLabel}</span>
        <span className="num text-[15px] font-semibold">{f.money(shown ? shown.amount : total, undefined, { compact: total >= 100000 })}</span>
        {shown && <span className="num text-[11px] text-muted-foreground">{shown.percent}%</span>}
      </div>
    </div>
  );
}

/* ───────── Generic line (net worth, balances, forecast) ───────── */

export function LineSeriesChart({
  data,
  series,
  height = 260,
  description,
  zeroLine = true,
  areaKey,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  height?: number;
  description: string;
  zeroLine?: boolean;
  areaKey?: string;
}) {
  const f = useFormat();
  const axis = useAxisMoney();
  return (
    <ChartFrame
      description={description}
      height={height}
      toolbar={series.length > 1 ? <ChartLegend series={series} /> : undefined}
      table={{ columns: ["Period", ...series.map((s) => s.label)], rows: data.map((d) => [String(d.label), ...series.map((s) => f.money(Number(d[s.key])))]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {areaKey ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`g-${areaKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series[0].color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={series[0].color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={axis} width={64} domain={["auto", "auto"]} />
            {zeroLine && <ReferenceLine y={0} stroke="var(--border-strong)" />}
            <RTooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard title={String(label)} rows={series.map((s) => ({ label: s.label, value: f.money(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)), color: s.color, dashed: s.dashed }))} />
                ) : null
              }
            />
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                fill={i === 0 ? `url(#g-${areaKey})` : "transparent"}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                animationDuration={500}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={axis} width={64} domain={["auto", "auto"]} />
            {zeroLine && <ReferenceLine y={0} stroke="var(--border-strong)" />}
            <RTooltip
              cursor={{ stroke: "var(--border-strong)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard title={String(label)} rows={series.map((s) => ({ label: s.label, value: f.money(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)), color: s.color, dashed: s.dashed }))} />
                ) : null
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={data.length <= 14 ? { r: 3, strokeWidth: 2, fill: "var(--surface)" } : false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--surface)" }}
                animationDuration={500}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ───────── Vertical bars for a single measure ───────── */

export function SingleBarChart({
  data,
  color = "var(--chart-1)",
  height = 240,
  description,
  valueLabel,
  onSelect,
}: {
  data: { label: string; value: number; key?: string }[];
  color?: string;
  height?: number;
  description: string;
  valueLabel: string;
  onSelect?: (key: string) => void;
}) {
  const f = useFormat();
  const axis = useAxisMoney();
  return (
    <ChartFrame description={description} height={height} table={{ columns: ["Period", valueLabel], rows: data.map((d) => [d.label, f.money(d.value)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tickFormatter={axis} width={64} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <RTooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? <TooltipCard title={String(label)} rows={[{ label: valueLabel, value: f.money(Number(payload[0].value)), color }]} /> : null
            }
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
            onClick={(d: { key?: string }) => d?.key && onSelect?.(d.key)}
            className={onSelect ? "cursor-pointer" : undefined}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.value < 0 ? "var(--chart-expense)" : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
