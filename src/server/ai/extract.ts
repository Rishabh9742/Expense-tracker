import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, aiModel } from "./provider";

// ───────────── Categorization suggestions ─────────────

const CategorizationSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      categoryId: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

/**
 * Suggests categories for uncategorized transactions. Only descriptions, merchants,
 * signed amounts and the category list are sent — no account names or identifiers.
 * Results are stored as AI suggestions with confidence and flagged for review.
 */
export async function suggestCategories(
  txns: { id: string; description: string; merchant: string | null; amount: string; type: string }[],
  categories: { id: string; name: string; kind: string; parent?: string | null }[],
) {
  const response = await anthropic().messages.parse({
    model: aiModel(),
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(CategorizationSchema) },
    system:
      "You categorize personal finance transactions. Choose the single best categoryId from the provided list, or null if none fits. Confidence is 0–1: use below 0.6 when the description is ambiguous. Never invent category ids.",
    messages: [
      {
        role: "user",
        content: `Categories:\n${JSON.stringify(categories)}\n\nTransactions:\n${JSON.stringify(txns)}`,
      },
    ],
  } as Parameters<ReturnType<typeof anthropic>["messages"]["parse"]>[0]);
  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  const valid = new Set(categories.map((c) => c.id));
  return (response.parsed_output as z.infer<typeof CategorizationSchema>).suggestions
    .filter((s) => txns.some((t) => t.id === s.id))
    .map((s) => ({ ...s, categoryId: s.categoryId && valid.has(s.categoryId) ? s.categoryId : null, confidence: Math.max(0, Math.min(1, s.confidence)) }));
}

// ───────────── Receipt OCR ─────────────

const ReceiptSchema = z.object({
  readable: z.boolean(),
  merchant: z.string().nullable(),
  date: z.string().nullable(),
  total: z.string().nullable(),
  tax: z.string().nullable(),
  currency: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.string().nullable() })),
  notes: z.string().nullable(),
});
export type ReceiptExtraction = z.infer<typeof ReceiptSchema>;

export async function extractReceipt(data: Buffer, mimeType: string): Promise<ReceiptExtraction> {
  const b64 = data.toString("base64");
  const media =
    mimeType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: b64 } };
  const response = await anthropic().messages.parse({
    model: aiModel(),
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ReceiptSchema) },
    system:
      "Extract fields from a purchase receipt. Use null for anything you cannot read clearly — never guess. date: YYYY-MM-DD. total/tax/amounts: plain decimal strings without currency symbols or thousands separators. currency: ISO 4217 code if shown or clearly implied by the symbol, else null. Set readable=false if the image is too blurry or isn't a receipt.",
    messages: [{ role: "user", content: [media, { type: "text", text: "Extract this receipt." }] }],
  } as Parameters<ReturnType<typeof anthropic>["messages"]["parse"]>[0]);
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { readable: false, merchant: null, date: null, total: null, tax: null, currency: null, paymentMethod: null, lineItems: [], notes: "Extraction was declined." };
  }
  const r = response.parsed_output as ReceiptExtraction;
  // Sanitize: reject malformed values rather than passing them into the form.
  const num = (v: string | null) => (v && /^\d{1,12}(\.\d{1,4})?$/.test(v.trim()) ? v.trim() : null);
  return {
    ...r,
    date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    total: num(r.total),
    tax: num(r.tax),
    currency: r.currency && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
    lineItems: r.lineItems.slice(0, 50).map((l) => ({ description: l.description.slice(0, 120), amount: num(l.amount) })),
  };
}
