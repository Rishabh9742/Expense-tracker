import { describe, expect, it } from "vitest";
import { detectDateFormat, guessMapping, parseDateString, validateRows, type ImportOptions } from "@/lib/finance/import";
import { findPossibleDuplicates, importHash, normalizeMerchant } from "@/lib/finance/duplicates";
import { categorize, type RuleLike } from "@/lib/finance/categorize";
import { detectRecurring } from "@/lib/finance/detect-recurring";

const opts: ImportOptions = { dateFormat: "auto", decimalSeparator: ".", invertSign: false, timezone: "UTC", hasHeader: true };

describe("import validation", () => {
  it("parses valid rows with a signed amount column", () => {
    const data = [
      ["Date", "Description", "Amount"],
      ["2026-01-05", "Salary", "85,000.00"],
      ["2026-01-06", "Groceries", "-2450.50"],
    ];
    const r = validateRows(data, { date: 0, description: 1, amount: 2 }, opts);
    expect(r.invalidCount).toBe(0);
    expect(r.rows.map((x) => x.amount.toString())).toEqual(["85000", "-2450.5"]);
  });

  it("supports debit/credit columns", () => {
    const data = [
      ["Date", "Narration", "Debit", "Credit"],
      ["05/01/2026", "ATM", "500.00", ""],
      ["06/01/2026", "Refund", "", "120"],
    ];
    const r = validateRows(data, { date: 0, description: 1, debit: 2, credit: 3 }, { ...opts, dateFormat: "DD/MM/YYYY" });
    expect(r.rows.map((x) => x.amount.toString())).toEqual(["-500", "120"]);
    expect(r.rows[0].date.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("reports every invalid row with a reason", () => {
    const data = [
      ["Date", "Description", "Amount"],
      ["2026-13-45", "Bad date", "10"],
      ["2026-01-02", "", "10"],
      ["2026-01-03", "Bad amount", "ten"],
      ["2026-01-04", "Zero", "0"],
      ["2026-01-05", "Good", "-5"],
    ];
    const r = validateRows(data, { date: 0, description: 1, amount: 2 }, opts);
    expect(r.invalidCount).toBe(4);
    expect(r.errors.map((e) => e.field).sort()).toEqual(["amount", "amount", "date", "description"]);
    expect(r.rows).toHaveLength(1);
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateString("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDateString("29/02/2028", "DD/MM/YYYY")).toBe("2028-02-29");
    expect(parseDateString("03 Mar 2026", "auto")).toBe("2026-03-03");
  });

  it("detects date formats from samples", () => {
    expect(detectDateFormat(["12/25/2026", "01/02/2026"])).toBe("MM/DD/YYYY");
    expect(detectDateFormat(["25/12/2026", "01/02/2026"])).toBe("DD/MM/YYYY");
  });

  it("guesses mappings from common bank headers", () => {
    const m = guessMapping(["Txn Date", "Narration", "Withdrawal Amt", "Deposit Amt", "Closing Balance"]);
    expect(m).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
  });

  it("inverts signs for card exports", () => {
    const r = validateRows([["d", "x", "a"], ["2026-01-01", "Shop", "25"]], { date: 0, description: 1, amount: 2 }, { ...opts, invertSign: true });
    expect(r.rows[0].amount.toString()).toBe("-25");
  });
});

describe("duplicates", () => {
  it("produces stable import hashes", () => {
    const a = importHash({ accountId: "a", date: new Date("2026-01-01T10:00:00Z"), amount: "-10.5", description: "Coffee  Shop" });
    const b = importHash({ accountId: "a", date: new Date("2026-01-01T18:00:00Z"), amount: "-10.50", description: "coffee shop" });
    expect(a).toBe(b);
  });

  it("normalizes merchant noise", () => {
    expect(normalizeMerchant("UPI-SWIGGY*ORDER 123456 BANGALORE")).toBe("swiggy");
    expect(normalizeMerchant("POS 4411 AMAZON PAY INDIA")).toBe("amazon pay india");
  });

  it("finds near-duplicates within a window on the same account", () => {
    const base = { accountId: "a", amount: "-99" };
    const pairs = findPossibleDuplicates([
      { id: "1", ...base, date: new Date("2026-01-01"), description: "Netflix.com" },
      { id: "2", ...base, date: new Date("2026-01-02"), description: "NETFLIX.COM 1234" },
      { id: "3", ...base, date: new Date("2026-01-10"), description: "Netflix.com" },
      { id: "4", accountId: "b", amount: "-99", date: new Date("2026-01-01"), description: "Netflix.com" },
    ]);
    expect(pairs).toEqual([["1", "2"]]);
  });
});

describe("categorization engine", () => {
  const rules: RuleLike[] = [
    { id: "r1", field: "DESCRIPTION", operator: "CONTAINS", value: "uber", categoryId: "transport", priority: 10, active: true },
    { id: "r2", field: "DESCRIPTION", operator: "CONTAINS", value: "uber eats", categoryId: "dining", priority: 5, active: true },
    { id: "r3", field: "DESCRIPTION", operator: "REGEX", value: "(a+)+$", categoryId: "x", priority: 1, active: true },
  ];

  it("applies rules by priority", () => {
    expect(categorize({ description: "UBER EATS order", amount: 10 }, rules, new Map(), new Map()).categoryId).toBe("dining");
    expect(categorize({ description: "Uber trip", amount: 10 }, rules, new Map(), new Map())).toMatchObject({ categoryId: "transport", source: "RULE" });
  });

  it("ignores catastrophic regex rules", () => {
    expect(categorize({ description: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", amount: 1 }, rules, new Map(), new Map()).categoryId).toBeNull();
  });

  it("falls back to merchant mappings then history with confidence", () => {
    const mm = new Map([["blue tokai", "coffee"]]);
    const hist = new Map([["freshmart", new Map([["groceries", 3], ["household", 1]])]]);
    expect(categorize({ description: "Blue Tokai", amount: 1 }, [], mm, hist)).toMatchObject({ categoryId: "coffee", source: "MERCHANT" });
    expect(categorize({ description: "FreshMart", amount: 1 }, [], mm, hist)).toMatchObject({ categoryId: "groceries", source: "HISTORY", confidence: 0.75 });
    expect(categorize({ description: "Unknown", amount: 1 }, [], mm, hist).source).toBe("NONE");
  });
});

describe("recurring detection", () => {
  it("detects monthly charges and price increases", () => {
    const mk = (d: string, a: string) => ({ date: new Date(d), amount: a, description: "Spotify", merchant: "Spotify", categoryId: "ent", accountId: "a" });
    const c = detectRecurring([mk("2026-01-03", "-119"), mk("2026-02-03", "-119"), mk("2026-03-03", "-119"), mk("2026-04-03", "-139")]);
    expect(c).toHaveLength(1);
    expect(c[0].frequency).toBe("MONTHLY");
    expect(c[0].priceChange?.percent).toBe(16.8);
  });

  it("ignores irregular merchants", () => {
    const mk = (d: string) => ({ date: new Date(d), amount: "-50", description: "Cafe", categoryId: null, accountId: "a" });
    expect(detectRecurring([mk("2026-01-01"), mk("2026-01-04"), mk("2026-02-20"), mk("2026-02-21")])).toHaveLength(0);
  });
});
