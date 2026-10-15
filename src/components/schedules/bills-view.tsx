"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, CalendarClock, Check, MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, Trash2, Wallet, Zap, Home, Wifi, Shield, Landmark, CreditCard, BadgeCheck, GraduationCap, Circle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Switch, Tabs, TabsContent, TabsList, TabsTrigger, ProgressBar } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, EmptyState, MetricCard, PageHeader } from "@/components/finance/primitives";
import { useAppData } from "@/components/shell/app-shell";
import { CategorySelect } from "@/components/transactions/transaction-form";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  deleteBillAction,
  deleteRecurringAction,
  markBillPaidAction,
  saveBillAction,
  saveRecurringAction,
  toggleRecurringAction,
  type BillFormValues,
  type RecurringFormValues,
} from "@/server/actions/schedules";
import { FrequencyFields, freqLabel, isoToYmd, todayYmd } from "./shared";
import { cn } from "@/lib/utils";

interface Bill {
  id: string;
  name: string;
  kind: string;
  amount: string;
  currency: string;
  isVariable: boolean;
  frequency: string;
  interval: number;
  nextDueDate: string;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  reminderDays: number;
  autopay: boolean;
  notes: string | null;
  daysUntil: number;
  state: "paid" | "due-soon" | "upcoming" | "overdue";
  payments: { dueDate: string; paidAt: string; amount: string; late: boolean }[];
}
interface Rec {
  id: string;
  name: string;
  type: string;
  accountId: string;
  accountName: string;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  merchant: string | null;
  amount: string;
  isVariable: boolean;
  frequency: string;
  interval: number;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  autoCreate: boolean;
  postAsCleared: boolean;
  active: boolean;
  expectedThisMonth: string;
  actualThisMonth: string;
}

const KIND_META: Record<string, { label: string; icon: React.ElementType }> = {
  RENT: { label: "Rent", icon: Home },
  UTILITIES: { label: "Utilities", icon: Zap },
  PHONE_INTERNET: { label: "Phone & internet", icon: Wifi },
  INSURANCE: { label: "Insurance", icon: Shield },
  LOAN: { label: "Loan repayment", icon: Landmark },
  CREDIT_CARD: { label: "Credit card", icon: CreditCard },
  MEMBERSHIP: { label: "Membership", icon: BadgeCheck },
  EDUCATION: { label: "Education fees", icon: GraduationCap },
  OTHER: { label: "Other", icon: Circle },
};

export function BillsView({
  bills,
  calendar,
  recurring,
  monthlyObligation,
  monthLabel,
  autoNew,
  initialTab,
}: {
  bills: Bill[];
  calendar: { billId: string; name: string; date: string; amount: string; currency: string; state: string }[];
  recurring: Rec[];
  monthlyObligation: string;
  monthLabel: string;
  autoNew: boolean;
  initialTab: "bills" | "recurring";
}) {
  const f = useFormat();
  const [billEdit, setBillEdit] = React.useState<Bill | "new" | null>(autoNew && initialTab === "bills" ? "new" : null);
  const [recEdit, setRecEdit] = React.useState<Rec | { type: "INCOME" | "EXPENSE" } | null>(null);
  const [paying, setPaying] = React.useState<Bill | null>(null);
  const overdue = bills.filter((b) => b.state === "overdue");
  const dueSoon = bills.filter((b) => b.state === "due-soon");
  const incomeRec = recurring.filter((r) => r.type === "INCOME");
  const expenseRec = recurring.filter((r) => r.type !== "INCOME");

  // Group calendar by date
  const byDay = new Map<string, typeof calendar>();
  for (const c of calendar) {
    const k = isoToYmd(c.date, f.timezone);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }

  return (
    <div>
      <PageHeader
        title="Bills & Recurring"
        description="Due dates, reminders and recurring schedules. Finora records payments you make — it never sends money."
        actions={
          <>
            <Button size="sm" onClick={() => setRecEdit({ type: "INCOME" })}>
              <Repeat /> Recurring
            </Button>
            <Button size="sm" variant="primary" onClick={() => setBillEdit("new")}>
              <Plus /> Add bill
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Monthly obligations" value={<Money value={monthlyObligation} />} sub={<span>{bills.length} active bills</span>} footnote="All bills converted to a monthly equivalent in your base currency." />
        <MetricCard label="Overdue" value={<span className={cn("num", overdue.length && "text-negative")}>{overdue.length}</span>} sub={overdue[0] ? <span className="text-negative">{overdue[0].name}</span> : <span>Nothing overdue</span>} />
        <MetricCard label="Due soon" value={<span className="num">{dueSoon.length}</span>} sub={<span>Within reminder window</span>} />
        <MetricCard
          label={`Expected income · ${monthLabel}`}
          value={<Money value={String(incomeRec.reduce((a, r) => a + Number(r.expectedThisMonth), 0))} />}
          sub={<span>Received <Money value={String(incomeRec.reduce((a, r) => a + Number(r.actualThisMonth), 0))} className="text-meta" /></span>}
          footnote="Amounts in each schedule's account currency, summed as-is when currencies match."
        />
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="bills">
            <CalendarClock /> Bills
          </TabsTrigger>
          <TabsTrigger value="recurring">
            <Repeat /> Recurring & income
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bills">
          {bills.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarClock />}
                title="No bills yet"
                description="Add rent, utilities, insurance, loan EMIs or card payments to get reminders before they're due."
                action={
                  <Button size="sm" variant="primary" onClick={() => setBillEdit("new")}>
                    <Plus /> Add bill
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-7">
                <CardHeader>
                  <CardTitle>All bills</CardTitle>
                </CardHeader>
                <CardContent className="px-2">
                  <ul className="divide-y divide-border">
                    {bills.map((b) => (
                      <BillRow key={b.id} b={b} onEdit={() => setBillEdit(b)} onPay={() => setPaying(b)} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="lg:col-span-5">
                <CardHeader>
                  <div>
                    <CardTitle>Upcoming calendar</CardTitle>
                    <CardDescription>Next 45 days</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {[...byDay.entries()]
                      .filter(([, items]) => items.some((i) => i.state !== "paid"))
                      .slice(0, 14)
                      .map(([day, items]) => (
                        <li key={day} className="flex gap-3">
                          <div className="w-12 shrink-0 rounded-md border border-border py-1 text-center">
                            <div className="text-[10px] font-medium text-muted-foreground uppercase">{f.date(items[0].date, { month: "short" })}</div>
                            <div className="num text-[15px] leading-5 font-semibold">{f.date(items[0].date, { day: "numeric" })}</div>
                            <div className="text-[10px] text-subtle-foreground">{f.date(items[0].date, { weekday: "short" })}</div>
                          </div>
                          <ul className="flex-1 space-y-1">
                            {items
                              .filter((i) => i.state !== "paid")
                              .map((i, k) => (
                                <li key={k} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px]">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    {i.state === "overdue" && <AlertTriangle className="size-3.5 shrink-0 text-negative" aria-label="Overdue" />}
                                    <span className="truncate">{i.name}</span>
                                  </span>
                                  <Money value={i.amount} currency={i.currency} className="font-medium" />
                                </li>
                              ))}
                          </ul>
                        </li>
                      ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring" className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Income schedules</CardTitle>
                <CardDescription>Salary and other expected income · {monthLabel} expected vs received</CardDescription>
              </div>
              <Button size="sm" onClick={() => setRecEdit({ type: "INCOME" })}>
                <Plus /> Add income
              </Button>
            </CardHeader>
            <CardContent className="px-2">
              {incomeRec.length === 0 ? (
                <EmptyState compact icon={<Wallet />} title="No income schedules" description="Add your salary or retainer to auto-record it, or to get alerted when expected income doesn't arrive." />
              ) : (
                <ul className="divide-y divide-border">{incomeRec.map((r) => <RecRow key={r.id} r={r} onEdit={() => setRecEdit(r)} />)}</ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recurring expenses</CardTitle>
                <CardDescription>Auto-recorded on schedule (e.g. SIPs, EMIs paid by standing instruction)</CardDescription>
              </div>
              <Button size="sm" onClick={() => setRecEdit({ type: "EXPENSE" })}>
                <Plus /> Add expense
              </Button>
            </CardHeader>
            <CardContent className="px-2">
              {expenseRec.length === 0 ? <EmptyState compact icon={<Repeat />} title="No recurring expenses" /> : <ul className="divide-y divide-border">{expenseRec.map((r) => <RecRow key={r.id} r={r} onEdit={() => setRecEdit(r)} />)}</ul>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={billEdit !== null} onOpenChange={(o) => !o && setBillEdit(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{billEdit === "new" ? "Add bill" : "Edit bill"}</DialogTitle>
            <DialogDescription>Reminders appear before the due date. Payments are never made automatically.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{billEdit && <BillForm initial={billEdit === "new" ? undefined : billEdit} onDone={() => setBillEdit(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      <Dialog open={recEdit !== null} onOpenChange={(o) => !o && setRecEdit(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{recEdit && "id" in recEdit ? "Edit schedule" : recEdit?.type === "INCOME" ? "New income schedule" : "New recurring expense"}</DialogTitle>
            <DialogDescription>Choose whether Finora records each occurrence automatically or just expects it.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{recEdit && <RecForm initial={recEdit} onDone={() => setRecEdit(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      {paying && <PayDialog bill={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function BillRow({ b, onEdit, onPay }: { b: Bill; onEdit: () => void; onPay: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const K = KIND_META[b.kind] ?? KIND_META.OTHER;
  const lateCount = b.payments.filter((p) => p.late).length;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2", b.state === "overdue" ? "text-negative" : "text-muted-foreground")}>
        <K.icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
          {b.name}
          {b.state === "overdue" && (
            <Badge variant="negative">
              <AlertTriangle /> Overdue {-b.daysUntil}d
            </Badge>
          )}
          {b.state === "due-soon" && <Badge variant="warning">Due {b.daysUntil === 0 ? "today" : `in ${b.daysUntil}d`}</Badge>}
          {b.autopay && <Badge variant="outline">Autopay at bank</Badge>}
          {lateCount > 0 && <Badge variant="outline">{lateCount} late of last {b.payments.length}</Badge>}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {K.label} · {freqLabel(b.frequency, b.interval)} · due {f.date(b.nextDueDate)}
          {b.accountName ? ` · ${b.accountName}` : ""}
        </p>
      </div>
      <div className="text-right">
        <Money value={b.amount} currency={b.currency} className="text-[13.5px] font-medium" />
        {b.isVariable && <p className="text-[11px] text-muted-foreground">varies</p>}
      </div>
      <Button size="sm" variant={b.state === "overdue" || b.state === "due-soon" ? "primary" : "secondary"} onClick={onPay}>
        <Check /> Mark paid
      </Button>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${b.name}?`}
        description="Payment history for this bill will be removed. Recorded transactions stay."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteBillAction(b.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </li>
  );
}

function PayDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const router = useRouter();
  const { accounts } = useAppData();
  const [amount, setAmount] = React.useState(String(Number(bill.amount)));
  const [paidOn, setPaidOn] = React.useState(todayYmd());
  const [record, setRecord] = React.useState(true);
  const [accountId, setAccountId] = React.useState(bill.accountId ?? accounts[0]?.id ?? "");
  const [pending, start] = React.useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mark {bill.name} as paid</DialogTitle>
          <DialogDescription>Records a payment you&apos;ve already made and moves the due date forward.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <Field label={`Amount paid (${bill.currency})`} htmlFor="p-amt">
            <Input id="p-amt" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Paid on" htmlFor="p-date">
            <Input id="p-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={record} onCheckedChange={(c) => setRecord(!!c)} /> Also record the expense transaction
          </label>
          {record && (
            <Field label="Paid from" htmlFor="p-acct">
              <NativeSelect id="p-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
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
                const r = await markBillPaidAction({ billId: bill.id, amount, paidOn, recordTransaction: record, accountId: record ? accountId : null });
                if (!r.ok) return void toast.error(r.error);
                toast.success(`${bill.name} marked paid`);
                onClose();
                router.refresh();
              })
            }
          >
            <CalendarCheck /> Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BillForm({ initial, onDone }: { initial?: Bill; onDone: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts, categories } = useAppData();
  const [v, setV] = React.useState<BillFormValues>(
    initial
      ? {
          name: initial.name,
          kind: initial.kind as never,
          amount: String(Number(initial.amount)),
          currency: initial.currency,
          isVariable: initial.isVariable,
          frequency: initial.frequency as never,
          interval: initial.interval,
          nextDueDate: isoToYmd(initial.nextDueDate, f.timezone),
          accountId: initial.accountId,
          categoryId: initial.categoryId,
          reminderDays: initial.reminderDays,
          autopay: initial.autopay,
          notes: initial.notes ?? "",
        }
      : { name: "", kind: "RENT", amount: "", currency: f.currency, isVariable: false, frequency: "MONTHLY", interval: 1, nextDueDate: todayYmd(), accountId: accounts[0]?.id ?? null, categoryId: null, reminderDays: 3, autopay: false, notes: "" },
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
          const r = await saveBillAction(initial?.id ?? null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Bill saved");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="bl-name" error={errors.name?.[0]}>
          <Input id="bl-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Apartment rent" autoFocus />
        </Field>
        <Field label="Type" htmlFor="bl-kind">
          <NativeSelect id="bl-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as never })}>
            {Object.entries(KIND_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label={v.isVariable ? "Typical amount" : "Amount"} htmlFor="bl-amt" error={errors.amount?.[0]}>
            <Input id="bl-amt" inputMode="decimal" className="num" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          </Field>
          <Field label="Currency" htmlFor="bl-cur">
            <NativeSelect id="bl-cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Next due date" htmlFor="bl-due" error={errors.nextDueDate?.[0]}>
          <Input id="bl-due" type="date" value={v.nextDueDate} onChange={(e) => setV({ ...v, nextDueDate: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <FrequencyFields idPrefix="bl" frequency={v.frequency} interval={v.interval ?? 1} onFrequency={(x) => setV({ ...v, frequency: x as never })} onInterval={(n) => setV({ ...v, interval: n })} />
        </div>
        <Field label="Remind me (days before)" htmlFor="bl-rem">
          <Input id="bl-rem" type="number" min={0} max={30} value={String(v.reminderDays)} onChange={(e) => setV({ ...v, reminderDays: Number(e.target.value) })} />
        </Field>
        <Field label="Usually paid from" htmlFor="bl-acct" optional>
          <NativeSelect id="bl-acct" value={v.accountId ?? ""} onChange={(e) => setV({ ...v, accountId: e.target.value || null })}>
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Category" htmlFor="bl-cat" optional>
          <CategorySelect id="bl-cat" categories={categories} kind="EXPENSE" value={v.categoryId} onChange={(c) => setV({ ...v, categoryId: c })} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={v.isVariable} onCheckedChange={(c) => setV({ ...v, isVariable: !!c })} /> Amount varies each time
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={v.autopay} onCheckedChange={(c) => setV({ ...v, autopay: !!c })} /> Paid by autopay at my bank
        </label>
      </div>
      <Field label="Notes" htmlFor="bl-notes" optional>
        <Textarea id="bl-notes" rows={2} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save bill
        </Button>
      </div>
    </form>
  );
}

function RecRow({ r, onEdit }: { r: Rec; onEdit: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const expected = Number(r.expectedThisMonth);
  const pct = expected > 0 ? (Number(r.actualThisMonth) / expected) * 100 : null;
  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-3 py-3", !r.active && "opacity-60")}>
      <CategoryIcon icon={r.categoryIcon ?? (r.type === "INCOME" ? "briefcase" : "repeat")} color={r.categoryColor ?? "other"} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
          {r.name}
          <Badge variant={r.autoCreate ? "accent" : "outline"}>{r.autoCreate ? "Auto-records" : "Expected only"}</Badge>
          {r.isVariable && <Badge variant="outline">Variable</Badge>}
          {!r.active && <Badge variant="outline">Paused</Badge>}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {freqLabel(r.frequency, r.interval)} · {r.accountName}
          {r.active ? ` · next ${f.date(r.nextDate, { day: "numeric", month: "short" })}` : ""}
          {r.endDate ? ` · ends ${f.date(r.endDate)}` : ""}
        </p>
        {r.type === "INCOME" && pct !== null && (
          <div className="mt-1.5 flex max-w-sm items-center gap-2">
            <ProgressBar value={pct} size="sm" tone={pct >= 100 ? "positive" : "neutral"} label={`${r.name}: ${Math.round(pct)}% of expected received`} />
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
              <Money value={r.actualThisMonth} currency={r.currency} className="text-[11px]" /> of <Money value={r.expectedThisMonth} currency={r.currency} className="text-[11px]" />
            </span>
          </div>
        )}
      </div>
      <Money value={r.type === "INCOME" ? r.amount : String(-Number(r.amount))} currency={r.currency} showSign className="text-[13.5px] font-medium" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              await toggleRecurringAction(r.id, !r.active);
              router.refresh();
            }}
          >
            {r.active ? <Pause /> : <Play />} {r.active ? "Pause" : "Resume"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${r.name}?`}
        description="Future occurrences stop. Transactions already recorded are kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteRecurringAction(r.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </li>
  );
}

function RecForm({ initial, onDone }: { initial: Rec | { type: "INCOME" | "EXPENSE" }; onDone: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts, categories } = useAppData();
  const isEdit = "id" in initial;
  const [v, setV] = React.useState<RecurringFormValues>(() =>
    isEdit
      ? {
          name: initial.name,
          type: initial.type as never,
          accountId: initial.accountId,
          categoryId: initial.categoryId,
          merchant: initial.merchant ?? "",
          amount: String(Number(initial.amount)),
          isVariable: initial.isVariable,
          frequency: initial.frequency as never,
          interval: initial.interval,
          startDate: isoToYmd(initial.startDate, f.timezone),
          endDate: initial.endDate ? isoToYmd(initial.endDate, f.timezone) : "",
          autoCreate: initial.autoCreate,
          postAsCleared: initial.postAsCleared,
        }
      : {
          name: "",
          type: initial.type,
          accountId: accounts[0]?.id ?? "",
          categoryId: categories.find((c) => c.name === (initial.type === "INCOME" ? "Salary" : "Other Expenses"))?.id ?? null,
          merchant: "",
          amount: "",
          isVariable: false,
          frequency: "MONTHLY",
          interval: 1,
          startDate: todayYmd(),
          endDate: "",
          autoCreate: true,
          postAsCleared: true,
        },
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
          const r = await saveRecurringAction(isEdit ? (initial as Rec).id : null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success(`Schedule saved${r.data?.created ? ` · ${r.data.created} past occurrence${r.data.created === 1 ? "" : "s"} recorded` : ""}`);
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="rc-name" error={errors.name?.[0]}>
          <Input id="rc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={v.type === "INCOME" ? "e.g. Salary — Acme Corp" : "e.g. Index fund SIP"} autoFocus />
        </Field>
        <Field label="Type" htmlFor="rc-type">
          <NativeSelect id="rc-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as never, categoryId: null })}>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
          </NativeSelect>
        </Field>
        <Field label={v.isVariable ? "Estimated amount" : "Amount"} htmlFor="rc-amt" error={errors.amount?.[0]}>
          <Input id="rc-amt" inputMode="decimal" className="num" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label={v.type === "INCOME" ? "Deposited into" : "Paid from"} htmlFor="rc-acct" error={errors.accountId?.[0]}>
          <NativeSelect id="rc-acct" value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Category" htmlFor="rc-cat" optional>
          <CategorySelect id="rc-cat" categories={categories} kind={v.type === "INCOME" ? "INCOME" : "EXPENSE"} value={v.categoryId} onChange={(c) => setV({ ...v, categoryId: c })} />
        </Field>
        <Field label="Payer / merchant" htmlFor="rc-merch" optional>
          <Input id="rc-merch" value={v.merchant ?? ""} onChange={(e) => setV({ ...v, merchant: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <FrequencyFields idPrefix="rc" frequency={v.frequency} interval={v.interval ?? 1} onFrequency={(x) => setV({ ...v, frequency: x as never })} onInterval={(n) => setV({ ...v, interval: n })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="First date" htmlFor="rc-start">
            <Input id="rc-start" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
          </Field>
          <Field label="End date" htmlFor="rc-end" optional>
            <Input id="rc-end" type="date" value={v.endDate ?? ""} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-3.5">
        <label className="flex items-start justify-between gap-3 text-[13px]">
          <span>
            <span className="font-medium">Record automatically</span>
            <span className="block text-meta text-muted-foreground">
              {v.autoCreate ? "A transaction is created on each date (past dates are filled in now)." : "Nothing is recorded; you'll be alerted if expected income doesn't show up within 3 days."}
            </span>
          </span>
          <Switch checked={v.autoCreate} onCheckedChange={(c) => setV({ ...v, autoCreate: c })} aria-label="Record automatically" />
        </label>
        {v.autoCreate && (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={v.postAsCleared} onCheckedChange={(c) => setV({ ...v, postAsCleared: !!c })} /> Post as cleared (otherwise pending until you confirm)
          </label>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={v.isVariable} onCheckedChange={(c) => setV({ ...v, isVariable: !!c })} /> Amount varies (freelance, commissions, utilities)
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save schedule
        </Button>
      </div>
    </form>
  );
}
