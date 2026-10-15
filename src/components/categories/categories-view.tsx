"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2, Wand2, Sparkles, Store, X, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Switch, Tabs, TabsContent, TabsList, TabsTrigger, ProgressBar, Checkbox } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/finance/format";
import { CategoryIcon, EmptyState, Notice, PageHeader } from "@/components/finance/primitives";
import { COLOR_NAMES, COLOR_SLOTS, ICON_NAMES, Icon, slotVar } from "@/components/finance/icons";
import { CategorySelect } from "@/components/transactions/transaction-form";
import { useAppData } from "@/components/shell/app-shell";
import {
  archiveCategoryAction,
  deleteCategoryAction,
  deleteMerchantMappingAction,
  deleteRuleAction,
  previewRuleAction,
  saveCategoryAction,
  saveRuleAction,
  toggleRuleAction,
  type CategoryFormValues,
  type RuleFormValues,
} from "@/server/actions/categories";
import { cn } from "@/lib/utils";

interface Cat {
  id: string;
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  icon: string;
  color: string;
  parentId: string | null;
  monthlyTarget: string | null;
  isEssential: boolean;
  archived: boolean;
  txnCount: number;
  thisMonth: string;
}
interface Rule {
  id: string;
  name: string;
  field: string;
  operator: string;
  value: string;
  amountMin: string | null;
  amountMax: string | null;
  categoryId: string;
  categoryName: string;
  setMerchant: string | null;
  priority: number;
  active: boolean;
}

const KIND_LABEL = { EXPENSE: "Expenses", INCOME: "Income", TRANSFER: "Transfers & savings" };

export function CategoriesView({ categories, rules, mappings, monthLabel, aiEnabled }: { categories: Cat[]; rules: Rule[]; mappings: { id: string; merchant: string; categoryName: string }[]; monthLabel: string; aiEnabled: boolean }) {
  const [editing, setEditing] = React.useState<Cat | { parentId?: string; kind?: Cat["kind"] } | null>(null);
  const [ruleEditing, setRuleEditing] = React.useState<Rule | "new" | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  return (
    <div>
      <PageHeader
        title="Categories"
        description="Organize spending and income, set monthly targets, and teach Finora how to categorize automatically."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing({})}>
            <Plus /> New category
          </Button>
        }
      />
      <Tabs defaultValue="categories">
        <TabsList className="mb-5">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="rules">Rules · {rules.length}</TabsTrigger>
          <TabsTrigger value="merchants">Learned merchants · {mappings.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-6">
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived
          </label>
          {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((kind) => {
            const parents = categories.filter((c) => c.kind === kind && !c.parentId && (showArchived || !c.archived));
            if (!parents.length) return null;
            return (
              <Card key={kind}>
                <CardHeader>
                  <div>
                    <CardTitle>{KIND_LABEL[kind]}</CardTitle>
                    <CardDescription>{kind === "TRANSFER" ? "For moving money between your own accounts — never counted as spending." : `${monthLabel} totals shown on the right`}</CardDescription>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ kind })}>
                    <Plus /> Add
                  </Button>
                </CardHeader>
                <CardContent className="px-2">
                  <ul className="divide-y divide-border">
                    {parents.map((p) => (
                      <React.Fragment key={p.id}>
                        <CategoryRow c={p} onEdit={() => setEditing(p)} onAddChild={() => setEditing({ parentId: p.id, kind: p.kind })} all={categories} />
                        {categories
                          .filter((c) => c.parentId === p.id && (showArchived || !c.archived))
                          .map((c) => (
                            <CategoryRow key={c.id} c={c} child onEdit={() => setEditing(c)} all={categories} />
                          ))}
                      </React.Fragment>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Categorization rules</CardTitle>
                <CardDescription>Applied first, in priority order, to new and imported transactions. Then merchant mappings, then your history{aiEnabled ? ", then optional AI suggestions" : ""}.</CardDescription>
              </div>
              <Button size="sm" variant="primary" onClick={() => setRuleEditing("new")}>
                <Plus /> New rule
              </Button>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <EmptyState compact icon={<Wand2 />} title="No rules yet" description='Example: description contains "uber" → Transportation. You can preview matches before saving.' />
              ) : (
                <ul className="divide-y divide-border">
                  {rules.map((r) => (
                    <RuleRow key={r.id} r={r} onEdit={() => setRuleEditing(r)} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="merchants">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Learned merchants</CardTitle>
                <CardDescription>Created only when you approve “always categorize this merchant” after a correction.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {mappings.length === 0 ? (
                <EmptyState compact icon={<Store />} title="Nothing learned yet" description="When you change a transaction's category, Finora offers to remember it for that merchant." />
              ) : (
                <ul className="divide-y divide-border">
                  {mappings.map((m) => (
                    <MappingRow key={m.id} m={m} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editing && "id" in editing ? "Edit category" : editing?.parentId ? "New subcategory" : "New category"}</DialogTitle>
            <DialogDescription>Colours come from a coordinated palette so charts stay readable.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing && <CategoryForm initial={editing} categories={categories} onDone={() => setEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      <Dialog open={ruleEditing !== null} onOpenChange={(o) => !o && setRuleEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{ruleEditing === "new" ? "New rule" : "Edit rule"}</DialogTitle>
            <DialogDescription>Rules never touch transactions you categorized yourself.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{ruleEditing && <RuleForm initial={ruleEditing === "new" ? undefined : ruleEditing} onDone={() => setRuleEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryRow({ c, child, onEdit, onAddChild, all }: { c: Cat; child?: boolean; onEdit: () => void; onAddChild?: () => void; all: Cat[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState(false);
  const [moveTo, setMoveTo] = React.useState<string | null>(null);
  const target = c.monthlyTarget ? Number(c.monthlyTarget) : null;
  const pct = target ? (Number(c.thisMonth) / target) * 100 : null;
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", c.archived && "opacity-55")}>
      {child && <CornerDownRight className="ml-2 size-3.5 shrink-0 text-subtle-foreground" aria-hidden />}
      <CategoryIcon icon={c.icon} color={c.color} className={child ? "size-7" : undefined} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
          {c.name}
          {c.isEssential && <Badge variant="outline">Essential</Badge>}
          {c.archived && <Badge variant="outline">Archived</Badge>}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          {c.txnCount} transaction{c.txnCount === 1 ? "" : "s"}
          {target ? (
            <>
              {" "}
              · target <Money value={c.monthlyTarget} className="text-[11.5px]" />
            </>
          ) : null}
        </p>
        {pct !== null && <ProgressBar value={pct} size="sm" tone={pct >= 100 ? "negative" : pct >= 90 ? "warning" : "accent"} label={`${c.name} ${Math.round(pct)}% of target`} className="mt-1.5 max-w-60" />}
      </div>
      <Link href={`/transactions?categoryId=${c.id}`} className="hidden text-right sm:block" aria-label={`View ${c.name} transactions`}>
        <Money value={c.thisMonth} className="text-[13px] font-medium" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {onAddChild && (
            <DropdownMenuItem onSelect={onAddChild}>
              <Plus /> Add subcategory
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={async () => {
              await archiveCategoryAction(c.id, !c.archived);
              router.refresh();
            }}
          >
            {c.archived ? <ArchiveRestore /> : <Archive />} {c.archived ? "Restore" : "Archive"}
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
        title={`Delete ${c.name}?`}
        description={
          <div className="space-y-3">
            <p>
              {c.txnCount > 0 ? `${c.txnCount} transaction${c.txnCount === 1 ? " uses" : "s use"} this category${!child ? " or its subcategories" : ""}.` : "No transactions use this category."} Choose where to move them, or leave them uncategorized.
            </p>
            <CategorySelect categories={all.filter((x) => x.id !== c.id && x.parentId !== c.id && x.kind === c.kind) as never} kind={c.kind} value={moveTo} onChange={setMoveTo} />
          </div>
        }
        confirmLabel="Delete category"
        destructive
        onConfirm={async () => {
          const r = await deleteCategoryAction(c.id, moveTo);
          setConfirm(false);
          if (r.ok) {
            toast.success(`Deleted${r.data?.moved ? ` · ${r.data.moved} transactions ${moveTo ? "moved" : "now uncategorized"}` : ""}`);
            router.refresh();
          } else toast.error(r.error);
        }}
      />
    </li>
  );
}

function CategoryForm({ initial, categories, onDone }: { initial: Cat | { parentId?: string; kind?: Cat["kind"] }; categories: Cat[]; onDone: () => void }) {
  const router = useRouter();
  const isEdit = "id" in initial;
  const [v, setV] = React.useState<CategoryFormValues>(
    isEdit
      ? { name: initial.name, kind: initial.kind, icon: initial.icon, color: initial.color, parentId: initial.parentId, monthlyTarget: initial.monthlyTarget ? String(Number(initial.monthlyTarget)) : "", isEssential: initial.isEssential }
      : { name: "", kind: initial.kind ?? "EXPENSE", icon: "circle", color: "c1", parentId: initial.parentId ?? null, monthlyTarget: "", isEssential: false },
  );
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  const parents = categories.filter((c) => !c.parentId && c.kind === v.kind && (!isEdit || c.id !== (initial as Cat).id));
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveCategoryAction(isEdit ? (initial as Cat).id : null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Category saved");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name" error={errors.name?.[0]}>
          <Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Type" htmlFor="c-kind">
          <NativeSelect id="c-kind" value={v.kind} disabled={!!v.parentId} onChange={(e) => setV({ ...v, kind: e.target.value as Cat["kind"], parentId: null })}>
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
            <option value="TRANSFER">Transfer / savings</option>
          </NativeSelect>
        </Field>
        <Field label="Parent" htmlFor="c-parent" optional>
          <NativeSelect id="c-parent" value={v.parentId ?? ""} onChange={(e) => setV({ ...v, parentId: e.target.value || null })}>
            <option value="">None (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Monthly target" htmlFor="c-target" optional hint="Shown as progress on this page">
          <Input id="c-target" inputMode="decimal" className="num" value={v.monthlyTarget ?? ""} onChange={(e) => setV({ ...v, monthlyTarget: e.target.value })} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {COLOR_SLOTS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setV({ ...v, color: c })}
              aria-label={COLOR_NAMES[c]}
              aria-pressed={v.color === c}
              className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface transition", v.color === c && "ring-2 ring-foreground")}
              style={{ background: slotVar(c) }}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Icon</legend>
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
          {ICON_NAMES.map((i) => (
            <button
              type="button"
              key={i}
              onClick={() => setV({ ...v, icon: i })}
              aria-label={i}
              aria-pressed={v.icon === i}
              className={cn("grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2", v.icon === i && "bg-accent-soft text-accent-soft-foreground ring-1 ring-accent")}
            >
              <Icon name={i} className="size-4" />
            </button>
          ))}
        </div>
      </fieldset>
      {v.kind === "EXPENSE" && (
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={v.isEssential} onCheckedChange={(c) => setV({ ...v, isEssential: !!c })} />
          Essential spending <span className="text-muted-foreground">(used in essential vs discretionary reports)</span>
        </label>
      )}
      <div className="flex justify-end gap-2">
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

const OP_LABEL: Record<string, string> = { CONTAINS: "contains", EQUALS: "equals", STARTS_WITH: "starts with", REGEX: "matches pattern" };

function RuleRow({ r, onEdit }: { r: Rule; onEdit: () => void }) {
  const router = useRouter();
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="num grid h-6 min-w-6 place-items-center rounded bg-surface-2 px-1 text-[11px] text-muted-foreground" title="Priority">
        {r.priority}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{r.name}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          If {r.field.toLowerCase()} {OP_LABEL[r.operator]} “{r.value}”{r.amountMin ? ` and amount ≥ ${r.amountMin}` : ""}
          {r.amountMax ? ` and ≤ ${r.amountMax}` : ""} → <span className="text-foreground">{r.categoryName}</span>
          {r.setMerchant ? ` · rename merchant to “${r.setMerchant}”` : ""}
        </p>
      </div>
      <Switch
        checked={r.active}
        onCheckedChange={async (a) => {
          await toggleRuleAction(r.id, a);
          router.refresh();
        }}
        aria-label={r.active ? "Disable rule" : "Enable rule"}
      />
      <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit rule">
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete rule"
        onClick={async () => {
          await deleteRuleAction(r.id);
          toast.success("Rule deleted");
          router.refresh();
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function RuleForm({ initial, onDone }: { initial?: Rule; onDone: () => void }) {
  const router = useRouter();
  const { categories } = useAppData();
  const [v, setV] = React.useState<RuleFormValues>(
    initial
      ? { name: initial.name, field: initial.field as never, operator: initial.operator as never, value: initial.value, amountMin: initial.amountMin ?? "", amountMax: initial.amountMax ?? "", categoryId: initial.categoryId, setMerchant: initial.setMerchant ?? "", priority: initial.priority }
      : { name: "", field: "DESCRIPTION", operator: "CONTAINS", value: "", amountMin: "", amountMax: "", categoryId: "", setMerchant: "", priority: 100 },
  );
  const [apply, setApply] = React.useState(true);
  const [preview, setPreview] = React.useState<{ total: number; wouldChange: number; examples: string[] } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  React.useEffect(() => setPreview(null), [v]);
  const withName = () => ({ ...v, name: v.name || `${v.field === "MERCHANT" ? "Merchant" : "Description"} ${OP_LABEL[v.operator]} “${v.value}”` });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveRuleAction(initial?.id ?? null, withName(), apply);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success(`Rule saved${r.data?.updated ? ` · ${r.data.updated} transaction${r.data.updated === 1 ? "" : "s"} recategorized` : ""}`);
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[140px_150px_1fr]">
        <Field label="When" htmlFor="r-field">
          <NativeSelect id="r-field" value={v.field} onChange={(e) => setV({ ...v, field: e.target.value as never })}>
            <option value="DESCRIPTION">Description</option>
            <option value="MERCHANT">Merchant</option>
          </NativeSelect>
        </Field>
        <Field label="Condition" htmlFor="r-op">
          <NativeSelect id="r-op" value={v.operator} onChange={(e) => setV({ ...v, operator: e.target.value as never })}>
            {Object.entries(OP_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Text" htmlFor="r-val" error={errors.value?.[0]}>
          <Input id="r-val" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} placeholder="e.g. uber" autoFocus />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Set category" htmlFor="r-cat" error={errors.categoryId?.[0]}>
          <CategorySelect id="r-cat" categories={categories} kind="ANY" includeEmpty value={v.categoryId || null} onChange={(c) => setV({ ...v, categoryId: c ?? "" })} />
        </Field>
        <Field label="Rename merchant to" htmlFor="r-merch" optional>
          <Input id="r-merch" value={v.setMerchant ?? ""} onChange={(e) => setV({ ...v, setMerchant: e.target.value })} />
        </Field>
        <Field label="Min amount" htmlFor="r-min" optional>
          <Input id="r-min" inputMode="decimal" className="num" value={v.amountMin ?? ""} onChange={(e) => setV({ ...v, amountMin: e.target.value })} />
        </Field>
        <Field label="Max amount" htmlFor="r-max" optional>
          <Input id="r-max" inputMode="decimal" className="num" value={v.amountMax ?? ""} onChange={(e) => setV({ ...v, amountMax: e.target.value })} />
        </Field>
        <Field label="Rule name" htmlFor="r-name" optional>
          <Input id="r-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Priority" htmlFor="r-prio" hint="Lower numbers run first">
          <Input id="r-prio" type="number" min={1} max={1000} value={String(v.priority)} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={apply} onCheckedChange={(c) => setApply(!!c)} /> Also apply to existing transactions
          </label>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const r = await previewRuleAction(withName());
              if (r.ok) setPreview(r.data!);
              else toast.error(r.error);
            }}
          >
            <Sparkles /> Preview matches
          </Button>
        </div>
        {preview && (
          <Notice tone={preview.wouldChange > 50 ? "warning" : "info"} className="mt-3">
            Matches {preview.total} existing transaction{preview.total === 1 ? "" : "s"} not categorized by you; {preview.wouldChange} would change category.
            {preview.examples.length > 0 && <span className="block text-[12px] opacity-80">e.g. {preview.examples.join(", ")}</span>}
          </Notice>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save rule
        </Button>
      </div>
    </form>
  );
}

function MappingRow({ m }: { m: { id: string; merchant: string; categoryName: string } }) {
  const router = useRouter();
  return (
    <li className="flex items-center gap-3 py-2.5 text-[13.5px]">
      <Store className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate">
        <span className="font-medium">{m.merchant}</span> → {m.categoryName}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Forget ${m.merchant}`}
        onClick={async () => {
          await deleteMerchantMappingAction(m.id);
          router.refresh();
        }}
      >
        <X />
      </Button>
    </li>
  );
}

