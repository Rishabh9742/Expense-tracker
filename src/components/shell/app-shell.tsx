"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Command } from "cmdk";
import {
  Bell,
  CheckCheck,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
  ArrowLeftRight,
  LayoutDashboard,
  PiggyBank,
  AlertTriangle,
  Info,
  CircleCheck,
  OctagonAlert,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, SheetContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Kbd, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/misc";
import { FormatProvider } from "@/components/finance/format";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { cn, initials } from "@/lib/utils";
import type { AccountOption, CategoryOption } from "@/lib/dto";
import { ALL_NAV, NAV_GROUPS, SECONDARY_NAV, isActive, titleFor } from "./nav";
import { logoutAction } from "@/app/(auth)/actions";
import { markAllNotificationsReadAction, markNotificationReadAction, saveThemeAction } from "@/server/actions/settings";
import { DateRangePicker } from "./date-range-picker";

export interface ShellNotification {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ShellProps {
  user: { name: string | null; email: string };
  format: { currency: string; locale: string; timezone: string };
  notifications: ShellNotification[];
  unread: number;
  accounts: AccountOption[];
  categories: CategoryOption[];
  children: React.ReactNode;
}

const QuickAddCtx = React.createContext<{ open: (opts?: { type?: "EXPENSE" | "INCOME" | "TRANSFER"; accountId?: string }) => void }>({ open: () => {} });
export const useQuickAdd = () => React.useContext(QuickAddCtx);

const DataCtx = React.createContext<{ accounts: AccountOption[]; categories: CategoryOption[]; byId: Map<string, CategoryOption> }>({ accounts: [], categories: [], byId: new Map() });
/** Accounts and categories loaded once by the shell for every page. */
export const useAppData = () => React.useContext(DataCtx);

const RANGE_ROUTES = ["/", "/reports"];

export function AppShell({ user, format, notifications, unread, accounts, categories, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [quick, setQuick] = React.useState<{ open: boolean; type?: "EXPENSE" | "INCOME" | "TRANSFER"; accountId?: string }>({ open: false });

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("finora:sidebar") === "collapsed");
    } catch {}
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("finora:sidebar", c ? "expanded" : "collapsed");
      } catch {}
      return !c;
    });
  };

  // Global keyboard shortcuts
  React.useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") {
        e.preventDefault();
        setQuick({ open: true });
      } else if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "g") {
        gPressed = Date.now();
      } else if (Date.now() - gPressed < 800) {
        const map: Record<string, string> = { o: "/", t: "/transactions", a: "/accounts", b: "/budgets", r: "/reports", s: "/settings" };
        if (map[e.key]) {
          e.preventDefault();
          router.push(map[e.key]);
        }
        gPressed = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const appData = React.useMemo(() => ({ accounts, categories, byId: new Map(categories.map((c) => [c.id, c])) }), [accounts, categories]);
  const quickApi = React.useMemo(() => ({ open: (o?: { type?: "EXPENSE" | "INCOME" | "TRANSFER"; accountId?: string }) => setQuick({ open: true, ...o }) }), []);

  return (
    <FormatProvider value={format}>
      <DataCtx.Provider value={appData}>
      <QuickAddCtx.Provider value={quickApi}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          {/* Desktop sidebar */}
          <aside
            className={cn(
              "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex",
              collapsed ? "w-[64px]" : "w-[240px]",
            )}
            aria-label="Primary"
          >
            <SidebarContent collapsed={collapsed} pathname={pathname} user={user} onToggle={toggleCollapsed} />
          </aside>

          {/* Mobile drawer */}
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="bg-sidebar p-0" aria-describedby={undefined}>
              <DialogTitle className="sr-only">Navigation</DialogTitle>
              <SidebarContent collapsed={false} pathname={pathname} user={user} />
            </SheetContent>
          </Dialog>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
              <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-6 lg:px-8">
                <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                  <Menu />
                </Button>
                <span className="lg:hidden">
                  <LogoMark className="size-6" />
                </span>
                <h1 className="truncate text-[15px] font-semibold tracking-tight">{titleFor(pathname)}</h1>
                <div className="ml-auto flex items-center gap-1.5">
                  {RANGE_ROUTES.includes(pathname) && (
                    <div className="hidden md:block">
                      <DateRangePicker defaultKey={pathname === "/reports" ? "last_6_months" : "this_month"} />
                    </div>
                  )}
                  <button
                    onClick={() => setPaletteOpen(true)}
                    className="hidden h-8 w-56 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-subtle-foreground shadow-xs transition-colors hover:border-border-strong md:flex"
                    aria-label="Search and commands"
                  >
                    <Search className="size-3.5" />
                    Search or jump to…
                    <span className="ml-auto flex gap-0.5">
                      <Kbd>Ctrl</Kbd>
                      <Kbd>K</Kbd>
                    </span>
                  </button>
                  <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search">
                    <Search />
                  </Button>
                  <NotificationsBell items={notifications} unread={unread} />
                  <ThemeToggle />
                  <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => setQuick({ open: true })}>
                    <Plus /> Add
                    <Kbd className="ml-0.5 border-white/25 bg-white/15 text-current dark:border-black/20 dark:bg-black/10">N</Kbd>
                  </Button>
                </div>
              </div>
              {RANGE_ROUTES.includes(pathname) && (
                <div className="border-t border-border px-4 py-2 md:hidden">
                  <DateRangePicker defaultKey={pathname === "/reports" ? "last_6_months" : "this_month"} />
                </div>
              )}
            </header>
            <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">
              {children}
            </main>
          </div>
        </div>

        <MobileTabBar pathname={pathname} onAdd={() => setQuick({ open: true })} onMore={() => setMobileOpen(true)} />

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onQuickAdd={(type) => setQuick({ open: true, type })} />

        <Dialog open={quick.open} onOpenChange={(o) => setQuick((q) => ({ ...q, open: o }))}>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>New transaction</DialogTitle>
              <DialogDescription>Only amount, description and account are required. Everything else can wait.</DialogDescription>
            </DialogHeader>
            <DialogBody className="pb-5">
              {quick.open && (
                <TransactionForm
                  accounts={accounts}
                  categories={categories}
                  defaultType={quick.type}
                  defaultAccountId={quick.accountId}
                  onDone={() => {
                    setQuick({ open: false });
                    router.refresh();
                  }}
                />
              )}
            </DialogBody>
          </DialogContent>
        </Dialog>
      </QuickAddCtx.Provider>
      </DataCtx.Provider>
    </FormatProvider>
  );
}

function SidebarContent({ collapsed, pathname, user, onToggle }: { collapsed: boolean; pathname: string; user: ShellProps["user"]; onToggle?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
        <Link href="/" aria-label="Finora home" className="rounded-md">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-5")}>
            {g.label && !collapsed && <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-subtle-foreground uppercase">{g.label}</p>}
            {g.label && collapsed && <div className="mx-3 mb-2 h-px bg-border" />}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item.href)} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-2">
        <ul className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={isActive(pathname, item.href)} collapsed={collapsed} />
            </li>
          ))}
        </ul>
        <div className={cn("mt-2 flex items-center gap-2", collapsed && "flex-col")}>
          <UserMenu user={user} collapsed={collapsed} />
          {onToggle && (
            <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
              <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
                {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function NavLink({ item, active, collapsed }: { item: (typeof ALL_NAV)[number]; active: boolean; collapsed: boolean }) {
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
        active && "bg-surface text-foreground shadow-xs ring-1 ring-border",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-accent" />}
      <item.icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-subtle-foreground group-hover:text-muted-foreground")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function UserMenu({ user, collapsed }: { user: ShellProps["user"]; collapsed: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-surface-2", collapsed && "flex-none")} aria-label="Account menu">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-soft-foreground">{initials(user.name, user.email)}</span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{user.name ?? "You"}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{user.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logoutAction()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const choose = (t: string) => {
    setTheme(t);
    saveThemeAction(t).catch(() => undefined);
  };
  const IconC = !mounted ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          <IconC />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-36">
        <DropdownMenuItem onSelect={() => choose("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose("system")}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SEV_ICON: Record<string, React.ElementType> = { critical: OctagonAlert, warning: AlertTriangle, success: CircleCheck, info: Info };
const SEV_TONE: Record<string, string> = { critical: "text-negative", warning: "text-warning", success: "text-positive", info: "text-info" };

function NotificationsBell({ items, unread }: { items: ShellNotification[]; unread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-negative px-0.5 text-[9px] leading-none font-semibold text-white dark:text-[#1a0d0a]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await markAllNotificationsReadAction();
                router.refresh();
              }}
            >
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              You&apos;re all caught up. Budget alerts, bill reminders and unusual activity will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const I = SEV_ICON[n.severity] ?? Info;
                return (
                  <li key={n.id}>
                    <button
                      className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2", !n.readAt && "bg-accent-soft/30")}
                      onClick={async () => {
                        if (!n.readAt) await markNotificationReadAction(n.id);
                        setOpen(false);
                        if (n.href) router.push(n.href);
                        else router.refresh();
                      }}
                    >
                      <I className={cn("mt-0.5 size-4 shrink-0", SEV_TONE[n.severity])} aria-label={n.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={cn("text-[13px] leading-snug", !n.readAt ? "font-semibold" : "font-medium")}>{n.title}</span>
                          {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-subtle-foreground">{new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MobileTabBar({ pathname, onAdd, onMore }: { pathname: string; onAdd: () => void; onMore: () => void }) {
  const tabs = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/transactions", label: "Activity", icon: ArrowLeftRight },
    null,
    { href: "/budgets", label: "Budgets", icon: PiggyBank },
  ];
  return (
    <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {tabs.map((t, i) =>
          t ? (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={isActive(pathname, t.href) ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 py-1 text-[10.5px] font-medium text-muted-foreground", isActive(pathname, t.href) && "text-accent")}
              >
                <t.icon className="size-5" />
                {t.label}
              </Link>
            </li>
          ) : (
            <li key={i} className="flex justify-center">
              <button onClick={onAdd} aria-label="Add transaction" className="grid size-11 place-items-center rounded-full bg-accent text-accent-foreground shadow-md active:scale-95">
                <Plus className="size-5" />
              </button>
            </li>
          ),
        )}
        <li>
          <button onClick={onMore} className="flex w-full flex-col items-center gap-1 py-1 text-[10.5px] font-medium text-muted-foreground">
            <MoreHorizontal className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

function CommandPalette({ open, onOpenChange, onQuickAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onQuickAdd: (t?: "EXPENSE" | "INCOME" | "TRANSFER") => void }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [q, setQ] = React.useState("");
  const go = (fn: () => void) => {
    onOpenChange(false);
    setQ("");
    fn();
  };
  const itemCls =
    "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-foreground data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="top-[18%] translate-y-0 overflow-hidden p-0 data-[state=open]:animate-fade-in" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" className="flex flex-col" loop>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input value={q} onValueChange={setQ} placeholder="Search pages, actions, or transactions…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground" />
          </div>
          <Command.List className="scrollbar-thin max-h-[360px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">No matches.</Command.Empty>
            {q.trim().length > 1 && (
              <Command.Group heading="Search" className="text-meta text-subtle-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                <Command.Item value={`search-txn ${q}`} className={itemCls} onSelect={() => go(() => router.push(`/transactions?q=${encodeURIComponent(q.trim())}`))}>
                  <Search /> Search transactions for “{q.trim()}”
                </Command.Item>
                <Command.Item value={`ask-ai ${q}`} className={itemCls} onSelect={() => go(() => router.push(`/assistant?q=${encodeURIComponent(q.trim())}`))}>
                  <Search /> Ask the assistant: “{q.trim()}”
                </Command.Item>
              </Command.Group>
            )}
            <Command.Group heading="Actions" className="text-meta text-subtle-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
              <Command.Item className={itemCls} onSelect={() => go(() => onQuickAdd("EXPENSE"))}>
                <Plus /> Add expense <Kbd className="ml-auto">N</Kbd>
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => go(() => onQuickAdd("INCOME"))}>
                <Plus /> Add income
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => go(() => onQuickAdd("TRANSFER"))}>
                <ArrowLeftRight /> Record transfer
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => go(() => router.push("/import"))}>
                <Plus /> Import a statement
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => go(() => setTheme("dark"))}>
                <Moon /> Switch to dark theme
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => go(() => setTheme("light"))}>
                <Sun /> Switch to light theme
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Go to" className="text-meta text-subtle-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
              {ALL_NAV.map((n) => (
                <Command.Item key={n.href} value={`go ${n.label}`} className={itemCls} onSelect={() => go(() => router.push(n.href))}>
                  <n.icon /> {n.label}
                  {n.shortcut && <span className="ml-auto text-[11px] text-subtle-foreground">{n.shortcut}</span>}
                </Command.Item>
              ))}
              <Command.Item value="go forecast" className={itemCls} onSelect={() => go(() => router.push("/reports/forecast"))}>
                <ChevronsRight /> Cash-flow forecast
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-subtle-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> select
            </span>
            <span className="ml-auto">
              <Kbd>G</Kbd> then <Kbd>T</Kbd> jumps to Transactions
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
