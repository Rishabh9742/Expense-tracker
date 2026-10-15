import { cn } from "@/lib/utils";

/** Finora mark: three ascending rounded bars inside a soft square — steady, compounding growth. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-[#0b3d2e] dark:fill-[#123f30]" />
      <path d="M9 23V16" stroke="#6ee0b3" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 23V12" stroke="#a7efd0" strokeWidth="3" strokeLinecap="round" />
      <path d="M23 23V8" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">Finora</span>}
    </span>
  );
}
