"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/lib/utils";
import { askAssistant } from "@/server/ai/assistant";
import { aiAllowed } from "@/server/ai/provider";
import { suggestCategories } from "@/server/ai/extract";
import type { AssistantAnswer } from "@/server/ai/offline";

const historySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(40);

export async function askAssistantAction(history: { role: "user" | "assistant"; content: string }[]): Promise<ActionResult<AssistantAnswer>> {
  const user = await requireUser();
  if (!rateLimit(`ai:${user.id}`, 20, 60_000).ok) return { ok: false, error: "You're asking quickly — please wait a moment." };
  const parsed = historySchema.safeParse(history);
  if (!parsed.success || parsed.data[parsed.data.length - 1].role !== "user") return { ok: false, error: "Ask a question to get started." };
  try {
    const res = await askAssistant(user, parsed.data);
    // Results include Decimal-free JSON only; strip to plain data for the client.
    return { ok: true, data: JSON.parse(JSON.stringify(res)) };
  } catch (e) {
    console.error("[assistant]", e);
    return { ok: false, error: "The assistant is unavailable right now. Your data is safe — please try again shortly." };
  }
}

/** Ask the AI for categories for up to 50 uncategorized transactions. Results are saved as reviewable suggestions. */
export async function aiCategorizeAction(): Promise<ActionResult<{ suggested: number }>> {
  const user = await requireUser();
  if (!aiAllowed(user.prefs)) return { ok: false, error: "AI is not enabled. Turn it on in Settings → Privacy first." };
  if (!rateLimit(`ai-cat:${user.id}`, 5, 60_000).ok) return { ok: false, error: "Please wait a moment before trying again." };
  const [txns, cats] = await Promise.all([
    db.transaction.findMany({
      where: { userId: user.id, deletedAt: null, categoryId: null, type: { in: ["EXPENSE", "INCOME", "REFUND"] }, splits: { none: {} } },
      select: { id: true, description: true, merchant: true, amount: true, type: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
    db.category.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true, kind: true, parent: { select: { name: true } } } }),
  ]);
  if (!txns.length) return { ok: true, data: { suggested: 0 } };
  try {
    const suggestions = await suggestCategories(
      txns.map((t) => ({ ...t, amount: t.amount.toString() })),
      cats.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parent: c.parent?.name ?? null })),
    );
    let suggested = 0;
    for (const s of suggestions) {
      if (!s.categoryId) continue;
      await db.transaction.updateMany({
        where: { id: s.id, userId: user.id, categoryId: null },
        data: { categoryId: s.categoryId, categorySource: "AI", categoryConfidence: s.confidence, needsReview: true },
      });
      suggested++;
    }
    await audit(user.id, "ai.categorize", "Transaction", null, { after: { requested: txns.length, suggested } });
    revalidatePath("/", "layout");
    return { ok: true, data: { suggested } };
  } catch (e) {
    console.error("[ai-categorize]", e);
    return { ok: false, error: "AI categorization failed. Nothing was changed." };
  }
}
