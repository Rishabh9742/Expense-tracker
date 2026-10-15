import type { AccountType } from "@prisma/client";
import { Decimal, dec, type DecimalLike } from "@/lib/money";

export const LIABILITY_ACCOUNT_TYPES: AccountType[] = ["CREDIT_CARD", "LOAN"];

export function isLiabilityAccount(type: AccountType): boolean {
  return LIABILITY_ACCOUNT_TYPES.includes(type);
}

export interface NetWorthInput {
  /** Account balances already converted into base currency; null = no rate */
  accounts: { id: string; name: string; type: AccountType; baseBalance: DecimalLike | null; includeInNetWorth: boolean }[];
  /** Latest manual valuations (estimates) in base currency */
  assets: { id: string; name: string; type: string; baseValue: DecimalLike | null }[];
  /** Debts in base currency. Debts linked to an account are skipped to avoid double counting. */
  debts: { id: string; name: string; baseBalance: DecimalLike | null; linkedAccountId: string | null; closed?: boolean }[];
}

export interface NetWorthResult {
  accountAssets: Decimal;
  estimatedAssets: Decimal;
  totalAssets: Decimal;
  accountLiabilities: Decimal;
  debtLiabilities: Decimal;
  totalLiabilities: Decimal;
  netWorth: Decimal;
  missingRates: string[];
  skippedLinkedDebts: string[];
}

/**
 * Net worth = total assets − total liabilities.
 * - Asset accounts with a negative balance (overdraft) count as liabilities.
 * - Liability accounts (credit cards, loans) hold negative balances when money is owed;
 *   a positive balance (e.g. card overpayment) counts as an asset.
 * - Debts linked to a liability account are represented by that account only.
 */
export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  let accountAssets = new Decimal(0);
  let accountLiabilities = new Decimal(0);
  const missingRates: string[] = [];
  const accountIds = new Set<string>();
  for (const a of input.accounts) {
    if (!a.includeInNetWorth) continue;
    accountIds.add(a.id);
    if (a.baseBalance === null || a.baseBalance === undefined) {
      missingRates.push(a.name);
      continue;
    }
    const b = dec(a.baseBalance);
    if (b.gte(0)) accountAssets = accountAssets.plus(b);
    else accountLiabilities = accountLiabilities.plus(b.abs());
  }
  let estimatedAssets = new Decimal(0);
  for (const a of input.assets) {
    if (a.baseValue === null || a.baseValue === undefined) {
      missingRates.push(a.name);
      continue;
    }
    estimatedAssets = estimatedAssets.plus(dec(a.baseValue));
  }
  let debtLiabilities = new Decimal(0);
  const skippedLinkedDebts: string[] = [];
  for (const d of input.debts) {
    if (d.closed) continue;
    if (d.linkedAccountId && accountIds.has(d.linkedAccountId)) {
      skippedLinkedDebts.push(d.name);
      continue;
    }
    if (d.baseBalance === null || d.baseBalance === undefined) {
      missingRates.push(d.name);
      continue;
    }
    debtLiabilities = debtLiabilities.plus(dec(d.baseBalance).abs());
  }
  const totalAssets = accountAssets.plus(estimatedAssets);
  const totalLiabilities = accountLiabilities.plus(debtLiabilities);
  return {
    accountAssets,
    estimatedAssets,
    totalAssets,
    accountLiabilities,
    debtLiabilities,
    totalLiabilities,
    netWorth: totalAssets.minus(totalLiabilities),
    missingRates,
    skippedLinkedDebts,
  };
}
