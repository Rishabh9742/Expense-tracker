import Anthropic from "@anthropic-ai/sdk";

/**
 * Configurable AI provider. Only "anthropic" is implemented; anything else (or a
 * missing key) means AI features are unavailable and Finora says so explicitly.
 */
export function aiConfigured(): boolean {
  return (process.env.AI_PROVIDER ?? "none") === "anthropic" && !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel(): string {
  return process.env.AI_MODEL || "claude-opus-5-5";
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!aiConfigured()) throw new Error("AI provider is not configured");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}

/** AI may be used for this user only when configured AND the user has explicitly consented. */
export function aiAllowed(prefs: { aiEnabled: boolean; aiConsentAt: Date | null }): boolean {
  return aiConfigured() && prefs.aiEnabled && !!prefs.aiConsentAt;
}
