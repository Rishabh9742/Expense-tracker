import type { CategorySource, RuleField, RuleOperator } from "@prisma/client";
import { dec, type DecimalLike } from "@/lib/money";
import { normalizeMerchant } from "./duplicates";

export interface RuleLike {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
  amountMin?: DecimalLike | null;
  amountMax?: DecimalLike | null;
  categoryId: string;
  setMerchant?: string | null;
  priority: number;
  active: boolean;
}

export interface CategorizeInput {
  description: string;
  merchant?: string | null;
  amount: DecimalLike; // magnitude or signed — compared by absolute value
}

export interface CategorizeResult {
  categoryId: string | null;
  source: CategorySource;
  confidence: number | null;
  merchant?: string | null;
  ruleId?: string;
}

function safeRegex(pattern: string): RegExp | null {
  // Reject catastrophic patterns and overly long input to protect the server.
  // Nested quantifiers like (a+)+ or (a*)* or (x+){2,} cause exponential backtracking.
  if (pattern.length > 200 || /\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern) || /[+*]\s*[+*]/.test(pattern) || /\\\d/.test(pattern)) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function ruleMatches(rule: RuleLike, input: CategorizeInput): boolean {
  if (!rule.active) return false;
  const target = (rule.field === "MERCHANT" ? input.merchant ?? "" : input.description).toLowerCase();
  const v = rule.value.toLowerCase();
  let ok = false;
  switch (rule.operator) {
    case "CONTAINS":
      ok = target.includes(v);
      break;
    case "EQUALS":
      ok = target.trim() === v.trim();
      break;
    case "STARTS_WITH":
      ok = target.startsWith(v);
      break;
    case "REGEX": {
      const re = safeRegex(rule.value);
      ok = !!re && re.test(target.slice(0, 500));
      break;
    }
  }
  if (!ok) return false;
  const amt = dec(input.amount).abs();
  if (rule.amountMin != null && amt.lt(dec(rule.amountMin))) return false;
  if (rule.amountMax != null && amt.gt(dec(rule.amountMax))) return false;
  return true;
}

/**
 * Deterministic categorization pipeline (AI is applied separately, only with consent):
 *   1. user-defined rules (by priority)
 *   2. confirmed merchant mappings
 *   3. previous confirmed categorization of the same merchant (majority vote)
 */
export function categorize(
  input: CategorizeInput,
  rules: RuleLike[],
  merchantMap: Map<string, string>,
  history: Map<string, Map<string, number>>,
): CategorizeResult {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(r, input)) {
      return { categoryId: r.categoryId, source: "RULE", confidence: 1, merchant: r.setMerchant ?? undefined, ruleId: r.id };
    }
  }
  const key = normalizeMerchant(input.merchant || input.description);
  if (key && merchantMap.has(key)) return { categoryId: merchantMap.get(key)!, source: "MERCHANT", confidence: 1 };
  const counts = key ? history.get(key) : undefined;
  if (counts && counts.size) {
    let best: string | null = null;
    let bestN = 0;
    let total = 0;
    for (const [cat, n] of counts) {
      total += n;
      if (n > bestN) {
        best = cat;
        bestN = n;
      }
    }
    const confidence = Math.round((bestN / total) * 100) / 100;
    return { categoryId: best, source: "HISTORY", confidence };
  }
  return { categoryId: null, source: "NONE", confidence: null };
}

export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;
