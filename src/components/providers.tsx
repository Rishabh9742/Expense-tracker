"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/misc";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="finora-theme">
      <TooltipProvider delayDuration={250}>
        {children}
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!bg-surface !text-foreground !border-border !shadow-lg !rounded-lg !font-sans",
              description: "!text-muted-foreground",
              actionButton: "!bg-accent !text-accent-foreground !font-medium",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
