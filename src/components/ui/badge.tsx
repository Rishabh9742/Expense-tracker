import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3", {
  variants: {
    variant: {
      neutral: "bg-surface-2 text-muted-foreground ring-1 ring-inset ring-border",
      accent: "bg-accent-soft text-accent-soft-foreground",
      positive: "bg-positive-soft text-positive",
      negative: "bg-negative-soft text-negative",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
      outline: "text-muted-foreground ring-1 ring-inset ring-border",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
