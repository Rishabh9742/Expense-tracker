"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CircleCheck, Lightbulb, MoreHorizontal, Pencil, PiggyBank, Plus, Trash2, Wallet, OctagonAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, ProgressBar } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, EmptyState, PageHeader, StatRow } from "@/components/finance/primitives";
import { Icon } from "@/components/finance/icons";
import { useAppData } from "@/components/shell/app-shell";
import { CategorySelect } from "@/components/transactions/transaction-form";
import { deleteBudgetAction, saveBudgetAction, setPeriodAllocationAction, type BudgetFormValues } from "@/server/actions/budgets";
import { cn } from "@/lib/utils";

interface BudgetRow {
  id: string;
  name: string;
  scope: string;
  method: string;
  period: string;
  amount: string;
  percentOfIncome: string | null;
  categoryId: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountId: string | null;
  accountName: string | null;
  merchant: string | null;
  startDate: string;
  endDate: string | null;
  alertLevels: number[];
  periodStart: string;
  periodEnd: string;
  budgeted: string;
  rollover: string;
  available: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  daysLeft: number;
  dailyAllowance: string;
  forecast: string;
  forecastOver: boolean;
  level: "ok" | "watch" | "warning" | "over";
  thresholdReached: number | null;
}

const METHOD_LABEL: Record<string, string> = {
  FIXED: "Fixed",
  ZERO_BASED: "Zero-based",
  ENVELOPE: "Envelope",
  PERCENTAGE: "% of income",
  ROLLOVER: "Rollover",
};
const METHOD_HELP: Record<string, string> = {
  FIXED: "Same limit every period. Unused money doesn't carry over.",
  ZERO_BASED: "Give every unit of income a job — Finora shows what's still unassigned this month.",
  ENVELOPE: "Unused funds carry forward, and overspending reduces the next period's envelope.",
  PERCENTAGE: "Limit is a percentage of the income you actually received in the period.",
  ROLLOVER: "Unused funds carry forward. Overspending is not carried.",
};
const LEVEL = {
  ok: { tone: "accent" as const, label: "On track", icon: CircleCheck, cls: "text-positive" },
  watch: { tone: "warning" as const, label: "Watch", icon: AlertTriangle, cls: "text-warning" },
  warning: { tone: "warning" as const, label: "Near limit", icon: AlertTriangle, cls: "text-warning" },
  over: { tone: "negative" as const, label: "Over budget", icon: OctagonAlert, cls: "text-negative" },
};

export function BudgetsView({
  budgets,
  income,
  unassigned,
  allocated,
  monthLabel,
  suggestions,
  autoNew,
}: {
  budgets: BudgetRow[];
  income: string;
  unassigned: string;
  allocated: string;
  monthLabel: string;
  suggestions: { categoryId: string; name: string; icon: string; monthlyAverage: string }[];
  autoNew: boolean;
}) {
  const [editing, setEditing] = React.useState<BudgetRow | "new" | Partial<BudgetFormValues> | null>(autoNew ? "new" : null);
  const hasZeroBased = budgets.some((b) => b.method === "ZERO_BASED");
  const over = budgets.filter((b) => b.level === "over");

  return (
    <div>
      <PageHeader
        title="Budgets"
        description={`Spending limits for ${monthLabel}. Refunds reduce spending; transfers never count.`}
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> New budget
          </Button>
        }
      />

      {budgets.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="px-4 py-3">
            <p className="text-meta text-muted-foreground">Income received · {monthLabel}</p>
            <Money value={income} className="mt-1 block text-[18px] font-semibold" />
          </Card>
          <Card className="px-4 py-3">
            <p className="text-meta text-muted-foreground">Allocated to monthly budgets</p>
            <Money value={allocated} className="mt-1 block text-[18px] font-semibold" />
          </Card>
          <Card className={cn("px-4 py-3", hasZeroBased && Number(unassigned) !== 0 && "border-warning/40")}>
            <p className="text-meta text-muted-foreground">{Number(unassigned) >= 0 ? "Unassigned income" : "Over-assigned"}</p>
            <Money value={String(Math.abs(Number(unassigned)))} className={cn("mt-1 block text-[18px] font-semibold", Number(unassigned) < 0 && "text-negative")} />
            {hasZeroBased && <p className="text-[11.5px] text-muted-foreground">{Number(unassigned) === 0 ? "Every unit has a job." : "Zero-based target: assign until this reaches 0."}</p>}
          </Card>
        </div>
      )}

      {over.length > 0 && (
        <Card className="mb-6 border-negative/30 p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-negative">
            <OctagonAlert className="size-4" /> {over.length} budget{over.length === 1 ? " is" : "s are"} over the limit
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
            {over.map((b) => (
              <li key={b.id}>
                {b.name}: over by <Money value={String(-Number(b.remaining))} className="font-medium text-foreground" />.{" "}
                {b.method === "ENVELOPE" ? "The overspend will reduce next period's envelope." : "Consider moving funds from a budget with room, or raising this limit."}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PiggyBank />}
            title="Create your first budget"
            description="Set a monthly limit for a category like Dining, for an account, a merchant, or your overall spending."
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus /> New budget
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {budgets.map((b) => (
            <BudgetCard key={b.id} b={b} onEdit={() => setEditing(b)} />
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 flex items-center gap-2 text-section font-semibold">
            <Lightbulb className="size-4 text-info" /> Suggested budgets
          </h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Based on your average monthly spending over the last 3 full months in categories without a budget.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {suggestions.map((s) => (
              <Card key={s.categoryId} className="flex items-center gap-3 p-3">
                <CategoryIcon icon={s.icon} color="other" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{s.name}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    Avg <Money value={s.monthlyAverage} className="text-[11.5px]" /> / month
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setEditing({ name: s.name, scope: "CATEGORY", categoryId: s.categoryId, amount: String(Math.ceil(Number(s.monthlyAverage) / 100) * 100), method: "FIXED", period: "MONTHLY" })
                  }
                >
                  Add
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing && typeof editing === "object" && "id" in editing ? "Edit budget" : "New budget"}</DialogTitle>
            <DialogDescription>Alerts are sent when spending crosses the thresholds you choose.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing !== null && <BudgetForm initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BudgetCard({ b, onEdit }: { b: BudgetRow; onEdit: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const [fund, setFund] = React.useState(false);
  const L = LEVEL[b.level];
  const scopeLabel = b.scope === "OVERALL" ? "All spending" : b.scope === "ACCOUNT" ? `Account · ${b.accountName}` : b.scope === "MERCHANT" ? `Merchant · ${b.merchant}` : "Category";
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2.5">
          {b.categoryIcon ? <CategoryIcon icon={b.categoryIcon} color={b.categoryColor} /> : <CategoryIcon icon={b.scope === "ACCOUNT" ? "wallet" : "piggy-bank"} color="other" />}
          <div className="min-w-0">
            <CardTitle className="truncate">{b.name}</CardTitle>
            <CardDescription>
              {scopeLabel} · {b.period.toLowerCase()} · {METHOD_LABEL[b.method]}
            </CardDescription>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFund(true)}>
              <Wallet /> Adjust this period
            </DropdownMenuItem>
            {b.categoryId && (
              <DropdownMenuItem asChild>
                <Link href={`/transactions?categoryId=${b.categoryId}&from=${b.periodStart.slice(0, 10)}`}>
                  <Icon name="receipt" /> View transactions
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <Money value={b.spent} className="text-[22px] font-semibold" />
          <span className="text-[13px] text-muted-foreground">
            of <Money value={b.available} />
          </span>
        </div>
        <ProgressBar value={b.percentUsed} tone={L.tone} label={`${b.name}: ${b.percentUsed}% used`} className="mt-2.5" />
        {/* Threshold ticks */}
        <div className="relative mt-1 h-3">
          {b.alertLevels
            .filter((l) => l < 100)
            .map((l) => (
              <span key={l} className="absolute top-0 h-1.5 w-px bg-border-strong" style={{ left: `${l}%` }} title={`Alert at ${l}%`} aria-hidden />
            ))}
        </div>
        <p className={cn("flex items-center gap-1.5 text-[12.5px] font-medium", L.cls)}>
          <L.icon className="size-3.5" /> {L.label} · {b.percentUsed}% used
        </p>
        <div className="mt-3 border-t border-border pt-2">
          <StatRow label={Number(b.remaining) >= 0 ? "Remaining" : "Over by"} value={<Money value={String(Math.abs(Number(b.remaining)))} tone={Number(b.remaining) < 0 ? "negative" : "neutral"} />} />
          <StatRow label="Daily allowance" value={<span>{f.money(b.dailyAllowance)} <span className="font-normal text-muted-foreground">· {b.daysLeft}d left</span></span>} />
          <StatRow
            label="Forecast at period end"
            value={
              <span className={cn(b.forecastOver && "text-warning")}>
                {f.money(b.forecast)}
                {b.forecastOver && <AlertTriangle className="ml-1 inline size-3.5" aria-label="Forecast exceeds budget" />}
              </span>
            }
          />
          {Number(b.rollover) !== 0 && <StatRow label="Rolled over" value={<Money value={b.rollover} showSign />} />}
          {b.method === "PERCENTAGE" && <StatRow label="Rule" value={`${Number(b.percentOfIncome)}% of income`} />}
        </div>
        {b.forecastOver && b.level !== "over" && Number(b.remaining) > 0 && (
          <p className="mt-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
            At this pace you&apos;ll exceed the budget. Keep daily spending under {f.money(b.dailyAllowance)} to stay on track.
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete the ${b.name} budget?`}
        description="Your transactions are not affected."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const r = await deleteBudgetAction(b.id);
          setConfirm(false);
          if (r.ok) {
            toast.success("Budget deleted");
            router.refresh();
          } else toast.error(r.error);
        }}
      />
      <FundDialog b={b} open={fund} onOpenChange={setFund} />
    </Card>
  );
}

function FundDialog({ b, open, onOpenChange }: { b: BudgetRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const f = useFormat();
  const [val, setVal] = React.useState(b.budgeted);
  const save = async (v: string | null) => {
    const r = await setPeriodAllocationAction(b.id, b.periodStart, b.periodEnd, v);
    if (r.ok) {
      toast.success(v === null ? "Reset to default" : "Period allocation updated");
      onOpenChange(false);
      router.refresh();
    } else toast.error(r.error);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Adjust this period</DialogTitle>
          <DialogDescription>
            Override the allocation for {f.date(b.periodStart, { day: "numeric", month: "short" })} – {f.date(new Date(new Date(b.periodEnd).getTime() - 1), { day: "numeric", month: "short" })} only. Future periods keep the default.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-4">
          <Field label="Allocation for this period" htmlFor="fund">
            <Input id="fund" inputMode="decimal" className="num" value={val} onChange={(e) => setVal(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => save(null)}>
            Reset to default
          </Button>
          <Button variant="primary" onClick={() => save(val)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BudgetForm({ initial, onDone }: { initial?: BudgetRow | Partial<BudgetFormValues>; onDone: () => void }) {
  const router = useRouter();
  const { categories, accounts } = useAppData();
  const isRow = initial && "id" in initial;
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const [v, setV] = React.useState<BudgetFormValues>(() => {
    if (isRow) {
      const r = initial as BudgetRow;
      return {
        name: r.name,
        scope: r.scope as BudgetFormValues["scope"],
        method: r.method as BudgetFormValues["method"],
        period: r.period as BudgetFormValues["period"],
        amount: String(Number(r.amount)),
        percentOfIncome: r.percentOfIncome ? String(Number(r.percentOfIncome)) : "",
        categoryId: r.categoryId,
        accountId: r.accountId,
        merchant: r.merchant,
        startDate: r.startDate.slice(0, 10),
        endDate: r.endDate?.slice(0, 10) ?? "",
        alertLevels: r.alertLevels,
      };
    }
    return {
      name: "",
      scope: "CATEGORY",
      method: "FIXED",
      period: "MONTHLY",
      amount: "",
      percentOfIncome: "",
      categoryId: null,
      accountId: null,
      merchant: "",
      startDate: monthStart,
      endDate: "",
      alertLevels: [50, 75, 90, 100],
      ...(initial as Partial<BudgetFormValues>),
    };
  });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  const set = <K extends keyof BudgetFormValues>(k: K, val: BudgetFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBudgetAction(isRow ? (initial as BudgetRow).id : null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            return;
          }
          toast.success(isRow ? "Budget updated" : "Budget created");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget applies to" htmlFor="b-scope">
          <NativeSelect id="b-scope" value={v.scope} onChange={(e) => set("scope", e.target.value as BudgetFormValues["scope"])}>
            <option value="CATEGORY">A category (includes subcategories)</option>
            <option value="OVERALL">All spending</option>
            <option value="ACCOUNT">An account</option>
            <option value="MERCHANT">A merchant</option>
          </NativeSelect>
        </Field>
        {v.scope === "CATEGORY" && (
          <Field label="Category" htmlFor="b-cat" error={errors.categoryId?.[0]}>
            <CategorySelect
              id="b-cat"
              categories={categories}
              kind="EXPENSE"
              includeEmpty
              value={v.categoryId}
              onChange={(c) => {
                set("categoryId", c);
                if (!v.name && c) set("name", categories.find((x) => x.id === c)?.name ?? "");
              }}
            />
          </Field>
        )}
        {v.scope === "ACCOUNT" && (
          <Field label="Account" htmlFor="b-acct" error={errors.accountId?.[0]}>
            <NativeSelect id="b-acct" value={v.accountId ?? ""} onChange={(e) => set("accountId", e.target.value || null)}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {v.scope === "MERCHANT" && (
          <Field label="Merchant" htmlFor="b-merch" error={errors.merchant?.[0]}>
            <Input id="b-merch" value={v.merchant ?? ""} onChange={(e) => set("merchant", e.target.value)} placeholder="e.g. Swiggy" />
          </Field>
        )}
      </div>
      <Field label="Name" htmlFor="b-name" error={errors.name?.[0]}>
        <Input id="b-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Dining out" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Method" htmlFor="b-method" hint={METHOD_HELP[v.method]}>
          <NativeSelect id="b-method" value={v.method} onChange={(e) => set("method", e.target.value as BudgetFormValues["method"])}>
            {Object.entries(METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Period" htmlFor="b-period">
          <NativeSelect id="b-period" value={v.period} onChange={(e) => set("period", e.target.value as BudgetFormValues["period"])}>
            <option value="MONTHLY">Monthly</option>
            <option value="WEEKLY">Weekly</option>
            <option value="CUSTOM">Custom date range</option>
          </NativeSelect>
        </Field>
        {v.method === "PERCENTAGE" ? (
          <Field label="Percent of income" htmlFor="b-pct" error={errors.percentOfIncome?.[0]}>
            <Input id="b-pct" inputMode="decimal" className="num" value={v.percentOfIncome ?? ""} onChange={(e) => set("percentOfIncome", e.target.value)} placeholder="30" />
          </Field>
        ) : (
          <Field label={`Amount per ${v.period === "WEEKLY" ? "week" : v.period === "CUSTOM" ? "range" : "month"}`} htmlFor="b-amt" error={errors.amount?.[0]}>
            <Input id="b-amt" inputMode="decimal" className="num" value={v.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
          </Field>
        )}
        <Field label="Starts" htmlFor="b-start">
          <Input id="b-start" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        {v.period === "CUSTOM" && (
          <Field label="Ends" htmlFor="b-end" error={errors.endDate?.[0]}>
            <Input id="b-end" type="date" value={v.endDate ?? ""} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        )}
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Alert me at</legend>
        <div className="flex flex-wrap gap-4">
          {[50, 75, 90, 100].map((l) => (
            <label key={l} className="flex items-center gap-2 text-[13px]">
              <Checkbox
                checked={v.alertLevels.includes(l)}
                onCheckedChange={(c) => set("alertLevels", c ? [...v.alertLevels, l] : v.alertLevels.filter((x) => x !== l))}
              />
              {l}%
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isRow ? "Save budget" : "Create budget"}
        </Button>
      </div>
    </form>
  );
}

