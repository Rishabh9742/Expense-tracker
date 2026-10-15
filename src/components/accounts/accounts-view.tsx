"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Banknote, Building2, CreditCard, Landmark, LineChart, Link2Off, MoreHorizontal, Pencil, Plus, Smartphone, Trash2, Wallet, CircleDot } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { EmptyState, PageHeader } from "@/components/finance/primitives";
import { AccountForm, ACCOUNT_TYPE_LABELS } from "./account-form";
import { deleteAccountAction, saveAccountAction } from "@/server/actions/accounts";
import { cn } from "@/lib/utils";

export interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  status: string;
  notes: string | null;
  balance: string;
  baseBalance: string | null;
  openingBalance: string;
  openingDate: string;
  lastReconciledAt: string | null;
  includeInNetWorth: boolean;
  transactionCount: number;
  isLiability: boolean;
  isSample: boolean;
}

export const TYPE_ICON: Record<string, React.ElementType> = {
  CASH: Banknote,
  CHECKING: Building2,
  SAVINGS: Landmark,
  CREDIT_CARD: CreditCard,
  DIGITAL_WALLET: Smartphone,
  INVESTMENT: LineChart,
  LOAN: Landmark,
  OTHER: CircleDot,
};

const GROUPS = [
  { label: "Cash & bank", types: ["CASH", "CHECKING", "SAVINGS", "DIGITAL_WALLET"] },
  { label: "Credit cards & loans", types: ["CREDIT_CARD", "LOAN"] },
  { label: "Investments & other", types: ["INVESTMENT", "OTHER"] },
];

export function AccountsView({ accounts, baseCurrency, autoNew, bankSyncConfigured }: { accounts: AccountRow[]; baseCurrency: string; autoNew: boolean; bankSyncConfigured: boolean }) {
  const [editing, setEditing] = React.useState<AccountRow | "new" | null>(autoNew ? "new" : null);
  const active = accounts.filter((a) => a.status === "ACTIVE");
  const inactive = accounts.filter((a) => a.status !== "ACTIVE");
  const sumBase = (rows: AccountRow[], sign: 1 | -1) =>
    rows.reduce((acc, a) => (a.baseBalance && a.includeInNetWorth && Math.sign(Number(a.baseBalance)) === sign ? acc + Number(a.baseBalance) : acc), 0);
  const assets = sumBase(active, 1);
  const liabilities = -sumBase(active, -1);
  const missing = active.filter((a) => a.baseBalance === null);

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from your opening balance plus every recorded transaction."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> New account
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="Create your first account"
            description="Add a bank account, credit card, digital wallet or cash. You'll record transactions against it, or import a statement."
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus /> New account
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryTile label="Assets in accounts" value={assets} />
            <SummaryTile label="Owed on cards & loans" value={liabilities} />
            <SummaryTile label="Net across accounts" value={assets - liabilities} signed />
          </div>
          {missing.length > 0 && (
            <p className="mb-4 text-meta text-warning">
              {missing.map((m) => m.name).join(", ")}: no exchange rate to {baseCurrency} yet, so excluded from these totals.
            </p>
          )}
          <div className="space-y-8">
            {GROUPS.map((g) => {
              const rows = active.filter((a) => g.types.includes(a.type));
              if (!rows.length) return null;
              return (
                <section key={g.label}>
                  <h2 className="mb-3 text-section font-semibold">{g.label}</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((a) => (
                      <AccountCard key={a.id} a={a} baseCurrency={baseCurrency} onEdit={() => setEditing(a)} />
                    ))}
                  </div>
                </section>
              );
            })}
            {inactive.length > 0 && (
              <section>
                <h2 className="mb-3 text-section font-semibold text-muted-foreground">Closed & archived</h2>
                <div className="grid grid-cols-1 gap-3 opacity-75 sm:grid-cols-2 xl:grid-cols-3">
                  {inactive.map((a) => (
                    <AccountCard key={a.id} a={a} baseCurrency={baseCurrency} onEdit={() => setEditing(a)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <Card className="mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
          <Link2Off className="size-4" />
        </span>
        <div className="flex-1">
          <p className="text-[13.5px] font-medium">Bank synchronization {bankSyncConfigured ? "is configured by your administrator" : "is not connected"}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {bankSyncConfigured
              ? "Connections are made through the provider's own authorization flow. Finora never sees or stores your banking password."
              : "No authorized financial-data provider is configured for this workspace, so no account is linked to a bank. Use manual entry, CSV/Excel import and reconciliation instead — Finora never asks for your online banking password."}
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/import">Import a statement</Link>
        </Button>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New account" : "Edit account"}</DialogTitle>
            <DialogDescription>{editing === "new" ? "Where does this money live?" : "Changes apply to balances immediately."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">
            {editing && (
              <AccountForm
                id={editing === "new" ? undefined : editing.id}
                baseCurrency={baseCurrency}
                hasTransactions={editing !== "new" && editing.transactionCount > 0}
                initial={
                  editing === "new"
                    ? undefined
                    : {
                        name: editing.name,
                        type: editing.type as never,
                        currency: editing.currency,
                        openingBalance: String(editing.isLiability ? Math.abs(Number(editing.openingBalance)) : Number(editing.openingBalance)),
                        openingDate: editing.openingDate.slice(0, 10),
                        institution: editing.institution ?? "",
                        notes: editing.notes ?? "",
                        includeInNetWorth: editing.includeInNetWorth,
                        status: editing.status as never,
                      }
                }
                onDone={() => setEditing(null)}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <Money value={value} showSign={signed} className="mt-1 block text-[18px] font-semibold" />
    </Card>
  );
}

function AccountCard({ a, baseCurrency, onEdit }: { a: AccountRow; baseCurrency: string; onEdit: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const I = TYPE_ICON[a.type] ?? CircleDot;
  const owed = a.isLiability ? -Number(a.balance) : null;
  return (
    <Card interactive className="group relative p-4">
      <Link href={`/accounts/${a.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${a.name}`} />
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
          <I className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{a.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[a.type]}
            {a.institution ? ` · ${a.institution}` : ""} · {a.currency}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${a.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            {a.status === "ACTIVE" && (
              <DropdownMenuItem
                onSelect={async () => {
                  const r = await saveAccountAction(a.id, {
                    name: a.name,
                    type: a.type as never,
                    currency: a.currency,
                    openingBalance: String(a.isLiability ? Math.abs(Number(a.openingBalance)) : Number(a.openingBalance)),
                    openingDate: a.openingDate.slice(0, 10),
                    institution: a.institution,
                    notes: a.notes,
                    includeInNetWorth: a.includeInNetWorth,
                    status: "ARCHIVED",
                  });
                  if (r.ok) {
                    toast.success("Account archived");
                    router.refresh();
                  } else toast.error(r.error);
                }}
              >
                <Archive /> Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-meta text-muted-foreground">{a.isLiability ? (owed! >= 0 ? "Owed" : "Credit balance") : "Balance"}</p>
          <Money value={a.isLiability ? String(Math.abs(Number(a.balance))) : a.balance} currency={a.currency} className={cn("text-[20px] font-semibold", !a.isLiability && Number(a.balance) < 0 && "text-negative")} />
          {a.currency !== baseCurrency && a.baseBalance && <p className="text-[11.5px] text-muted-foreground">≈ {f.money(a.baseBalance)}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {a.isSample && <Badge variant="warning">Sample</Badge>}
          {!a.includeInNetWorth && <Badge variant="outline">Excluded from net worth</Badge>}
          <span className="text-[11px] text-subtle-foreground">{a.lastReconciledAt ? `Reconciled ${f.date(a.lastReconciledAt, { day: "numeric", month: "short" })}` : "Not reconciled"}</span>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${a.name}?`}
        description={a.transactionCount > 0 ? `This account has ${a.transactionCount} transactions and can't be deleted. Archive it instead.` : "This account has no transactions and will be removed permanently."}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const r = await deleteAccountAction(a.id);
          setConfirm(false);
          if (r.ok) {
            toast.success("Account deleted");
            router.refresh();
          } else toast.error(r.error);
        }}
      />
    </Card>
  );
}
