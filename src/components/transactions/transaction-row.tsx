"use client";

import * as React from "react";
import { ArrowLeftRight, Clock, Paperclip, RotateCcw, Scale, SplitSquareHorizontal } from "lucide-react";
import type { TxnDTO } from "@/lib/dto";
import { Money, useFormat } from "@/components/finance/format";
import { CategoryBadge, CategoryIcon } from "@/components/finance/primitives";
import { useAppData } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";
import { TransactionDrawer } from "./transaction-drawer";

export function txnVisual(t: TxnDTO, byId: Map<string, { name: string; icon: string; color: string; parentId: string | null }>) {
  if (t.type === "TRANSFER") return { name: "Transfer", icon: "arrow-left-right", color: "other", special: ArrowLeftRight };
  if (t.type === "ADJUSTMENT") return { name: "Adjustment", icon: "scale", color: "other", special: Scale };
  if (t.splits.length) return { name: `Split · ${t.splits.length}`, icon: "split", color: "other", special: SplitSquareHorizontal };
  const c = t.categoryId ? byId.get(t.categoryId) : undefined;
  if (!c) return { name: "Uncategorized", icon: "circle-dashed", color: "other", special: null };
  const parent = c.parentId ? byId.get(c.parentId) : undefined;
  return { name: parent ? `${parent.name} › ${c.name}` : c.name, icon: c.icon, color: c.color, special: null };
}

export function TxnAmount({ t, className }: { t: TxnDTO; className?: string }) {
  // Transfers are shown neutrally — they're neither income nor spending.
  if (t.type === "TRANSFER") return <Money value={String(Math.abs(Number(t.amount)))} currency={t.currency} tone="muted" className={className} />;
  return <Money value={t.amount} currency={t.currency} showSign tone={Number(t.amount) > 0 ? "positive" : "neutral"} className={className} />;
}

export function TransactionRow({ t, compact }: { t: TxnDTO; compact?: boolean }) {
  const f = useFormat();
  const { byId } = useAppData();
  const [open, setOpen] = React.useState(false);
  const v = txnVisual(t, byId);
  const Special = v.special;
  return (
    <li>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-offset-0"
      >
        {Special ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
            <Special className="size-4" />
          </span>
        ) : (
          <CategoryIcon icon={v.icon} color={v.color} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium">{t.merchant || t.description}</span>
            {t.status === "PENDING" && <Clock className="size-3 shrink-0 text-warning" aria-label="Pending" />}
            {t.type === "REFUND" && <RotateCcw className="size-3 shrink-0 text-positive" aria-label="Refund" />}
            {t.receipts.length > 0 && <Paperclip className="size-3 shrink-0 text-subtle-foreground" aria-label="Has receipt" />}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {compact ? `${v.name} · ` : ""}
            {t.type === "TRANSFER" ? `${t.accountName} → ${t.toAccountName}` : t.accountName} · {f.date(t.date, { day: "numeric", month: "short" })}
          </span>
        </span>
        {!compact && <CategoryBadge name={v.name} icon={v.icon} color={v.color} className="hidden md:inline-flex" />}
        <TxnAmount t={t} className={cn("text-[13.5px] font-medium")} />
      </button>
      <TransactionDrawer id={t.id} open={open} onOpenChange={setOpen} initial={t} />
    </li>
  );
}
