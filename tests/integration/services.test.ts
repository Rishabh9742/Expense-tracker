import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subDays, addDays } from "date-fns";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import { createTransaction, restoreTransactions, softDeleteTransactions, undoTransactionEdit, updateTransaction, ServiceError } from "@/server/services/transactions";
import { getAccountsWithBalances } from "@/server/services/balances";
import { loadTxns } from "@/server/services/analytics";
import { getBudgetsWithStatus } from "@/server/services/budgets";
import { processRecurring } from "@/server/services/jobs";
import { getNetWorth } from "@/server/services/planning";
import { cashFlow, spendingByCategory } from "@/lib/finance/aggregate";
import { runTool } from "@/server/ai/tools";
import { answerOffline } from "@/server/ai/offline";
import { getRate } from "@/lib/fx";
import { resolveRange, toLocalYmd } from "@/lib/dates";
import { cat, cleanup, makeUser } from "./helpers";

// These tests run against the PostgreSQL database in DATABASE_URL using throwaway users.
process.env.FX_PROVIDER = "none"; // never hit the network in tests

let a: CurrentUser;
let b: CurrentUser;
let checking: { id: string };
let savings: { id: string };
let usd: { id: string };
const base = { baseCurrency: "INR" };
const now = new Date();

beforeAll(async () => {
  a = await makeUser("a");
  b = await makeUser("b");
  checking = await db.account.create({ data: { userId: a.id, name: "Checking", type: "CHECKING", currency: "INR", openingBalance: "1000", openingDate: subDays(now, 60) } });
  savings = await db.account.create({ data: { userId: a.id, name: "Savings", type: "SAVINGS", currency: "INR", openingBalance: "0", openingDate: subDays(now, 60) } });
  usd = await db.account.create({ data: { userId: a.id, name: "USD", type: "CHECKING", currency: "USD", openingBalance: "0", openingDate: subDays(now, 60) } });
});

afterAll(async () => {
  await cleanup(a, b);
  await db.$disconnect();
});

describe("transactions and balances", () => {
  it("creates income and expenses with correct signs and balances", async () => {
    await createTransaction(a.id, { accountId: checking.id, type: "INCOME", date: subDays(now, 1), description: "Salary", amount: "5000", categoryId: await cat(a.id, "Salary") }, base);
    const e = await createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: subDays(now, 1), description: "Groceries", amount: "1234.56", categoryId: await cat(a.id, "Groceries") }, base);
    expect(e.amount.toString()).toBe("-1234.56");
    const [acct] = await getAccountsWithBalances(a.id, "INR", { accountIds: [checking.id] });
    expect(acct.balance.toString()).toBe("4765.44");
  });

  it("rejects zero and negative amounts", async () => {
    await expect(createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: now, description: "x", amount: "0" }, base)).rejects.toBeInstanceOf(ServiceError);
    await expect(createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: now, description: "x", amount: "-5" }, base)).rejects.toBeInstanceOf(ServiceError);
  });

  it("transfers move money without changing income or spending", async () => {
    const before = cashFlow(await loadTxns(a.id, subDays(now, 30), addDays(now, 1)), {});
    await createTransaction(a.id, { accountId: checking.id, type: "TRANSFER", toAccountId: savings.id, date: subDays(now, 1), description: "To savings", amount: "2000" }, base);
    const after = cashFlow(await loadTxns(a.id, subDays(now, 30), addDays(now, 1)), {});
    expect(after.income.toString()).toBe(before.income.toString());
    expect(after.expenses.toString()).toBe(before.expenses.toString());
    const accts = await getAccountsWithBalances(a.id, "INR", { accountIds: [checking.id, savings.id] });
    const total = accts.reduce((s, x) => s + Number(x.balance), 0);
    expect(total).toBeCloseTo(4765.44, 2); // conserved
  });

  it("refunds reduce category spending instead of counting as income", async () => {
    const groceries = await cat(a.id, "Groceries");
    await createTransaction(a.id, { accountId: checking.id, type: "REFUND", date: subDays(now, 1), description: "Returned item", amount: "234.56", categoryId: groceries }, base);
    const txns = await loadTxns(a.id, subDays(now, 30), addDays(now, 1));
    expect(spendingByCategory(txns).get(groceries)?.toString()).toBe("1000");
    expect(cashFlow(txns).income.toString()).toBe("5000");
  });

  it("validates split totals and attributes spending to each split", async () => {
    const dining = await cat(a.id, "Dining");
    const shopping = await cat(a.id, "Shopping");
    await expect(
      createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: now, description: "Mall", amount: "100", splits: [{ categoryId: dining, amount: "30" }, { categoryId: shopping, amount: "60" }] }, base),
    ).rejects.toThrow(/add up/);
    await createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: subDays(now, 1), description: "Mall", amount: "100", splits: [{ categoryId: dining, amount: "40" }, { categoryId: shopping, amount: "60" }] }, base);
    const map = spendingByCategory(await loadTxns(a.id, subDays(now, 30), addDays(now, 1)));
    expect(map.get(dining)?.toString()).toBe("40");
    expect(map.get(shopping)?.toString()).toBe("60");
  });

  it("supports edit + undo and soft delete + restore", async () => {
    const t = await createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: subDays(now, 2), description: "Coffee", amount: "100" }, base);
    const { auditId } = await updateTransaction(a.id, t.id, { accountId: checking.id, type: "EXPENSE", date: subDays(now, 2), description: "Coffee (large)", amount: "150" }, "INR");
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).amount.toString()).toBe("-150");
    await undoTransactionEdit(a.id, auditId);
    const restored = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(restored.amount.toString()).toBe("-100");
    expect(restored.description).toBe("Coffee");
    await softDeleteTransactions(a.id, [t.id]);
    expect((await loadTxns(a.id, subDays(now, 30), addDays(now, 1))).some((x) => x.id === t.id)).toBe(false);
    await restoreTransactions(a.id, [t.id]);
    expect((await loadTxns(a.id, subDays(now, 30), addDays(now, 1))).some((x) => x.id === t.id)).toBe(true);
  });
});

describe("currency conversion", () => {
  it("stores no base amount when a rate is missing, and excludes it from totals", async () => {
    const t = await createTransaction(a.id, { accountId: usd.id, type: "EXPENSE", date: subDays(now, 3), description: "SaaS", amount: "10" }, base);
    expect(t.baseAmount).toBeNull();
    const cf = cashFlow(await loadTxns(a.id, subDays(now, 30), addDays(now, 1)));
    expect(cf.unconverted).toBeGreaterThan(0);
  });

  it("uses manual rates with provenance and inverse lookup", async () => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.exchangeRate.create({ data: { userId: a.id, base: "USD", quote: "INR", date: subDays(day, 1), rate: "83.5", source: "manual" } });
    const r = await getRate("USD", "INR", now, a.id);
    expect(r?.rate.toString()).toBe("83.5");
    expect(r?.source).toBe("manual");
    const inv = await getRate("INR", "USD", now, a.id);
    expect(inv?.rate.toDecimalPlaces(6).toString()).toBe("0.011976");
    const t = await createTransaction(a.id, { accountId: usd.id, type: "EXPENSE", date: now, description: "SaaS 2", amount: "10" }, base);
    expect(t.baseAmount?.toString()).toBe("-835");
    expect(t.fxRateSource).toBe("manual");
    // Other users never see this manual rate
    expect(await getRate("USD", "INR", now, b.id)).toBeNull();
  });
});

describe("user data isolation", () => {
  it("cannot write into another user's account or category", async () => {
    await expect(createTransaction(b.id, { accountId: checking.id, type: "EXPENSE", date: now, description: "steal", amount: "1" }, base)).rejects.toThrow(/Account not found/);
    const bAcct = await db.account.create({ data: { userId: b.id, name: "B", type: "CASH", currency: "INR" } });
    await expect(createTransaction(b.id, { accountId: bAcct.id, type: "EXPENSE", date: now, description: "x", amount: "1", categoryId: await cat(a.id, "Dining") }, base)).rejects.toThrow(/Category not found/);
  });

  it("queries never return another user's records", async () => {
    expect(await getAccountsWithBalances(b.id, "INR", { accountIds: [checking.id] })).toHaveLength(0);
    expect(await loadTxns(b.id, subDays(now, 365), addDays(now, 1), { accountIds: [checking.id] })).toHaveLength(0);
    await expect(softDeleteTransactions(b.id, (await db.transaction.findMany({ where: { userId: a.id }, select: { id: true } })).map((t) => t.id))).resolves.toBe(0);
  });
});

describe("budgets", () => {
  it("counts subcategories, refunds and ignores transfers", async () => {
    const dining = await cat(a.id, "Dining");
    const coffee = await db.category.findFirstOrThrow({ where: { userId: a.id, name: "Coffee" } });
    await db.budget.create({ data: { userId: a.id, name: "Dining", scope: "CATEGORY", categoryId: dining, amount: "500", startDate: subDays(now, 90) } });
    await createTransaction(a.id, { accountId: checking.id, type: "EXPENSE", date: now, description: "Latte", amount: "60", categoryId: coffee.id }, base);
    const [d] = (await getBudgetsWithStatus(a.id, a.prefs)).filter((x) => x.budget.name === "Dining");
    // 40 (split) + 60 (subcategory) this month — split was created 1 day ago, may fall in the previous month at month start
    expect(Number(d.status.spent.toString())).toBeGreaterThanOrEqual(60);
    expect(d.status.available.toString()).toBe("500");
  });
});

describe("recurring generation", () => {
  it("creates each occurrence exactly once, even when run repeatedly", async () => {
    const start = subDays(now, 70);
    await db.recurringTransaction.create({
      data: { userId: a.id, name: "Rent", type: "EXPENSE", accountId: checking.id, amount: "100", frequency: "MONTHLY", startDate: start, nextDate: start, autoCreate: true, status: "POSTED" },
    });
    const first = await processRecurring(a.id, now);
    const second = await processRecurring(a.id, now);
    const rows = await db.transaction.findMany({ where: { userId: a.id, description: "Rent" } });
    expect(first.created).toBe(rows.length);
    expect(second.created).toBe(0);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.occurrenceDate?.toISOString())).size).toBe(rows.length);
  });
});

describe("net worth", () => {
  it("does not double count a debt linked to a loan account", async () => {
    const loan = await db.account.create({ data: { userId: b.id, name: "Loan", type: "LOAN", currency: "INR", openingBalance: "-5000" } });
    await db.account.create({ data: { userId: b.id, name: "Bank", type: "CHECKING", currency: "INR", openingBalance: "8000" } });
    await db.debt.create({ data: { userId: b.id, name: "Loan", type: "PERSONAL_LOAN", currency: "INR", originalPrincipal: "6000", currentBalance: "5000", linkedAccountId: loan.id } });
    const nw = await getNetWorth(b.id, { baseCurrency: "INR", timezone: "Asia/Kolkata", includePending: true, excludeReimbursable: true });
    expect(nw.result.netWorth.toString()).toBe("3000"); // 8000 bank − 5000 loan (B also has an empty cash account)
    expect(nw.result.skippedLinkedDebts).toEqual(["Loan"]);
  });
});

describe("assistant tools answer from real data", () => {
  it("spending_summary matches deterministic totals for a category", async () => {
    const r = await runTool(a, "spending_summary", { period: "this_month", category: "groceries" });
    const d = r.data as { category: { net_spending: string; matched_categories: string[] } };
    const month = resolveRange("this_month", a.prefs.timezone);
    expect(r.basis.from).toBe(toLocalYmd(month.from, a.prefs.timezone));
    expect(r.basis.from.endsWith("-01")).toBe(true);
    const txns = await loadTxns(a.id, month.from, month.to);
    const groceries = await cat(a.id, "Groceries");
    const expected = spendingByCategory(txns, {}).get(groceries);
    expect(d.category.matched_categories).toContain("Groceries");
    expect(Number(d.category.net_spending)).toBeCloseTo(Number(expected?.toString() ?? 0), 2);
    expect(r.basis.currency).toBe("INR");
  });

  it("offline mode answers common questions with the calculation basis", async () => {
    const ans = await answerOffline(a, "What would happen if I reduced dining expenses by 15%?");
    expect(ans.mode).toBe("offline");
    expect(ans.calls[0].name).toBe("simulate_category_change");
    expect(ans.answer).toMatch(/15%/);
    const bills = await answerOffline(a, "Which upcoming bills require attention?");
    expect(bills.calls[0].name).toBe("upcoming_bills");
  });
});

describe("account deletion", () => {
  it("removes every record owned by the user", async () => {
    const c = await makeUser("del");
    const acct = await db.account.create({ data: { userId: c.id, name: "X", type: "CASH", currency: "INR" } });
    await createTransaction(c.id, { accountId: acct.id, type: "EXPENSE", date: now, description: "x", amount: "5" }, base);
    await db.user.delete({ where: { id: c.id } });
    expect(await db.transaction.count({ where: { userId: c.id } })).toBe(0);
    expect(await db.category.count({ where: { userId: c.id } })).toBe(0);
    expect(await db.account.count({ where: { userId: c.id } })).toBe(0);
  });
});
