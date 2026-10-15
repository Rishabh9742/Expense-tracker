"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Plus,
  Receipt,
  Search,
  SearchX,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
  Clock,
  CheckCircle2,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, Popover, PopoverContent, PopoverTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryIcon, EmptyState, PageHeader, Notice } from "@/components/finance/primitives";
import { useAppData, useQuickAdd } from "@/components/shell/app-shell";
import type { TxnDTO } from "@/lib/dto";
import type { TxnQuery } from "@/server/queries/transactions";
import { bulkUpdateAction, deleteTransactionsAction, restoreTransactionsAction } from "@/server/actions/transactions";
import { cn } from "@/lib/utils";
import { TransactionDrawer } from "./transaction-drawer";
import { TransactionRow, TxnAmount, txnVisual } from "./transaction-row";
import { CategorySelect } from "./transaction-form";

interface Result {
  rows: TxnDTO[];
  total: number;
  page: number;
  pages: number;
  totals: { income: string; expenses: string; net: string; unconverted: number } | null;
}

const TYPE_FILTERS = [
  { v: "", l: "All" },
  { v: "EXPENSE", l: "Expenses" },
  { v: "INCOME", l: "Income" },
  { v: "TRANSFER", l: "Transfers" },
  { v: "REFUND", l: "Refunds" },
];

export function TransactionsView({ query, result, tags, reviewCount, hasAny }: { query: TxnQuery; result: Result; tags: string[]; reviewCount: number; hasAny: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const f = useFormat();
  const quick = useQuickAdd();
  const { accounts, categories, byId } = useAppData();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState(query.q ?? "");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setSelected(new Set()), [result]);
  React.useEffect(() => setSearch(query.q ?? ""), [query.q]);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      if (!("page" in patch)) p.delete("page");
      startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
    },
    [sp, pathname, router],
  );

  // Debounced search
  React.useEffect(() => {
    if ((query.q ?? "") === search) return;
    const t = setTimeout(() => setParams({ q: search || null }), 300);
    return () => clearTimeout(t);
  }, [search, query.q, setParams]);

  // Shortcut: "f" focuses search, Escape clears selection
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const allSelected = result.rows.length > 0 && result.rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(result.rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = async (patch: Parameters<typeof bulkUpdateAction>[0] extends infer P ? Omit<P & object, "ids"> : never, label: string) => {
    const r = await bulkUpdateAction({ ids: [...selected], ...patch });
    if (r.ok) {
      toast.success(`${label} · ${r.data?.count} transaction${r.data?.count === 1 ? "" : "s"}`);
      router.refresh();
    } else toast.error(r.error);
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    const r = await deleteTransactionsAction(ids);
    setConfirmBulkDelete(false);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
    toast.success(`Deleted ${r.data?.count} transaction${r.data?.count === 1 ? "" : "s"}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await restoreTransactionsAction(ids);
          router.refresh();
        },
      },
    });
  };

  const activeFilters: { key: string; label: string }[] = [];
  if (query.accountId) activeFilters.push({ key: "accountId", label: `Account: ${accounts.find((a) => a.id === query.accountId)?.name ?? "—"}` });
  if (query.categoryId) activeFilters.push({ key: "categoryId", label: query.categoryId === "none" ? "Uncategorized" : `Category: ${byId.get(query.categoryId)?.name ?? "—"}` });
  if (query.tag) activeFilters.push({ key: "tag", label: `#${query.tag}` });
  if (query.min) activeFilters.push({ key: "min", label: `≥ ${f.money(query.min)}` });
  if (query.max) activeFilters.push({ key: "max", label: `≤ ${f.money(query.max)}` });
  if (query.from) activeFilters.push({ key: "from", label: `From ${query.from}` });
  if (query.to) activeFilters.push({ key: "to", label: `To ${query.to}` });
  if (query.status) activeFilters.push({ key: "status", label: query.status === "PENDING" ? "Pending" : "Cleared" });
  if (query.review) activeFilters.push({ key: "review", label: "Needs review" });
  if (query.dupes) activeFilters.push({ key: "dupes", label: "Possible duplicates" });
  const filtered = activeFilters.length > 0 || !!query.q || !!query.type;

  const sortHeader = (key: string, label: string, align: "left" | "right" = "left") => {
    const active = (query.sort ?? "date") === key;
    const dir = active ? (query.dir === "asc" ? "asc" : "desc") : null;
    const I = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
    return (
      <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} className={cn("px-3 py-2.5 font-medium", align === "right" && "text-right")}>
        <button
          onClick={() => setParams({ sort: key, dir: active && dir === "desc" ? "asc" : "desc" })}
          className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", active && "text-foreground", align === "right" && "flex-row-reverse")}
        >
          {label}
          <I className={cn("size-3", !active && "opacity-40")} />
        </button>
      </th>
    );
  };

  const exportHref = `/api/export/transactions?${new URLSearchParams(Object.entries(query).filter(([k, v]) => v && k !== "page") as [string, string][]).toString()}`;

  return (
    <div>
      <PageHeader
        title="Transactions"
        description={hasAny ? `${result.total.toLocaleString()} ${filtered ? "matching" : "total"} · amounts in account currency` : "Every expense, income, transfer and refund in one place."}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Current filters</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <a href={`${exportHref}&format=csv`}>CSV</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`${exportHref}&format=xlsx`}>Excel (XLSX)</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" asChild>
              <Link href="/import">
                <Upload /> Import
              </Link>
            </Button>
            <Button size="sm" variant="primary" onClick={() => quick.open()}>
              <Plus /> Add
            </Button>
          </>
        }
      />

      {reviewCount > 0 && !query.review && (
        <Notice tone="info" className="mb-4" icon={<Sparkles />}>
          {reviewCount} transaction{reviewCount === 1 ? "" : "s"} {reviewCount === 1 ? "has" : "have"} an uncertain or missing category.{" "}
          <button className="font-medium underline" onClick={() => setParams({ review: "1" })}>
            Review now
          </button>
        </Notice>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, merchant, notes or #tag   (F)"
            className="pl-9"
            aria-label="Search transactions"
          />
          {pending && <span className="absolute top-1/2 right-3 size-1.5 -translate-y-1/2 animate-pulse rounded-full bg-accent" aria-label="Loading" />}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <div role="tablist" aria-label="Type" className="flex shrink-0 rounded-lg bg-surface-2 p-0.5">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.v}
                role="tab"
                aria-selected={(query.type ?? "") === t.v}
                onClick={() => setParams({ type: t.v || null })}
                className={cn(
                  "h-8 rounded-md px-3 text-[12.5px] font-medium whitespace-nowrap text-muted-foreground",
                  (query.type ?? "") === t.v && "bg-surface text-foreground shadow-sm",
                )}
              >
                {t.l}
              </button>
            ))}
          </div>
          <FilterPanel query={query} tags={tags} onApply={setParams} />
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((af) => (
            <button
              key={af.key}
              onClick={() => setParams({ [af.key]: null })}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12px] hover:border-border-strong"
              aria-label={`Remove filter ${af.label}`}
            >
              {af.label}
              <X className="size-3 text-muted-foreground" />
            </button>
          ))}
          <button onClick={() => router.replace(pathname)} className="text-[12px] text-muted-foreground underline-offset-2 hover:underline">
            Clear all
          </button>
        </div>
      )}

      {result.totals && result.rows.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>
            Income <Money value={result.totals.income} className="font-medium text-foreground" />
          </span>
          <span>
            Net spending <Money value={result.totals.expenses} className="font-medium text-foreground" />
          </span>
          <span>
            Net <Money value={result.totals.net} showSign className="font-medium" />
          </span>
          <span className="text-subtle-foreground">Totals in base currency · transfers excluded</span>
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-md">
          <span className="text-[13px] font-medium">{selected.size} selected</span>
          <div className="mx-1 h-5 w-px bg-border" />
          <BulkCategorize onApply={(categoryId) => bulk({ categoryId }, "Categorized")} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <CheckCircle2 /> Status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => bulk({ status: "CLEARED" }, "Marked cleared")}>Mark cleared</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => bulk({ status: "PENDING" }, "Marked pending")}>Mark pending</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => bulk({ isReimbursable: true }, "Marked reimbursable")}>Mark reimbursable</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => bulk({ isReimbursable: false }, "Unmarked reimbursable")}>Not reimbursable</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <BulkTag onApply={(addTag) => bulk({ addTag }, `Tagged #${addTag}`)} />
          <BulkMove accounts={accounts} onApply={(accountId) => bulk({ accountId }, "Moved")} />
          <Button size="sm" variant="ghost" className="text-negative hover:bg-negative-soft hover:text-negative" onClick={() => setConfirmBulkDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {result.rows.length === 0 ? (
        <Card>
          {!hasAny ? (
            <EmptyState
              icon={<Receipt />}
              title="No transactions yet"
              description="Add transactions by hand, or import a CSV/Excel statement from your bank."
              action={
                <>
                  <Button variant="primary" size="sm" onClick={() => quick.open()}>
                    <Plus /> Add transaction
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/import">
                      <Upload /> Import statement
                    </Link>
                  </Button>
                </>
              }
            />
          ) : (
            <EmptyState
              icon={<SearchX />}
              title="No results for these filters"
              description="Try a different search or remove some filters."
              action={
                <Button size="sm" onClick={() => router.replace(pathname)}>
                  Clear filters
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className={cn("hidden overflow-hidden md:block", pending && "opacity-70 transition-opacity")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border bg-surface-2/60 text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 py-2.5 pl-4">
                      <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                    </th>
                    {sortHeader("date", "Date")}
                    {sortHeader("description", "Description")}
                    {sortHeader("category", "Category")}
                    {sortHeader("account", "Account")}
                    {sortHeader("amount", "Amount", "right")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((t) => {
                    const v = txnVisual(t, byId);
                    const isSel = selected.has(t.id);
                    return (
                      <tr key={t.id} className={cn("group cursor-pointer transition-colors hover:bg-surface-2/60", isSel && "bg-accent-soft/40 hover:bg-accent-soft/50")} onClick={() => setOpenId(t.id)}>
                        <td className="py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={isSel} onCheckedChange={() => toggle(t.id)} aria-label={`Select ${t.description}`} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                          <span className="num">{f.date(t.date, { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </td>
                        <td className="max-w-[340px] px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <CategoryIcon icon={v.special ? "circle" : v.icon} color={v.color} className="size-7" />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate font-medium">
                                <span className="truncate">{t.merchant || t.description}</span>
                                {t.status === "PENDING" && <Clock className="size-3 shrink-0 text-warning" aria-label="Pending" />}
                                {t.receipts.length > 0 && <Paperclip className="size-3 shrink-0 text-subtle-foreground" aria-label="Has receipt" />}
                                {t.isSample && <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">sample</span>}
                              </p>
                              {t.merchant && <p className="truncate text-[11.5px] text-muted-foreground">{t.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {t.type === "TRANSFER" || t.type === "ADJUSTMENT" || t.splits.length ? (
                            <span className="text-[12px] text-muted-foreground">{v.name}</span>
                          ) : (
                            <InlineCategory t={t} />
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                          {t.type === "TRANSFER" ? (
                            <span>
                              {t.accountName} → {t.toAccountName}
                            </span>
                          ) : (
                            t.accountName
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <TxnAmount t={t} className="font-medium" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile list */}
          <Card className="md:hidden">
            <ul className="divide-y divide-border p-1.5">
              {result.rows.map((t) => (
                <TransactionRow key={t.id} t={t} compact />
              ))}
            </ul>
          </Card>

          {result.pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="Pagination">
              <span className="text-muted-foreground">
                Page {result.page} of {result.pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={result.page <= 1} onClick={() => setParams({ page: String(result.page - 1) })}>
                  <ChevronLeft /> Previous
                </Button>
                <Button size="sm" disabled={result.page >= result.pages} onClick={() => setParams({ page: String(result.page + 1) })}>
                  Next <ChevronRight />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}

      {openId && <TransactionDrawer id={openId} open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} initial={result.rows.find((r) => r.id === openId)} />}

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}?`}
        description="Balances, budgets and reports will update immediately. You can undo right after."
        confirmLabel="Delete"
        destructive
        onConfirm={bulkDelete}
      />
    </div>
  );
}

function InlineCategory({ t }: { t: TxnDTO }) {
  const router = useRouter();
  const { categories, byId } = useAppData();
  const v = txnVisual(t, byId);
  const kind = t.type === "INCOME" ? "INCOME" : "EXPENSE";
  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor={`cat-${t.id}`}>
        Category for {t.description}
      </label>
      <div className="relative">
        <select
          id={`cat-${t.id}`}
          value={t.categoryId ?? ""}
          onChange={async (e) => {
            const r = await bulkUpdateAction({ ids: [t.id], categoryId: e.target.value || undefined });
            if (r.ok) {
              toast.success("Category updated");
              router.refresh();
            } else toast.error(r.error);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? `  ${byId.get(c.parentId)?.name} › ${c.name}` : c.name}
              </option>
            ))}
        </select>
        <span className={cn("pointer-events-none inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] ring-1 ring-transparent group-hover:ring-border", !t.categoryId && "text-subtle-foreground italic")}>
          {v.name}
        </span>
      </div>
      {t.needsReview && t.categoryId && (
        <span title={`Suggested · ${Math.round((t.categoryConfidence ?? 0) * 100)}% confidence`} className="num rounded bg-warning-soft px-1 text-[10px] font-medium text-warning">
          {Math.round((t.categoryConfidence ?? 0) * 100)}%
        </span>
      )}
    </div>
  );
}

function FilterPanel({ query, tags, onApply }: { query: TxnQuery; tags: string[]; onApply: (p: Record<string, string | null>) => void }) {
  const { accounts, categories } = useAppData();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState(query);
  React.useEffect(() => {
    if (open) setV(query);
  }, [open, query]);
  const count = ["accountId", "categoryId", "tag", "min", "max", "from", "to", "status", "review", "dupes"].filter((k) => query[k as keyof TxnQuery]).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-9 shrink-0">
          <Filter /> Filters
          {count > 0 && <span className="grid size-4.5 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="f-account">Account</Label>
            <NativeSelect id="f-account" value={v.accountId ?? ""} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="f-cat">Category</Label>
            <NativeSelect id="f-cat" value={v.categoryId ?? ""} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              {categories
                .filter((c) => !c.parentId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={v.from ?? ""} onChange={(e) => setV({ ...v, from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={v.to ?? ""} onChange={(e) => setV({ ...v, to: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-min">Min amount</Label>
            <Input id="f-min" inputMode="decimal" value={v.min ?? ""} onChange={(e) => setV({ ...v, min: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-max">Max amount</Label>
            <Input id="f-max" inputMode="decimal" value={v.max ?? ""} onChange={(e) => setV({ ...v, max: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-tag">Tag</Label>
            <NativeSelect id="f-tag" value={v.tag ?? ""} onChange={(e) => setV({ ...v, tag: e.target.value })}>
              <option value="">Any</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-status">Status</Label>
            <NativeSelect id="f-status" value={v.status ?? ""} onChange={(e) => setV({ ...v, status: e.target.value })}>
              <option value="">Any</option>
              <option value="CLEARED">Cleared</option>
              <option value="PENDING">Pending</option>
            </NativeSelect>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-[13px]">
            <Checkbox checked={v.review === "1"} onCheckedChange={(c) => setV({ ...v, review: c ? "1" : "" })} /> Needs category review
          </label>
          <label className="col-span-2 flex items-center gap-2 text-[13px]">
            <Checkbox checked={v.dupes === "1"} onCheckedChange={(c) => setV({ ...v, dupes: c ? "1" : "" })} />
            <Copy className="size-3.5 text-muted-foreground" /> Show possible duplicates only
          </label>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onApply({ accountId: null, categoryId: null, tag: null, min: null, max: null, from: null, to: null, status: null, review: null, dupes: null });
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onApply({
                accountId: v.accountId || null,
                categoryId: v.categoryId || null,
                tag: v.tag || null,
                min: v.min || null,
                max: v.max || null,
                from: v.from || null,
                to: v.to || null,
                status: v.status || null,
                review: v.review || null,
                dupes: v.dupes || null,
              });
              setOpen(false);
            }}
          >
            Apply filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkCategorize({ onApply }: { onApply: (categoryId: string) => void }) {
  const { categories } = useAppData();
  const [open, setOpen] = React.useState(false);
  const [val, setVal] = React.useState<string | null>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Sparkles /> Categorize
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <Label className="mb-1.5 block">Set category</Label>
        <CategorySelect categories={categories} kind="ANY" value={val} onChange={setVal} includeEmpty={false} />
        <Button
          size="sm"
          variant="primary"
          className="mt-3 w-full"
          disabled={!val}
          onClick={() => {
            if (val) onApply(val);
            setOpen(false);
          }}
        >
          Apply to selected
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function BulkTag({ onApply }: { onApply: (tag: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [val, setVal] = React.useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Tag /> Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (val.trim()) onApply(val.trim().replace(/^#/, ""));
            setOpen(false);
            setVal("");
          }}
        >
          <Label htmlFor="bulk-tag" className="mb-1.5 block">
            Add tag
          </Label>
          <Input id="bulk-tag" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. vacation" autoFocus />
          <Button size="sm" variant="primary" type="submit" className="mt-3 w-full" disabled={!val.trim()}>
            Add tag
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function BulkMove({ accounts, onApply }: { accounts: { id: string; name: string; currency: string }[]; onApply: (id: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          Move to…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Same-currency accounts only</DropdownMenuLabel>
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => onApply(a.id)}>
            {a.name} · {a.currency}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
