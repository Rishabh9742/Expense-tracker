import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { money } from "@/lib/money";
import { getNetWorth, getNetWorthHistory } from "@/server/services/planning";
import { NetWorthView } from "@/components/planning/net-worth-view";

export const metadata: Metadata = { title: "Net Worth" };

export default async function NetWorthPage() {
  const user = await requireUser();
  const p = user.prefs;
  const prefs = { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable };
  const [nw, history, assets] = await Promise.all([
    getNetWorth(user.id, prefs),
    getNetWorthHistory(user.id, prefs, 13),
    db.asset.findMany({ where: { userId: user.id, archived: false }, include: { valuations: { orderBy: { date: "desc" }, take: 12 } }, orderBy: { name: "asc" } }),
  ]);
  const r = nw.result;
  return (
    <NetWorthView
      summary={{
        netWorth: money(r.netWorth),
        totalAssets: money(r.totalAssets),
        accountAssets: money(r.accountAssets),
        estimatedAssets: money(r.estimatedAssets),
        totalLiabilities: money(r.totalLiabilities),
        accountLiabilities: money(r.accountLiabilities),
        debtLiabilities: money(r.debtLiabilities),
        missingRates: r.missingRates,
        skippedLinkedDebts: r.skippedLinkedDebts,
      }}
      accounts={nw.accounts
        .filter((a) => a.includeInNetWorth && (a.status === "ACTIVE" || !a.balance.isZero()))
        .map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: money(a.balance), baseBalance: a.baseBalance ? money(a.baseBalance) : null }))}
      debts={nw.debts.filter((d) => !d.closed && !(d.linkedAccountId && r.skippedLinkedDebts.includes(d.name))).map((d) => ({ id: d.id, name: d.name, baseBalance: d.baseBalance ? money(d.baseBalance) : null }))}
      assets={assets.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        notes: a.notes,
        latest: a.valuations[0] ? { value: money(a.valuations[0].value), date: a.valuations[0].date.toISOString() } : null,
        baseValue: nw.assets.find((x) => x.id === a.id)?.baseValue ? money(nw.assets.find((x) => x.id === a.id)!.baseValue!) : null,
        valuations: a.valuations.map((v) => ({ date: v.date.toISOString(), value: money(v.value) })),
      }))}
      history={history.map((h) => ({ label: h.label, date: h.date.toISOString(), assets: h.assets.toDecimalPlaces(2).toNumber(), liabilities: h.liabilities.toDecimalPlaces(2).toNumber(), netWorth: h.netWorth.toDecimalPlaces(2).toNumber() }))}
    />
  );
}
