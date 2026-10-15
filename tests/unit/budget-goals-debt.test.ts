import { describe, expect, it } from "vitest";
import { baseAllocation, budgetPeriodAt, budgetStatus, computeRollover } from "@/lib/finance/budget";
import { monthsToPayoff, simulatePayoff } from "@/lib/finance/debt";
import { projectGoal } from "@/lib/finance/goals";
import { computeNetWorth } from "@/lib/finance/networth";
import { forecastCashFlow } from "@/lib/finance/forecast";

describe("budgets", () => {
  const period = { start: new Date("2026-03-01T00:00:00Z"), end: new Date("2026-04-01T00:00:00Z") };

  it("computes remaining, percentage, daily allowance and forecast", () => {
    const s = budgetStatus({ budgeted: "3100", spent: "1000", period, now: new Date("2026-03-10T12:00:00Z") });
    expect(s.remaining.toString()).toBe("2100");
    expect(s.percentUsed).toBe(32.3);
    expect(s.daysTotal).toBe(31);
    expect(s.daysElapsed).toBe(10);
    expect(s.daysLeft).toBe(22);
    expect(s.dailyAllowance.toString()).toBe("95.45");
    expect(s.forecast.toString()).toBe("3100");
    expect(s.thresholdReached).toBeNull();
  });

  it("reports thresholds and overspending", () => {
    const s = budgetStatus({ budgeted: "100", spent: "120", period, now: new Date("2026-03-20T00:00:00Z") });
    expect(s.level).toBe("over");
    expect(s.thresholdReached).toBe(100);
    expect(s.dailyAllowance.toString()).toBe("0");
    expect(s.remaining.toString()).toBe("-20");
  });

  it("includes rollover in available funds", () => {
    const s = budgetStatus({ budgeted: "100", rollover: "50", spent: "75", period, now: new Date("2026-03-15T00:00:00Z") });
    expect(s.available.toString()).toBe("150");
    expect(s.percentUsed).toBe(50);
    expect(s.thresholdReached).toBe(50);
  });

  it("rolls unused funds; envelope carries overspend, rollover floors at zero", () => {
    const hist = [
      { allocated: "100", spent: "60" },
      { allocated: "100", spent: "170" },
      { allocated: "100", spent: "80" },
    ];
    expect(computeRollover("ROLLOVER", hist).toString()).toBe("20");
    expect(computeRollover("ENVELOPE", hist).toString()).toBe("-10");
    expect(computeRollover("FIXED", hist).toString()).toBe("0");
  });

  it("percentage budgets scale with income", () => {
    const def = { period: "MONTHLY" as const, method: "PERCENTAGE" as const, amount: "0", percentOfIncome: "30", startDate: new Date() };
    expect(baseAllocation(def, "85000").toString()).toBe("25500");
  });

  it("resolves monthly periods in the user's timezone", () => {
    // 2026-03-31 20:00 UTC is already April 1st in Kolkata
    const p = budgetPeriodAt({ period: "MONTHLY", startDate: new Date("2026-01-01") }, new Date("2026-03-31T20:00:00Z"), "Asia/Kolkata");
    expect(p.start.toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });
});

describe("goals", () => {
  const now = new Date("2026-01-15T00:00:00Z");
  it("projects completion and required contribution", () => {
    const g = projectGoal({ saved: "20000", target: "100000", monthlyContribution: "10000", targetDate: new Date("2026-09-15"), now });
    expect(g.percent).toBe(20);
    expect(g.remaining.toString()).toBe("80000");
    expect(g.monthsToGoal).toBe(8);
    expect(g.requiredMonthly?.toString()).toBe("10000");
    expect(g.onTrack).toBe(true);
  });

  it("caps progress at 100% and handles no contribution", () => {
    expect(projectGoal({ saved: "120", target: "100", now }).percent).toBe(100);
    expect(projectGoal({ saved: "0", target: "100", now }).projectedDate).toBeNull();
  });
});

describe("debt payoff", () => {
  const debts = [
    { id: "a", name: "Card", balance: "5000", apr: "36", minimumPayment: "200" },
    { id: "b", name: "Loan", balance: "2000", apr: "10", minimumPayment: "100" },
  ];

  it("avalanche never pays more interest than snowball", () => {
    const av = simulatePayoff(debts, "avalanche", "300");
    const sn = simulatePayoff(debts, "snowball", "300");
    expect(av.months).not.toBeNull();
    expect(av.totalInterest.lte(sn.totalInterest)).toBe(true);
    expect(sn.perDebt.find((d) => d.id === "b")!.payoffMonth!).toBeLessThan(sn.perDebt.find((d) => d.id === "a")!.payoffMonth!);
    expect(av.isEstimate).toBe(true);
  });

  it("warns about unknown interest rates", () => {
    const r = simulatePayoff([{ id: "x", name: "Friend", balance: "1000", apr: null, minimumPayment: "100" }], "avalanche");
    expect(r.months).toBe(10);
    expect(r.warnings.join(" ")).toMatch(/unknown/);
  });

  it("detects payments that never cover interest", () => {
    const r = simulatePayoff([{ id: "x", name: "Bad", balance: "10000", apr: "48", minimumPayment: "100" }], "avalanche");
    expect(r.months).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/interest/);
  });

  it("monthsToPayoff matches the amortization formula", () => {
    expect(monthsToPayoff("10000", "12", "500")).toBe(23);
    expect(monthsToPayoff("1000", "0", "100")).toBe(10);
    expect(monthsToPayoff("1000", "24", "10")).toBeNull();
  });
});

describe("net worth", () => {
  it("subtracts liabilities and avoids double counting linked debts", () => {
    const r = computeNetWorth({
      accounts: [
        { id: "chk", name: "Checking", type: "CHECKING", baseBalance: "5000", includeInNetWorth: true },
        { id: "cc", name: "Card", type: "CREDIT_CARD", baseBalance: "-1200", includeInNetWorth: true },
        { id: "loan", name: "Car loan acct", type: "LOAN", baseBalance: "-8000", includeInNetWorth: true },
      ],
      assets: [{ id: "car", name: "Car", type: "VEHICLE", baseValue: "12000" }],
      debts: [
        { id: "d1", name: "Car loan", baseBalance: "8000", linkedAccountId: "loan" },
        { id: "d2", name: "Family loan", baseBalance: "1000", linkedAccountId: null },
      ],
    });
    expect(r.totalAssets.toString()).toBe("17000");
    expect(r.totalLiabilities.toString()).toBe("10200");
    expect(r.netWorth.toString()).toBe("6800");
    expect(r.skippedLinkedDebts).toEqual(["Car loan"]);
  });

  it("reports missing exchange rates instead of adding unconverted values", () => {
    const r = computeNetWorth({
      accounts: [{ id: "usd", name: "USD acct", type: "SAVINGS", baseBalance: null, includeInNetWorth: true }],
      assets: [],
      debts: [],
    });
    expect(r.netWorth.toString()).toBe("0");
    expect(r.missingRates).toEqual(["USD acct"]);
  });
});

describe("forecast", () => {
  it("projects balances and detects shortfalls", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const r = forecastCashFlow({
      startBalance: "1000",
      start,
      days: 30,
      dailyDiscretionary: "20",
      events: [
        { date: new Date("2026-05-05T00:00:00Z"), amount: "-900", label: "Rent", kind: "bill" },
        { date: new Date("2026-05-20T00:00:00Z"), amount: "2000", label: "Salary", kind: "income" },
      ],
    });
    expect(r.points).toHaveLength(30);
    expect(r.endBalance.toString()).toBe(String(1000 - 900 + 2000 - 600));
    expect(r.shortfalls.length).toBe(1);
    expect(r.lowest.balance.isNegative()).toBe(true);
  });
});
