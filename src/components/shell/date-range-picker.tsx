"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function DateRangePicker({ className, defaultKey = "this_month" }: { className?: string; defaultKey?: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = (RANGE_KEYS as readonly string[]).includes(sp.get("range") ?? "") ? (sp.get("range") as RangeKey) : defaultKey;
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(sp.get("from") ?? "");
  const [to, setTo] = React.useState(sp.get("to") ?? "");
  const [error, setError] = React.useState<string | null>(null);

  const apply = (key: RangeKey, f?: string, t?: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set("range", key);
    if (key === "custom") {
      params.set("from", f!);
      params.set("to", t!);
    } else {
      params.delete("from");
      params.delete("to");
    }
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setOpen(false);
  };

  const label = current === "custom" && sp.get("from") && sp.get("to") ? `${sp.get("from")} → ${sp.get("to")}` : RANGE_LABELS[current];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className={cn("w-full justify-between md:w-auto", className)} aria-label={`Date range: ${label}`}>
          <span className="flex items-center gap-2">
            <CalendarRange className="text-muted-foreground" />
            {label}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        <ul role="listbox" aria-label="Date range presets">
          {RANGE_KEYS.filter((k) => k !== "custom").map((k) => (
            <li key={k}>
              <button
                role="option"
                aria-selected={k === current}
                onClick={() => apply(k)}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2"
              >
                {RANGE_LABELS[k]}
                {k === current && <Check className="size-3.5 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-border px-2.5 pt-2.5 pb-1.5">
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="text-[11.5px] text-muted-foreground">
                From
              </Label>
              <Input id="range-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 px-2 text-[12.5px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="text-[11.5px] text-muted-foreground">
                To
              </Label>
              <Input id="range-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 px-2 text-[12.5px]" />
            </div>
          </div>
          {error && <p className="mt-1.5 text-[11.5px] text-negative">{error}</p>}
          <Button
            size="sm"
            variant="primary"
            className="mt-2.5 w-full"
            onClick={() => {
              if (!from || !to) return setError("Choose both dates");
              if (to < from) return setError("End date must be after start");
              setError(null);
              apply("custom", from, to);
            }}
          >
            Apply range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
