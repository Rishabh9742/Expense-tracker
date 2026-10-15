"use client";

import { Field, Input, NativeSelect } from "@/components/ui/input";

export const FREQ_OPTIONS = [
  { v: "WEEKLY", l: "Weekly" },
  { v: "BIWEEKLY", l: "Every 2 weeks" },
  { v: "MONTHLY", l: "Monthly" },
  { v: "QUARTERLY", l: "Quarterly" },
  { v: "SEMIANNUAL", l: "Every 6 months" },
  { v: "YEARLY", l: "Yearly" },
  { v: "DAILY", l: "Daily" },
  { v: "CUSTOM", l: "Every N days" },
] as const;

export const FREQ_SHORT: Record<string, string> = { DAILY: "day", WEEKLY: "week", BIWEEKLY: "2 wks", MONTHLY: "month", QUARTERLY: "quarter", SEMIANNUAL: "6 mo", YEARLY: "year", CUSTOM: "custom" };

export function freqLabel(f: string, interval: number) {
  if (f === "CUSTOM") return `Every ${interval} days`;
  if (interval > 1 && ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(f)) return `Every ${interval} ${FREQ_SHORT[f]}s`;
  return FREQ_OPTIONS.find((o) => o.v === f)?.l ?? f;
}

export function FrequencyFields({
  frequency,
  interval,
  onFrequency,
  onInterval,
  idPrefix,
}: {
  frequency: string;
  interval: number | string;
  onFrequency: (f: string) => void;
  onInterval: (n: number) => void;
  idPrefix: string;
}) {
  return (
    <>
      <Field label="Repeats" htmlFor={`${idPrefix}-freq`}>
        <NativeSelect id={`${idPrefix}-freq`} value={frequency} onChange={(e) => onFrequency(e.target.value)}>
          {FREQ_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {(frequency === "CUSTOM" || frequency === "MONTHLY" || frequency === "WEEKLY" || frequency === "YEARLY" || frequency === "DAILY") && (
        <Field label={frequency === "CUSTOM" ? "Every N days" : `Every N ${FREQ_SHORT[frequency]}s`} htmlFor={`${idPrefix}-int`}>
          <Input id={`${idPrefix}-int`} type="number" min={1} max={365} value={String(interval)} onChange={(e) => onInterval(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
      )}
    </>
  );
}

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isoToYmd(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
