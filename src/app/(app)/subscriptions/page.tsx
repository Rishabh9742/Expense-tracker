import type { Metadata } from "next";
import { subMonths } from "date-fns";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { money, Decimal, dec } from "@/lib/money";
import { monthBuckets } from "@/lib/dates";
import { getSubscriptionsSummary } from "@/server/services/planning";
import { detectRecurring } from "@/lib/finance/detect-recurring";
import { normalizeMerchant } from "@/lib/finance/duplicates";
import { SubscriptionsView } from "@/components/schedules/subscriptions-view";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const p = user.prefs;
  const prefs = { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable };
  const [summary, history, bills] = await Promise.all([
    getSubscriptionsSummary(user.id, prefs),
    db.transaction.findMany({
      where: { userId: user.id, deletedAt: null, type: "EXPENSE", date: { gte: subMonths(new Date(), 13) } },
      select: { date: true, amount: true, baseAmount: true, merchant: true, description: true, categoryId: true, accountId: true },
      orderBy: { date: "asc" },
    }),
    db.bill.findMany({ where: { userId: user.id }, select: { name: true } }),
  ]);

  const tracked = new Set([...summary.rows.map((s) => normalizeMerchant(s.merchant || s.name)), ...bills.map((b) => normalizeMerchant(b.name))]);
  const candidates = detectRecurring(history)
    .filter((c) => !tracked.has(c.key))
    .slice(0, 8);

  // Subscription spending trend: actual charges from tracked subscription merchants, by month.
  const buckets = monthBuckets(subMonths(new Date(), 11), new Date(), p.timezone);
  const subKeys = new Set(summary.rows.map((s) => normalizeMerchant(s.merchant || s.name)).filter(Boolean));
  const trend = buckets.map((b) => {
    let total = new Decimal(0);
    for (const t of history) if (t.date >= b.start && t.date < b.end && t.baseAmount && subKeys.has(normalizeMerchant(t.merchant || t.description))) total = total.plus(dec(t.baseAmount).abs());
    return { label: b.label, value: total.toDecimalPlaces(2).toNumber() };
  });

  return (
    <SubscriptionsView
      monthly={money(summary.monthlyTotal)}
      annual={money(summary.annualTotal)}
      missingRates={summary.missingRates}
      trend={trend}
      rows={summary.rows.map((s) => ({
        id: s.id,
        name: s.name,
        merchant: s.merchant,
        amount: money(s.amount),
        currency: s.currency,
        frequency: s.frequency,
        interval: s.interval,
        nextDate: s.nextDate.toISOString(),
        startDate: s.startDate.toISOString(),
        endDate: s.endDate?.toISOString() ?? null,
        accountId: s.accountId,
        accountName: s.account?.name ?? null,
        categoryId: s.categoryId,
        categoryName: s.category?.name ?? null,
        categoryIcon: s.category?.icon ?? null,
        categoryColor: s.category?.color ?? null,
        reminderDays: s.reminderDays,
        cancellationNotes: s.cancellationNotes,
        status: s.status,
        monthlyBase: s.monthlyBase ? money(s.monthlyBase) : null,
        previousAmount: s.previousAmount ? money(s.previousAmount) : null,
        amountChangedAt: s.amountChangedAt?.toISOString() ?? null,
        detected: s.detected,
      }))}
      candidates={candidates.map((c) => ({
        key: c.key,
        merchant: c.merchant,
        frequency: c.frequency,
        lastAmount: money(c.lastAmount),
        averageAmount: money(c.averageAmount),
        lastDate: c.lastDate.toISOString(),
        nextDate: c.nextDate.toISOString(),
        occurrences: c.occurrences,
        confidence: c.confidence,
        priceChange: c.priceChange ? { from: money(c.priceChange.from), to: money(c.priceChange.to), percent: c.priceChange.percent } : null,
        categoryId: c.categoryId,
        accountId: c.accountId,
      }))}
    />
  );
}
