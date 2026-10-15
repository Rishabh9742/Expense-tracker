import type { Budget, Category } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal, dec } from "@/lib/money";
import { baseAllocation, budgetPeriodAt, budgetStatus, computeRollover, previousPeriod, usesRollover, type BudgetStatus, type Period } from "@/lib/finance/budget";
import { cashFlow, spendingByCategory, type AggregateOptions } from "@/lib/finance/aggregate";
import { loadTxns, type LoadedTxn } from "./analytics";
import { normalizeMerchant } from "@/lib/finance/duplicates";

export interface BudgetWithStatus {
  budget: Budget & { category: Category | null; account: { id: string; name: string } | null };
  period: Period;
  status: BudgetStatus;
}

function descendantsOf(cats: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
      out.add(c.id);
      grew = true;
    }
  }
  return out;
}

/** Net spending attributable to a budget within its scope. */
export function spentForBudget(budget: Pick<Budget, "scope" | "categoryId" | "accountId" | "merchant">, txns: LoadedTxn[], opts: AggregateOptions, catIds?: Set<string>): Decimal {
  let scoped = txns;
  if (budget.scope === "ACCOUNT" && budget.accountId) scoped = txns.filter((t) => t.accountId === budget.accountId);
  if (budget.scope === "MERCHANT" && budget.merchant) {
    const key = normalizeMerchant(budget.merchant);
    scoped = txns.filter((t) => normalizeMerchant(t.merchant || t.description) === key);
  }
  if (budget.scope === "CATEGORY" && catIds) {
    const byCat = spendingByCategory(scoped, opts);
    let total = new Decimal(0);
    for (const [k, v] of byCat) if (k && catIds.has(k)) total = total.plus(v);
    return total;
  }
  return cashFlow(scoped, opts).expenses;
}

export async function getBudgetsWithStatus(
  userId: string,
  prefs: { timezone: string; weekStartsOn: number; includePending: boolean; excludeReimbursable: boolean },
  at: Date = new Date(),
  rolloverPeriods = 6,
): Promise<BudgetWithStatus[]> {
  const budgets = await db.budget.findMany({
    where: { userId, active: true },
    include: { category: true, account: { select: { id: true, name: true } }, allocations: true },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });
  if (!budgets.length) return [];
  const cats = await db.category.findMany({ where: { userId }, select: { id: true, parentId: true } });
  const opts: AggregateOptions = { includePending: prefs.includePending, excludeReimbursable: prefs.excludeReimbursable };
  const wso = (prefs.weekStartsOn === 0 ? 0 : 1) as 0 | 1;

  // Collect every period we need (current + rollover history) and load txns once.
  const plans = budgets.map((b) => {
    const current = budgetPeriodAt(b, at, prefs.timezone, wso);
    const history: Period[] = [];
    if (usesRollover(b.method)) {
      let p: Period | null = current;
      for (let i = 0; i < rolloverPeriods; i++) {
        p = p ? previousPeriod(b, p, prefs.timezone, wso) : null;
        if (!p) break;
        history.unshift(p);
      }
    }
    return { b, current, history };
  });
  const minFrom = new Date(Math.min(...plans.map((p) => (p.history[0] ?? p.current).start.getTime())));
  const maxTo = new Date(Math.max(...plans.map((p) => p.current.end.getTime())));
  const txns = await loadTxns(userId, minFrom, maxTo);
  const inPeriod = (p: Period) => txns.filter((t) => t.date >= p.start && t.date < p.end);
  const incomeFor = (p: Period) => cashFlow(inPeriod(p), opts).income;

  return plans.map(({ b, current, history }) => {
    const catIds = b.categoryId ? descendantsOf(cats, b.categoryId) : undefined;
    const overrideFor = (p: Period) => b.allocations.find((a) => a.periodStart.getTime() === p.start.getTime())?.allocated ?? null;
    const hist = history.map((p) => ({
      allocated: baseAllocation(b, incomeFor(p), overrideFor(p)),
      spent: spentForBudget(b, inPeriod(p), opts, catIds),
    }));
    const rollover = computeRollover(b.method, hist);
    const budgeted = baseAllocation(b, incomeFor(current), overrideFor(current));
    const spent = spentForBudget(b, inPeriod(current), opts, catIds);
    const { allocations: _a, ...rest } = b;
    return { budget: rest, period: current, status: budgetStatus({ budgeted, rollover, spent, period: current, now: at, alertLevels: b.alertLevels }) };
  });
}

/** Zero-based view: income for the month minus everything allocated. */
export function unassigned(income: Decimal, budgets: BudgetWithStatus[]): Decimal {
  const allocated = budgets
    .filter((b) => b.budget.period === "MONTHLY" && b.budget.scope !== "OVERALL")
    .reduce((a, b) => a.plus(b.status.budgeted), new Decimal(0));
  return dec(income).minus(allocated);
}
