"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Download, FileSpreadsheet, FileUp, History, Info, Loader2, ScanLine, Undo2, Upload, FileJson, Copy } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, NativeSelect } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { EmptyState, Notice, PageHeader } from "@/components/finance/primitives";
import { useAppData } from "@/components/shell/app-shell";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { DATE_FORMATS } from "@/lib/finance/import";
import { commitImportAction, inspectImportAction, previewImportAction, rollbackImportAction, type ImportOptionsInput, type InspectResult, type PreviewRow } from "@/server/actions/imports";
import { cn } from "@/lib/utils";

interface Batch {
  id: string;
  fileName: string;
  format: string;
  accountName: string;
  status: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  errors: { row: number; field: string; message: string; value?: string }[];
  createdAt: string;
  rolledBackAt: string | null;
}

export function ImportView({ history, ocr }: { history: Batch[]; ocr: "on" | "needs-consent" | "unavailable" }) {
  return (
    <div>
      <PageHeader title="Import & Export" description="Bring in bank statements, scan receipts, and take your data with you." />
      <Tabs defaultValue="import">
        <TabsList className="mb-5">
          <TabsTrigger value="import">
            <Upload /> Import statement
          </TabsTrigger>
          <TabsTrigger value="receipt">
            <ScanLine /> Scan receipt
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download /> Export
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> History · {history.length}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="import">
          <ImportWizard />
        </TabsContent>
        <TabsContent value="receipt">
          <ReceiptScanner ocr={ocr} />
        </TabsContent>
        <TabsContent value="export">
          <ExportPanel />
        </TabsContent>
        <TabsContent value="history">
          <ImportHistory history={history} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const MAP_FIELDS: { key: keyof ImportOptionsInput["mapping"]; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount (signed)" },
  { key: "debit", label: "Debit / money out" },
  { key: "credit", label: "Credit / money in" },
  { key: "merchant", label: "Merchant / payee" },
  { key: "category", label: "Category" },
  { key: "notes", label: "Notes" },
];

function ImportWizard() {
  const router = useRouter();
  const f = useFormat();
  const { accounts } = useAppData();
  const [file, setFile] = React.useState<File | null>(null);
  const [info, setInfo] = React.useState<InspectResult | null>(null);
  const [opts, setOpts] = React.useState<ImportOptionsInput | null>(null);
  const [preview, setPreview] = React.useState<{ rows: PreviewRow[]; total: number; valid: number; duplicates: number; errors: { row: number; field: string; message: string; value?: string }[]; invalidRows: number } | null>(null);
  const [busy, setBusy] = React.useState<"inspect" | "preview" | "commit" | null>(null);
  const [drag, setDrag] = React.useState(false);
  const step = !info ? 1 : !preview ? 2 : 3;

  const inspect = async (fl: File) => {
    setFile(fl);
    setPreview(null);
    setBusy("inspect");
    const fd = new FormData();
    fd.append("file", fl);
    const r = await inspectImportAction(fd);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setInfo(r.data!);
    const m = r.data!.mapping;
    setOpts({
      accountId: accounts[0]?.id ?? "",
      mapping: { date: m.date ?? 0, description: m.description ?? 1, amount: m.amount ?? (m.debit != null || m.credit != null ? -1 : 2), debit: m.debit ?? -1, credit: m.credit ?? -1, merchant: m.merchant ?? -1, category: m.category ?? -1, notes: m.notes ?? -1 },
      dateFormat: r.data!.dateFormat as ImportOptionsInput["dateFormat"],
      decimalSeparator: ".",
      invertSign: false,
      skipDuplicates: true,
      skipInvalid: false,
    });
  };
  const fd = () => {
    const d = new FormData();
    d.append("file", file!);
    d.append("options", JSON.stringify(opts));
    return d;
  };
  const runPreview = async () => {
    setBusy("preview");
    const r = await previewImportAction(fd());
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setPreview(r.data!);
  };
  const commit = async () => {
    setBusy("commit");
    const r = await commitImportAction(fd());
    setBusy(null);
    if (!r.ok) return toast.error(r.error, { duration: 8000 });
    toast.success(`Imported ${r.data!.imported} transactions${r.data!.skipped ? ` · ${r.data!.skipped} skipped` : ""}`, {
      action: {
        label: "Undo import",
        onClick: async () => {
          const u = await rollbackImportAction(r.data!.batchId);
          if (u.ok) {
            toast.success(`Removed ${u.data!.removed} imported transactions`);
            router.refresh();
          }
        },
      },
    });
    setFile(null);
    setInfo(null);
    setPreview(null);
    router.refresh();
  };

  if (!accounts.length)
    return (
      <Card>
        <EmptyState icon={<FileUp />} title="Create an account first" description="Imported transactions need an account to belong to." action={<Button size="sm" variant="primary" asChild><Link href="/accounts?new=1">Create account</Link></Button>} />
      </Card>
    );

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Import steps">
        {["Upload file", "Map columns", "Review & import"].map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", step === i + 1 ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className={cn("grid size-6 place-items-center rounded-full border text-[11px]", step > i + 1 ? "border-accent bg-accent text-accent-foreground" : step === i + 1 ? "border-accent text-accent" : "border-border")}>
              {step > i + 1 ? <CheckCircle2 className="size-3.5" /> : i + 1}
            </span>
            {s}
            {i < 2 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardContent className="pt-5">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const fl = e.dataTransfer.files[0];
                if (fl) inspect(fl);
              }}
              className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-14 text-center transition-colors hover:border-border-strong hover:bg-surface-2/50", drag && "border-accent bg-accent-soft/40")}
            >
              {busy === "inspect" ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <FileSpreadsheet className="size-7 text-muted-foreground" />}
              <span className="mt-3 text-sm font-medium">Drop a CSV, Excel (.xlsx) or OFX/QFX statement</span>
              <span className="mt-1 text-[12.5px] text-muted-foreground">or click to choose a file · up to 5 MB / 10,000 rows</span>
              <input type="file" accept=".csv,.xlsx,.ofx,.qfx,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && inspect(e.target.files[0])} />
            </label>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Info className="size-3.5" /> Nothing is saved until you review and confirm.
              </span>
              <a href="/api/import/template" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                <Download className="size-3.5" /> Download CSV template
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {step >= 2 && info && opts && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{info.fileName}</CardTitle>
              <CardDescription>
                {info.format} · {info.rowCount.toLocaleString()} rows
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setInfo(null);
                setPreview(null);
                setFile(null);
              }}
            >
              <ArrowLeft /> Choose another file
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Import into account" htmlFor="im-acct">
                <NativeSelect id="im-acct" value={opts.accountId} onChange={(e) => { setOpts({ ...opts, accountId: e.target.value }); setPreview(null); }}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Date format" htmlFor="im-df" hint={opts.dateFormat === "auto" ? "Couldn't detect — ambiguous dates default to day-first" : "Detected from your file"}>
                <NativeSelect id="im-df" value={opts.dateFormat} onChange={(e) => { setOpts({ ...opts, dateFormat: e.target.value as ImportOptionsInput["dateFormat"] }); setPreview(null); }}>
                  {DATE_FORMATS.map((d) => (
                    <option key={d} value={d}>
                      {d === "auto" ? "Auto-detect" : d}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Decimal separator" htmlFor="im-dec">
                <NativeSelect id="im-dec" value={opts.decimalSeparator} onChange={(e) => { setOpts({ ...opts, decimalSeparator: e.target.value as "." | "," }); setPreview(null); }}>
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </NativeSelect>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
                <Checkbox checked={opts.invertSign} onCheckedChange={(c) => { setOpts({ ...opts, invertSign: !!c }); setPreview(null); }} />
                Positive amounts are spending
              </label>
            </div>

            {!info.fixedMapping && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Column mapping</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {MAP_FIELDS.map((mf) => (
                    <Field key={mf.key} label={mf.label + (mf.required ? " *" : "")} htmlFor={`map-${mf.key}`}>
                      <NativeSelect
                        id={`map-${mf.key}`}
                        value={String(opts.mapping[mf.key] ?? -1)}
                        onChange={(e) => {
                          setOpts({ ...opts, mapping: { ...opts.mapping, [mf.key]: Number(e.target.value) } });
                          setPreview(null);
                        }}
                      >
                        {!mf.required && <option value="-1">— Not in file —</option>}
                        {info.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ))}
                </div>
                <p className="mt-2 text-meta text-muted-foreground">Map either a single signed amount column, or separate debit and credit columns.</p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[12px]">
                <caption className="sr-only">File preview</caption>
                <thead className="bg-surface-2 text-left text-muted-foreground">
                  <tr>
                    {info.headers.map((h, i) => (
                      <th key={i} className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {info.sample.map((r, i) => (
                    <tr key={i}>
                      {info.headers.map((_, j) => (
                        <td key={j} className="max-w-48 truncate px-2.5 py-1.5 whitespace-nowrap">
                          {r[j]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!preview && (
              <div className="flex justify-end">
                <Button variant="primary" onClick={runPreview} loading={busy === "preview"}>
                  Validate & preview
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview && opts && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Review</CardTitle>
              <CardDescription>
                {preview.valid} valid of {preview.total} rows · {preview.duplicates} possible duplicate{preview.duplicates === 1 ? "" : "s"} · {preview.invalidRows} with errors
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.invalidRows > 0 && (
              <Notice tone="negative" icon={<AlertTriangle />}>
                <p className="font-medium">
                  {preview.invalidRows} row{preview.invalidRows === 1 ? " has" : "s have"} invalid required fields. The import is blocked until you fix the file, or explicitly skip these rows.
                </p>
                <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-[12px]">
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      Row {e.row}, {e.field}: {e.message}
                      {e.value ? ` (“${e.value}”)` : ""}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={opts.skipDuplicates} onCheckedChange={(c) => setOpts({ ...opts, skipDuplicates: !!c })} />
                <Copy className="size-3.5 text-muted-foreground" /> Skip possible duplicates ({preview.duplicates})
              </label>
              {preview.invalidRows > 0 && (
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={opts.skipInvalid} onCheckedChange={(c) => setOpts({ ...opts, skipInvalid: !!c })} />
                  Skip the {preview.invalidRows} invalid row{preview.invalidRows === 1 ? "" : "s"} and import the rest
                </label>
              )}
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <caption className="sr-only">Transactions to import</caption>
                <thead className="sticky top-0 bg-surface-2 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.row} className={cn(r.status === "duplicate" && opts.skipDuplicates && "opacity-50")}>
                      <td className="num px-3 py-1.5 text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{f.date(r.date)}</td>
                      <td className="max-w-72 truncate px-3 py-1.5">{r.merchant ? `${r.merchant} · ` : ""}{r.description}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {r.category ?? <span className="text-subtle-foreground italic">Uncategorized</span>}
                        {r.category && r.categorySource !== "IMPORT" && <span className="ml-1 text-[10.5px] text-muted-foreground">({r.categorySource.toLowerCase()})</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Money value={r.amount} showSign tone={Number(r.amount) > 0 ? "positive" : "neutral"} />
                      </td>
                      <td className="px-3 py-1.5">{r.status === "duplicate" ? <Badge variant="warning">Duplicate?</Badge> : <Badge variant="positive">New</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.valid > preview.rows.length && <p className="text-meta text-muted-foreground">Showing the first {preview.rows.length} rows.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button variant="primary" loading={busy === "commit"} disabled={preview.invalidRows > 0 && !opts.skipInvalid} onClick={commit}>
                Import {Math.max(0, preview.valid - (opts.skipDuplicates ? preview.duplicates : 0))} transactions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ImportHistory({ history }: { history: Batch[] }) {
  const router = useRouter();
  const f = useFormat();
  const [rollback, setRollback] = React.useState<Batch | null>(null);
  const [errorsOf, setErrorsOf] = React.useState<Batch | null>(null);
  if (!history.length) return <Card><EmptyState icon={<History />} title="No imports yet" description="Each import is recorded here so you can review errors or undo it." /></Card>;
  return (
    <Card>
      <CardContent className="overflow-x-auto pt-4">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Import history</caption>
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">File</th>
              <th className="py-2 font-medium">Account</th>
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 text-right font-medium">Imported</th>
              <th className="py-2 text-right font-medium">Skipped</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {history.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0">
                <td className="py-2.5">
                  <span className="font-medium">{b.fileName}</span> <Badge variant="outline">{b.format}</Badge>
                  {b.status === "ROLLED_BACK" && <Badge variant="warning" className="ml-1">Rolled back</Badge>}
                </td>
                <td className="py-2.5 text-muted-foreground">{b.accountName}</td>
                <td className="py-2.5 whitespace-nowrap text-muted-foreground">{f.date(b.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className="num py-2.5 text-right">{b.importedCount}</td>
                <td className="num py-2.5 text-right">{b.skippedCount}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {b.errors.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setErrorsOf(b)}>
                      Errors ({b.errors.length})
                    </Button>
                  )}
                  {b.status !== "ROLLED_BACK" && (
                    <Button size="sm" variant="ghost" onClick={() => setRollback(b)}>
                      <Undo2 /> Roll back
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <ConfirmDialog
        open={!!rollback}
        onOpenChange={(o) => !o && setRollback(null)}
        title="Roll back this import?"
        description={rollback ? `Deletes the ${rollback.importedCount} transactions created by “${rollback.fileName}”. Transactions you added manually aren't affected.` : ""}
        confirmLabel="Roll back"
        destructive
        onConfirm={async () => {
          const r = await rollbackImportAction(rollback!.id);
          setRollback(null);
          if (r.ok) {
            toast.success(`Removed ${r.data!.removed} transactions`);
            router.refresh();
          } else toast.error(r.error);
        }}
      />
      <Dialog open={!!errorsOf} onOpenChange={(o) => !o && setErrorsOf(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Error report · {errorsOf?.fileName}</DialogTitle>
            <DialogDescription>Rows that were skipped because of invalid data.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">
            <ul className="space-y-1 text-[13px]">
              {errorsOf?.errors.map((e, i) => (
                <li key={i}>
                  <span className="num text-muted-foreground">Row {e.row}</span> · {e.field}: {e.message}
                  {e.value ? <span className="text-muted-foreground"> (“{e.value}”)</span> : null}
                </li>
              ))}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ExportPanel() {
  const items = [
    { title: "All transactions · CSV", desc: "Every transaction with category, account, currency and conversion details.", href: "/api/export/transactions?format=csv", icon: FileSpreadsheet },
    { title: "All transactions · Excel", desc: "Same data as an .xlsx workbook with formatted amounts.", href: "/api/export/transactions?format=xlsx", icon: FileSpreadsheet },
    { title: "Financial report · PDF", desc: "Last 6 months: cash flow, categories, merchants and income.", href: "/api/reports/export?format=pdf&range=last_6_months", icon: Download },
    { title: "Everything · JSON", desc: "A complete copy of all your Finora data for portability or backup.", href: "/api/export/all", icon: FileJson },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <a key={it.title} href={it.href} className="block rounded-xl focus-visible:outline-offset-4">
          <Card interactive className="flex h-full items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
              <it.icon className="size-4" />
            </span>
            <span>
              <span className="block text-[14px] font-medium">{it.title}</span>
              <span className="block text-[12.5px] text-muted-foreground">{it.desc}</span>
            </span>
          </Card>
        </a>
      ))}
      <p className="text-meta text-muted-foreground sm:col-span-2">
        Filtered exports are available from the Transactions and Reports pages. Exports are logged in your audit trail.
      </p>
    </div>
  );
}

interface Extraction {
  readable: boolean;
  merchant: string | null;
  date: string | null;
  total: string | null;
  tax: string | null;
  currency: string | null;
  paymentMethod: string | null;
  lineItems: { description: string; amount: string | null }[];
}

function ReceiptScanner({ ocr }: { ocr: "on" | "needs-consent" | "unavailable" }) {
  const router = useRouter();
  const { accounts, categories } = useAppData();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ id: string; ocr: Extraction | null; ocrError: string | null } | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("ocr", "1");
    const res = await fetch("/api/receipts", { method: "POST", body: fd });
    setBusy(false);
    const body = (await res.json().catch(() => ({}))) as { id?: string; ocr?: Extraction | null; ocrError?: string | null; error?: string };
    if (!res.ok || !body.id) return toast.error(body.error ?? "Upload failed");
    setResult({ id: body.id, ocr: body.ocr ?? null, ocrError: body.ocrError ?? null });
    setFormOpen(true);
  };
  const ex = result?.ocr;
  const lineNote = ex?.lineItems.length ? `Items: ${ex.lineItems.map((l) => `${l.description}${l.amount ? ` ${l.amount}` : ""}`).join("; ")}`.slice(0, 1500) : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Scan a receipt</CardTitle>
            <CardDescription>Upload a photo or PDF. You&apos;ll review every extracted value before anything is saved.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ocr === "unavailable" && <Notice>Automatic text extraction isn&apos;t configured for this workspace. You can still upload a receipt, fill in the details yourself, and keep the encrypted receipt attached.</Notice>}
          {ocr === "needs-consent" && (
            <Notice>
              Text extraction uses the AI provider and is off. <Link href="/settings#privacy" className="underline">Enable AI in Settings</Link> to use it, or continue and enter details manually.
            </Notice>
          )}
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-12 text-center transition-colors hover:border-border-strong hover:bg-surface-2/50">
            {busy ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <Camera className="size-7 text-muted-foreground" />}
            <span className="mt-3 text-sm font-medium">{busy ? (ocr === "on" ? "Reading receipt…" : "Uploading…") : "Take a photo or choose a file"}</span>
            <span className="mt-1 text-[12.5px] text-muted-foreground">JPEG, PNG, WebP or PDF · up to 10 MB · encrypted at rest</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tips for clear scans</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted-foreground">
            <li>Lay the receipt flat in good light and fill the frame.</li>
            <li>Avoid shadows and glare across the total.</li>
            <li>Blurry or partial receipts are flagged — values Finora can&apos;t read clearly are left blank, never guessed.</li>
            <li>To attach a receipt to an existing transaction, open it from Transactions and choose “Attach”.</li>
          </ul>
        </CardContent>
      </Card>
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Confirm receipt details</DialogTitle>
            <DialogDescription>Check and edit the values below. The receipt will be attached to the new transaction.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-5">
            {result?.ocrError && <Notice tone="warning" icon={<AlertTriangle />}>{result.ocrError}</Notice>}
            {ex?.readable && <Notice tone="positive" icon={<CheckCircle2 />}>Extracted {[ex.merchant && "merchant", ex.date && "date", ex.total && "total", ex.tax && "tax", ex.lineItems.length && `${ex.lineItems.length} line items`].filter(Boolean).join(", ")}. Please verify.</Notice>}
            {formOpen && result && (
              <TransactionForm
                accounts={accounts}
                categories={categories}
                mode="full"
                prefill={{
                  type: "EXPENSE",
                  amount: ex?.total ?? "",
                  description: ex?.merchant ? `${ex.merchant}` : "Receipt purchase",
                  merchant: ex?.merchant ?? "",
                  ...(ex?.date ? { date: `${ex.date}T12:00` } : {}),
                  paymentMethod: ex?.paymentMethod ?? "",
                  notes: [ex?.tax ? `Tax: ${ex.tax}` : "", lineNote].filter(Boolean).join("\n"),
                }}
                onDone={async (id) => {
                  setFormOpen(false);
                  if (id) {
                    await fetch(`/api/receipts/${result.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: id }) });
                    toast.success("Receipt attached to the new transaction");
                    router.refresh();
                  }
                  setResult(null);
                }}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
