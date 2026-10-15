import { describe, expect, it } from "vitest";
import { accountBalance, cashFlow, findUnusual, percentChange, spendingByCategory, type TxnLike } from "@/lib/finance/aggregate";
import { Decimal } from "@/lib/money";

const t = (type: TxnLike["type"], amount: string, extra: Partial<TxnLike> = {}): TxnLike => ({
  type,
  amount,
  baseAmount: amount,
  status: "CLEARED",
  ...extra,
});

describe("cashFlow", () => {
  it("computes income, expenses, net and savings rate", () => {
    const cf = cashFlow([t("INCOME", "1000"), t("EXPENSE", "-250.50"), t("EXPENSE", "-149.50")]);
    expect(cf.income.toString()).toBe("1000");
    expect(cf.expenses.toString()).toBe("400");
    expect(cf.net.toString()).toBe("600");
    expect(cf.savingsRate).toBe(60);
  });

  it("excludes transfers and adjustments from income and expenses", () => {
    const cf = cashFlow([t("INCOME", "1000"), t("TRANSFER", "-500"), t("ADJUSTMENT", "200"), t("ADJUSTMENT", "-50")]);
    expect(cf.income.toString()).toBe("1000");
    expect(cf.expenses.toString()).toBe("0");
  });

  it("treats refunds as negative spending, not income", () => {
    const cf = cashFlow([t("INCOME", "1000"), t("EXPENSE", "-300"), t("REFUND", "100")]);
    expect(cf.income.toString()).toBe("1000");
    expect(cf.grossExpenses.toString()).toBe("300");
    expect(cf.refunds.toString()).toBe("100");
    expect(cf.expenses.toString()).toBe("200");
  });

  it("honours pending and reimbursable preferences", () => {
    const txns = [t("EXPENSE", "-100", { status: "PENDING" }), t("EXPENSE", "-40", { isReimbursable: true }), t("EXPENSE", "-10")];
    expect(cashFlow(txns).expenses.toString()).toBe("150");
    expect(cashFlow(txns, { includePending: false }).expenses.toString()).toBe("50");
    expect(cashFlow(txns, { excludeReimbursable: true }).expenses.toString()).toBe("110");
  });

  it("never adds unconverted foreign amounts", () => {
    const cf = cashFlow([t("EXPENSE", "-100"), { type: "EXPENSE", amount: "-50", baseAmount: null }]);
    expect(cf.expenses.toString()).toBe("100");
    expect(cf.unconverted).toBe(1);
  });

  it("returns null savings rate with no income", () => {
    expect(cashFlow([t("EXPENSE", "-5")]).savingsRate).toBeNull();
  });

  it("handles negative savings rate when overspending", () => {
    expect(cashFlow([t("INCOME", "100"), t("EXPENSE", "-150")]).savingsRate).toBe(-50);
  });
});

describe("spendingByCategory", () => {
  it("distributes split transactions across categories using the base conversion", () => {
    // 100 USD charge converted to 8300 INR, split 60/40
    const m = spendingByCategory([
      {
        type: "EXPENSE",
        amount: "-100",
        baseAmount: "-8300",
        categoryId: "x",
        splits: [
          { categoryId: "food", amount: "60" },
          { categoryId: "home", amount: "40" },
        ],
      },
    ]);
    expect(m.get("food")?.toString()).toBe("4980");
    expect(m.get("home")?.toString()).toBe("3320");
    expect(m.has("x")).toBe(false);
  });

  it("nets refunds against their category", () => {
    const m = spendingByCategory([t("EXPENSE", "-80", { categoryId: "shop" }), t("REFUND", "30", { categoryId: "shop" })]);
    expect(m.get("shop")?.toString()).toBe("50");
  });
});

describe("accountBalance", () => {
  it("adds opening, own amounts and incoming transfers", () => {
    const bal = accountBalance("1000", [{ amount: "-200" }, { amount: "50.25" }], [{ toAmount: "300" }]);
    expect(bal.toString()).toBe("1150.25");
  });

  it("can exclude pending", () => {
    const bal = accountBalance("0", [{ amount: "-20", status: "PENDING" }, { amount: "-5", status: "CLEARED" }], [], false);
    expect(bal.toString()).toBe("-5");
  });

  it("transfers conserve total money across accounts", () => {
    // 500 from A to B
    const a = accountBalance("1000", [{ amount: "-500" }], []);
    const b = accountBalance("0", [], [{ toAmount: "500" }]);
    expect(a.plus(b).toString()).toBe("1000");
  });
});

describe("percentChange / findUnusual", () => {
  it("percentChange handles zero baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it("flags outliers only with enough history", () => {
    const hist = [10, 12, 11, 9, 13, 10].map((n) => ({ categoryId: "c", base: new Decimal(n) }));
    const flagged = findUnusual(
      [
        { id: "big", categoryId: "c", base: new Decimal(-200) },
        { id: "normal", categoryId: "c", base: new Decimal(-12) },
        { id: "nohist", categoryId: "z", base: new Decimal(-999) },
      ],
      hist,
    );
    expect(flagged.map((f) => f.id)).toEqual(["big"]);
  });
});
