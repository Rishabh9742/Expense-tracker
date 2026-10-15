import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { aiAllowed, aiConfigured } from "@/server/ai/provider";
import { ImportView } from "@/components/import/import-view";

export const metadata: Metadata = { title: "Import & Export" };

export default async function ImportPage() {
  const user = await requireUser();
  const batches = await db.importBatch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 });
  const accounts = await db.account.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <ImportView
      ocr={aiAllowed(user.prefs) ? "on" : aiConfigured() ? "needs-consent" : "unavailable"}
      history={batches.map((b) => ({
        id: b.id,
        fileName: b.fileName,
        format: b.format,
        accountName: b.accountId ? names.get(b.accountId) ?? "Deleted account" : "—",
        status: b.status,
        rowCount: b.rowCount,
        importedCount: b.importedCount,
        skippedCount: b.skippedCount,
        errors: Array.isArray(b.errorReport) ? (b.errorReport as { row: number; field: string; message: string; value?: string }[]).slice(0, 100) : [],
        createdAt: b.createdAt.toISOString(),
        rolledBackAt: b.rolledBackAt?.toISOString() ?? null,
      }))}
    />
  );
}
