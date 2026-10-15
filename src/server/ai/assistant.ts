import Anthropic from "@anthropic-ai/sdk";
import type { CurrentUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { anthropic, aiAllowed, aiConfigured, aiModel } from "./provider";
import { TOOL_DEFS, runTool } from "./tools";
import { answerOffline, type AssistantAnswer } from "./offline";

const MAX_TOOL_ROUNDS = 6;

function systemPrompt(user: CurrentUser) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: user.prefs.timezone, dateStyle: "full" }).format(new Date());
  return `You are Finora's financial assistant. You help one user understand their own finances.

Rules:
- Every number you state must come from a tool result in this conversation. Never estimate, invent or recall figures. If the tools can't answer, say what's missing.
- Call tools to get data; you may call several. Tools are read-only — you cannot change the user's data. If asked to change something, explain how to do it in the app instead.
- Amounts are in ${user.prefs.baseCurrency} unless a tool says otherwise. Format money with the currency symbol and thousands separators (locale ${user.prefs.locale}).
- Keep answers short and scannable: lead with the direct answer, then 2–5 supporting bullets. Use **bold** for key figures.
- When you give an important figure, mention the period it covers.
- Financial suggestions are informational, not professional advice. State assumptions, and never promise returns or outcomes. Scenarios and projections are estimates.
- Today is ${today}; the user's time zone is ${user.prefs.timezone}.`;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askAssistant(user: CurrentUser, history: ChatTurn[]): Promise<AssistantAnswer> {
  const question = history[history.length - 1]?.content ?? "";
  if (!aiAllowed(user.prefs)) {
    const res = await answerOffline(user, question);
    return {
      ...res,
      notice: aiConfigured()
        ? "Offline analysis mode — enable AI in Settings → Privacy to get conversational answers. Your data has not been sent anywhere."
        : "Offline analysis mode — no AI provider is configured for this workspace, so answers come from built-in calculations only.",
    };
  }

  const client = anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({ role: t.role, content: t.content }));
  const calls: AssistantAnswer["calls"] = [];
  const tools: Anthropic.Beta.BetaTool[] = TOOL_DEFS.map((t) => ({ ...t, input_schema: t.input_schema as unknown as Anthropic.Beta.BetaTool.InputSchema, strict: true }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: aiModel(),
      max_tokens: 16000,
      system: [{ type: "text", text: systemPrompt(user) }],
      tools,
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
      // Server-side fallback on policy refusals (Claude API only).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") {
      return { answer: "I can't help with that request. Try asking about your spending, budgets, bills, subscriptions or goals.", calls, mode: "ai" };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      await audit(user.id, "ai.query", "Assistant", null, { after: { tools: calls.map((c) => c.name), model: response.model } });
      return { answer: text || "I couldn't produce an answer. Please try rephrasing.", calls, mode: "ai" };
    }

    // Keep the full assistant content (including thinking blocks) for the next request.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        try {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const result = await runTool(user, tu.name, input);
          calls.push({ name: tu.name, input, result });
          return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(result) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: tu.id, content: `Tool failed: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { answer: "That question needed more steps than I can take at once. Try a more specific question.", calls, mode: "ai" };
}
