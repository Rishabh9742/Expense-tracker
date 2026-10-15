"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { saveAccountAction, type AccountFormValues } from "@/server/actions/accounts";

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH: "Cash",
  CHECKING: "Checking / current",
  SAVINGS: "Savings",
  CREDIT_CARD: "Credit card",
  DIGITAL_WALLET: "Digital wallet",
  INVESTMENT: "Investment",
  LOAN: "Loan",
  OTHER: "Other",
};

export function AccountForm({
  initial,
  id,
  baseCurrency,
  hasTransactions,
  onDone,
}: {
  initial?: Partial<AccountFormValues>;
  id?: string;
  baseCurrency: string;
  hasTransactions?: boolean;
  onDone: (id?: string) => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = React.useState<AccountFormValues>({
    name: "",
    type: "CHECKING",
    currency: baseCurrency,
    openingBalance: "0",
    openingDate: today,
    institution: "",
    notes: "",
    includeInNetWorth: true,
    status: "ACTIVE",
    ...initial,
  });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  const liability = v.type === "CREDIT_CARD" || v.type === "LOAN";
  const set = <K extends keyof AccountFormValues>(k: K, val: AccountFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAccountAction(id ?? null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            return;
          }
          toast.success(id ? "Account updated" : "Account created");
          router.refresh();
          onDone(r.data?.id);
        });
      }}
      noValidate
    >
      <Field label="Account name" htmlFor="a-name" error={errors.name?.[0]}>
        <Input id="a-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. HDFC Salary Account" autoFocus aria-invalid={!!errors.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="a-type">
          <NativeSelect id="a-type" value={v.type} onChange={(e) => set("type", e.target.value as AccountFormValues["type"])}>
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Currency" htmlFor="a-cur" error={errors.currency?.[0]} hint={hasTransactions ? "Locked after transactions exist" : undefined}>
          <NativeSelect id="a-cur" value={v.currency} disabled={hasTransactions} onChange={(e) => set("currency", e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={liability ? "Amount owed on opening date" : "Opening balance"}
          htmlFor="a-open"
          error={errors.openingBalance?.[0]}
          hint={liability ? "Enter what you owed as a positive number." : "Balance before the first transaction you'll record."}
        >
          <Input id="a-open" inputMode="decimal" className="num" value={v.openingBalance} onChange={(e) => set("openingBalance", e.target.value)} aria-invalid={!!errors.openingBalance} />
        </Field>
        <Field label="Opening date" htmlFor="a-date">
          <Input id="a-date" type="date" value={v.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Institution" htmlFor="a-inst" optional>
        <Input id="a-inst" value={v.institution ?? ""} onChange={(e) => set("institution", e.target.value)} placeholder="Bank or provider name" />
      </Field>
      <Field label="Notes" htmlFor="a-notes" optional hint="Don't store full account numbers or passwords here.">
        <Textarea id="a-notes" rows={2} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-[13px]">
          Include in net worth
          <Switch checked={v.includeInNetWorth} onCheckedChange={(c) => set("includeInNetWorth", c)} aria-label="Include in net worth" />
        </label>
        {id && (
          <Field label="Status" htmlFor="a-status">
            <NativeSelect id="a-status" value={v.status} onChange={(e) => set("status", e.target.value as AccountFormValues["status"])}>
              <option value="ACTIVE">Active</option>
              <option value="CLOSED">Closed</option>
              <option value="ARCHIVED">Archived</option>
            </NativeSelect>
          </Field>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {id ? "Save account" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
