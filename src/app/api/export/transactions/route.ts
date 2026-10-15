import { db } from "@/lib/db";
import { getUserOrNull } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { formatLocal } from "@/lib/dates";
import { buildWhere, parseTxnQuery } from "@/server/queries/transactions";
import { fileResponse, toCsv, toXlsx, XLSX_TYPE, type Sheet } from "@/server/services/exporters";

export async function GET(req: Request) {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!rateLimit(`export:${user.id}`, 20, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const q = parseTxnQuery(Object.fromEntries(url.searchParams));
  const where = await buildWhere(user.id, q, user.prefs.timezone);
  const rows = await db.transaction.findMany({
    where,
    include: { account: { select: { name: true } }, toAccount: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } }, tags: { include: { tag: true } } },
    orderBy: { date: "desc" },
    take: 50_000,
  });
  const tz = user.prefs.timezone;
  const sheet: Sheet = {
    name: "Transactions",
    columns: [
      { header: "Date", key: "date", width: 12 },
      { header: "Time", key: "time", width: 8 },
      { header: "Type", key: "type", width: 11 },
      { header: "Description", key: "description", width: 36 },
      { header: "Merchant", key: "merchant", width: 22 },
      { header: "Category", key: "category", width: 22 },
      { header: "Account", key: "account", width: 20 },
      { header: "To account", key: "toAccount", width: 20 },
      { header: "Amount", key: "amount", width: 14, numFmt: "#,##0.00" },
      { header: "Currency", key: "currency", width: 9 },
      { header: `Amount (${user.prefs.baseCurrency})`, key: "base", width: 16, numFmt: "#,##0.00" },
      { header: "FX rate", key: "fxRate", width: 12 },
      { header: "FX source", key: "fxSource", width: 22 },
      { header: "Status", key: "status", width: 10 },
      { header: "Payment method", key: "payment", width: 16 },
      { header: "Tags", key: "tags", width: 20 },
      { header: "Reimbursable", key: "reimbursable", width: 12 },
      { header: "Notes", key: "notes", width: 30 },
    ],
    rows: rows.map((t) => ({
      date: formatLocal(t.date, tz, "yyyy-MM-dd"),
      time: formatLocal(t.date, tz, "HH:mm"),
      type: t.type,
      description: t.description,
      merchant: t.merchant,
      category: t.category ? (t.category.parent ? `${t.category.parent.name} > ${t.category.name}` : t.category.name) : null,
      account: t.account.name,
      toAccount: t.toAccount?.name ?? null,
      amount: Number(t.amount.toFixed(2)),
      currency: t.currency,
      base: t.baseAmount ? Number(t.baseAmount.toFixed(2)) : null,
      fxRate: t.fxRate?.toString() ?? null,
      fxSource: t.fxRateSource,
      status: t.status,
      payment: t.paymentMethod,
      tags: t.tags.map((x) => x.tag.name).join(", "),
      reimbursable: t.isReimbursable ? "yes" : "",
      notes: t.notes,
    })),
  };
  await audit(user.id, "export.transactions", "Transaction", null, { after: { format, count: rows.length } });
  const stamp = new Date().toISOString().slice(0, 10);
  return format === "xlsx" ? fileResponse(await toXlsx([sheet]), `finora-transactions-${stamp}.xlsx`, XLSX_TYPE) : fileResponse(toCsv(sheet), `finora-transactions-${stamp}.csv`, "text/csv; charset=utf-8");
}
