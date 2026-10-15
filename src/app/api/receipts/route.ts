import { db } from "@/lib/db";
import { getUserOrNull } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { MAX_RECEIPT_BYTES, putPrivateFile, sniffMime } from "@/lib/storage";
import { aiAllowed, aiConfigured } from "@/server/ai/provider";
import { extractReceipt } from "@/server/ai/extract";

/**
 * Upload a receipt (image or PDF). The file type is verified from its bytes, the file
 * is encrypted at rest, and OCR runs only when an AI provider is configured AND the user
 * has consented. Otherwise the response says OCR is unavailable — nothing is faked.
 */
export async function POST(req: Request) {
  const user = await getUserOrNull();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`receipt:${user.id}`, 30, 60_000).ok) return Response.json({ error: "Too many uploads — wait a minute." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_RECEIPT_BYTES) return Response.json({ error: "Receipts must be 10 MB or smaller" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) return Response.json({ error: "Only JPEG, PNG, WebP images and PDFs are supported" }, { status: 415 });

  const transactionId = typeof form?.get("transactionId") === "string" ? (form!.get("transactionId") as string) : null;
  if (transactionId && !(await db.transaction.findFirst({ where: { id: transactionId, userId: user.id } }))) {
    return Response.json({ error: "Transaction not found" }, { status: 404 });
  }
  const runOcr = form?.get("ocr") === "1";

  const storageKey = await putPrivateFile(user.id, buf);
  let ocrStatus = "NOT_RUN";
  let ocrData: unknown = null;
  let ocrError: string | null = null;
  if (runOcr) {
    if (!aiAllowed(user.prefs)) {
      ocrStatus = "UNAVAILABLE";
      ocrError = aiConfigured() ? "Receipt OCR uses the AI provider — enable AI in Settings → Privacy to use it." : "Receipt OCR isn't configured for this workspace. Enter the details manually.";
    } else {
      try {
        const r = await extractReceipt(buf, mime);
        ocrData = r;
        ocrStatus = r.readable ? "SUCCESS" : "FAILED";
        if (!r.readable) ocrError = "The receipt couldn't be read clearly. Try a sharper, well-lit photo, or enter the details manually.";
      } catch (e) {
        console.error("[ocr]", e);
        ocrStatus = "FAILED";
        ocrError = "Text extraction failed. You can still enter the details manually.";
      }
    }
  }
  const receipt = await db.receipt.create({
    data: {
      userId: user.id,
      transactionId,
      fileName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "receipt",
      mimeType: mime,
      size: buf.length,
      storageKey,
      ocrStatus,
      ocrData: ocrData ? (JSON.parse(JSON.stringify(ocrData)) as object) : undefined,
      ocrError,
    },
  });
  await audit(user.id, "receipt.upload", "Receipt", receipt.id, { after: { transactionId, size: buf.length, ocrStatus } });
  return Response.json({ id: receipt.id, ocrStatus, ocr: ocrData, ocrError });
}
