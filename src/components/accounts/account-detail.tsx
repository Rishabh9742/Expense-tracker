"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Plus, Receipt, Scale } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { EmptyState, Notice, StatRow } from "@/components/finance/primitives";
import { LineSeriesChart } from "@/components/charts/charts";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { useQuickAdd } from "@/components/shell/app-shell";
import { reconcileAccountAction, setBalanceAction } from "@/server/actions/accounts";
import type { TxnDTO } from "@/lib/dto";
import { ACCOUNT_TYPE_LABELS } from "./account-form";
import { TYPE_ICON } from "./accounts-view";

interface Acct {
  id: string;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  status: string;
  balance: string;
  clearedBalance: string;
  baseBalance: string | null;
  lastReconciledAt: string | null;
  reconciledBalance: string | null;
  isLiability: boolean;
  notes: string | null;
  pendingCount: number;
}

export function AccountDetail({ account: a, history, transactions, baseCurrency }: { account: Acct; history: { label: string; balance: number }[]; transactions: TxnDTO[]; baseCurrency: string }) {
  const f = useFormat();
  const quick = useQuickAdd();
  const [reconcileOpen, setReconcileOpen] = React.useState(false);
  const [balanceOpen, setBalanceOpen] = React.useState(false);
  const I = TYPE_ICON[a.type];
  const display = (v: string) => (a.isLiability ? String(-Number(v)) : v);

  return (
    <div>
      <Link href="/accounts" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All accounts
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-muted-foreground">{I && <I className="size-5" />}</span>
          <div>
            <h1 className="text-title font-semibold">{a.name}</h1>
            <p className="text-sm text-muted-foreground">
              {ACCOUNT_TYPE_LABELS[a.type]}
              {a.institution ? ` · ${a.institution}` : ""} · {a.currency}
              {a.status !== "ACTIVE" && (
                <Badge variant="outline" className="ml-2">
                  {a.status.toLowerCase()}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setBalanceOpen(true)}>
            <Scale /> Update balance
          </Button>
          <Button size="sm" onClick={() => setReconcileOpen(true)}>
            <CheckCircle2 /> Reconcile
          </Button>
          <Button size="sm" variant="primary" onClick={() => quick.open({ accountId: a.id })}>
            <Plus /> Add transaction
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader>
            <div>
              <CardDescription className="mt-0">{a.isLiability ? "Amount owed" : "Current balance"}</CardDescription>
              <Money value={display(a.balance)} currency={a.currency} className="mt-1 block text-[28px] font-semibold tracking-tight" />
              {a.currency !== baseCurrency && a.baseBalance && <p className="text-meta text-muted-foreground">≈ {f.money(display(a.baseBalance))} at today&apos;s rate</p>}
            </div>
          </CardHeader>
          <CardContent>
            <LineSeriesChart
              data={history}
              series={[{ key: "balance", label: a.isLiability ? "Owed" : "Balance", color: "var(--chart-1)" }]}
              areaKey="balance"
              height={220}
              description={`${a.isLiability ? "Amount owed" : "Balance"} over the last 90 days`}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow label="Cleared balance" value={<Money value={display(a.clearedBalance)} currency={a.currency} />} />
            <StatRow label="Pending transactions" value={a.pendingCount} />
            <StatRow label="Last reconciled" value={a.lastReconciledAt ? f.date(a.lastReconciledAt) : "Never"} />
            {a.reconciledBalance && <StatRow label="Reconciled balance" value={<Money value={display(a.reconciledBalance)} currency={a.currency} />} />}
            <StatRow label="Bank connection" value={<span className="text-muted-foreground">Not connected · manual</span>} />
            {a.notes && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-[12.5px] text-muted-foreground">{a.notes}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-12">
          <CardHeader>
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>Most recent 100 · including transfers in and out</CardDescription>
            </div>
            <Link href={`/transactions?accountId=${a.id}`} className="text-meta font-medium text-muted-foreground hover:text-foreground">
              Open in Transactions
            </Link>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <EmptyState compact icon={<Receipt />} title="No transactions in this account yet" action={<Button size="sm" variant="primary" onClick={() => quick.open({ accountId: a.id })}><Plus /> Add transaction</Button>} />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {transactions.map((t) =>
                  t.toAccountId === a.id ? (
                    // Incoming transfer: show as a credit from this account's perspective
                    <TransactionRow key={t.id} t={{ ...t, amount: t.toAmount ?? t.amount, currency: t.toCurrency ?? t.currency }} />
                  ) : (
                    <TransactionRow key={t.id} t={t} />
                  ),
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ReconcileDialog open={reconcileOpen} onOpenChange={setReconcileOpen} account={a} />
      <SetBalanceDialog open={balanceOpen} onOpenChange={setBalanceOpen} account={a} />
    </div>
  );
}

function ReconcileDialog({ open, onOpenChange, account: a }: { open: boolean; onOpenChange: (o: boolean) => void; account: Acct }) {
  const router = useRouter();
  const f = useFormat();
  const [balance, setBalance] = React.useState("");
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [adjust, setAdjust] = React.useState(true);
  const [result, setResult] = React.useState<{ difference: string; adjusted: boolean } | null>(null);
  const [pending, start] = React.useTransition();
  React.useEffect(() => {
    if (open) setResult(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reconcile {a.name}</DialogTitle>
          <DialogDescription>Compare your statement with the cleared balance Finora has calculated.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <Field label="Statement date" htmlFor="r-date">
            <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={a.isLiability ? "Statement amount owed" : "Statement ending balance"} htmlFor="r-bal">
            <Input id="r-bal" inputMode="decimal" className="num" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" autoFocus />
          </Field>
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox checked={adjust} onCheckedChange={(c) => setAdjust(!!c)} className="mt-0.5" />
            <span>
              If there&apos;s a difference, record a balance adjustment
              <span className="block text-meta text-muted-foreground">Adjustments never count as income or spending.</span>
            </span>
          </label>
          {result &&
            (Number(result.difference) === 0 ? (
              <Notice tone="positive" icon={<CheckCircle2 />}>
                Balanced — the account is marked as reconciled.
              </Notice>
            ) : result.adjusted ? (
              <Notice tone="positive" icon={<CheckCircle2 />}>
                Recorded a {f.money(result.difference, a.currency, { signDisplay: "always" })} adjustment and marked the account reconciled.
              </Notice>
            ) : (
              <Notice tone="warning">
                Off by {f.money(result.difference, a.currency, { signDisplay: "always" })}. Look for missing or duplicate transactions, or enable the adjustment option.
              </Notice>
            ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!balance}
            onClick={() =>
              start(async () => {
                const r = await reconcileAccountAction({ accountId: a.id, statementBalance: balance, statementDate: date, createAdjustment: adjust });
                if (!r.ok) return void toast.error(r.error);
                setResult(r.data!);
                router.refresh();
              })
            }
          >
            Reconcile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetBalanceDialog({ open, onOpenChange, account: a }: { open: boolean; onOpenChange: (o: boolean) => void; account: Acct }) {
  const router = useRouter();
  const f = useFormat();
  const [value, setValue] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Update balance</DialogTitle>
          <DialogDescription>
            Finora records the difference as a dated adjustment, so your history stays accurate and auditable.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-4">
          <Field label={a.isLiability ? "Current amount owed" : "Current balance"} htmlFor="sb" hint={`Currently ${f.money(a.isLiability ? String(-Number(a.balance)) : a.balance, a.currency)}`}>
            <Input id="sb" inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!value}
            onClick={() =>
              start(async () => {
                const r = await setBalanceAction(a.id, value);
                if (!r.ok) return void toast.error(r.error);
                toast.success(Number(r.data!.difference) === 0 ? "Balance already matches" : `Adjusted by ${f.money(r.data!.difference, a.currency, { signDisplay: "always" })}`);
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            Save balance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

