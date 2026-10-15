import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon, slotVar } from "./icons";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Category dot + name. Colour comes from the category's fixed slot (identity, never rank). */
export function CategoryBadge({
  name,
  icon,
  color,
  className,
  size = "sm",
}: {
  name: string;
  icon?: string | null;
  color?: string | null;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pr-2 pl-1 text-[12px] font-medium text-foreground/85 ring-1 ring-inset ring-border/70",
        size === "md" && "py-1 text-[13px]",
        className,
      )}
    >
      <span className="grid size-4 shrink-0 place-items-center rounded-[4px]" style={{ background: `color-mix(in srgb, ${slotVar(color)} 18%, transparent)`, color: slotVar(color) }}>
        <Icon name={icon} className="size-3" />
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CategoryIcon({ icon, color, className }: { icon?: string | null; color?: string | null; className?: string }) {
  return (
    <span
      className={cn("grid size-8 shrink-0 place-items-center rounded-lg", className)}
      style={{ background: `color-mix(in srgb, ${slotVar(color)} 14%, transparent)`, color: slotVar(color) }}
    >
      <Icon name={icon} className="size-4" />
    </span>
  );
}

/** Change indicator with arrow + sign so meaning doesn't depend on colour. `goodWhen` sets which direction is favourable. */
export function Delta({ value, goodWhen = "up", suffix = "%", className }: { value: number | null; goodWhen?: "up" | "down"; suffix?: string; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={cn("text-meta text-subtle-foreground", className)}>No prior data</span>;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : (value > 0) === (goodWhen === "up");
  const IconC = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-meta font-medium",
        good === null ? "text-muted-foreground" : good ? "text-positive" : "text-negative",
        className,
      )}
    >
      <IconC className="size-3.5" aria-hidden />
      <span className="num">
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
        {suffix}
      </span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  footnote,
  icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  footnote?: string;
  icon?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-[border-color,box-shadow] duration-200",
        href && "hover:border-border-strong hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
          {icon}
          {label}
          {footnote && (
            <span title={footnote} aria-label={footnote} className="text-subtle-foreground">
              <Info className="size-3" />
            </span>
          )}
        </span>
      </div>
      <div className="mt-2.5 text-[22px] leading-7 font-semibold tracking-tight text-foreground">{value}</div>
      {sub && <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-offset-4">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="mb-3 grid size-10 place-items-center rounded-xl border border-border bg-surface-2 text-muted-foreground [&_svg]:size-5">{icon}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between", className)}>
      <h2 className="text-section font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children, className, icon }: { tone?: "info" | "warning" | "negative" | "positive"; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div
      role={tone === "negative" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "info" && "bg-info-soft text-info",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "negative" && "bg-negative-soft text-negative",
        tone === "positive" && "bg-positive-soft text-positive",
        className,
      )}
    >
      {icon ?? <Info />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function StatRow({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-[13px]", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
