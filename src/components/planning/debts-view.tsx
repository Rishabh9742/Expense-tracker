"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, HandCoins, Link2, MoreHorizontal, Pencil, Plus, Trash2, Info, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, ProgressBar, Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { EmptyState, MetricCard, Notice, PageHeader } from "@/components/finance/primitives";
import { LineSeriesChart } from "@/components/charts/charts";
import { useAppData } from "@/components/shell/app-shell";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { simulatePayoff, type PayoffStrategy } from "@/lib/finance/debt";
import { deleteDebtAction, recordDebtPaymentAction, reorderDebtsAction, saveDebtAction, type DebtFormValues } from "@/server/actions/planning";
import { isoToYmd, todayYmd } from "@/components/schedules/shared";
import { cn } from "@/lib/utils";

interface Debt {
  id: string;
  name: string;
  type: string;
  lender: string | null;
  currency: string;
  originalPrincipal: string;
  currentBalance: string;
  balance: string;
  baseBalance: string | null;
  balanceSource: "account" | "manual";
  interestRate: string | null;
  minimumPayment: string | null;
  dueDay: number | null;
  startDate: string | null;
  termMonths: number | null;
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  customOrder: number;
  notes: string | null;
  closedAt: string | null;
  progress: number;
  payments: { id: string; date: string; amount: string; principal: string | null; interest: string | null; isExtra: boolean }[];
}

const TYPE_LABEL: Record<string, string> = {
  CREDIT_CARD: "Credit card",
  PERSONAL_LOAN: "Personal loan",
  EDUCATION_LOAN: "Education loan",
  VEHICLE_LOAN: "Vehicle loan",
  MORTGAGE: "Mortgage",
  OTHER: "Other",
};

export function DebtsView({ debts, total, totalMinimum, autoNew }: { debts: Debt[]; total: string; totalMinimum: string; autoNew: boolean }) {
  const [editing, setEditing] = React.useState<Debt | "new" | null>(autoNew ? "new" : null);
  const [paying, setPaying] = React.useState<Debt | null>(null);
  const open = debts.filter((d) => !d.closedAt);
  const closed = debts.filter((d) => d.closedAt);
  const weightedApr = (() => {
    const known = open.filter((d) => d.interestRate !== null && d.baseBalance);
    const tot = known.reduce((a, d) => a + Number(d.baseBalance), 0);
    return tot > 0 ? known.reduce((a, d) => a + Number(d.interestRate) * Number(d.baseBalance), 0) / tot : null;
  })();

  return (
    <div>
      <PageHeader
        title="Debts & Loans"
        description="Track what you owe and compare repayment strategies. Projections are estimates based on the terms you enter."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Add debt
          </Button>
        }
      />
      {debts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins />}
            title="No debts tracked"
            description="Add credit cards, personal, education or vehicle loans, or a mortgage to see payoff timelines and compare strategies."
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus /> Add debt
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Total owed" value={<Money value={total} />} sub={<span>{open.length} open</span>} footnote="Converted to your base currency. Debts linked to a loan/card account use that account's balance." />
            <MetricCard label="Minimum payments" value={<Money value={totalMinimum} />} sub={<span>per month</span>} />
            <MetricCard label="Weighted APR" value={<span className="num">{weightedApr === null ? "—" : `${weightedApr.toFixed(2)}%`}</span>} sub={<span>Balance-weighted, known rates only</span>} />
            <MetricCard label="Paid off" value={<span className="num">{closed.length}</span>} sub={<span>closed debts</span>} />
          </div>
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              {open.map((d, i) => (
                <DebtCard key={d.id} d={d} onEdit={() => setEditing(d)} onPay={() => setPaying(d)} index={i} all={open} />
              ))}
              {closed.length > 0 && (
                <Card className="p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted-foreground">Paid off</p>
                  <ul className="space-y-1 text-[13px]">
                    {closed.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <CircleCheck className="size-4 text-positive" /> {d.name}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
            <div className="lg:col-span-7">{open.length > 0 && <PayoffPlanner debts={open} />}</div>
          </div>
        </>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add debt" : "Edit debt"}</DialogTitle>
            <DialogDescription>Leave interest rate empty if you don&apos;t know it — projections will say so.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing && <DebtForm initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      {paying && <PaymentDialog debt={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function DebtCard({ d, onEdit, onPay, index, all }: { d: Debt; onEdit: () => void; onPay: () => void; index: number; all: Debt[] }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const move = async (dir: -1 | 1) => {
    const ids = all.map((x) => x.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderDebtsAction(ids);
    router.refresh();
  };
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
            {d.name}
            {d.balanceSource === "account" && (
              <Badge variant="outline">
                <Link2 /> {d.linkedAccountName}
              </Badge>
            )}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {TYPE_LABEL[d.type]}
            {d.lender ? ` · ${d.lender}` : ""} · {d.interestRate !== null ? `${Number(d.interestRate)}% APR` : "APR unknown"}
            {d.dueDay ? ` · due day ${d.dueDay}` : ""}
          </p>
        </div>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label="Move up in custom order" onClick={() => move(-1)} disabled={index === 0}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Move down in custom order" onClick={() => move(1)} disabled={index === all.length - 1}>
            <ArrowDown />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <Money value={d.balance} currency={d.currency} className="text-[20px] font-semibold" />
        <span className="text-[12px] text-muted-foreground">
          of <Money value={d.originalPrincipal} currency={d.currency} className="text-[12px]" /> original
        </span>
      </div>
      <ProgressBar value={d.progress} tone="positive" label={`${d.name}: ${d.progress}% repaid`} className="mt-2" />
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{d.progress}% repaid</span>
        {d.minimumPayment && (
          <span>
            Min <Money value={d.minimumPayment} currency={d.currency} className="text-[11.5px]" />
            /mo
          </span>
        )}
      </div>
      {d.payments.length > 0 && (
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Payment history ({d.payments.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {d.payments.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>
                  {f.date(p.date)} {p.isExtra && <Badge variant="accent">extra</Badge>}
                </span>
                <span>
                  <Money value={p.amount} currency={d.currency} />
                  {p.interest && <span className="text-muted-foreground"> · {f.money(p.interest, d.currency)} interest</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Button size="sm" variant="primary" className="mt-3 w-full" onClick={onPay}>
        Record payment
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${d.name}?`}
        description="Payment history for this debt is deleted. Recorded transactions are kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteDebtAction(d.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </Card>
  );
}

const STRATEGY_INFO: Record<PayoffStrategy, { label: string; desc: string }> = {
  avalanche: { label: "Avalanche", desc: "Highest interest rate first — usually the least total interest." },
  snowball: { label: "Snowball", desc: "Smallest balance first — quicker early wins." },
  custom: { label: "Your order", desc: "The order you set with the arrows on the left." },
};

function PayoffPlanner({ debts }: { debts: Debt[] }) {
  const f = useFormat();
  const [extra, setExtra] = React.useState("0");
  const [strategy, setStrategy] = React.useState<PayoffStrategy>("avalanche");
  // Mixed currencies are simulated in base currency using each debt's converted balance.
  const sameCurrency = debts.every((d) => d.currency === debts[0].currency);
  const inputs = debts.map((d) => {
    const ratio = !sameCurrency && d.baseBalance && Number(d.balance) !== 0 ? Number(d.baseBalance) / Number(d.balance) : 1;
    return {
      id: d.id,
      name: d.name,
      balance: sameCurrency ? d.balance : d.baseBalance ?? d.balance,
      apr: d.interestRate,
      minimumPayment: d.minimumPayment ? String(Number(d.minimumPayment) * ratio) : null,
      customOrder: d.customOrder,
    };
  });
  const cur = sameCurrency ? debts[0].currency : f.currency;
  const extraNum = Number(extra) || 0;
  const results = (["avalanche", "snowball", "custom"] as PayoffStrategy[]).map((s) => simulatePayoff(inputs, s, extraNum));
  const chosen = results.find((r) => r.strategy === strategy)!;
  const baseline = simulatePayoff(inputs, strategy, 0);
  const chart = chosen.schedule.filter((_, i) => i % Math.max(1, Math.ceil(chosen.schedule.length / 60)) === 0 || i === chosen.schedule.length - 1).map((p) => ({ label: p.month === 0 ? "Now" : `M${p.month}`, balance: p.totalBalance.toDecimalPlaces(2).toNumber() }));
  const best = [...results].filter((r) => r.months !== null).sort((a, b) => a.totalInterest.comparedTo(b.totalInterest))[0];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Payoff planner</CardTitle>
          <CardDescription>Estimates based on the balances, rates and minimums you entered{!sameCurrency ? ` · simulated in ${f.currency}` : ""}.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={`Extra payment per month (${cur})`} htmlFor="extra" hint="On top of all minimum payments">
            <Input id="extra" inputMode="decimal" className="num" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
          <Tabs value={strategy} onValueChange={(v) => setStrategy(v as PayoffStrategy)}>
            <TabsList>
              {(Object.keys(STRATEGY_INFO) as PayoffStrategy[]).map((s) => (
                <TabsTrigger key={s} value={s}>
                  {STRATEGY_INFO[s].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <p className="text-[12.5px] text-muted-foreground">{STRATEGY_INFO[strategy].desc}</p>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Strategy comparison</caption>
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 font-medium">Strategy</th>
                <th className="py-2 text-right font-medium">Debt-free in</th>
                <th className="py-2 text-right font-medium">Total interest</th>
                <th className="py-2 text-right font-medium">Total paid</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.strategy} className={cn("border-b border-border last:border-0", r.strategy === strategy && "bg-surface-2/60")}>
                  <td className="py-2 font-medium">
                    {STRATEGY_INFO[r.strategy].label}
                    {best?.strategy === r.strategy && (
                      <Badge variant="positive" className="ml-2">
                        Lowest interest
                      </Badge>
                    )}
                  </td>
                  <td className="num py-2 text-right">{r.months === null ? "Not within 50 yrs" : `${Math.floor(r.months / 12) ? `${Math.floor(r.months / 12)}y ` : ""}${r.months % 12}m`}</td>
                  <td className="py-2 text-right">
                    <Money value={r.totalInterest.toFixed(2)} currency={cur} />
                  </td>
                  <td className="py-2 text-right">
                    <Money value={r.totalPaid.toFixed(2)} currency={cur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {extraNum > 0 && baseline.months !== null && chosen.months !== null && (
          <Notice tone="positive" icon={<CircleCheck />}>
            Paying {f.money(extraNum, cur)} extra each month could make you debt-free about {baseline.months - chosen.months} months sooner and save roughly {f.money(baseline.totalInterest.minus(chosen.totalInterest).toFixed(2), cur)} in interest.
          </Notice>
        )}

        <LineSeriesChart data={chart} series={[{ key: "balance", label: "Total balance", color: "var(--chart-1)" }]} areaKey="debt" height={220} description={`Projected total debt balance under the ${STRATEGY_INFO[strategy].label} strategy`} />

        <div>
          <h3 className="mb-2 text-[13px] font-semibold">Payoff order</h3>
          <ol className="space-y-1.5">
            {[...chosen.perDebt]
              .sort((a, b) => (a.payoffMonth ?? 1e9) - (b.payoffMonth ?? 1e9))
              .map((p, i) => (
                <li key={p.id} className="flex items-center justify-between text-[13px]">
                  <span>
                    <span className="num mr-2 text-muted-foreground">{i + 1}.</span>
                    {p.name}
                  </span>
                  <span className="text-muted-foreground">
                    {p.payoffMonth === null ? "—" : `month ${p.payoffMonth}`} · {f.money(p.interest.toFixed(2), cur)} interest
                  </span>
                </li>
              ))}
          </ol>
        </div>

        {chosen.warnings.length > 0 && (
          <Notice tone="warning" icon={<AlertTriangle />}>
            <ul className="space-y-0.5">
              {[...new Set(chosen.warnings)].map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
        <p className="flex items-start gap-1.5 text-meta text-subtle-foreground">
          <Info className="mt-0.5 size-3 shrink-0" /> Estimates only. Interest is modelled monthly at APR ÷ 12; lenders may compound daily, change rates or add fees, so actual payoff dates and interest will differ.
        </p>
      </CardContent>
    </Card>
  );
}

function PaymentDialog({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const router = useRouter();
  const { accounts } = useAppData();
  const [amount, setAmount] = React.useState(debt.minimumPayment ? String(Number(debt.minimumPayment)) : "");
  const [interest, setInterest] = React.useState("");
  const [date, setDate] = React.useState(todayYmd());
  const [isExtra, setIsExtra] = React.useState(false);
  const [record, setRecord] = React.useState(true);
  const [from, setFrom] = React.useState(accounts.find((a) => a.id !== debt.linkedAccountId && !["CREDIT_CARD", "LOAN"].includes(a.type))?.id ?? "");
  const [pending, start] = React.useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record payment · {debt.name}</DialogTitle>
          <DialogDescription>
            {debt.balanceSource === "account" ? `Recorded as a transfer into ${debt.linkedAccountName}, reducing its balance.` : "The principal portion reduces the outstanding balance."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${debt.currency})`} htmlFor="dp-amt">
              <Input id="dp-amt" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <Field label="Of which interest" htmlFor="dp-int" optional>
              <Input id="dp-int" inputMode="decimal" className="num" value={interest} onChange={(e) => setInterest(e.target.value)} />
            </Field>
          </div>
          <Field label="Date" htmlFor="dp-date">
            <Input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={isExtra} onCheckedChange={(c) => setIsExtra(!!c)} /> Extra payment (beyond the minimum)
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={record || debt.balanceSource === "account"} disabled={debt.balanceSource === "account"} onCheckedChange={(c) => setRecord(!!c)} /> Record the transaction from an account
          </label>
          {(record || debt.balanceSource === "account") && (
            <Field label="Paid from" htmlFor="dp-from">
              <NativeSelect id="dp-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {accounts
                  .filter((a) => a.id !== debt.linkedAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await recordDebtPaymentAction({ debtId: debt.id, amount, interest: interest || undefined, date, isExtra, fromAccountId: record || debt.balanceSource === "account" ? from || null : null });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Payment recorded");
                onClose();
                router.refresh();
              })
            }
          >
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DebtForm({ initial, onDone }: { initial?: Debt; onDone: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts } = useAppData();
  const liabilityAccounts = accounts.filter((a) => a.type === "LOAN" || a.type === "CREDIT_CARD");
  const [v, setV] = React.useState<DebtFormValues>(
    initial
      ? {
          name: initial.name,
          type: initial.type as never,
          lender: initial.lender ?? "",
          currency: initial.currency,
          originalPrincipal: String(Number(initial.originalPrincipal)),
          currentBalance: String(Number(initial.currentBalance)),
          interestRate: initial.interestRate ?? "",
          minimumPayment: initial.minimumPayment ? String(Number(initial.minimumPayment)) : "",
          dueDay: initial.dueDay ?? "",
          startDate: initial.startDate ? isoToYmd(initial.startDate, f.timezone) : "",
          termMonths: initial.termMonths ?? "",
          linkedAccountId: initial.linkedAccountId,
          notes: initial.notes ?? "",
        }
      : { name: "", type: "PERSONAL_LOAN", lender: "", currency: f.currency, originalPrincipal: "", currentBalance: "", interestRate: "", minimumPayment: "", dueDay: "", startDate: "", termMonths: "", linkedAccountId: null, notes: "" },
  );
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDebtAction(initial?.id ?? null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Debt saved");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="d-name" error={errors.name?.[0]}>
          <Input id="d-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Car loan" autoFocus />
        </Field>
        <Field label="Type" htmlFor="d-type">
          <NativeSelect id="d-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as never })}>
            {Object.entries(TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Lender" htmlFor="d-lender" optional>
          <Input id="d-lender" value={v.lender ?? ""} onChange={(e) => setV({ ...v, lender: e.target.value })} />
        </Field>
        <Field label="Currency" htmlFor="d-cur">
          <NativeSelect id="d-cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Original principal" htmlFor="d-orig" error={errors.originalPrincipal?.[0]}>
          <Input id="d-orig" inputMode="decimal" className="num" value={v.originalPrincipal} onChange={(e) => setV({ ...v, originalPrincipal: e.target.value })} />
        </Field>
        <Field label="Current outstanding balance" htmlFor="d-bal" error={errors.currentBalance?.[0]} hint={v.linkedAccountId ? "Ignored — the linked account's balance is used" : undefined}>
          <Input id="d-bal" inputMode="decimal" className="num" value={v.currentBalance} onChange={(e) => setV({ ...v, currentBalance: e.target.value })} />
        </Field>
        <Field label="Interest rate (APR %)" htmlFor="d-apr" optional error={errors.interestRate?.[0]}>
          <Input id="d-apr" inputMode="decimal" className="num" value={v.interestRate ?? ""} onChange={(e) => setV({ ...v, interestRate: e.target.value })} placeholder="Unknown" />
        </Field>
        <Field label="Minimum monthly payment" htmlFor="d-min" optional>
          <Input id="d-min" inputMode="decimal" className="num" value={v.minimumPayment ?? ""} onChange={(e) => setV({ ...v, minimumPayment: e.target.value })} />
        </Field>
        <Field label="Due day of month" htmlFor="d-due" optional>
          <Input id="d-due" type="number" min={1} max={31} value={String(v.dueDay ?? "")} onChange={(e) => setV({ ...v, dueDay: e.target.value as never })} />
        </Field>
        <Field label="Remaining term (months)" htmlFor="d-term" optional>
          <Input id="d-term" type="number" min={1} max={600} value={String(v.termMonths ?? "")} onChange={(e) => setV({ ...v, termMonths: e.target.value as never })} />
        </Field>
        <Field label="Linked loan / card account" htmlFor="d-acct" optional hint="Avoids double counting in net worth">
          <NativeSelect id="d-acct" value={v.linkedAccountId ?? ""} onChange={(e) => setV({ ...v, linkedAccountId: e.target.value || null })}>
            <option value="">None — track balance here</option>
            {liabilityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="d-start" optional>
          <Input id="d-start" type="date" value={v.startDate ?? ""} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="d-notes" optional>
        <Textarea id="d-notes" rows={2} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save debt
        </Button>
      </div>
    </form>
  );
}

