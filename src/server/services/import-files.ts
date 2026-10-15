import Papa from "papaparse";
import ExcelJS from "exceljs";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

export type ImportFormat = "CSV" | "XLSX" | "OFX";

export interface ParsedFile {
  format: ImportFormat;
  rows: string[][];
  /** OFX has a fixed layout; CSV/XLSX need column mapping */
  fixedMapping: boolean;
}

function detectFormat(name: string, buf: Buffer): ImportFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || (buf[0] === 0x50 && buf[1] === 0x4b)) return "XLSX";
  const head = buf.subarray(0, 512).toString("utf8");
  if (lower.endsWith(".ofx") || lower.endsWith(".qfx") || /OFXHEADER|<OFX>/i.test(head)) return "OFX";
  return "CSV";
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object") {
        const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
        if (o.richText) return o.richText.map((r) => r.text).join("");
        if (o.result !== undefined) return o.result instanceof Date ? o.result.toISOString().slice(0, 10) : String(o.result);
        if (o.text) return o.text;
      }
      return String(v);
    });
    rows.push(vals);
  });
  return rows;
}

/** Minimal OFX/QFX (SGML or XML) statement parser: extracts STMTTRN entries. */
function parseOfx(text: string): string[][] {
  const rows: string[][] = [["Date", "Description", "Amount", "Merchant", "Reference"]];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => {
    const m = new RegExp(`<${t}>([^<\\r\\n]*)`, "i").exec(b);
    return m ? m[1].trim() : "";
  };
  for (const b of blocks) {
    const body = b.split(/<\/STMTTRN>/i)[0];
    const dt = tag(body, "DTPOSTED");
    const date = /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
    const name = tag(body, "NAME");
    const memo = tag(body, "MEMO");
    rows.push([date, memo || name, tag(body, "TRNAMT"), name, tag(body, "FITID")]);
  }
  return rows;
}

export async function parseImportFile(name: string, buf: Buffer): Promise<ParsedFile> {
  if (buf.length > MAX_IMPORT_BYTES) throw new Error("File is larger than 5 MB");
  const format = detectFormat(name, buf);
  let rows: string[][];
  if (format === "XLSX") rows = await parseXlsx(buf);
  else {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    if (format === "OFX") rows = parseOfx(text);
    else {
      const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
      rows = res.data.map((r) => r.map((c) => (c ?? "").toString()));
    }
  }
  rows = rows.filter((r) => r.some((c) => c.trim()));
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`Files are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows`);
  // Neutralize spreadsheet formula injection in any cell that will be shown or exported again.
  rows = rows.map((r) => r.map((c) => c.slice(0, 1000)));
  return { format, rows, fixedMapping: format === "OFX" };
}

/** Prefix cells that would be interpreted as formulas by spreadsheet apps. */
export function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
}
