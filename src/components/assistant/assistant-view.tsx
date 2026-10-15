"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, Bot, Calculator, ChevronDown, Lock, Sparkles, User, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/finance/primitives";
import { askAssistantAction } from "@/server/actions/ai";
import type { AssistantAnswer } from "@/server/ai/offline";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: Omit<AssistantAnswer, "answer">;
  error?: boolean;
}

const SUGGESTIONS = [
  "How much did I spend on food this month?",
  "Which category increased the most?",
  "How much can I reasonably save based on my current budget?",
  "Which subscriptions account for the most recurring spending?",
  "How much did I spend on transportation last quarter?",
  "How does this month compare with last month?",
  "Which upcoming bills require attention?",
  "What would happen if I reduced dining expenses by 15%?",
  "How much money remains in my monthly budget?",
];

const TOOL_LABEL: Record<string, string> = {
  spending_summary: "Spending summary",
  compare_periods: "Period comparison",
  budget_status: "Budget status",
  subscriptions_summary: "Subscriptions",
  upcoming_bills: "Upcoming bills",
  goals_status: "Savings goals",
  account_balances: "Account balances",
  simulate_category_change: "What-if scenario",
  savings_capacity: "Savings capacity",
  search_transactions: "Transaction search",
};

/** Minimal, safe markdown: paragraphs, bullet/numbered lists and **bold**. No HTML injection. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    );
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const L = ordered ? "ol" : "ul";
          return (
            <L key={i} className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </L>
          );
        }
        if (/^#{1,3}\s/.test(b)) return <p key={i} className="font-semibold text-foreground">{inline(b.replace(/^#{1,3}\s/, ""))}</p>;
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
      })}
    </div>
  );
}

function Basis({ meta }: { meta: NonNullable<Msg["meta"]> }) {
  const [open, setOpen] = React.useState(false);
  if (!meta.calls.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/50 text-[12.5px]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground">
        <Calculator className="size-3.5" />
        How this was calculated · {meta.calls.map((c) => TOOL_LABEL[c.name] ?? c.name).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="space-y-2 border-t border-border px-3 py-2.5">
          {meta.calls.map((c, i) => (
            <li key={i}>
              <p className="font-medium text-foreground">{TOOL_LABEL[c.name] ?? c.name}</p>
              <p className="text-muted-foreground">
                Period: {c.result.basis.period} ({c.result.basis.from} → {c.result.basis.to}) · Currency: {c.result.basis.currency}
              </p>
              <p className="text-muted-foreground">{c.result.basis.calculation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssistantView({ initialQuestion, mode }: { initialQuestion: string | null; mode: "ai" | "needs-consent" | "offline" }) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const asked = React.useRef(false);

  const send = React.useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || pending) return;
      const next: Msg[] = [...messages, { role: "user", content: q }];
      setMessages(next);
      setInput("");
      setPending(true);
      const res = await askAssistantAction(next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })));
      setPending(false);
      if (res.ok && res.data) {
        const { answer, ...meta } = res.data;
        setMessages((m) => [...m, { role: "assistant", content: answer, meta }]);
      } else if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.error, error: true }]);
      }
    },
    [messages, pending],
  );

  React.useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      send(initialQuestion);
    }
  }, [initialQuestion, send]);
  React.useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, pending]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold">AI Assistant</h1>
          <p className="mt-1 text-sm text-muted-foreground">Answers are calculated from your own records. Every figure shows its period, currency and method.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={mode === "ai" ? "accent" : "outline"}>
            {mode === "ai" ? (
              <>
                <Sparkles /> AI enabled
              </>
            ) : (
              <>
                <Lock /> Offline analysis
              </>
            )}
          </Badge>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setMessages([])}>
              <RotateCcw /> New chat
            </Button>
          )}
        </div>
      </div>

      {mode === "needs-consent" && (
        <Notice className="mb-4" icon={<Lock />}>
          AI is available but off. Without it, the assistant answers common questions using built-in calculations only. To enable conversational answers, review what is shared and turn it on in{" "}
          <Link href="/settings#privacy" className="underline">
            Settings → Privacy
          </Link>
          .
        </Notice>
      )}
      {mode === "offline" && (
        <Notice className="mb-4" icon={<Lock />}>
          No AI provider is configured, so this assistant runs in offline analysis mode: it recognizes common questions and answers them with Finora&apos;s own calculations. Nothing leaves your workspace.
        </Notice>
      )}
      {mode === "ai" && (
        <p className="mb-4 text-meta text-muted-foreground">
          With AI enabled, the aggregated figures needed to answer (and matching transaction descriptions for searches) are sent to the configured AI provider. Turn it off any time in Settings.
        </p>
      )}

      <Card className="flex min-h-[420px] flex-col">
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="py-6 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                <Bot className="size-5" />
              </span>
              <p className="mt-3 font-medium">Ask about your money</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Read-only — the assistant can&apos;t change your data.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-surface-3 text-muted-foreground" : "bg-accent-soft text-accent-soft-foreground")}>
                {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
              </span>
              <div className={cn("max-w-[85%] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed", m.role === "user" ? "bg-accent text-accent-foreground" : m.error ? "bg-negative-soft text-negative" : "bg-surface-2 text-foreground/90")}>
                {m.role === "assistant" ? <Rich text={m.content} /> : m.content}
                {m.meta && (
                  <>
                    <Basis meta={m.meta} />
                    {m.meta.notice && <p className="mt-2 text-[11.5px] text-muted-foreground">{m.meta.notice}</p>}
                  </>
                )}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
                <Bot className="size-3.5" />
              </span>
              <div className="flex items-center gap-1 rounded-xl bg-surface-2 px-4 py-3" aria-label="Thinking">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="size-1.5 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 150}ms` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about spending, budgets, bills, goals…"
            className="max-h-40 min-h-10 resize-none"
            aria-label="Your question"
            maxLength={2000}
          />
          <Button type="submit" variant="primary" size="icon" disabled={!input.trim() || pending} aria-label="Send">
            <ArrowUp />
          </Button>
        </form>
      </Card>
      <p className="mt-3 text-center text-meta text-subtle-foreground">Informational only — not financial, tax or investment advice.</p>
    </div>
  );
}
