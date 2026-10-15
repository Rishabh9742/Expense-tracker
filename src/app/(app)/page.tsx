import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { rangeFromParams } from "@/lib/range-params";
import { getOverviewData } from "@/server/queries/overview";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const range = rangeFromParams(await searchParams, user.prefs.timezone, user.prefs.weekStartsOn);
  const data = await getOverviewData(user, range);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: user.prefs.timezone }).format(new Date()));
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return <OverviewDashboard data={data} greeting={`${greeting}${user.name ? `, ${user.name.split(" ")[0]}` : ""}`} />;
}
