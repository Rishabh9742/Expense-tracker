import type { Prisma } from "@prisma/client";

/** Serializable transaction shape sent to client components. Money is exact decimal strings. */
export interface TxnDTO {
  id: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER" | "REFUND" | "ADJUSTMENT";
  status: "CLEARED" | "PENDING";
  date: string;
  description: string;
  merchant: string | null;
  amount: string;
  currency: string;
  baseAmount: string | null;
  baseCurrency: string | null;
  fxRate: string | null;
  fxRateSource: string | null;
  fxRateDate: string | null;
  originalAmount: string | null;
  originalCurrency: string | null;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  toAmount: string | null;
  toCurrency: string | null;
  categoryId: string | null;
  categorySource: string;
  categoryConfidence: number | null;
  needsReview: boolean;
  paymentMethod: string | null;
  notes: string | null;
  isReimbursable: boolean;
  tags: string[];
  splits: { categoryId: string | null; amount: string; note: string | null }[];
  receipts: { id: string; fileName: string; mimeType: string; size: number }[];
  recurringName: string | null;
  importFile: string | null;
  isSample: boolean;
}

export const TXN_INCLUDE = {
  account: { select: { name: true, currency: true } },
  toAccount: { select: { name: true, currency: true } },
  splits: { select: { categoryId: true, amount: true, note: true } },
  tags: { select: { tag: { select: { name: true } } } },
  receipts: { select: { id: true, fileName: true, mimeType: true, size: true } },
  recurring: { select: { name: true } },
  importBatch: { select: { fileName: true } },
} satisfies Prisma.TransactionInclude;

type TxnRow = Prisma.TransactionGetPayload<{ include: typeof TXN_INCLUDE }>;

const s = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toString());

export function toTxnDTO(t: TxnRow): TxnDTO {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    date: t.date.toISOString(),
    description: t.description,
    merchant: t.merchant,
    amount: t.amount.toString(),
    currency: t.currency,
    baseAmount: s(t.baseAmount),
    baseCurrency: t.baseCurrency,
    fxRate: s(t.fxRate),
    fxRateSource: t.fxRateSource,
    fxRateDate: t.fxRateDate?.toISOString() ?? null,
    originalAmount: s(t.originalAmount),
    originalCurrency: t.originalCurrency,
    accountId: t.accountId,
    accountName: t.account.name,
    toAccountId: t.toAccountId,
    toAccountName: t.toAccount?.name ?? null,
    toAmount: s(t.toAmount),
    toCurrency: t.toAccount?.currency ?? null,
    categoryId: t.categoryId,
    categorySource: t.categorySource,
    categoryConfidence: t.categoryConfidence,
    needsReview: t.needsReview,
    paymentMethod: t.paymentMethod,
    notes: t.notes,
    isReimbursable: t.isReimbursable,
    tags: t.tags.map((x) => x.tag.name),
    splits: t.splits.map((x) => ({ categoryId: x.categoryId, amount: x.amount.toString(), note: x.note })),
    receipts: t.receipts,
    recurringName: t.recurring?.name ?? null,
    importFile: t.importBatch?.fileName ?? null,
    isSample: t.isSample,
  };
}

export interface AccountOption {
  id: string;
  name: string;
  type: string;
  currency: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  icon: string;
  color: string;
  parentId: string | null;
}
