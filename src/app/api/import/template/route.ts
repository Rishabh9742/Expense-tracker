import { CSV_TEMPLATE } from "@/lib/finance/import";
import { fileResponse } from "@/server/services/exporters";

export function GET() {
  return fileResponse(CSV_TEMPLATE, "finora-import-template.csv", "text/csv; charset=utf-8");
}
