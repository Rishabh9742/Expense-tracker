import { getUserOrNull } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { rangeFromParams } from "@/lib/range-params";
import { db } from "@/lib/db";
import { getReportData } from "@/server/queries/reports";
import { buildReportPdf } from "@/server/services/pdf-report";
import { fileResponse, toCsv, toXlsx, XLSX_TYPE, type Sheet } from "@/server/services/exporters";

export const maxDuration = 120;

export async function GET(req: Request) {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!rateLimit(`report:${user.id}`, 20, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const format = ["pdf", "xlsx", "csv"].includes(sp.format) ? sp.format : "pdf";
  const range = rangeFromParams(sp, user.prefs.timezone, user.prefs.weekStartsOn, "last_6_months");
  const accountIds = sp.account ? [sp.account] : undefined;
  const categoryIds = sp.category ? [sp.category] : undefined;
  const data = await getReportData(user, range, { accountIds, categoryIds });
  const filterNames: string[] = [];
  if (sp.account) filterNames.push(`Account: ${(await db.account.findFirst({ where: { id: sp.account, userId: user.id } }))?.name ?? "?"}`);
  if (sp.category) filterNames.push(`Category: ${(await db.category.findFirst({ where: { id: sp.category, userId: user.id } }))?.name ?? "?"}`);
  const stamp = `${range.from.toISOString().slice(0, 10)}_${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}`;
  await audit(user.id, "export.report", "Report", null, { after: { format, range: range.label } });

  if (format === "pdf") {
    const pdf = await buildReportPdf(data, { currency: user.prefs.baseCurrency, locale: user.prefs.locale, userName: user.name, filters: filterNames.join(", ") });
    return fileResponse(pdf, `finora-report-${stamp}.pdf`, "application/pdf");
  }
  const cur = user.prefs.baseCurrency;
  const sheets: Sheet[] = [
    {
      name: "Monthly cash flow",
      columns: [
        { header: "Month", key: "label", width: 12 },
        { header: `Income (${cur})`, key: "income", numFmt: "#,##0.00" },
        { header: `Net spending (${cur})`, key: "expenses", numFmt: "#,##0.00" },
        { header: `Net (${cur})`, key: "net", numFmt: "#,##0.00" },
        { header: "Savings rate %", key: "savingsRate" },
      ],
      rows: data.monthly.map((r) => ({ label: r.label, income: r.income, expenses: r.expenses, net: r.net, savingsRate: r.savingsRate })),
    },
    {
      name: "Categories",
      columns: [
        { header: "Category", key: "name", width: 26 },
        { header: "Share %", key: "percent" },
        { header: `Amount (${cur})`, key: "amount", numFmt: "#,##0.00" },
        { header: `Previous (${cur})`, key: "prev", numFmt: "#,##0.00" },
        { header: "Change %", key: "change" },
      ],
      rows: data.categories.map((c) => ({ name: c.name, percent: c.percent, amount: Number(c.amount), prev: Number(c.prev), change: c.change })),
    },
    {
      name: "Merchants",
      columns: [
        { header: "Merchant", key: "name", width: 30 },
        { header: "Transactions", key: "count" },
        { header: `Total (${cur})`, key: "total", numFmt: "#,##0.00" },
        { header: `Average (${cur})`, key: "average", numFmt: "#,##0.00" },
      ],
      rows: data.merchants.map((x) => ({ name: x.name, count: x.count, total: Number(x.total), average: Number(x.average) })),
    },
    {
      name: "Income sources",
      columns: [
        { header: "Source", key: "name", width: 26 },
        { header: "Share %", key: "percent" },
        { header: `Amount (${cur})`, key: "amount", numFmt: "#,##0.00" },
      ],
      rows: data.income.sources.map((x) => ({ name: x.name, percent: x.percent, amount: Number(x.amount) })),
    },
  ];
  if (format === "xlsx") return fileResponse(await toXlsx(sheets), `finora-report-${stamp}.xlsx`, XLSX_TYPE);
  // CSV: one combined file with a section column.
  const combined: Sheet = {
    name: "Report",
    columns: [
      { header: "Section", key: "section" },
      { header: "Item", key: "item" },
      { header: `Amount (${cur})`, key: "amount" },
      { header: "Extra", key: "extra" },
    ],
    rows: [
      ...data.monthly.map((r) => ({ section: "Monthly income", item: r.label, amount: r.income, extra: null })),
      ...data.monthly.map((r) => ({ section: "Monthly net spending", item: r.label, amount: r.expenses, extra: null })),
      ...data.categories.map((c) => ({ section: "Category", item: c.name, amount: Number(c.amount), extra: `${c.percent}%` })),
      ...data.merchants.map((x) => ({ section: "Merchant", item: x.name, amount: Number(x.total), extra: `${x.count} txns` })),
      ...data.income.sources.map((x) => ({ section: "Income source", item: x.name, amount: Number(x.amount), extra: `${x.percent}%` })),
    ],
  };
  return fileResponse(toCsv(combined), `finora-report-${stamp}.csv`, "text/csv; charset=utf-8");
}
