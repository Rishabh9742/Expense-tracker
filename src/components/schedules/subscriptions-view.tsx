"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, ScanSearch, Trash2, X, Ban, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, EmptyState, MetricCard, Notice, PageHeader } from "@/components/finance/primitives";
import { SingleBarChart } from "@/components/charts/charts";
import { useAppData } from "@/components/shell/app-shell";
import { CategorySelect } from "@/components/transactions/transaction-form";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { deleteSubscriptionAction, saveSubscriptionAction, setSubscriptionStatusAction, type SubscriptionFormValues } from "@/server/actions/schedules";
import { FrequencyFields, freqLabel, isoToYmd, todayYmd } from "./shared";
import { cn } from "@/lib/utils";

interface Sub {
  id: string;
  name: string;
  merchant: string | null;
  amount: string;
  currency: string;
  frequency: string;
  interval: number;
  nextDate: string;
  startDate: string;
  endDate: string | null;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  reminderDays: number;
  cancellationNotes: string | null;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  monthlyBase: string | null;
  previousAmount: string | null;
  amountChangedAt: string | null;
  detected: boolean;
}
interface Candidate {
  key: string;
  merchant: string;
  frequency: string;
  lastAmount: string;
  averageAmount: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  confidence: number;
  priceChange: { from: string; to: string; percent: number } | null;
  categoryId: string | null;
  accountId: string;
}

export function SubscriptionsView({ rows, candidates, monthly, annual, trend, missingRates }: { rows: Sub[]; candidates: Candidate[]; monthly: string; annual: string; trend: { label: string; value: number }[]; missingRates: number }) {
  const f = useFormat();
  const { accounts } = useAppData();
  const [editing, setEditing] = React.useState<Sub | Partial<SubscriptionFormValues> | null>(null);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const active = rows.filter((r) => r.status === "ACTIVE");
  const inactive = rows.filter((r) => r.status !== "ACTIVE");
  const changed = rows.filter((r) => r.amountChangedAt && Date.now() - new Date(r.amountChangedAt).getTime() < 90 * 86400000);
  const upcoming = active.filter((r) => new Date(r.nextDate).getTime() - Date.now() < 30 * 86400000);
  const top = [...active].sort((a, b) => Number(b.monthlyBase ?? 0) - Number(a.monthlyBase ?? 0))[0];
  const shownCandidates = candidates.filter((c) => !dismissed.has(c.key));

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Track recurring services, spot price changes, and see what they really cost per year."
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing({})}>
            <Plus /> Add subscription
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Monthly total" value={<Money value={monthly} />} sub={<span>{active.length} active</span>} footnote="Each subscription converted to a monthly equivalent in your base currency." />
        <MetricCard label="Annualized" value={<Money value={annual} />} sub={<span>Monthly × 12</span>} />
        <MetricCard label="Renewing in 30 days" value={<span className="num">{upcoming.length}</span>} sub={upcoming[0] ? <span>Next: {upcoming[0].name}</span> : <span>Nothing soon</span>} />
        <MetricCard label="Largest" value={top ? <span className="truncate">{top.name}</span> : "—"} sub={top?.monthlyBase ? <span><Money value={top.monthlyBase} className="text-meta" /> / month</span> : undefined} />
      </div>
      {missingRates > 0 && <Notice tone="warning" className="mb-4">{missingRates} subscription(s) use a currency without an exchange rate and are excluded from totals.</Notice>}

      {changed.length > 0 && (
        <Card className="mb-6 border-warning/30 p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-warning">
            <ArrowUpRight className="size-4" /> Recently changed prices
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {changed.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.name}</span>: <Money value={s.previousAmount} currency={s.currency} /> → <Money value={s.amount} currency={s.currency} className="font-medium" />
                <span className="text-muted-foreground"> · {f.date(s.amountChangedAt!)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {shownCandidates.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ScanSearch className="size-4 text-info" /> Possible subscriptions found
              </CardTitle>
              <CardDescription>Regular charges detected in your last 12 months. Nothing is added until you confirm.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {shownCandidates.map((c) => {
                const acct = accounts.find((a) => a.id === c.accountId);
                return (
                  <li key={c.key} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{c.merchant}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {freqLabel(c.frequency, 1)} · seen {c.occurrences}× · last {f.date(c.lastDate)} · {Math.round(c.confidence * 100)}% confidence
                        {c.priceChange && (
                          <span className="ml-1 text-warning">
                            · price {c.priceChange.percent > 0 ? "up" : "down"} {Math.abs(c.priceChange.percent)}%
                          </span>
                        )}
                      </p>
                    </div>
                    <Money value={c.lastAmount} currency={acct?.currency} className="text-[13.5px] font-medium" />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() =>
                          setEditing({
                            name: c.merchant,
                            merchant: c.merchant,
                            amount: String(Number(c.lastAmount)),
                            currency: acct?.currency,
                            frequency: c.frequency as never,
                            nextDate: isoToYmd(c.nextDate, f.timezone),
                            startDate: isoToYmd(c.lastDate, f.timezone),
                            accountId: c.accountId,
                            categoryId: c.categoryId,
                            __detectedKey: c.key,
                          } as never)
                        }
                      >
                        <Check /> Track
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${c.merchant}`} onClick={() => setDismissed(new Set([...dismissed, c.key]))}>
                        <X />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat />}
            title="No subscriptions yet"
            description="Add streaming, software, gym or any other recurring service. Finora will also suggest subscriptions it detects in your transactions."
            action={
              <Button size="sm" variant="primary" onClick={() => setEditing({})}>
                <Plus /> Add subscription
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>Active</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              {active.length === 0 ? <p className="px-3 pb-2 text-[13px] text-muted-foreground">No active subscriptions.</p> : <ul className="divide-y divide-border">{active.map((s) => <SubRow key={s.id} s={s} onEdit={() => setEditing(s)} />)}</ul>}
            </CardContent>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader>
              <div>
                <CardTitle>Subscription spending</CardTitle>
                <CardDescription>Actual charges from tracked subscriptions, last 12 months</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {trend.some((t) => t.value > 0) ? (
                <SingleBarChart data={trend} valueLabel="Charged" description="Monthly subscription charges over the last 12 months" height={220} color="var(--chart-5)" />
              ) : (
                <EmptyState compact icon={<Info />} title="No matching charges yet" description="When transactions from these merchants are recorded, the trend appears here." />
              )}
            </CardContent>
          </Card>
          {inactive.length > 0 && (
            <Card className="lg:col-span-12">
              <CardHeader>
                <CardTitle>Paused & cancelled</CardTitle>
              </CardHeader>
              <CardContent className="px-2">
                <ul className="divide-y divide-border opacity-80">{inactive.map((s) => <SubRow key={s.id} s={s} onEdit={() => setEditing(s)} />)}</ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <p className="mt-6 text-meta text-subtle-foreground">Marking a subscription as cancelled only updates your records — Finora doesn&apos;t contact merchants or cancel services for you.</p>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing && "id" in editing ? "Edit subscription" : "Add subscription"}</DialogTitle>
            <DialogDescription>Renewal reminders appear in your notifications.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing && <SubForm initial={editing} onDone={() => setEditing(null)} onSaved={(key) => key && setDismissed(new Set([...dismissed, key]))} />}</DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubRow({ s, onEdit }: { s: Sub; onEdit: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const days = Math.ceil((new Date(s.nextDate).getTime() - Date.now()) / 86400000);
  const status = async (st: Sub["status"]) => {
    await setSubscriptionStatusAction(s.id, st);
    toast.success(st === "CANCELLED" ? "Marked as cancelled" : st === "PAUSED" ? "Paused" : "Reactivated");
    router.refresh();
  };
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <CategoryIcon icon={s.categoryIcon ?? "repeat"} color={s.categoryColor ?? "c5"} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
          {s.name}
          {s.status !== "ACTIVE" && <Badge variant="outline">{s.status.toLowerCase()}</Badge>}
          {s.previousAmount && <Badge variant="warning">price changed</Badge>}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {freqLabel(s.frequency, s.interval)}
          {s.status === "ACTIVE" && ` · renews ${days <= 0 ? "today" : days === 1 ? "tomorrow" : f.date(s.nextDate, { day: "numeric", month: "short" })}`}
          {s.accountName ? ` · ${s.accountName}` : ""}
        </p>
      </div>
      <div className="text-right">
        <Money value={s.amount} currency={s.currency} className="block text-[13.5px] font-medium" />
        {s.monthlyBase && s.frequency !== "MONTHLY" && (
          <span className="text-[11.5px] text-muted-foreground">
            <Money value={s.monthlyBase} className="text-[11.5px]" />/mo
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {s.status === "ACTIVE" ? (
            <>
              <DropdownMenuItem onSelect={() => status("PAUSED")}>
                <Pause /> Pause
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => status("CANCELLED")}>
                <Ban /> Mark as cancelled
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => status("ACTIVE")}>
              <Play /> Reactivate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${s.name}?`}
        description="This removes it from tracking. Past transactions aren't affected."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteSubscriptionAction(s.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </li>
  );
}

function SubForm({ initial, onDone, onSaved }: { initial: Sub | Partial<SubscriptionFormValues>; onDone: () => void; onSaved: (key?: string) => void }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts, categories } = useAppData();
  const isEdit = "id" in initial;
  const detectedKey = (initial as { __detectedKey?: string }).__detectedKey;
  const [v, setV] = React.useState<SubscriptionFormValues>(() => {
    if (isEdit) {
      const s = initial as Sub;
      return {
        name: s.name,
        merchant: s.merchant ?? "",
        amount: String(Number(s.amount)),
        currency: s.currency,
        frequency: s.frequency as never,
        interval: s.interval,
        nextDate: isoToYmd(s.nextDate, f.timezone),
        startDate: isoToYmd(s.startDate, f.timezone),
        endDate: s.endDate ? isoToYmd(s.endDate, f.timezone) : "",
        accountId: s.accountId,
        categoryId: s.categoryId,
        reminderDays: s.reminderDays,
        cancellationNotes: s.cancellationNotes ?? "",
        status: s.status,
      };
    }
    const subsCat = categories.find((c) => c.name === "Subscriptions")?.id ?? null;
    const { __detectedKey: _k, ...rest } = initial as Partial<SubscriptionFormValues> & { __detectedKey?: string };
    return {
      name: "",
      merchant: "",
      amount: "",
      currency: f.currency,
      frequency: "MONTHLY",
      interval: 1,
      nextDate: todayYmd(),
      startDate: todayYmd(),
      endDate: "",
      accountId: accounts[0]?.id ?? null,
      categoryId: subsCat,
      reminderDays: 3,
      cancellationNotes: "",
      status: "ACTIVE",
      ...rest,
    };
  });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSubscriptionAction(isEdit ? (initial as Sub).id : null, v, !!detectedKey);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Subscription saved");
          onSaved(detectedKey);
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="s-name" error={errors.name?.[0]}>
          <Input id="s-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Netflix" autoFocus />
        </Field>
        <Field label="Merchant" htmlFor="s-merch" optional hint="Used to match charges in your transactions">
          <Input id="s-merch" value={v.merchant ?? ""} onChange={(e) => setV({ ...v, merchant: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label="Amount" htmlFor="s-amt" error={errors.amount?.[0]}>
            <Input id="s-amt" inputMode="decimal" className="num" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          </Field>
          <Field label="Currency" htmlFor="s-cur">
            <NativeSelect id="s-cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FrequencyFields idPrefix="s" frequency={v.frequency} interval={v.interval ?? 1} onFrequency={(x) => setV({ ...v, frequency: x as never })} onInterval={(n) => setV({ ...v, interval: n })} />
        </div>
        <Field label="Next renewal" htmlFor="s-next" error={errors.nextDate?.[0]}>
          <Input id="s-next" type="date" value={v.nextDate} onChange={(e) => setV({ ...v, nextDate: e.target.value })} />
        </Field>
        <Field label="Remind me (days before)" htmlFor="s-rem">
          <Input id="s-rem" type="number" min={0} max={30} value={String(v.reminderDays)} onChange={(e) => setV({ ...v, reminderDays: Number(e.target.value) })} />
        </Field>
        <Field label="Started" htmlFor="s-start">
          <Input id="s-start" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
        </Field>
        <Field label="Ends" htmlFor="s-end" optional>
          <Input id="s-end" type="date" value={v.endDate ?? ""} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
        </Field>
        <Field label="Paid from" htmlFor="s-acct" optional>
          <NativeSelect id="s-acct" value={v.accountId ?? ""} onChange={(e) => setV({ ...v, accountId: e.target.value || null })}>
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Category" htmlFor="s-cat" optional>
          <CategorySelect id="s-cat" categories={categories} kind="EXPENSE" value={v.categoryId} onChange={(c) => setV({ ...v, categoryId: c })} />
        </Field>
        {isEdit && (
          <Field label="Status" htmlFor="s-status">
            <NativeSelect id="s-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as never })}>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="CANCELLED">Cancelled</option>
            </NativeSelect>
          </Field>
        )}
      </div>
      <Field label="Cancellation notes" htmlFor="s-notes" optional hint="e.g. how to cancel, notice period, account email">
        <Textarea id="s-notes" rows={2} value={v.cancellationNotes ?? ""} onChange={(e) => setV({ ...v, cancellationNotes: e.target.value })} />
      </Field>
      <div className={cn("flex justify-end gap-2")}>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
