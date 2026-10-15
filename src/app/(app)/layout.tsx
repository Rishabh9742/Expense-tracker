import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { AppShell } from "@/components/shell/app-shell";
import { maybeRunUserJobs } from "@/server/services/jobs";
import { getAccountOptions, getCategoryOptions } from "@/server/queries/options";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await maybeRunUserJobs(user.id);
  const [notifications, unread, accounts, categories] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    getAccountOptions(user.id),
    getCategoryOptions(user.id),
  ]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      format={{ currency: user.prefs.baseCurrency, locale: user.prefs.locale, timezone: user.prefs.timezone }}
      notifications={notifications.map((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }))}
      unread={unread}
      accounts={accounts}
      categories={categories}
    >
      {children}
    </AppShell>
  );
}
