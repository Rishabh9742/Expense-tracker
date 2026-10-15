"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as AlertPrimitive from "@radix-ui/react-alert-dialog";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/* Checkbox */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-surface shadow-xs transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      {props.checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

/* Switch */
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-surface-3 transition-colors data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = "Switch";

/* Tabs */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-surface-2 p-0.5", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/* Tooltip */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* Popover */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "end", ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("z-[60] rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-fade-in", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* Dropdown */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("z-[60] min-w-44 rounded-lg border border-border bg-surface p-1 shadow-lg data-[state=open]:animate-fade-in", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-negative data-[highlighted]:bg-negative-soft [&_svg]:text-negative",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2 py-1.5 text-meta text-muted-foreground", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

/* Confirmation dialog */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => unknown;
  loading?: boolean;
}) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <AlertPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-lg data-[state=open]:animate-scale-in">
          <AlertPrimitive.Title className="text-base font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description asChild>
            <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          </AlertPrimitive.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertPrimitive.Cancel className={buttonVariants({ variant: "secondary" })}>Cancel</AlertPrimitive.Cancel>
            <button
              type="button"
              disabled={loading}
              className={buttonVariants({ variant: destructive ? "destructive" : "primary" })}
              onClick={async () => {
                await onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

/* Progress bar with accessible semantics */
export function ProgressBar({
  value,
  tone = "accent",
  className,
  label,
  size = "md",
}: {
  value: number;
  tone?: "accent" | "positive" | "warning" | "negative" | "neutral";
  className?: string;
  label: string;
  size?: "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color = {
    accent: "bg-accent",
    positive: "bg-positive",
    warning: "bg-warning",
    negative: "bg-negative",
    neutral: "bg-muted-foreground",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn("w-full overflow-hidden rounded-full bg-surface-3", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-surface-3/70", className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-muted-foreground", className)}>
      {children}
    </kbd>
  );
}
