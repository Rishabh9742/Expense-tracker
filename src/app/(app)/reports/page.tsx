import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { rangeFromParams } from "@/lib/range-params";
import { getReportData } from "@/server/queries/reports";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata: Metadata = { title: "Reports & Analytics" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = rangeFromParams(sp, user.prefs.timezone, user.prefs.weekStartsOn, "last_6_months");
  const accountIds = typeof sp.account === "string" && sp.account ? [sp.account] : undefined;
  const categoryIds = typeof sp.category === "string" && sp.category ? [sp.category] : undefined;
  const data = await getReportData(user, range, { accountIds, categoryIds });
  return <ReportsView data={data} tab={typeof sp.tab === "string" ? sp.tab : "overview"} />;
}
