"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, FileText, Pencil, Sparkles, Trash2, Upload, Paperclip, Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, Separator } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryBadge, StatRow } from "@/components/finance/primitives";
import { useAppData } from "@/components/shell/app-shell";
import type { TxnDTO } from "@/lib/dto";
import { confirmCategoryAction, deleteTransactionsAction, duplicateTransactionAction, getTransactionDetail, restoreTransactionsAction } from "@/server/actions/transactions";
import { TransactionForm } from "./transaction-form";
import { txnVisual, TxnAmount } from "./transaction-row";

const SOURCE_LABEL: Record<string, string> = {
  USER: "Set by you",
  RULE: "Matched a rule",
  MERCHANT: "Merchant mapping",
  HISTORY: "Based on your history",
  AI: "AI suggestion",
  IMPORT: "From import",
  NONE: "Not categorized",
};

export function TransactionDrawer({ id, open, onOpenChange, initial }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; initial?: TxnDTO }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts, categories, byId } = useAppData();
  const [t, setT] = React.useState<TxnDTO | null>(initial ?? null);
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    const d = await getTransactionDetail(id);
    if (d) setT(d);
  }, [id]);

  React.useEffect(() => {
    if (open) {
      setEditing(false);
      reload();
    }
  }, [open, reload]);

  if (!t) return null;
  const v = txnVisual(t, byId);

  const remove = async () => {
    const r = await deleteTransactionsAction([t.id]);
    setConfirmDelete(false);
    if (!r.ok) return toast.error(r.error);
    onOpenChange(false);
    router.refresh();
    toast.success("Transaction deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          await restoreTransactionsAction([t.id]);
          router.refresh();
          toast.success("Transaction restored");
        },
      },
    });
  };

  const uploadReceipt = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("transactionId", t.id);
    const res = await fetch("/api/receipts", { method: "POST", body: fd });
    setUploading(false);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return toast.error(body.error ?? "Upload failed");
    toast.success("Receipt attached");
    reload();
    router.refresh();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full">
          <div className="border-b border-border px-6 pt-5 pb-4 pr-14">
            <DialogTitle className="text-base font-semibold">{editing ? "Edit transaction" : t.merchant || t.description}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] text-muted-foreground">
              {f.date(t.date, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </DialogDescription>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
            {editing ? (
              <TransactionForm
                accounts={accounts.some((a) => a.id === t.accountId) ? accounts : [...accounts, { id: t.accountId, name: t.accountName, type: "OTHER", currency: t.currency }]}
                categories={categories}
                initial={t}
                mode="full"
                onDone={(saved) => {
                  setEditing(false);
                  if (saved) {
                    reload();
                    router.refresh();
                  }
                }}
              />
            ) : (
              <div className="space-y-6">
                <div className="rounded-xl bg-surface-2 p-5 text-center">
                  <TxnAmount t={t} className="text-[28px] font-semibold tracking-tight" />
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                    <Badge variant={t.type === "INCOME" ? "positive" : t.type === "REFUND" ? "accent" : "neutral"}>{t.type.toLowerCase()}</Badge>
                    <Badge variant={t.status === "PENDING" ? "warning" : "outline"}>{t.status === "PENDING" ? "Pending" : "Cleared"}</Badge>
                    {t.isReimbursable && <Badge variant="info">Reimbursable</Badge>}
                    {t.isSample && <Badge variant="warning">Sample data</Badge>}
                  </div>
                  {t.originalAmount && t.originalCurrency && (
                    <p className="mt-2 text-meta text-muted-foreground">
                      Originally <Money value={t.originalAmount} currency={t.originalCurrency} className="text-meta" />
                    </p>
                  )}
                </div>

                {t.needsReview && t.type !== "TRANSFER" && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-4" />
                      {t.categoryId ? `Suggested category (${Math.round((t.categoryConfidence ?? 0) * 100)}% confidence) — please confirm.` : "Not categorized yet."}
                    </span>
                    {t.categoryId ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await confirmCategoryAction(t.id);
                          reload();
                          router.refresh();
                        }}
                      >
                        <Check /> Confirm
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                        Categorize
                      </Button>
                    )}
                  </div>
                )}

                <section>
                  <StatRow label="Description" value={t.description} />
                  {t.merchant && <StatRow label="Merchant" value={t.merchant} />}
                  <StatRow label={t.type === "TRANSFER" ? "From" : "Account"} value={t.accountName} />
                  {t.type === "TRANSFER" && (
                    <StatRow
                      label="To"
                      value={
                        <span>
                          {t.toAccountName}
                          {t.toAmount && t.toCurrency && t.toCurrency !== t.currency && (
                            <span className="text-muted-foreground">
                              {" "}
                              · received <Money value={t.toAmount} currency={t.toCurrency} />
                            </span>
                          )}
                        </span>
                      }
                    />
                  )}
                  {t.splits.length === 0 ? (
                    <StatRow
                      label="Category"
                      value={
                        <span className="flex flex-col items-end gap-0.5">
                          <CategoryBadge name={v.name} icon={v.icon} color={v.color} />
                          <span className="text-[11px] font-normal text-subtle-foreground">
                            {SOURCE_LABEL[t.categorySource]}
                            {t.categoryConfidence !== null && t.categorySource !== "USER" ? ` · ${Math.round(t.categoryConfidence * 100)}%` : ""}
                          </span>
                        </span>
                      }
                    />
                  ) : null}
                  {t.paymentMethod && <StatRow label="Payment method" value={t.paymentMethod} />}
                  {t.tags.length > 0 && (
                    <StatRow
                      label="Tags"
                      value={
                        <span className="flex flex-wrap justify-end gap-1">
                          {t.tags.map((x) => (
                            <Badge key={x} variant="outline">
                              #{x}
                            </Badge>
                          ))}
                        </span>
                      }
                    />
                  )}
                  {t.recurringName && <StatRow label="Recurring schedule" value={t.recurringName} />}
                  {t.importFile && <StatRow label="Imported from" value={t.importFile} />}
                </section>

                {t.splits.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[13px] font-semibold">Split</h3>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {t.splits.map((s, i) => {
                        const c = s.categoryId ? byId.get(s.categoryId) : undefined;
                        return (
                          <li key={i} className="flex items-center justify-between px-3 py-2 text-[13px]">
                            <CategoryBadge name={c?.name ?? "Uncategorized"} icon={c?.icon} color={c?.color} />
                            <Money value={s.amount} currency={t.currency} />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {t.notes && (
                  <section>
                    <h3 className="mb-1.5 text-[13px] font-semibold">Notes</h3>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{t.notes}</p>
                  </section>
                )}

                {t.baseCurrency && t.currency !== t.baseCurrency && (
                  <section className="rounded-lg border border-border p-3.5">
                    <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
                      <Info className="size-3.5 text-muted-foreground" /> Currency conversion
                    </h3>
                    {t.baseAmount ? (
                      <p className="text-[12.5px] text-muted-foreground">
                        <Money value={t.baseAmount} currency={t.baseCurrency} className="text-foreground" /> at {Number(t.fxRate).toFixed(6)} {t.currency}/{t.baseCurrency}
                        {t.fxRateDate ? ` · rate date ${f.date(t.fxRateDate, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as Intl.DateTimeFormatOptions)}` : ""} · source: {t.fxRateSource}
                      </p>
                    ) : (
                      <p className="text-[12.5px] text-warning">No exchange rate was available, so this transaction is excluded from base-currency totals. Add a manual rate in Settings.</p>
                    )}
                  </section>
                )}

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold">Receipts</h3>
                    <Button size="sm" variant="ghost" loading={uploading} onClick={() => fileRef.current?.click()}>
                      <Upload /> Attach
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadReceipt(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {t.receipts.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">No receipts. Images and PDFs are encrypted and only visible to you.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {t.receipts.map((r) => (
                        <li key={r.id}>
                          <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener" className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] hover:bg-surface-2">
                            {r.mimeType === "application/pdf" ? <FileText className="size-4 text-muted-foreground" /> : <Paperclip className="size-4 text-muted-foreground" />}
                            <span className="flex-1 truncate">{r.fileName}</span>
                            <span className="text-meta text-muted-foreground">{Math.ceil(r.size / 1024)} KB</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
          {!editing && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center gap-2 px-6 py-4">
                <Button variant="primary" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  onClick={async () => {
                    const r = await duplicateTransactionAction(t.id);
                    if (r.ok) {
                      toast.success("Duplicated with today's date");
                      router.refresh();
                    } else toast.error(r.error);
                  }}
                >
                  <Copy /> Duplicate
                </Button>
                <Button variant="ghost" className="ml-auto text-negative hover:bg-negative-soft hover:text-negative" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this transaction?"
        description="Balances, budgets and reports will update immediately. You can undo right after deleting; deleted transactions are purged after 30 days."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
