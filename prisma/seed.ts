/**
 * Development seed: creates a separate DEMO user filled with realistic synthetic data.
 * Every account and transaction is flagged `isSample`, the user is named
 * "Demo (sample data)", and real users are never touched.
 *
 *   npm run db:seed
 *   Login: demo@finora.app / FinoraDemo2026
 */
import "dotenv/config";
import { PrismaClient, Prisma, type Frequency } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, addMonths, startOfMonth, subMonths } from "date-fns";
import { ensureDefaultCategories } from "../src/server/services/categories";
import { importHash, normalizeMerchant } from "../src/lib/finance/duplicates";

const db = new PrismaClient();
const EMAIL = "demo@finora.app";
const PASSWORD = "FinoraDemo2026";
const USD_INR = new Prisma.Decimal("83.20");

// Deterministic PRNG so the demo looks the same on every machine.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const pair = (opts: [string, string][]) => {
  const [description, merchant] = pick(opts);
  return { description, merchant };
};
const at = (d: Date, h = 12, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};

async function main() {
  const existing = await db.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } });
    console.log("Removed previous demo user");
  }
  const user = await db.user.create({
    data: {
      email: EMAIL,
      name: "Demo (sample data)",
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      preferences: { create: { baseCurrency: "INR", timezone: "Asia/Kolkata", locale: "en-IN", onboardingDismissed: true, lowBalanceThreshold: "15000" } },
    },
  });
  await ensureDefaultCategories(user.id, db);
  const cats = await db.category.findMany({ where: { userId: user.id } });
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  await db.category.updateMany({ where: { userId: user.id, name: "Groceries" }, data: { monthlyTarget: "14000" } });

  const now = new Date();
  const start = startOfMonth(subMonths(now, 6));
  const acct = async (name: string, type: Prisma.AccountCreateInput["type"], opening: string, currency = "INR", institution?: string) =>
    db.account.create({ data: { userId: user.id, name, type, currency, openingBalance: opening, openingDate: start, institution, isSample: true } });
  const checking = await acct("HDFC Salary Account", "CHECKING", "84500", "INR", "HDFC Bank");
  const savings = await acct("Emergency Savings", "SAVINGS", "210000", "INR", "ICICI Bank");
  const card = await acct("Amazon Pay ICICI Card", "CREDIT_CARD", "-12400", "INR", "ICICI Bank");
  const wallet = await acct("Paytm Wallet", "DIGITAL_WALLET", "1800", "INR", "Paytm");
  const cash = await acct("Cash", "CASH", "4200");
  const usd = await acct("Wise USD", "CHECKING", "640", "USD", "Wise");
  const invest = await acct("Index Fund Portfolio", "INVESTMENT", "350000", "INR", "Zerodha Coin");
  const carLoan = await acct("Car Loan", "LOAN", "-420000", "INR", "SBI");

  // Manual USD→INR rates so the demo works offline; flagged as manual.
  for (let d = new Date(start); d <= now; d = addDays(d, 7)) {
    await db.exchangeRate.create({ data: { userId: user.id, base: "USD", quote: "INR", date: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), rate: USD_INR.plus(between(-0.6, 0.6)).toFixed(4), source: "manual" } });
  }

  const rows: Prisma.TransactionCreateManyInput[] = [];
  const add = (t: { account: { id: string; currency: string }; type: Prisma.TransactionCreateManyInput["type"]; date: Date; description: string; merchant?: string; amount: number; category?: string; to?: { id: string }; toAmount?: number; status?: "CLEARED" | "PENDING"; payment?: string; reimbursable?: boolean; notes?: string }) => {
    const signed = t.type === "EXPENSE" || t.type === "TRANSFER" ? -Math.abs(t.amount) : t.type === "ADJUSTMENT" ? t.amount : Math.abs(t.amount);
    const rate = t.account.currency === "USD" ? USD_INR : new Prisma.Decimal(1);
    const amt = new Prisma.Decimal(signed.toFixed(2));
    rows.push({
      userId: user.id,
      accountId: t.account.id,
      type: t.type,
      status: t.status ?? "CLEARED",
      date: t.date,
      description: t.description,
      merchant: t.merchant ?? null,
      amount: amt,
      currency: t.account.currency,
      baseAmount: amt.times(rate).toDecimalPlaces(4),
      baseCurrency: "INR",
      fxRate: rate,
      fxRateDate: t.account.currency === "USD" ? t.date : null,
      fxRateSource: t.account.currency === "USD" ? "manual" : "identity",
      toAccountId: t.to?.id ?? null,
      toAmount: t.to ? new Prisma.Decimal((t.toAmount ?? Math.abs(t.amount)).toFixed(2)) : null,
      toBaseAmount: t.to ? new Prisma.Decimal((t.toAmount ?? Math.abs(t.amount)).toFixed(2)) : null,
      categoryId: t.category ? cat(t.category) : null,
      categorySource: t.category ? "USER" : "NONE",
      needsReview: !t.category && t.type !== "TRANSFER" && t.type !== "ADJUSTMENT",
      paymentMethod: t.payment ?? null,
      isReimbursable: !!t.reimbursable,
      notes: t.notes ?? null,
      isSample: true,
      importHash: importHash({ accountId: t.account.id, date: t.date, amount: amt, description: t.description }),
    });
  };

  for (let m = 0; m <= 6; m++) {
    const month = addMonths(start, m);
    const dayOf = (d: number) => at(addDays(month, d - 1), 10);
    const inMonth = (d: Date) => d <= now;
    const salaryDay = dayOf(1);
    if (inMonth(salaryDay)) add({ account: checking, type: "INCOME", date: salaryDay, description: "Salary credit — Northwind Technologies", merchant: "Northwind Technologies", amount: 145000, category: "Salary" });
    if (m % 2 === 1 && inMonth(dayOf(14))) add({ account: usd, type: "INCOME", date: dayOf(14), description: "Upwork payout — dashboard redesign", merchant: "Upwork", amount: between(420, 780), category: "Freelance Income" });
    if (inMonth(dayOf(28))) add({ account: savings, type: "INCOME", date: dayOf(28), description: "Savings interest", merchant: "ICICI Bank", amount: between(620, 760), category: "Interest" });
    if (inMonth(dayOf(3))) add({ account: checking, type: "EXPENSE", date: dayOf(3), description: "Rent — Koramangala apartment", merchant: "Landlord", amount: 32000, category: "Rent", payment: "Bank transfer" });
    if (inMonth(dayOf(2))) add({ account: checking, type: "TRANSFER", date: dayOf(2), description: "Move to emergency savings", amount: 20000, to: savings, category: "Savings" });
    if (inMonth(dayOf(5))) add({ account: checking, type: "TRANSFER", date: dayOf(5), description: "Index fund SIP", amount: 15000, to: invest, category: "Investments" });
    if (inMonth(dayOf(7))) add({ account: checking, type: "TRANSFER", date: dayOf(7), description: "Car loan EMI — principal", amount: 11200, to: carLoan, category: "Debt Payments", notes: "EMI 14,500 = 11,200 principal + 3,300 interest" });
    if (inMonth(dayOf(7))) add({ account: checking, type: "EXPENSE", date: dayOf(7), description: "Car loan interest", merchant: "SBI", amount: 3300, category: "Debt Payments" });
    if (inMonth(dayOf(12))) add({ account: checking, type: "EXPENSE", date: dayOf(12), description: "BESCOM electricity bill", merchant: "BESCOM", amount: between(1400, 2600), category: "Electricity", payment: "UPI" });
    if (inMonth(dayOf(9))) add({ account: card, type: "EXPENSE", date: dayOf(9), description: "Airtel Fiber", merchant: "Airtel", amount: 1178, category: "Phone & internet" });
    if (inMonth(dayOf(11))) add({ account: card, type: "EXPENSE", date: dayOf(11), description: "NETFLIX.COM", merchant: "Netflix", amount: m >= 5 ? 799 : 649, category: "Subscriptions" });
    if (inMonth(dayOf(16))) add({ account: card, type: "EXPENSE", date: dayOf(16), description: "Spotify Premium", merchant: "Spotify", amount: 119, category: "Subscriptions" });
    if (inMonth(dayOf(4))) add({ account: checking, type: "EXPENSE", date: dayOf(4), description: "Cult.fit membership", merchant: "Cult.fit", amount: 2499, category: "Personal Care" });
    if (inMonth(dayOf(20))) add({ account: checking, type: "TRANSFER", date: dayOf(20), description: "Credit card payment", amount: 42000, to: card, category: "Credit Card Payment" });
    if (inMonth(dayOf(6))) add({ account: checking, type: "TRANSFER", date: dayOf(6), description: "Paytm wallet top-up", amount: 4500, to: wallet });

    for (let w = 0; w < 5; w++) {
      const d = at(addDays(month, w * 7 + Math.floor(rand() * 3)), 18, 20);
      if (d > now || d.getMonth() !== month.getMonth()) continue;
      add({ account: card, type: "EXPENSE", date: d, ...pair([["BigBasket order", "BigBasket"], ["Nature's Basket Indiranagar", "Nature's Basket"], ["DMart Koramangala", "DMart"]]), amount: between(1800, 3900), category: "Groceries" });
      add({ account: wallet, type: "EXPENSE", date: addDays(d, 1), ...pair([["Swiggy order", "Swiggy"], ["Zomato order", "Zomato"]]), amount: between(320, 890), category: "Food delivery", payment: "Wallet" });
      add({ account: card, type: "EXPENSE", date: addDays(d, 2), ...pair([["Third Wave Coffee", "Third Wave Coffee"], ["Blue Tokai Coffee", "Blue Tokai"]]), amount: between(240, 520), category: "Coffee" });
      add({ account: checking, type: "EXPENSE", date: addDays(d, 3), description: "Uber trip", merchant: "Uber", amount: between(180, 640), category: "Rideshare & taxi", payment: "UPI" });
      if (rand() > 0.4) add({ account: card, type: "EXPENSE", date: addDays(d, 4), ...pair([["Toit Brewpub", "Toit"], ["Truffles", "Truffles"], ["Meghana Foods", "Meghana Foods"]]), amount: between(900, 3200), category: "Restaurants" });
      if (rand() > 0.6) add({ account: cash, type: "EXPENSE", date: addDays(d, 5), description: "Auto rickshaw", amount: between(60, 220), category: "Transportation", payment: "Cash" });
    }
    const fuel = dayOf(15);
    if (inMonth(fuel)) add({ account: card, type: "EXPENSE", date: fuel, description: "Indian Oil — fuel", merchant: "Indian Oil", amount: between(2800, 3600), category: "Fuel" });
    const shop = dayOf(18);
    if (inMonth(shop)) add({ account: card, type: "EXPENSE", date: shop, ...pair([["Amazon.in order", "Amazon"], ["Myntra order", "Myntra"], ["Croma electronics", "Croma"]]), amount: between(1200, 7800), category: "Shopping" });
    const movie = dayOf(22);
    if (inMonth(movie) && rand() > 0.3) add({ account: card, type: "EXPENSE", date: movie, description: "PVR Cinemas", merchant: "PVR", amount: between(600, 1400), category: "Entertainment" });
    if (m === 2 && inMonth(dayOf(10))) {
      add({ account: card, type: "EXPENSE", date: dayOf(10), description: "IndiGo flights BLR–GOI", merchant: "IndiGo", amount: 11840, category: "Travel" });
      add({ account: card, type: "EXPENSE", date: dayOf(19), description: "Goa beach resort", merchant: "Taj Holiday Village", amount: 18600, category: "Travel" });
    }
    if (m === 3 && inMonth(dayOf(21))) {
      add({ account: card, type: "EXPENSE", date: dayOf(21), description: "Boat headphones", merchant: "Amazon", amount: 3999, category: "Shopping" });
      add({ account: card, type: "REFUND", date: dayOf(25), description: "Refund — Boat headphones (returned)", merchant: "Amazon", amount: 3999, category: "Shopping" });
    }
    if (m === 4 && inMonth(dayOf(8))) {
      add({ account: card, type: "EXPENSE", date: dayOf(8), description: "Client dinner — reimbursable", merchant: "Olive Beach", amount: 6400, category: "Restaurants", reimbursable: true });
      add({ account: checking, type: "REFUND", date: dayOf(17), description: "Expense reimbursement — Northwind", merchant: "Northwind Technologies", amount: 6400, category: "Restaurants", notes: "Reimbursement for client dinner" });
    }
    if (m === 5 && inMonth(dayOf(13))) add({ account: checking, type: "EXPENSE", date: dayOf(13), description: "Apollo Hospital — consultation & tests", merchant: "Apollo", amount: 8900, category: "Healthcare" });
    if (m === 1 && inMonth(dayOf(24))) add({ account: usd, type: "EXPENSE", date: dayOf(24), description: "Figma Professional (annual)", merchant: "Figma", amount: 144, category: "Subscriptions" });
  }
  // A couple of pending and uncategorized transactions to show review flows.
  add({ account: card, type: "EXPENSE", date: at(addDays(now, -1), 20), description: "POS 4411 STARMARK BOOKS", amount: 1240, status: "PENDING" });
  add({ account: checking, type: "EXPENSE", date: at(addDays(now, -2), 13), description: "UPI-RAZORPAY*URBANCLAP", amount: 899 });
  // A possible duplicate pair
  add({ account: card, type: "EXPENSE", date: at(addDays(now, -3), 19), description: "Swiggy Instamart", merchant: "Swiggy", amount: 642, category: "Groceries" });
  add({ account: card, type: "EXPENSE", date: at(addDays(now, -3), 19, 4), description: "SWIGGY INSTAMART", merchant: "Swiggy", amount: 642, category: "Groceries" });

  await db.transaction.createMany({ data: rows.filter((r) => (r.date as Date) <= now) });

  // Rules & merchant mappings
  await db.transactionRule.create({ data: { userId: user.id, name: "Uber → Rideshare", field: "DESCRIPTION", operator: "CONTAINS", value: "uber", categoryId: cat("Rideshare & taxi"), priority: 10 } });
  await db.transactionRule.create({ data: { userId: user.id, name: "Swiggy/Zomato → Food delivery", field: "DESCRIPTION", operator: "REGEX", value: "swiggy order|zomato", categoryId: cat("Food delivery"), priority: 20 } });
  await db.merchantMapping.create({ data: { userId: user.id, merchant: normalizeMerchant("BigBasket"), categoryId: cat("Groceries") } });

  // Budgets
  const bstart = startOfMonth(subMonths(now, 6));
  const budget = (name: string, amount: string, extra: Partial<Prisma.BudgetUncheckedCreateInput>) => db.budget.create({ data: { userId: user.id, name, amount, startDate: bstart, ...extra } });
  await budget("Groceries", "14000", { scope: "CATEGORY", categoryId: cat("Groceries"), method: "ROLLOVER" });
  await budget("Dining out", "9000", { scope: "CATEGORY", categoryId: cat("Dining") });
  await budget("Transportation", "3200", { scope: "CATEGORY", categoryId: cat("Transportation"), method: "ENVELOPE" });
  await budget("Shopping", "6000", { scope: "CATEGORY", categoryId: cat("Shopping") });
  await budget("Everything", "95000", { scope: "OVERALL" });

  // Recurring schedule (salary, expected-only to demonstrate missing-income alerts)
  await db.recurringTransaction.create({
    data: { userId: user.id, name: "Salary — Northwind Technologies", type: "INCOME", accountId: checking.id, categoryId: cat("Salary"), merchant: "Northwind Technologies", amount: "145000", frequency: "MONTHLY", startDate: at(startOfMonth(addMonths(now, 1)), 10), nextDate: at(startOfMonth(addMonths(now, 1)), 10), autoCreate: false },
  });

  // Subscriptions
  const sub = (name: string, amount: string, frequency: Frequency, nextDay: number, extra: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) =>
    db.subscription.create({
      data: { userId: user.id, name, merchant: name, amount, currency: "INR", frequency, nextDate: at(addDays(startOfMonth(addMonths(now, now.getDate() >= nextDay ? 1 : 0)), nextDay - 1), 9), startDate: start, accountId: card.id, categoryId: cat("Subscriptions"), ...extra },
    });
  await sub("Netflix", "799", "MONTHLY", 11, { previousAmount: "649", amountChangedAt: subMonths(now, 1) });
  await sub("Spotify", "119", "MONTHLY", 16);
  await sub("Cult.fit", "2499", "MONTHLY", 4, { accountId: checking.id, categoryId: cat("Personal Care") });
  await db.subscription.create({ data: { userId: user.id, name: "Figma Professional", merchant: "Figma", amount: "144", currency: "USD", frequency: "YEARLY", nextDate: addMonths(start, 13), startDate: addMonths(start, 1), accountId: usd.id, categoryId: cat("Subscriptions") } });

  // Bills
  const bill = (name: string, kind: Prisma.BillCreateInput["kind"], amount: string, day: number, extra: Partial<Prisma.BillUncheckedCreateInput> = {}) =>
    db.bill.create({ data: { userId: user.id, name, kind, amount, currency: "INR", nextDueDate: at(addDays(startOfMonth(addMonths(now, now.getDate() > day ? 1 : 0)), day - 1), 9), accountId: checking.id, ...extra } });
  await bill("Apartment rent", "RENT", "32000", 3, { categoryId: cat("Rent") });
  await bill("BESCOM electricity", "UTILITIES", "2100", 12, { isVariable: true, categoryId: cat("Electricity") });
  await bill("Airtel Fiber", "PHONE_INTERNET", "1178", 9, { accountId: card.id, autopay: true, categoryId: cat("Phone & internet") });
  await bill("Health insurance premium", "INSURANCE", "18400", 20, { frequency: "YEARLY", nextDueDate: at(addDays(now, 5), 9), categoryId: cat("Insurance") });
  await bill("Credit card statement", "CREDIT_CARD", "18000", 20, { isVariable: true });

  // Goals
  await db.savingsGoal.create({ data: { userId: user.id, name: "6-month emergency fund", kind: "EMERGENCY", icon: "shield", targetAmount: "540000", currency: "INR", linkedAccountId: savings.id, monthlyContribution: "20000", priority: 1, targetDate: addMonths(now, 14) } });
  const trip = await db.savingsGoal.create({ data: { userId: user.id, name: "Japan trip", kind: "TRAVEL", icon: "plane", targetAmount: "250000", currency: "INR", manualBalance: "45000", monthlyContribution: "12000", priority: 2, targetDate: addMonths(now, 10) } });
  for (let i = 3; i >= 1; i--) await db.goalContribution.create({ data: { goalId: trip.id, amount: "12000", date: subMonths(now, i) } });
  await db.savingsGoal.create({ data: { userId: user.id, name: "New MacBook", kind: "GADGET", icon: "laptop", targetAmount: "180000", currency: "INR", manualBalance: "62000", monthlyContribution: "8000", priority: 3, targetDate: addMonths(now, 6) } });

  // Debts
  await db.debt.create({ data: { userId: user.id, name: "Car loan", type: "VEHICLE_LOAN", lender: "SBI", currency: "INR", originalPrincipal: "600000", currentBalance: "420000", interestRate: "9.25", minimumPayment: "14500", dueDay: 7, linkedAccountId: carLoan.id, customOrder: 1 } });
  const pl = await db.debt.create({ data: { userId: user.id, name: "Personal loan", type: "PERSONAL_LOAN", lender: "Bajaj Finserv", currency: "INR", originalPrincipal: "150000", currentBalance: "86000", interestRate: "14.5", minimumPayment: "6200", dueDay: 15, customOrder: 2 } });
  for (let i = 3; i >= 1; i--) await db.debtPayment.create({ data: { debtId: pl.id, date: subMonths(now, i), amount: "6200", principal: "5150", interest: "1050" } });
  await db.debt.create({ data: { userId: user.id, name: "Credit card balance", type: "CREDIT_CARD", lender: "ICICI", currency: "INR", originalPrincipal: "60000", currentBalance: "0", interestRate: "42", minimumPayment: "2000", linkedAccountId: card.id, customOrder: 0 } });
  await db.debt.create({ data: { userId: user.id, name: "Loan from family", type: "OTHER", currency: "INR", originalPrincipal: "50000", currentBalance: "30000", interestRate: null, minimumPayment: "5000", customOrder: 3 } });

  // Assets with valuations
  const car = await db.asset.create({ data: { userId: user.id, name: "Hyundai Creta", type: "VEHICLE", currency: "INR" } });
  for (let i = 6; i >= 0; i -= 3) await db.assetValuation.create({ data: { assetId: car.id, date: new Date(Date.UTC(subMonths(now, i).getFullYear(), subMonths(now, i).getMonth(), 1)), value: String(1150000 - (6 - i) * 15000) } });
  const gold = await db.asset.create({ data: { userId: user.id, name: "Gold jewellery", type: "OTHER", currency: "INR", notes: "Estimated at current gold price" } });
  await db.assetValuation.create({ data: { assetId: gold.id, date: new Date(Date.UTC(start.getFullYear(), start.getMonth(), 1)), value: "380000" } });
  await db.assetValuation.create({ data: { assetId: gold.id, date: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)), value: "412000" } });

  console.log(`Seeded demo user ${EMAIL} / ${PASSWORD} with ${rows.length} sample transactions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
