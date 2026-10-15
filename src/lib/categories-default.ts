import type { CategoryKind } from "@prisma/client";

export interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string; // chart slot key: c1…c8 | other
  essential?: boolean;
  children?: { name: string; icon: string }[];
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Housing", kind: "EXPENSE", icon: "home", color: "c1", essential: true, children: [{ name: "Rent", icon: "key" }, { name: "Maintenance", icon: "wrench" }] },
  { name: "Groceries", kind: "EXPENSE", icon: "shopping-basket", color: "c3", essential: true },
  { name: "Dining", kind: "EXPENSE", icon: "utensils", color: "c2", children: [{ name: "Restaurants", icon: "utensils" }, { name: "Coffee", icon: "coffee" }, { name: "Food delivery", icon: "bike" }] },
  { name: "Transportation", kind: "EXPENSE", icon: "car", color: "c7", essential: true, children: [{ name: "Rideshare & taxi", icon: "car-taxi-front" }, { name: "Public transit", icon: "train-front" }, { name: "Parking & tolls", icon: "square-parking" }] },
  { name: "Fuel", kind: "EXPENSE", icon: "fuel", color: "c4", essential: true },
  { name: "Utilities", kind: "EXPENSE", icon: "zap", color: "c6", essential: true, children: [{ name: "Electricity", icon: "zap" }, { name: "Water", icon: "droplet" }, { name: "Phone & internet", icon: "wifi" }] },
  { name: "Healthcare", kind: "EXPENSE", icon: "heart-pulse", color: "c8", essential: true },
  { name: "Shopping", kind: "EXPENSE", icon: "shopping-bag", color: "c5" },
  { name: "Entertainment", kind: "EXPENSE", icon: "clapperboard", color: "c7" },
  { name: "Subscriptions", kind: "EXPENSE", icon: "repeat", color: "c5" },
  { name: "Education", kind: "EXPENSE", icon: "graduation-cap", color: "c1", essential: true },
  { name: "Travel", kind: "EXPENSE", icon: "plane", color: "c3" },
  { name: "Insurance", kind: "EXPENSE", icon: "shield", color: "c6", essential: true },
  { name: "Debt Payments", kind: "EXPENSE", icon: "landmark", color: "c8", essential: true },
  { name: "Personal Care", kind: "EXPENSE", icon: "sparkles", color: "c5" },
  { name: "Gifts & Donations", kind: "EXPENSE", icon: "gift", color: "c2" },
  { name: "Fees & Charges", kind: "EXPENSE", icon: "receipt", color: "other" },
  { name: "Other Expenses", kind: "EXPENSE", icon: "circle-dashed", color: "other" },
  { name: "Salary", kind: "INCOME", icon: "briefcase", color: "c3" },
  { name: "Freelance Income", kind: "INCOME", icon: "laptop", color: "c1" },
  { name: "Business Income", kind: "INCOME", icon: "store", color: "c7" },
  { name: "Investment Income", kind: "INCOME", icon: "trending-up", color: "c6" },
  { name: "Rental Income", kind: "INCOME", icon: "building", color: "c2" },
  { name: "Interest", kind: "INCOME", icon: "percent", color: "c4" },
  { name: "Gifts Received", kind: "INCOME", icon: "gift", color: "c5" },
  { name: "Other Income", kind: "INCOME", icon: "circle-plus", color: "other" },
  { name: "Savings", kind: "TRANSFER", icon: "piggy-bank", color: "c3" },
  { name: "Investments", kind: "TRANSFER", icon: "chart-candlestick", color: "c1" },
  { name: "Credit Card Payment", kind: "TRANSFER", icon: "credit-card", color: "other" },
];
