"use client";

import * as React from "react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface FormatCtx {
  currency: string;
  locale: string;
  timezone: string;
}

const Ctx = React.createContext<FormatCtx>({ currency: "INR", locale: "en-IN", timezone: "UTC" });

export function FormatProvider({ value, children }: { value: FormatCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFormat() {
  const ctx = React.useContext(Ctx);
  return React.useMemo(
    () => ({
      ...ctx,
      money: (v: string | number | null | undefined, currency?: string, opts?: Parameters<typeof formatMoney>[2]) =>
        v === null || v === undefined ? "—" : formatMoney(v, currency ?? ctx.currency, { locale: ctx.locale, ...opts }),
      date: (d: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
        new Intl.DateTimeFormat(ctx.locale, { timeZone: ctx.timezone, ...opts }).format(new Date(d)),
    }),
    [ctx],
  );
}

/**
 * A monetary value. Uses tabular figures; sign and tone carry meaning together with
 * the explicit +/− sign so status is never conveyed by colour alone.
 */
export function Money({
  value,
  currency,
  className,
  tone = "auto",
  showSign = false,
  compact = false,
}: {
  value: string | number | null | undefined;
  currency?: string;
  className?: string;
  tone?: "auto" | "neutral" | "positive" | "negative" | "muted";
  showSign?: boolean;
  compact?: boolean;
}) {
  const f = useFormat();
  if (value === null || value === undefined) return <span className={cn("num text-subtle-foreground", className)}>—</span>;
  const n = Number(value);
  const resolved = tone === "auto" ? (showSign ? (n > 0 ? "positive" : n < 0 ? "negative" : "neutral") : "neutral") : tone;
  return (
    <span
      className={cn(
        "num whitespace-nowrap",
        resolved === "positive" && "text-positive",
        resolved === "negative" && "text-negative",
        resolved === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {f.money(value, currency, { signDisplay: showSign ? "exceptZero" : "auto", compact })}
    </span>
  );
}
