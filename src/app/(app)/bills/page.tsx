import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { money, Decimal, dec } from "@/lib/money";
import { resolveRange } from "@/lib/dates";
import { occurrencesBetween } from "@/lib/finance/recurrence";
import { getBills } from "@/server/services/planning";
import { BillsView } from "@/components/schedules/bills-view";

export const metadata: Metadata = { title: "Bills & Recurring" };

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ new?: string; tab?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const p = user.prefs;
  const prefs = { baseCurrency: p.baseCurrency, timezone: p.timezone, includePending: p.includePending, excludeReimbursable: p.excludeReimbursable };
  const month = resolveRange("this_month", p.timezone);
  const [bills, recurring] = await Promise.all([
    getBills(user.id, prefs, 45),
    db.recurringTransaction.findMany({
      where: { userId: user.id },
      include: { account: { select: { name: true, currency: true } }, category: { select: { name: true, icon: true, color: true } }, transactions: { where: { deletedAt: null, date: { gte: month.from, lt: month.to } }, select: { amount: true } } },
      orderBy: [{ active: "desc" }, { type: "asc" }, { nextDate: "asc" }],
    }),
  ]);

  return (
    <BillsView
      autoNew={sp.new === "1"}
      initialTab={sp.tab === "recurring" ? "recurring" : "bills"}
      monthlyObligation={money(bills.monthlyObligation)}
      monthLabel={month.label}
      bills={bills.rows.map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        amount: money(b.amount),
        currency: b.currency,
        isVariable: b.isVariable,
        frequency: b.frequency,
        interval: b.interval,
        nextDueDate: b.nextDueDate.toISOString(),
        accountId: b.accountId,
        accountName: b.account?.name ?? null,
        categoryId: b.categoryId,
        reminderDays: b.reminderDays,
        autopay: b.autopay,
        notes: b.notes,
        daysUntil: b.daysUntil,
        state: b.state,
        payments: b.payments.map((x) => ({ dueDate: x.dueDate.toISOString(), paidAt: x.paidAt.toISOString(), amount: money(x.amount), late: x.late })),
      }))}
      calendar={bills.calendar.map((c) => ({ ...c, date: c.date.toISOString(), amount: money(c.amount) }))}
      recurring={recurring.map((r) => {
        const expectedCount = r.active ? occurrencesBetween(r.startDate, r.frequency, r.interval, month.from, month.to, r.endDate, p.timezone, 40).length : 0;
        const actual = r.transactions.reduce((a, t) => a.plus(dec(t.amount).abs()), new Decimal(0));
        return {
          id: r.id,
          name: r.name,
          type: r.type,
          accountId: r.accountId,
          accountName: r.account.name,
          currency: r.account.currency,
          categoryId: r.categoryId,
          categoryName: r.category?.name ?? null,
          categoryIcon: r.category?.icon ?? null,
          categoryColor: r.category?.color ?? null,
          merchant: r.merchant,
          amount: money(r.amount),
          isVariable: r.isVariable,
          frequency: r.frequency,
          interval: r.interval,
          startDate: r.startDate.toISOString(),
          nextDate: r.nextDate.toISOString(),
          endDate: r.endDate?.toISOString() ?? null,
          autoCreate: r.autoCreate,
          postAsCleared: r.status === "POSTED",
          active: r.active,
          expectedThisMonth: money(dec(r.amount).times(expectedCount)),
          actualThisMonth: money(actual),
        };
      })}
    />
  );
}
