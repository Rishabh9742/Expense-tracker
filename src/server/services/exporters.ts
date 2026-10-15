import ExcelJS from "exceljs";
import Papa from "papaparse";
import { csvSafe } from "./import-files";

export interface Sheet {
  name: string;
  columns: { header: string; key: string; width?: number; numFmt?: string }[];
  rows: Record<string, string | number | null>[];
}

export function toCsv(sheet: Sheet): string {
  const data = sheet.rows.map((r) => sheet.columns.map((c) => (typeof r[c.key] === "number" ? r[c.key] : csvSafe(r[c.key]))));
  return "﻿" + Papa.unparse({ fields: sheet.columns.map((c) => c.header), data });
}

export async function toXlsx(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Finora";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of s.rows) {
      const safe: Record<string, string | number | null> = {};
      for (const c of s.columns) safe[c.key] = typeof r[c.key] === "number" ? r[c.key] : r[c.key] === null || r[c.key] === undefined ? null : csvSafe(r[c.key]);
      ws.addRow(safe);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function fileResponse(body: string | Buffer, filename: string, type: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
