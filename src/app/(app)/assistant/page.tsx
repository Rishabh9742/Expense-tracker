import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { aiAllowed, aiConfigured } from "@/server/ai/provider";
import { AssistantView } from "@/components/assistant/assistant-view";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return <AssistantView initialQuestion={sp.q?.slice(0, 500) ?? null} mode={aiAllowed(user.prefs) ? "ai" : aiConfigured() ? "needs-consent" : "offline"} />;
}
