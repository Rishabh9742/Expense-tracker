import { z } from "zod";

export const amountString = z
  .string()
  .trim()
  .min(1, "Enter an amount")
  .transform((s) => s.replace(/,/g, ""))
  .refine((s) => /^-?\d{1,13}(\.\d{1,4})?$/.test(s), "Enter a valid amount (up to 4 decimals)");

export const positiveAmount = amountString.refine((s) => Number(s) > 0, "Amount must be greater than zero");
export const optionalAmount = z
  .string()
  .trim()
  .optional()
  .transform((s) => (s ? s.replace(/,/g, "") : undefined))
  .refine((s) => s === undefined || /^-?\d{1,13}(\.\d{1,4})?$/.test(s), "Enter a valid amount");

export const id = z.string().min(1).max(40);
export const optionalId = z
  .string()
  .max(40)
  .optional()
  .nullable()
  .transform((s) => (s ? s : null));

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");

export const TRANSACTION_TYPES = ["EXPENSE", "INCOME", "TRANSFER", "REFUND", "ADJUSTMENT"] as const;

export const transactionSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amount: amountString,
    description: z.string().trim().min(1, "Add a description").max(500),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Choose a date"),
    accountId: id,
    toAccountId: optionalId,
    toAmount: optionalAmount,
    categoryId: optionalId,
    merchant: z.string().trim().max(200).optional().nullable(),
    status: z.enum(["CLEARED", "PENDING"]).default("CLEARED"),
    paymentMethod: z.string().trim().max(60).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    tags: z.string().max(400).optional().nullable(),
    isReimbursable: z.boolean().default(false),
    originalAmount: optionalAmount,
    originalCurrency: z.string().trim().toUpperCase().max(3).optional().nullable(),
    splits: z
      .array(z.object({ categoryId: optionalId, amount: positiveAmount, note: z.string().max(200).optional().nullable() }))
      .max(20)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "ADJUSTMENT" && Number(v.amount) <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero" });
    if (v.type === "ADJUSTMENT" && Number(v.amount) === 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount cannot be zero" });
    if (v.type === "TRANSFER" && !v.toAccountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose where the money went" });
    if (v.type === "TRANSFER" && v.toAccountId === v.accountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Pick a different account" });
  });

export type TransactionFormValues = z.input<typeof transactionSchema>;
export type TransactionParsed = z.output<typeof transactionSchema>;

export function zodFieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of err.issues) {
    const k = i.path.join(".") || "_";
    (out[k] ??= []).push(i.message);
  }
  return out;
}
