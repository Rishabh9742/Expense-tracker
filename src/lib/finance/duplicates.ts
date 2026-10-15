import { createHash } from "node:crypto";
import { dec, type DecimalLike } from "@/lib/money";

/** Normalize a merchant / description into a stable key: "AMAZON PAY*1234 MUMBAI" → "amazon pay". */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/\b(pos|upi|imps|neft|rtgs|ach|debit|credit|card|purchase|payment|txn|ref|www|com|in|ltd|pvt|inc|llc)\b/g, " ")
    .replace(/[*#].*$/, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[^a-z\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

/** Deterministic fingerprint used to detect re-imports of the same statement row. */
export function importHash(input: { accountId: string; date: Date; amount: DecimalLike; description: string }): string {
  const day = input.date.toISOString().slice(0, 10);
  const amt = dec(input.amount).toFixed(2);
  const desc = input.description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${input.accountId}|${day}|${amt}|${desc}`).digest("hex").slice(0, 32);
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export interface DupCandidate {
  id: string;
  accountId: string;
  date: Date;
  amount: DecimalLike;
  description: string;
  merchant?: string | null;
}

/**
 * Possible duplicates: same account, same amount, within `windowDays`, and
 * similar merchant/description. Returns pairs [earlierId, laterId].
 */
export function findPossibleDuplicates(txns: DupCandidate[], windowDays = 2): [string, string][] {
  const sorted = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime());
  const pairs: [string, string][] = [];
  const windowMs = windowDays * 86400000;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const ka = normalizeMerchant(a.merchant || a.description);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.date.getTime() - a.date.getTime() > windowMs) break;
      if (a.accountId !== b.accountId) continue;
      if (!dec(a.amount).eq(dec(b.amount))) continue;
      const kb = normalizeMerchant(b.merchant || b.description);
      if (similarity(ka, kb) >= 0.5) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}
