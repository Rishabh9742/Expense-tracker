import { Logo } from "@/components/brand/logo";
import { Lock, Sparkles, LineChart } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-sidebar p-10 lg:flex lg:flex-col">
        <Logo />
        <div className="my-auto max-w-md">
          <h2 className="text-[28px] leading-9 font-semibold tracking-[-0.025em] text-foreground">A calm, clear view of your money.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Track spending, plan budgets and goals, and understand where every rupee, dollar or euro goes — with numbers calculated from your
            own records, never guessed.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              { icon: LineChart, title: "Accurate by design", body: "Decimal-safe math, transfers that never inflate spending, and multi-currency with rate provenance." },
              { icon: Sparkles, title: "Insight, not noise", body: "An assistant that answers from your actual data and shows how each number was calculated." },
              { icon: Lock, title: "Private by default", body: "Encrypted receipts, strict data isolation, and nothing sent to an AI provider without your consent." },
            ].map(({ icon: I, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-accent">
                  <I className="size-4" />
                </span>
                <span>
                  <span className="block font-medium text-foreground">{title}</span>
                  <span className="text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-meta text-subtle-foreground">Finora never asks for or stores your online banking password.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
