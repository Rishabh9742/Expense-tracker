"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  Check,
  ChartPie,
  CircleCheck,
  Eye,
  EyeOff,
  Landmark,
  LayoutGrid,
  Lightbulb,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, Delta, EmptyState, MetricCard, Notice } from "@/components/finance/primitives";
import { Icon, slotVar } from "@/components/finance/icons";
import { CashFlowChart, DonutChart } from "@/components/charts/charts";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { useQuickAdd } from "@/components/shell/app-shell";
import { dismissOnboardingAction, saveDashboardLayoutAction } from "@/server/actions/settings";
import type { OverviewData, WidgetId } from "@/server/queries/overview";
import { cn } from "@/lib/utils";

const WIDGET_LABELS: Record<WidgetId, string> = {
  cashflow: "Cash flow",
  categories: "Spending by category",
  budgets: "Budget progress",
  insights: "Insights",
  recent: "Recent transactions",
  bills: "Upcoming bills",
  goals: "Savings goals",
  subscriptions: "Subscriptions",
  accounts: "Accounts",
  timeline: "Activity timeline",
};

const SPAN: Record<WidgetId, string> = {
  cashflow: "lg:col-span-8",
  categories: "lg:col-span-4",
  budgets: "lg:col-span-4",
  insights: "lg:col-span-4",
  recent: "lg:col-span-8",
  bills: "lg:col-span-4",
  goals: "lg:col-span-4",
  subscriptions: "lg:col-span-4",
  accounts: "lg:col-span-4",
  timeline: "lg:col-span-4",
};

export function OverviewDashboard({ data, greeting }: { data: OverviewData; greeting: string }) {
  const quick = useQuickAdd();
  const [customize, setCustomize] = React.useState(false);
  const s = data.summary;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s your money for <span className="font-medium text-foreground">{data.range.label}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCustomize(true)}>
            <LayoutGrid /> Customize
          </Button>
          <Button variant="primary" size="sm" onClick={() => quick.open()} className="sm:hidden">
            <Plus /> Add transaction
          </Button>
        </div>
      </div>

      {!data.onboarding.dismissed && <Onboarding o={data.onboarding} />}

      {s.liquidMissing.length > 0 && (
        <Notice tone="warning" className="mb-4" icon={<AlertTriangle />}>
          No exchange rate is available for {s.liquidMissing.join(", ")}, so {s.liquidMissing.length === 1 ? "it is" : "they are"} excluded from totals. Add a manual rate in{" "}
          <Link href="/settings#currency" className="underline">
            Settings
          </Link>
          .
        </Notice>
      )}
      {s.unconverted > 0 && (
        <Notice tone="warning" className="mb-4" icon={<AlertTriangle />}>
          {s.unconverted} transaction{s.unconverted === 1 ? "" : "s"} in this period could not be converted to your base currency and {s.unconverted === 1 ? "is" : "are"} excluded from totals.
        </Notice>
      )}

      {/* Summary */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          className="col-span-2 md:col-span-1"
          label="Available balance"
          icon={<Wallet className="size-3.5" />}
          footnote="Sum of cash, checking, savings and wallet accounts converted to your base currency at today's rate. Excludes credit cards, loans and investments."
          value={<Money value={s.liquid} />}
          sub={<span>Cash, checking, savings & wallets</span>}
          href="/accounts"
        />
        <MetricCard
          label="Income"
          icon={<ArrowDown className="size-3.5" />}
          footnote="Genuine earnings only. Refunds and transfers between your accounts are excluded."
          value={<Money value={s.income} />}
          sub={
            <>
              <Delta value={s.incomeChange} goodWhen="up" />
              <span className="text-subtle-foreground">{s.comparisonLabel}</span>
            </>
          }
        />
        <MetricCard
          label="Expenses"
          icon={<ArrowUp className="size-3.5" />}
          footnote="Net spending: expenses minus refunds and reimbursements. Transfers are excluded."
          value={<Money value={s.expenses} />}
          sub={
            <>
              <Delta value={s.expenseChange} goodWhen="down" />
              <span className="text-subtle-foreground">{s.comparisonLabel}</span>
            </>
          }
        />
        <MetricCard
          label="Net cash flow"
          icon={Number(s.net) >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          footnote="Income minus net spending for the selected period."
          value={<Money value={s.net} showSign />}
          sub={<span>{Number(s.net) >= 0 ? "Surplus" : "Deficit"} this period</span>}
        />
        <MetricCard
          label="Savings rate"
          icon={<PiggyBank className="size-3.5" />}
          footnote="(Income − net spending) ÷ income."
          value={<span className="num">{s.savingsRate === null ? "—" : `${s.savingsRate}%`}</span>}
          sub={s.savingsRate === null ? <span>No income recorded</span> : s.prevSavingsRate !== null ? <Delta value={s.savingsRate - s.prevSavingsRate} suffix=" pts" /> : <span>No prior data</span>}
        />
      </section>

      <section aria-label="Position" className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm md:grid-cols-4">
        {[
          { label: "Net worth", value: <Money value={s.netWorth} />, href: "/net-worth", hint: "Assets minus liabilities" },
          { label: "Liabilities", value: <Money value={s.liabilities} />, href: "/debts", hint: "Cards, loans and debts" },
          {
            label: "Budget utilization",
            value: <span className="num">{s.utilization === null ? "—" : `${s.utilization}%`}</span>,
            href: "/budgets",
            hint: s.utilization === null ? "No active budgets" : "Of all active budgets",
          },
          {
            label: "Spending vs previous",
            value: <Delta value={s.expenseChange} goodWhen="down" className="text-[15px]" />,
            href: "/reports",
            hint: <>{s.comparisonLabel === "vs previous period" ? "Previously" : "Same point last period"} <Money value={s.prevExpenses} className="text-meta" /></>,
          },
        ].map((x) => (
          <Link key={x.label} href={x.href} className="group bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
            <span className="text-meta text-muted-foreground">{x.label}</span>
            <span className="mt-0.5 block text-[15px] font-semibold">{x.value}</span>
            <span className="block truncate text-[11.5px] text-subtle-foreground">{x.hint}</span>
          </Link>
        ))}
      </section>

      {data.unusual.length > 0 && (
        <div className="mt-4 space-y-2">
          {data.unusual.map((u) => (
            <Notice key={u.id} tone="warning" icon={<AlertTriangle />}>
              <span className="font-medium">Unusual spending:</span> “{u.description}” — <Money value={u.amount} className="font-medium" /> is well above your typical <Money value={u.median} /> {u.category ? `for ${u.category}` : "for this category"}.{" "}
              <Link className="underline" href={`/transactions?q=${encodeURIComponent(u.description.slice(0, 40))}`}>
                Review
              </Link>
            </Notice>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-flow-row-dense grid-cols-1 gap-4 lg:grid-cols-12">
        {data.layout
          // Before any transactions exist, show only the widgets that help someone get started.
          .filter((w) => !w.hidden && (data.txnCount > 0 || ["cashflow", "accounts", "budgets", "goals"].includes(w.id)))
          .map((w) => (
            <div key={w.id} className={cn("min-w-0", SPAN[w.id])}>
              <Widget id={w.id} data={data} />
            </div>
          ))}
      </div>

      <CustomizeDialog open={customize} onOpenChange={setCustomize} layout={data.layout} />
    </div>
  );
}

function Widget({ id, data }: { id: WidgetId; data: OverviewData }) {
  switch (id) {
    case "cashflow":
      return <CashFlowWidget data={data} />;
    case "categories":
      return <CategoriesWidget data={data} />;
    case "budgets":
      return <BudgetsWidget data={data} />;
    case "insights":
      return <InsightsWidget data={data} />;
    case "recent":
      return <RecentWidget data={data} />;
    case "bills":
      return <BillsWidget data={data} />;
    case "goals":
      return <GoalsWidget data={data} />;
    case "subscriptions":
      return <SubscriptionsWidget data={data} />;
    case "accounts":
      return <AccountsWidget data={data} />;
    case "timeline":
      return <TimelineWidget data={data} />;
  }
}

function WidgetCard({ title, description, href, linkLabel = "View all", children, className }: { title: string; description?: React.ReactNode; href?: string; linkLabel?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {href && (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-meta font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            {linkLabel} <ArrowRight className="size-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CashFlowWidget({ data }: { data: OverviewData }) {
  const quick = useQuickAdd();
  const hasData = data.series.some((p) => p.income > 0 || p.expenses > 0);
  return (
    <WidgetCard
      title="Cash flow"
      description={data.seriesGranularity === "day" ? `Running totals of money in and out · ${data.range.label}` : `Income vs expenses per period · ${data.range.label}`}
      href="/reports"
      linkLabel="Reports"
    >
      {hasData ? (
        <CashFlowChart data={data.series} mode={data.seriesGranularity === "day" ? "cumulative" : "bars"} />
      ) : (
        <EmptyState
          icon={<Activity />}
          title={data.txnCount ? "No income or spending in this period" : "No transactions yet"}
          description={data.txnCount ? "Choose a different date range, or add transactions for this period." : "Your cash-flow chart fills in as you add income and expenses or import a statement."}
          action={
            <>
              <Button size="sm" variant="primary" onClick={() => quick.open()}>
                <Plus /> Add transaction
              </Button>
              <Button size="sm" asChild>
                <Link href="/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
            </>
          }
        />
      )}
    </WidgetCard>
  );
}

function CategoriesWidget({ data }: { data: OverviewData }) {
  const slices = data.categories.slice(0, 6);
  const rest = data.categories.slice(6);
  const restAmount = rest.reduce((a, c) => a + Number(c.amount), 0);
  const restPct = rest.reduce((a, c) => a + c.percent, 0);
  const chart = [
    ...slices.map((c) => ({ name: c.name, amount: Number(c.amount), color: c.color, percent: c.percent })),
    ...(rest.length ? [{ name: "Other", amount: restAmount, color: "other", percent: Math.round(restPct * 10) / 10 }] : []),
  ];
  return (
    <WidgetCard title="Spending by category" description="Net of refunds · largest first" href="/reports?tab=categories" linkLabel="Details">
      {chart.length === 0 ? (
        <EmptyState compact icon={<ChartPie />} title="Nothing spent yet" description="Categorized expenses for this period will appear here." />
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-col">
          <DonutChart slices={chart} total={Number(data.categoryTotal)} size={168} />
          <ul className="w-full space-y-2">
            {chart.map((c) => (
              <li key={c.name} className="flex items-center gap-2.5 text-[13px]">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slotVar(c.color) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="num w-11 text-right text-meta text-muted-foreground">{c.percent}%</span>
                <Money value={c.amount} className="w-24 text-right font-medium" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

const LEVEL_TONE = { ok: "accent", watch: "warning", warning: "warning", over: "negative" } as const;
const LEVEL_LABEL = { ok: "On track", watch: "Watch", warning: "Near limit", over: "Over budget" } as const;

function BudgetsWidget({ data }: { data: OverviewData }) {
  return (
    <WidgetCard title="Budgets" description="This period" href="/budgets">
      {data.budgets.length === 0 ? (
        <EmptyState
          compact
          icon={<PiggyBank />}
          title="No budgets yet"
          description="Set a monthly limit for a category or your overall spending."
          action={
            <Button size="sm" asChild>
              <Link href="/budgets?new=1">Create budget</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-4">
          {data.budgets.map((b) => (
            <li key={b.id}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Icon name={b.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="text-meta text-muted-foreground">
                  <Money value={b.spent} className="font-medium text-foreground" /> / <Money value={b.available} />
                </span>
              </div>
              <ProgressBar value={b.percent} tone={LEVEL_TONE[b.level]} label={`${b.name}: ${b.percent}% used`} />
              <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
                <span className={cn(b.level === "over" && "text-negative", (b.level === "warning" || b.level === "watch") && "text-warning")}>
                  {LEVEL_LABEL[b.level]} · {b.percent}%{b.forecastOver && b.level !== "over" ? " · pace exceeds budget" : ""}
                </span>
                <span>
                  {Number(b.remaining) >= 0 ? (
                    <>
                      <Money value={b.remaining} className="text-[11.5px]" /> left · {b.daysLeft}d
                    </>
                  ) : (
                    <>
                      <Money value={String(-Number(b.remaining))} className="text-[11.5px] text-negative" /> over
                    </>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function InsightsWidget({ data }: { data: OverviewData }) {
  const toneIcon = { positive: CircleCheck, negative: TrendingDown, warning: AlertTriangle, neutral: Lightbulb };
  const toneCls = { positive: "text-positive", negative: "text-negative", warning: "text-warning", neutral: "text-info" };
  return (
    <WidgetCard title="Insights" description="Calculated from your transactions — not estimates" href="/assistant" linkLabel="Ask assistant">
      {data.insights.length === 0 ? (
        <EmptyState compact icon={<Lightbulb />} title="Insights need a little history" description="Add a few weeks of income and spending to see trends and comparisons." />
      ) : (
        <ul className="space-y-3">
          {data.insights.slice(0, 5).map((i, idx) => {
            const I = toneIcon[i.tone];
            return (
              <li key={idx} className="flex gap-2.5 text-[13px] leading-relaxed">
                <I className={cn("mt-0.5 size-4 shrink-0", toneCls[i.tone])} aria-hidden />
                <span>{i.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

function RecentWidget({ data }: { data: OverviewData }) {
  const quick = useQuickAdd();
  return (
    <WidgetCard title="Recent transactions" href="/transactions">
      {data.recent.length === 0 ? (
        <EmptyState
          compact
          icon={<Receipt />}
          title="No transactions yet"
          description="Add your first transaction or import a bank statement to get started."
          action={
            <Button size="sm" variant="primary" onClick={() => quick.open()}>
              <Plus /> Add transaction
            </Button>
          }
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {data.recent.map((t) => (
            <TransactionRow key={t.id} t={t} compact />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function BillsWidget({ data }: { data: OverviewData }) {
  const f = useFormat();
  return (
    <WidgetCard title="Upcoming bills" description={<>Monthly obligations <Money value={data.billsMonthly} className="text-meta" /></>} href="/bills">
      {data.bills.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarClock />}
          title="No bills in the next 30 days"
          description="Track rent, utilities and other obligations to get reminders."
          action={
            <Button size="sm" asChild>
              <Link href="/bills?new=1">Add bill</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-1">
          {data.bills.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <div className={cn("flex w-10 shrink-0 flex-col items-center rounded-md border py-0.5 text-center", b.state === "overdue" ? "border-negative/40 text-negative" : "border-border")}>
                <span className="text-[10px] font-medium uppercase">{f.date(b.dueDate, { month: "short" })}</span>
                <span className="num text-[14px] leading-4 font-semibold">{f.date(b.dueDate, { day: "numeric" })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{b.name}</p>
                <p className={cn("text-[11.5px]", b.state === "overdue" ? "text-negative" : b.state === "due-soon" ? "text-warning" : "text-muted-foreground")}>
                  {b.state === "overdue" ? `Overdue by ${-b.daysUntil}d` : b.daysUntil === 0 ? "Due today" : `Due in ${b.daysUntil}d`}
                </p>
              </div>
              <Money value={b.amount} currency={b.currency} className="text-[13px] font-medium" />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function GoalsWidget({ data }: { data: OverviewData }) {
  return (
    <WidgetCard title="Savings goals" href="/goals">
      {data.goals.length === 0 ? (
        <EmptyState
          compact
          icon={<Target />}
          title="No goals yet"
          description="Plan for an emergency fund, a trip or a big purchase."
          action={
            <Button size="sm" asChild>
              <Link href="/goals?new=1">Create goal</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-4">
          {data.goals.map((g) => (
            <li key={g.id}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Icon name={g.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{g.name}</span>
                </span>
                <span className="num text-meta text-muted-foreground">{g.percent}%</span>
              </div>
              <ProgressBar value={g.percent} tone="positive" label={`${g.name}: ${g.percent}% funded`} />
              <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
                <span>
                  <Money value={g.saved} currency={g.currency} className="text-[11.5px]" /> of <Money value={g.target} currency={g.currency} className="text-[11.5px]" />
                </span>
                <span>{g.basis === "linked-account" ? "Account balance" : "Tracked manually"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function SubscriptionsWidget({ data }: { data: OverviewData }) {
  const f = useFormat();
  const s = data.subscriptions;
  return (
    <WidgetCard title="Subscriptions" description={`${s.activeCount} active`} href="/subscriptions">
      {s.activeCount === 0 ? (
        <EmptyState
          compact
          icon={<Repeat />}
          title="No subscriptions tracked"
          description="Finora can detect recurring charges from your history."
          action={
            <Button size="sm" asChild>
              <Link href="/subscriptions">Find subscriptions</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3">
            <div>
              <p className="text-meta text-muted-foreground">Monthly</p>
              <Money value={s.monthly} className="text-[15px] font-semibold" />
            </div>
            <div>
              <p className="text-meta text-muted-foreground">Annualized</p>
              <Money value={s.annual} className="text-[15px] font-semibold" />
            </div>
          </div>
          {s.changed > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-meta text-warning">
              <AlertTriangle className="size-3.5" /> {s.changed} subscription{s.changed === 1 ? "" : "s"} changed price recently
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {s.upcoming.map((u) => (
              <li key={u.id} className="flex items-center justify-between text-[13px]">
                <span className="truncate">{u.name}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="text-meta">{f.date(u.nextDate, { day: "numeric", month: "short" })}</span>
                  <Money value={u.amount} currency={u.currency} className="font-medium text-foreground" />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

function AccountsWidget({ data }: { data: OverviewData }) {
  return (
    <WidgetCard title="Accounts" href="/accounts">
      {data.accounts.length === 0 ? (
        <EmptyState
          compact
          icon={<Landmark />}
          title="No accounts yet"
          description="Add a bank account, card, wallet or cash."
          action={
            <Button size="sm" variant="primary" asChild>
              <Link href="/accounts?new=1">Create account</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-1">
          {data.accounts.map((a) => (
            <li key={a.id}>
              <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                <CategoryIcon icon={a.type === "CREDIT_CARD" ? "credit-card" : a.type === "CASH" ? "wallet" : a.type === "INVESTMENT" ? "trending-up" : a.type === "LOAN" ? "landmark" : "building"} color="other" className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{a.name}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">{a.institution ?? a.type.replace("_", " ").toLowerCase()}</span>
                </span>
                <Money value={a.balance} currency={a.currency} className="text-[13px] font-medium" tone={Number(a.balance) < 0 ? "negative" : "neutral"} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function TimelineWidget({ data }: { data: OverviewData }) {
  const f = useFormat();
  return (
    <WidgetCard title="Activity timeline" description="Last 30 days">
      {data.timeline.length === 0 ? (
        <EmptyState compact icon={<Activity />} title="No recent activity" />
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-4">
          {data.timeline.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute top-1.5 -left-[20.5px] size-2 rounded-full border-2 border-surface bg-border-strong ring-1 ring-border" aria-hidden />
              <div className="flex items-start justify-between gap-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {f.date(e.date, { day: "numeric", month: "short" })} · {e.kind}
                  </span>
                </span>
                <Money value={e.amount} currency={e.currency} showSign className="text-[13px]" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </WidgetCard>
  );
}

function Onboarding({ o }: { o: OverviewData["onboarding"] }) {
  const quick = useQuickAdd();
  const router = useRouter();
  const steps = [
    { done: o.hasAccount, label: "Create an account", desc: "Bank, card, wallet or cash", href: "/accounts?new=1" },
    { done: o.hasTransaction, label: "Add your first transaction", desc: "Or press N anywhere", onClick: () => quick.open() },
    { done: o.hasBudget, label: "Set a monthly budget", desc: "For a category or overall", href: "/budgets?new=1" },
    { done: o.hasImport, label: "Import a bank statement", desc: "CSV or Excel", href: "/import" },
    { done: o.hasGoal, label: "Create a savings goal", desc: "Emergency fund, travel…", href: "/goals?new=1" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div>
          <h2 className="text-section font-semibold">Set up Finora</h2>
          <p className="text-meta text-muted-foreground">
            {done} of {steps.length} complete — every number you see is calculated from what you add here.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss setup guide"
          onClick={async () => {
            await dismissOnboardingAction();
            router.refresh();
          }}
        >
          <X />
        </Button>
      </div>
      <div className="px-5 pt-3">
        <ProgressBar value={(done / steps.length) * 100} label="Setup progress" size="sm" />
      </div>
      <ol className="grid gap-px p-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => {
          const inner = (
            <>
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", s.done ? "border-accent bg-accent text-accent-foreground" : "border-border-strong text-muted-foreground")}>
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13px] font-medium", s.done && "text-muted-foreground line-through")}>{s.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{s.desc}</span>
              </span>
            </>
          );
          const cls = "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:bg-surface-2";
          return (
            <li key={s.label}>
              {s.href ? (
                <Link href={s.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button className={cls} onClick={s.onClick}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function CustomizeDialog({ open, onOpenChange, layout }: { open: boolean; onOpenChange: (o: boolean) => void; layout: OverviewData["layout"] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(layout);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) setItems(layout);
  }, [open, layout]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>Reorder or hide widgets. The summary cards always stay visible.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="space-y-1.5 pb-3">
            {items.map((w, i) => (
              <li key={w.id} className={cn("flex items-center gap-2 rounded-lg border border-border px-3 py-2", w.hidden && "opacity-55")}>
                <span className="flex-1 text-[13px] font-medium">{WIDGET_LABELS[w.id]}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${WIDGET_LABELS[w.id]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${WIDGET_LABELS[w.id]} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={w.hidden ? `Show ${WIDGET_LABELS[w.id]}` : `Hide ${WIDGET_LABELS[w.id]}`}
                  aria-pressed={!w.hidden}
                  onClick={() => setItems(items.map((x) => (x.id === w.id ? { ...x, hidden: !x.hidden } : x)))}
                >
                  {w.hidden ? <EyeOff /> : <Eye />}
                </Button>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setItems(items.map((x) => ({ ...x, hidden: false })))}>
            Show all
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const r = await saveDashboardLayoutAction(items);
              setSaving(false);
              if (r.ok) {
                toast.success("Dashboard updated");
                onOpenChange(false);
                router.refresh();
              } else toast.error(r.error);
            }}
          >
            Save layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

