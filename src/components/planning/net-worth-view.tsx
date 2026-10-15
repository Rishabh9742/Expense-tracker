"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building, Car, Gem, LineChart as LineIcon, MoreHorizontal, Pencil, Plus, Trash2, TrendingUp, Banknote, AlertTriangle, Info, History } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { Delta, EmptyState, Notice, PageHeader } from "@/components/finance/primitives";
import { LineSeriesChart } from "@/components/charts/charts";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { addValuationAction, deleteAssetAction, saveAssetAction, type AssetFormValues } from "@/server/actions/planning";
import { todayYmd } from "@/components/schedules/shared";
import { ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-form";

interface Asset {
  id: string;
  name: string;
  type: string;
  currency: string;
  notes: string | null;
  latest: { value: string; date: string } | null;
  baseValue: string | null;
  valuations: { date: string; value: string }[];
}

const ASSET_META: Record<string, { label: string; icon: React.ElementType }> = {
  PROPERTY: { label: "Property", icon: Building },
  VEHICLE: { label: "Vehicle", icon: Car },
  INVESTMENT: { label: "Investment (manual)", icon: LineIcon },
  CASH: { label: "Cash held elsewhere", icon: Banknote },
  OTHER: { label: "Other", icon: Gem },
};

export function NetWorthView({
  summary: s,
  accounts,
  debts,
  assets,
  history,
}: {
  summary: { netWorth: string; totalAssets: string; accountAssets: string; estimatedAssets: string; totalLiabilities: string; accountLiabilities: string; debtLiabilities: string; missingRates: string[]; skippedLinkedDebts: string[] };
  accounts: { id: string; name: string; type: string; currency: string; balance: string; baseBalance: string | null }[];
  debts: { id: string; name: string; baseBalance: string | null }[];
  assets: Asset[];
  history: { label: string; date: string; assets: number; liabilities: number; netWorth: number }[];
}) {
  const f = useFormat();
  const [editing, setEditing] = React.useState<Asset | "new" | null>(null);
  const [valuing, setValuing] = React.useState<Asset | null>(null);
  const first = history[0]?.netWorth ?? 0;
  const prevMonth = history[history.length - 2]?.netWorth ?? 0;
  const now = Number(s.netWorth);
  const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
  const hasAnything = accounts.length + assets.length + debts.length > 0;
  const yearly = history.filter((_, i) => i === 0 || i === history.length - 1);

  return (
    <div>
      <PageHeader
        title="Net Worth"
        description="Total assets minus total liabilities, in your base currency."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Add asset
          </Button>
        }
      />
      {s.missingRates.length > 0 && (
        <Notice tone="warning" className="mb-4" icon={<AlertTriangle />}>
          No exchange rate for {s.missingRates.join(", ")} — excluded from net worth until a rate is available.
        </Notice>
      )}
      {!hasAnything ? (
        <Card>
          <EmptyState
            icon={<TrendingUp />}
            title="Nothing to measure yet"
            description="Net worth is built from your account balances, debts, and assets like property or a vehicle."
            action={
              <>
                <Button size="sm" variant="primary" asChild>
                  <Link href="/accounts?new=1">Add account</Link>
                </Button>
                <Button size="sm" onClick={() => setEditing("new")}>
                  Add asset
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader>
                <div>
                  <CardDescription className="mt-0">Net worth</CardDescription>
                  <Money value={s.netWorth} className="mt-1 block text-[30px] font-semibold tracking-tight" tone={now < 0 ? "negative" : "neutral"} />
                  <div className="mt-1 flex flex-wrap gap-4">
                    <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
                      vs last month <Delta value={pct(now, prevMonth)} />
                    </span>
                    <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
                      vs 12 months ago <Delta value={pct(now, first)} />
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <LineSeriesChart
                  data={history}
                  series={[
                    { key: "netWorth", label: "Net worth", color: "var(--chart-1)" },
                    { key: "assets", label: "Assets", color: "var(--chart-income)" },
                    { key: "liabilities", label: "Liabilities", color: "var(--chart-expense)", dashed: true },
                  ]}
                  height={260}
                  description="Net worth, assets and liabilities at each month end over the last year"
                />
                <p className="mt-2 flex items-start gap-1.5 text-meta text-subtle-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" /> Account balances are reconstructed from transactions; asset values use the latest valuation on or before each date; past balances of manually tracked debts are approximated from recorded payments.
                </p>
              </CardContent>
            </Card>
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-[13px]">
                <div>
                  <div className="flex justify-between font-medium">
                    <span>Assets</span>
                    <Money value={s.totalAssets} />
                  </div>
                  <div className="mt-1.5 space-y-1 pl-3 text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Account balances (actual)</span>
                      <Money value={s.accountAssets} />
                    </div>
                    <div className="flex justify-between">
                      <span>Assets (estimated values)</span>
                      <Money value={s.estimatedAssets} />
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between font-medium">
                    <span>Liabilities</span>
                    <Money value={s.totalLiabilities} />
                  </div>
                  <div className="mt-1.5 space-y-1 pl-3 text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Cards, loans & overdrafts</span>
                      <Money value={s.accountLiabilities} />
                    </div>
                    <div className="flex justify-between">
                      <span>Debts tracked separately</span>
                      <Money value={s.debtLiabilities} />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between border-t border-border pt-3 text-[14px] font-semibold">
                  <span>Net worth</span>
                  <Money value={s.netWorth} />
                </div>
                {s.skippedLinkedDebts.length > 0 && (
                  <p className="text-meta text-muted-foreground">Not double-counted: {s.skippedLinkedDebts.join(", ")} (represented by linked accounts).</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="items" className="mt-6">
            <TabsList className="mb-4">
              <TabsTrigger value="items">Assets & liabilities</TabsTrigger>
              <TabsTrigger value="monthly">
                <History /> Monthly report
              </TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Estimated assets</CardTitle>
                    <CardDescription>Manually valued — update periodically</CardDescription>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
                    <Plus /> Add
                  </Button>
                </CardHeader>
                <CardContent className="px-2">
                  {assets.length === 0 ? (
                    <EmptyState compact icon={<Gem />} title="No assets" description="Add property, vehicles or investments held outside your accounts." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {assets.map((a) => (
                        <AssetRow key={a.id} a={a} onEdit={() => setEditing(a)} onValue={() => setValuing(a)} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Accounts & debts</CardTitle>
                    <CardDescription>Actual balances from your records</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border text-[13px]">
                    {accounts.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="min-w-0 truncate">
                          <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                            {a.name}
                          </Link>{" "}
                          <span className="text-muted-foreground">· {ACCOUNT_TYPE_LABELS[a.type]}</span>
                        </span>
                        <span className="text-right">
                          <Money value={a.baseBalance ?? a.balance} tone={Number(a.balance) < 0 ? "negative" : "neutral"} />
                        </span>
                      </li>
                    ))}
                    {debts.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                        <span>
                          <Link href="/debts" className="font-medium hover:underline">
                            {d.name}
                          </Link>{" "}
                          <span className="text-muted-foreground">· debt</span>
                        </span>
                        <Money value={d.baseBalance ? String(-Number(d.baseBalance)) : null} tone="negative" />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="monthly">
              <Card>
                <CardContent className="overflow-x-auto pt-4">
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">Net worth at month end</caption>
                    <thead className="text-left text-[12px] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 font-medium">Month end</th>
                        <th className="py-2 text-right font-medium">Assets</th>
                        <th className="py-2 text-right font-medium">Liabilities</th>
                        <th className="py-2 text-right font-medium">Net worth</th>
                        <th className="py-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h, i, arr) => {
                        const prev = arr[i + 1];
                        return (
                          <tr key={h.label} className="border-b border-border last:border-0">
                            <td className="py-2">{h.label}</td>
                            <td className="py-2 text-right"><Money value={h.assets} /></td>
                            <td className="py-2 text-right"><Money value={h.liabilities} /></td>
                            <td className="py-2 text-right font-medium"><Money value={h.netWorth} /></td>
                            <td className="py-2 text-right">{prev ? <Money value={h.netWorth - prev.netWorth} showSign /> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {yearly.length === 2 && (
                    <p className="mt-4 text-[13px] text-muted-foreground">
                      12-month change: <Money value={yearly[1].netWorth - yearly[0].netWorth} showSign className="font-medium" /> ({f.date(history[0].date, { month: "short", year: "numeric" })} → today)
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add asset" : "Edit asset"}</DialogTitle>
            <DialogDescription>Asset values are your estimates and are shown separately from actual account balances.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing && <AssetForm initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      {valuing && <ValuationDialog asset={valuing} onClose={() => setValuing(null)} />}
    </div>
  );
}

function AssetRow({ a, onEdit, onValue }: { a: Asset; onEdit: () => void; onValue: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const M = ASSET_META[a.type] ?? ASSET_META.OTHER;
  const prev = a.valuations[1];
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
        <M.icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">
          {a.name} <Badge variant="outline">estimate</Badge>
        </p>
        <p className="text-[12px] text-muted-foreground">
          {M.label}
          {a.latest ? ` · valued ${f.date(a.latest.date, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as Intl.DateTimeFormatOptions)}` : ""}
          {prev && a.latest ? (
            <>
              {" "}
              · <Money value={Number(a.latest.value) - Number(prev.value)} currency={a.currency} showSign className="text-[12px]" /> since last
            </>
          ) : null}
        </p>
      </div>
      <div className="text-right">
        <Money value={a.latest?.value ?? null} currency={a.currency} className="text-[13.5px] font-medium" />
        {a.currency !== f.currency && a.baseValue && <p className="text-[11px] text-muted-foreground">≈ {f.money(a.baseValue)}</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onValue}>
            <TrendingUp /> Update value
          </DropdownMenuItem>
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
        title={`Delete ${a.name}?`}
        description="All valuations for this asset will be removed and net-worth history recalculated."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteAssetAction(a.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </li>
  );
}

function ValuationDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = React.useState(asset.latest ? String(Number(asset.latest.value)) : "");
  const [date, setDate] = React.useState(todayYmd());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Update value · {asset.name}</DialogTitle>
          <DialogDescription>Adds a dated valuation. Earlier valuations are kept for history.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <Field label={`Estimated value (${asset.currency})`} htmlFor="v-val">
            <Input id="v-val" inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
          <Field label="As of" htmlFor="v-date">
            <Input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await addValuationAction(asset.id, value, date);
              if (!r.ok) return toast.error(r.error);
              toast.success("Valuation saved");
              onClose();
              router.refresh();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetForm({ initial, onDone }: { initial?: Asset; onDone: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [v, setV] = React.useState<AssetFormValues>({
    name: initial?.name ?? "",
    type: (initial?.type as never) ?? "PROPERTY",
    currency: initial?.currency ?? f.currency,
    value: initial?.latest ? String(Number(initial.latest.value)) : "",
    valuedOn: todayYmd(),
    notes: initial?.notes ?? "",
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
          const r = await saveAssetAction(initial?.id ?? null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Asset saved");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="as-name" error={errors.name?.[0]}>
          <Input id="as-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Apartment in Pune" autoFocus />
        </Field>
        <Field label="Type" htmlFor="as-type">
          <NativeSelect id="as-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as never })}>
            {Object.entries(ASSET_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Estimated value" htmlFor="as-val" error={errors.value?.[0]}>
          <Input id="as-val" inputMode="decimal" className="num" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
        </Field>
        <Field label="Currency" htmlFor="as-cur">
          <NativeSelect id="as-cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Valued on" htmlFor="as-date">
          <Input id="as-date" type="date" value={v.valuedOn} onChange={(e) => setV({ ...v, valuedOn: e.target.value })} />
        </Field>
      </div>
      <Notice tone="info">Don&apos;t add investment or savings accounts here if you already track them as accounts — that would count them twice.</Notice>
      <Field label="Notes" htmlFor="as-notes" optional>
        <Textarea id="as-notes" rows={2} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save asset
        </Button>
      </div>
    </form>
  );
}
