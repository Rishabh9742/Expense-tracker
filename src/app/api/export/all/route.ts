import { db } from "@/lib/db";
import { getUserOrNull } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { fileResponse } from "@/server/services/exporters";

/** Complete machine-readable export of everything Finora stores for the user (data portability). */
export async function GET() {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!rateLimit(`export-all:${user.id}`, 5, 60 * 60_000).ok) return new Response("Too many exports — try again later", { status: 429 });
  const where = { userId: user.id };
  const [profile, accounts, transactions, categories, tags, rules, merchantMappings, budgets, recurring, subscriptions, bills, goals, debts, assets, receipts, imports, notifications, exchangeRates, auditLogs] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, email: true, createdAt: true, preferences: true } }),
    db.account.findMany({ where }),
    db.transaction.findMany({ where, include: { splits: true, tags: { include: { tag: { select: { name: true } } } } } }),
    db.category.findMany({ where }),
    db.tag.findMany({ where }),
    db.transactionRule.findMany({ where }),
    db.merchantMapping.findMany({ where }),
    db.budget.findMany({ where, include: { allocations: true } }),
    db.recurringTransaction.findMany({ where }),
    db.subscription.findMany({ where }),
    db.bill.findMany({ where, include: { payments: true } }),
    db.savingsGoal.findMany({ where, include: { contributions: true } }),
    db.debt.findMany({ where, include: { payments: true } }),
    db.asset.findMany({ where, include: { valuations: true } }),
    db.receipt.findMany({ where, select: { id: true, transactionId: true, fileName: true, mimeType: true, size: true, ocrStatus: true, ocrData: true, createdAt: true } }),
    db.importBatch.findMany({ where }),
    db.notification.findMany({ where }),
    db.exchangeRate.findMany({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);
  await audit(user.id, "export.all", "User", user.id);
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: "finora-export-v1",
      note: "Monetary values are exact decimal strings. Receipt files can be downloaded individually from the app.",
      profile,
      accounts,
      transactions,
      categories,
      tags,
      rules,
      merchantMappings,
      budgets,
      recurring,
      subscriptions,
      bills,
      goals,
      debts,
      assets,
      receipts,
      imports,
      notifications,
      manualExchangeRates: exchangeRates,
      auditLogs,
    },
    null,
    2,
  );
  return fileResponse(body, `finora-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}
