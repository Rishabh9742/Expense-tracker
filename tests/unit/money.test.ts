import { describe, expect, it } from "vitest";
import { dec, formatMoney, parseAmount, percentOf, roundMoney, sum } from "@/lib/money";

describe("decimal-safe arithmetic", () => {
  it("avoids floating point drift", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(sum(Array(10).fill("0.1")).toString()).toBe("1");
  });

  it("rounds half-even to the currency's minor unit", () => {
    expect(roundMoney("2.345", "USD").toString()).toBe("2.34");
    expect(roundMoney("2.355", "USD").toString()).toBe("2.36");
    expect(roundMoney("1234.5", "JPY").toString()).toBe("1234");
  });

  it("formats negatives and currencies", () => {
    expect(formatMoney("-1234.5", "USD", { locale: "en-US" })).toBe("-$1,234.50");
    expect(formatMoney("100000", "INR", { locale: "en-IN" })).toBe("₹1,00,000.00");
    expect(formatMoney("1500", "JPY", { locale: "en-US" })).toBe("¥1,500");
  });

  it("returns null percentage for zero denominators", () => {
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(25, 200)).toBe(12.5);
  });
});

describe("parseAmount", () => {
  it.each([
    ["1,234.56", "1234.56"],
    ["-45.10", "-45.1"],
    ["(99.99)", "-99.99"],
    ["₹ 2,500", "2500"],
    ["$12", "12"],
    ["150.00 Dr", "-150"],
    ["150.00 Cr", "150"],
    ["75-", "-75"],
    ["+10", "10"],
  ])("parses %s", (input, expected) => {
    expect(parseAmount(input)?.toString()).toBe(expected);
  });

  it("supports comma decimal separators", () => {
    expect(parseAmount("1.234,50", ",")?.toString()).toBe("1234.5");
  });

  it("rejects garbage", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });

  it("dec rejects non-finite numbers", () => {
    expect(() => dec(Number.NaN)).toThrow();
  });
});
