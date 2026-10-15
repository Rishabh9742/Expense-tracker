import { describe, expect, it } from "vitest";
import { monthlyFactor, nextOccurrenceAfter, nthOccurrence, occurrencesBetween } from "@/lib/finance/recurrence";
import { previousRange, resolveRange, parseLocalDate, toLocalYmd } from "@/lib/dates";

describe("recurrence", () => {
  it("anchors monthly schedules to avoid month-end drift", () => {
    const start = new Date("2026-01-31T00:00:00Z");
    expect(nthOccurrence(start, "MONTHLY", 1, 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(nthOccurrence(start, "MONTHLY", 1, 2).toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("lists occurrences in a window respecting end date", () => {
    const occ = occurrencesBetween(
      new Date("2026-01-01T00:00:00Z"),
      "WEEKLY",
      1,
      new Date("2026-01-10T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-01-20T00:00:00Z"),
    );
    expect(occ.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-15"]);
  });

  it("handles leap years for yearly schedules", () => {
    const d = nthOccurrence(new Date("2024-02-29T00:00:00Z"), "YEARLY", 1, 1);
    expect(d.toISOString().slice(0, 10)).toBe("2025-02-28");
  });

  it("finds the next occurrence", () => {
    const n = nextOccurrenceAfter(new Date("2026-01-15T00:00:00Z"), "QUARTERLY", 1, new Date("2026-05-01T00:00:00Z"));
    expect(n.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("converts frequencies to monthly factors", () => {
    expect(monthlyFactor("YEARLY")).toBeCloseTo(1 / 12);
    expect(monthlyFactor("WEEKLY")).toBeCloseTo(4.333, 2);
  });
});

describe("date ranges and time zones", () => {
  const now = new Date("2026-03-15T10:00:00Z");

  it("computes this month in the user's timezone", () => {
    const r = resolveRange("this_month", "Asia/Kolkata", now);
    expect(r.from.toISOString()).toBe("2026-02-28T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });

  it("handles DST transitions (America/New_York)", () => {
    const r = resolveRange("this_month", "America/New_York", now);
    expect(r.from.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-04-01T04:00:00.000Z");
  });

  it("previous range of a month is the prior calendar month", () => {
    const r = previousRange(resolveRange("this_month", "UTC", now));
    expect(r.from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("custom ranges are inclusive of the end day", () => {
    const r = resolveRange("custom", "UTC", now, { from: "2026-01-01", to: "2026-01-31" });
    expect(r.to.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(() => resolveRange("custom", "UTC", now, { from: "2026-02-01", to: "2026-01-01" })).toThrow();
  });

  it("round-trips local dates", () => {
    const d = parseLocalDate("2026-07-04", "Asia/Tokyo");
    expect(toLocalYmd(d, "Asia/Tokyo")).toBe("2026-07-04");
    expect(toLocalYmd(d, "UTC")).toBe("2026-07-03");
  });
});
