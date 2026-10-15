"use client";

import * as React from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftRight, ChevronDown, Minus, Plus, Receipt, RotateCcw, Scale, SplitSquareHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { transactionSchema, type TransactionFormValues } from "@/lib/validators";
import type { AccountOption, CategoryOption, TxnDTO } from "@/lib/dto";
import { SUPPORTED_CURRENCIES, dec } from "@/lib/money";
import { createMerchantRuleAction, createTransactionAction, undoEditAction, updateTransactionAction } from "@/server/actions/transactions";
import { useFormat } from "@/components/finance/format";

const TYPES = [
  { value: "EXPENSE", label: "Expense", icon: Minus },
  { value: "INCOME", label: "Income", icon: Plus },
  { value: "TRANSFER", label: "Transfer", icon: ArrowLeftRight },
  { value: "REFUND", label: "Refund", icon: RotateCcw },
  { value: "ADJUSTMENT", label: "Adjust", icon: Scale },
] as const;

const TYPE_HELP: Record<string, string> = {
  EXPENSE: "Money spent. Counts toward spending and budgets.",
  INCOME: "Genuine earnings like salary, freelance or interest.",
  TRANSFER: "Money moved between your own accounts. Never counted as income or spending.",
  REFUND: "Refunds, reimbursements and chargebacks. Reduces spending in the chosen category — not counted as income.",
  ADJUSTMENT: "Balance correction (positive or negative). Excluded from income and spending.",
};

function nowLocal(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

function toLocalInput(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

export function CategorySelect({
  categories,
  kind,
  value,
  onChange,
  id,
  includeEmpty = true,
  invalid,
}: {
  categories: CategoryOption[];
  kind: "EXPENSE" | "INCOME" | "TRANSFER" | "ANY";
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  id?: string;
  includeEmpty?: boolean;
  invalid?: boolean;
}) {
  const filtered = categories.filter((c) => kind === "ANY" || c.kind === kind);
  const parents = filtered.filter((c) => !c.parentId);
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-invalid={invalid}>
      {includeEmpty && <option value="">Uncategorized</option>}
      {parents.map((p) => {
        const kids = filtered.filter((c) => c.parentId === p.id);
        return kids.length ? (
          <optgroup key={p.id} label={p.name}>
            <option value={p.id}>{p.name}</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {p.name} › {k.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        );
      })}
    </NativeSelect>
  );
}

export function TransactionForm({
  accounts,
  categories,
  initial,
  mode = "quick",
  defaultType = "EXPENSE",
  defaultAccountId,
  prefill,
  onDone,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  initial?: TxnDTO | null;
  mode?: "quick" | "full";
  defaultType?: TransactionFormValues["type"];
  defaultAccountId?: string;
  prefill?: Partial<TransactionFormValues>;
  onDone?: (id?: string) => void;
}) {
  const f = useFormat();
  const lastAccount = React.useMemo(() => {
    if (typeof window === "undefined") return undefined;
    try {
      return localStorage.getItem("finora:lastAccount") ?? undefined;
    } catch {
      return undefined;
    }
  }, []);
  const activeAccounts = accounts;
  const firstAccount = defaultAccountId ?? (lastAccount && accounts.some((a) => a.id === lastAccount) ? lastAccount : accounts[0]?.id) ?? "";

  const defaults: TransactionFormValues = initial
    ? {
        type: initial.type,
        amount: initial.type === "ADJUSTMENT" ? initial.amount : dec(initial.amount).abs().toString(),
        description: initial.description,
        date: toLocalInput(initial.date, f.timezone),
        accountId: initial.accountId,
        toAccountId: initial.toAccountId,
        toAmount: initial.toAmount ?? undefined,
        categoryId: initial.categoryId,
        merchant: initial.merchant ?? "",
        status: initial.status,
        paymentMethod: initial.paymentMethod ?? "",
        notes: initial.notes ?? "",
        tags: initial.tags.join(", "),
        isReimbursable: initial.isReimbursable,
        originalAmount: initial.originalAmount ?? undefined,
        originalCurrency: initial.originalCurrency ?? "",
        splits: initial.splits.map((s) => ({ categoryId: s.categoryId, amount: dec(s.amount).toString(), note: s.note })),
      }
    : {
        type: defaultType,
        amount: "",
        description: "",
        date: nowLocal(f.timezone),
        accountId: firstAccount,
        toAccountId: null,
        categoryId: null,
        merchant: "",
        status: "CLEARED",
        paymentMethod: "",
        notes: "",
        tags: "",
        isReimbursable: false,
        originalCurrency: "",
        splits: [],
        ...prefill,
      };

  const form = useForm<TransactionFormValues>({ resolver: zodResolver(transactionSchema), defaultValues: defaults, mode: "onTouched" });
  const { register, handleSubmit, watch, setValue, formState, setError, control } = form;
  const splits = useFieldArray({ control, name: "splits" });
  const [expanded, setExpanded] = React.useState(mode === "full" || !!initial);
  const [splitMode, setSplitMode] = React.useState((initial?.splits.length ?? 0) > 0);
  const [foreign, setForeign] = React.useState(!!initial?.originalAmount);
  const [pending, startTransition] = React.useTransition();

  const type = watch("type");
  const accountId = watch("accountId");
  const toAccountId = watch("toAccountId");
  const amount = watch("amount");
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === "TRANSFER" && account && toAccount && account.currency !== toAccount.currency;
  const catKind = type === "INCOME" ? "INCOME" : type === "TRANSFER" ? "TRANSFER" : "EXPENSE";
  const splitTotal = (watch("splits") ?? []).reduce((a, s) => {
    try {
      return a.plus(dec(s.amount || "0"));
    } catch {
      return a;
    }
  }, dec(0));
  const amountDec = (() => {
    try {
      return dec((amount || "0").replace(/,/g, "")).abs();
    } catch {
      return dec(0);
    }
  })();

  const err = (k: string) => (formState.errors as Record<string, { message?: string }>)[k]?.message;

  const onSubmit = handleSubmit((values) => {
    const payload = { ...values, splits: splitMode ? values.splits : [], originalAmount: foreign ? values.originalAmount : undefined };
    startTransition(async () => {
      const res = initial ? await updateTransactionAction(initial.id, payload) : await createTransactionAction(payload);
      if (!res.ok) {
        for (const [k, msgs] of Object.entries(res.fieldErrors ?? {})) setError(k as keyof TransactionFormValues, { message: msgs[0] });
        toast.error(res.error);
        return;
      }
      try {
        localStorage.setItem("finora:lastAccount", values.accountId);
      } catch {}
      if (initial && res.data && "auditId" in res.data) {
        const auditId = res.data.auditId;
        toast.success("Transaction updated", {
          action: {
            label: "Undo",
            onClick: async () => {
              const u = await undoEditAction(auditId);
              if (u.ok) {
                toast.success("Change undone");
              } else toast.error(u.error);
            },
          },
        });
        const s = res.data.suggestRule;
        if (s) {
          const cat = categories.find((c) => c.id === s.categoryId);
          toast(`Always categorize “${s.merchant.slice(0, 40)}” as ${cat?.name ?? "this category"}?`, {
            description: "Creates a merchant rule. Existing uncategorized or auto-categorized matches will be updated and counted.",
            duration: 12000,
            action: {
              label: "Create rule",
              onClick: async () => {
                const r = await createMerchantRuleAction(s.merchant, s.categoryId, true);
                if (r.ok) toast.success(`Rule saved${r.data?.updated ? ` · ${r.data.updated} past transaction${r.data.updated === 1 ? "" : "s"} updated` : ""}`);
                else toast.error(r.error);
              },
            },
          });
        }
      } else {
        toast.success(type === "TRANSFER" ? "Transfer recorded" : "Transaction added", {
          description: `${values.description} · ${f.money(values.amount, account?.currency)}`,
        });
      }
      onDone?.(res.data && "id" in res.data ? res.data.id : initial?.id);
    });
  });

  if (!accounts.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Create an account first so Finora knows where this money lives.
        <div className="mt-3">
          <Button asChild variant="primary" size="sm">
            <a href="/accounts?new=1">Create account</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* Type selector */}
      <div role="radiogroup" aria-label="Transaction type" className="grid grid-cols-5 gap-1 rounded-lg bg-surface-2 p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            onClick={() => {
              setValue("type", t.value);
              setValue("categoryId", null);
            }}
            className={cn(
              "flex h-8 items-center justify-center gap-1 rounded-md text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground",
              type === t.value && "bg-surface text-foreground shadow-sm",
            )}
          >
            <t.icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.slice(0, 4)}</span>
          </button>
        ))}
      </div>
      <p className="-mt-3 text-meta text-muted-foreground">{TYPE_HELP[type]}</p>

      {/* Amount */}
      <div className="grid gap-4 sm:grid-cols-[1.1fr_1fr]">
        <Field label="Amount" htmlFor="amount" error={err("amount")} hint={type === "ADJUSTMENT" ? "Use a minus sign to decrease the balance." : undefined}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{account?.currency}</span>
            <Input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              autoFocus={!initial}
              className="num h-10 pl-12 text-lg font-medium"
              aria-invalid={!!err("amount")}
              {...register("amount")}
            />
          </div>
        </Field>
        <Field label="Date" htmlFor="date" error={err("date")}>
          <Input id="date" type="datetime-local" className="h-10" {...register("date")} aria-invalid={!!err("date")} />
        </Field>
      </div>

      <Field label="Description" htmlFor="description" error={err("description")}>
        <Input id="description" placeholder={type === "INCOME" ? "e.g. October salary" : type === "TRANSFER" ? "e.g. Move to savings" : "e.g. Groceries at FreshMart"} {...register("description")} aria-invalid={!!err("description")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={type === "TRANSFER" ? "From account" : "Account"} htmlFor="accountId" error={err("accountId")}>
          <NativeSelect id="accountId" {...register("accountId")}>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {type === "TRANSFER" ? (
          <Field label="To account" htmlFor="toAccountId" error={err("toAccountId")}>
            <NativeSelect id="toAccountId" value={toAccountId ?? ""} onChange={(e) => setValue("toAccountId", e.target.value || null, { shouldValidate: true })} aria-invalid={!!err("toAccountId")}>
              <option value="">Choose account…</option>
              {activeAccounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
            </NativeSelect>
          </Field>
        ) : !splitMode && type !== "ADJUSTMENT" ? (
          <Field label="Category" htmlFor="categoryId" hint={!initial ? "Leave empty to auto-categorize from your rules and history." : undefined}>
            <CategorySelect id="categoryId" categories={categories} kind={catKind} value={watch("categoryId")} onChange={(v) => setValue("categoryId", v)} />
          </Field>
        ) : null}
      </div>

      {crossCurrency && (
        <Field label={`Amount received (${toAccount!.currency})`} htmlFor="toAmount" error={err("toAmount")} hint="Leave empty to convert using the exchange rate for this date.">
          <Input id="toAmount" inputMode="decimal" className="num" placeholder="Auto-convert" {...register("toAmount")} />
        </Field>
      )}

      {type === "TRANSFER" && (
        <Field label="Category" htmlFor="categoryIdT" optional>
          <CategorySelect id="categoryIdT" categories={categories} kind="TRANSFER" value={watch("categoryId")} onChange={(v) => setValue("categoryId", v)} />
        </Field>
      )}

      {/* Expandable details */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          More details — merchant, tags, notes, split, currency
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
        {expanded && (
          <div className="space-y-4 border-t border-border p-3.5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Merchant" htmlFor="merchant" optional>
                <Input id="merchant" {...register("merchant")} />
              </Field>
              <Field label="Payment method" htmlFor="paymentMethod" optional>
                <Input id="paymentMethod" list="payment-methods" placeholder="Card, UPI, cash…" {...register("paymentMethod")} />
                <datalist id="payment-methods">
                  {["Debit card", "Credit card", "UPI", "Cash", "Bank transfer", "Wallet", "Cheque"].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label="Tags" htmlFor="tags" optional hint="Comma separated">
                <Input id="tags" placeholder="work, trip-goa" {...register("tags")} />
              </Field>
              <Field label="Status" htmlFor="status">
                <NativeSelect id="status" {...register("status")}>
                  <option value="CLEARED">Cleared</option>
                  <option value="PENDING">Pending</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes" optional>
              <Textarea id="notes" rows={2} {...register("notes")} />
            </Field>

            {type === "EXPENSE" && (
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium">Reimbursable</span>
                  <span className="block text-meta text-muted-foreground">Someone will pay you back. Excluded from spending if enabled in Settings.</span>
                </span>
                <Switch checked={watch("isReimbursable")} onCheckedChange={(v) => setValue("isReimbursable", v)} aria-label="Reimbursable" />
              </label>
            )}

            {type !== "TRANSFER" && type !== "ADJUSTMENT" && (
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium">Foreign currency purchase</span>
                  <span className="block text-meta text-muted-foreground">Record the original amount charged in another currency.</span>
                </span>
                <Switch checked={foreign} onCheckedChange={setForeign} aria-label="Foreign currency purchase" />
              </label>
            )}
            {foreign && (
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label="Original amount" htmlFor="originalAmount" error={err("originalAmount")}>
                  <Input id="originalAmount" inputMode="decimal" className="num" {...register("originalAmount")} />
                </Field>
                <Field label="Currency" htmlFor="originalCurrency">
                  <NativeSelect id="originalCurrency" {...register("originalCurrency")}>
                    <option value="">—</option>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            )}

            {(type === "EXPENSE" || type === "REFUND" || type === "INCOME") && (
              <div>
                <label className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2 font-medium">
                    <SplitSquareHorizontal className="size-4 text-muted-foreground" /> Split across categories
                  </span>
                  <Switch
                    checked={splitMode}
                    onCheckedChange={(v) => {
                      setSplitMode(v);
                      if (v && splits.fields.length === 0) {
                        splits.append({ categoryId: watch("categoryId") ?? null, amount: amountDec.toString(), note: "" });
                        splits.append({ categoryId: null, amount: "", note: "" });
                      }
                    }}
                    aria-label="Split across categories"
                  />
                </label>
                {splitMode && (
                  <div className="mt-3 space-y-2">
                    {splits.fields.map((field, i) => (
                      <div key={field.id} className="grid grid-cols-[1fr_110px_auto] items-start gap-2">
                        <CategorySelect categories={categories} kind={catKind} value={watch(`splits.${i}.categoryId`)} onChange={(v) => setValue(`splits.${i}.categoryId`, v)} />
                        <Input inputMode="decimal" className="num" placeholder="0.00" aria-label={`Split ${i + 1} amount`} {...register(`splits.${i}.amount`)} />
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove split" onClick={() => splits.remove(i)} disabled={splits.fields.length <= 2}>
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => splits.append({ categoryId: null, amount: "", note: "" })}>
                        <Plus /> Add part
                      </Button>
                      <span className={cn("num text-meta", splitTotal.eq(amountDec) ? "text-positive" : "text-warning")}>
                        {f.money(splitTotal.toString(), account?.currency)} of {f.money(amountDec.toString(), account?.currency)}
                        {splitTotal.eq(amountDec) ? " · balanced" : ` · ${f.money(amountDec.minus(splitTotal).toString(), account?.currency)} left`}
                      </span>
                    </div>
                    {err("splits") && <p className="text-meta text-negative">{err("splits")}</p>}
                  </div>
                )}
              </div>
            )}
            {initial?.receipts.length ? (
              <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
                <Receipt className="size-3.5" /> {initial.receipts.length} receipt attached
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="hidden text-meta text-subtle-foreground sm:block">
          <kbd className="font-sans">Ctrl</kbd> + <kbd className="font-sans">Enter</kbd> to save
        </span>
        <div className="flex gap-2">
          {onDone && (
            <Button type="button" variant="ghost" onClick={() => onDone()}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            onKeyDown={undefined}
          >
            {initial ? "Save changes" : type === "TRANSFER" ? "Record transfer" : "Add transaction"}
          </Button>
        </div>
      </div>
      <KeyboardSubmit onSubmit={onSubmit} />
    </form>
  );
}

function KeyboardSubmit({ onSubmit }: { onSubmit: () => void }) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onSubmit]);
  return null;
}
