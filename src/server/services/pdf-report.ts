import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/money";
import type { ReportData } from "@/server/queries/reports";

const INK = rgb(0.09, 0.1, 0.12);
const MUTED = rgb(0.42, 0.44, 0.48);
const LINE = rgb(0.88, 0.88, 0.86);
const ACCENT = rgb(0.016, 0.47, 0.34);

/** Standard PDF fonts only cover WinAnsi; replace anything else so drawing never throws. */
function safe(s: string): string {
  return s.replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "?");
}

export async function buildReportPdf(data: ReportData, opts: { currency: string; locale: string; userName: string | null; filters: string }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Finora report — ${data.range.label}`);
  pdf.setCreator("Finora");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Use the ISO code rather than a symbol (e.g. ₹ isn't available in standard fonts).
  const m = (v: string | number) => `${opts.currency} ${formatMoney(v, opts.currency, { locale: opts.locale, hideCurrency: true })}`;

  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 790;
  const left = 50;
  const right = 545;
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = INK) => page.drawText(safe(s), { x, y, size, font: f, color });
  const textRight = (s: string, xRight: number, size = 10, f: PDFFont = font, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  const ensure = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
  };
  const rule = () => page.drawLine({ start: { x: left, y: y - 4 }, end: { x: right, y: y - 4 }, thickness: 0.6, color: LINE });

  // Header
  page.drawRectangle({ x: left, y: y - 4, width: 18, height: 18, color: rgb(0.043, 0.24, 0.18) });
  text("Finora", left + 26, 16, bold);
  y -= 30;
  text(`Financial report · ${data.range.label}`, left, 13, bold);
  y -= 16;
  text(`${opts.userName ? `${opts.userName} · ` : ""}Generated ${new Date().toISOString().slice(0, 10)} · Amounts in ${opts.currency}${opts.filters ? ` · ${opts.filters}` : ""}`, left, 9, font, MUTED);
  y -= 28;

  // Summary
  const s = data.summary;
  const cards: [string, string][] = [
    ["Income", m(s.income)],
    ["Net spending", m(s.expenses)],
    ["Net cash flow", m(s.net)],
    ["Savings rate", s.savingsRate === null ? "-" : `${s.savingsRate}%`],
  ];
  const w = (right - left) / 4;
  cards.forEach(([label, val], i) => {
    const x = left + i * w;
    page.drawRectangle({ x: x + 2, y: y - 30, width: w - 8, height: 44, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(safe(label), { x: x + 10, y: y + 2, size: 8.5, font, color: MUTED });
    page.drawText(safe(val), { x: x + 10, y: y - 16, size: 11, font: bold, color: INK });
  });
  y -= 60;
  text("Net spending = expenses minus refunds and reimbursements. Transfers between your own accounts are excluded.", left, 8, font, MUTED);
  y -= 26;

  const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
    ensure(50);
    text(title, left, 11.5, bold);
    y -= 18;
    let x = left;
    headers.forEach((h, i) => {
      if (i === 0) text(h, x, 8.5, bold, MUTED);
      else textRight(h, x + widths[i], 8.5, bold, MUTED);
      x += widths[i];
    });
    rule();
    y -= 16;
    for (const r of rows) {
      ensure(20);
      x = left;
      r.forEach((c, i) => {
        if (i === 0) text(c.length > 46 ? `${c.slice(0, 45)}…` : c, x, 9);
        else textRight(c, x + widths[i], 9);
        x += widths[i];
      });
      y -= 14;
    }
    y -= 16;
  };

  table(
    "Monthly cash flow",
    ["Month", "Income", "Net spending", "Net", "Savings rate"],
    data.monthly.map((r) => [r.label, m(r.income), m(r.expenses), m(r.net), r.savingsRate === null ? "-" : `${r.savingsRate}%`]),
    [95, 105, 105, 105, 85],
  );
  table(
    "Spending by category",
    ["Category", "Share", "Amount", "Previous period"],
    data.categories.slice(0, 20).map((c) => [c.name, `${c.percent}%`, m(c.amount), m(c.prev)]),
    [185, 70, 120, 120],
  );
  if (data.merchants.length) table("Top merchants", ["Merchant", "Transactions", "Total"], data.merchants.slice(0, 12).map((x) => [x.name, String(x.count), m(x.total)]), [255, 100, 140]);
  if (data.income.sources.length) table("Income sources", ["Source", "Share", "Amount"], data.income.sources.map((x) => [x.name, `${x.percent}%`, m(x.amount)]), [255, 100, 140]);
  table(
    "Spending mix",
    ["Type", "Amount"],
    [
      ["Essential", m(data.essential.essential)],
      ["Discretionary", m(data.essential.discretionary)],
      ["Recurring", m(data.recurringSplit.recurring)],
      ["One-off", m(data.recurringSplit.nonRecurring)],
    ],
    [355, 140],
  );

  ensure(40);
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: ACCENT });
  y -= 14;
  text("Calculated from your recorded transactions. Figures are informational and not financial advice.", left, 8, font, MUTED);

  // Page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: right - 30, y: 30, size: 8, font, color: MUTED }));
  return Buffer.from(await pdf.save());
}
