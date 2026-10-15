import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { resolveRange } from "@/lib/dates";
import { money } from "@/lib/money";
import { aggOpts, loadTxns } from "@/server/services/analytics";
import { spendingByCategory, incomeByCategory } from "@/lib/finance/aggregate";
import { CategoriesView } from "@/components/categories/categories-view";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const month = resolveRange("this_month", user.prefs.timezone);
  const [cats, rules, maps, counts, txns] = await Promise.all([
    db.category.findMany({ where: { userId: user.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.transactionRule.findMany({ where: { userId: user.id }, include: { category: { select: { name: true } } }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
    db.merchantMapping.findMany({ where: { userId: user.id }, include: { category: { select: { name: true } } }, orderBy: { merchant: "asc" } }),
    db.transaction.groupBy({ by: ["categoryId"], where: { userId: user.id, deletedAt: null }, _count: { _all: true } }),
    loadTxns(user.id, month.from, month.to),
  ]);
  const spent = spendingByCategory(txns, aggOpts(user.prefs));
  const earned = incomeByCategory(txns, aggOpts(user.prefs));
  const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return (
    <CategoriesView
      monthLabel={month.label}
      categories={cats.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        icon: c.icon,
        color: c.color,
        parentId: c.parentId,
        monthlyTarget: c.monthlyTarget ? money(c.monthlyTarget) : null,
        isEssential: c.isEssential,
        archived: c.archived,
        txnCount: countMap.get(c.id) ?? 0,
        thisMonth: money(c.kind === "INCOME" ? earned.get(c.id) ?? 0 : spent.get(c.id) ?? 0),
      }))}
      rules={rules.map((r) => ({
        id: r.id,
        name: r.name,
        field: r.field,
        operator: r.operator,
        value: r.value,
        amountMin: r.amountMin?.toString() ?? null,
        amountMax: r.amountMax?.toString() ?? null,
        categoryId: r.categoryId,
        categoryName: r.category.name,
        setMerchant: r.setMerchant,
        priority: r.priority,
        active: r.active,
      }))}
      mappings={maps.map((m) => ({ id: m.id, merchant: m.merchant, categoryName: m.category.name }))}
      aiEnabled={user.prefs.aiEnabled}
    />
  );
}
