import {
  ArrowLeftRight,
  Bot,
  CalendarClock,
  ChartColumn,
  HandCoins,
  LayoutDashboard,
  Layers,
  PiggyBank,
  Repeat,
  Settings,
  Target,
  TrendingUp,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, shortcut: "G O" },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, shortcut: "G T" },
      { href: "/accounts", label: "Accounts", icon: Wallet, shortcut: "G A" },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/budgets", label: "Budgets", icon: PiggyBank, shortcut: "G B" },
      { href: "/categories", label: "Categories", icon: Layers },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/bills", label: "Bills & Recurring", icon: CalendarClock },
      { href: "/goals", label: "Savings Goals", icon: Target },
      { href: "/debts", label: "Debts & Loans", icon: HandCoins },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/net-worth", label: "Net Worth", icon: TrendingUp },
      { href: "/reports", label: "Reports & Analytics", icon: ChartColumn, shortcut: "G R" },
      { href: "/assistant", label: "AI Assistant", icon: Bot },
    ],
  },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/import", label: "Import & Export", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const ALL_NAV = [...NAV_GROUPS.flatMap((g) => g.items), ...SECONDARY_NAV];

export function titleFor(pathname: string): string {
  if (pathname === "/") return "Overview";
  const match = ALL_NAV.filter((n) => n.href !== "/" && pathname.startsWith(n.href)).sort((a, b) => b.href.length - a.href.length)[0];
  if (pathname.startsWith("/reports/forecast")) return "Cash-flow Forecast";
  return match?.label ?? "Finora";
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
