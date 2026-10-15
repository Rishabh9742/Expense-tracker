"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, CircleCheck, CircleSlash, Database, Globe, KeyRound, Lock, Monitor, Moon, Plug, Shield, Sparkles, Sun, Trash2, User, Users, Download, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, ConfirmDialog, Switch } from "@/components/ui/misc";
import { Money, useFormat } from "@/components/finance/format";
import { Notice, PageHeader } from "@/components/finance/primitives";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  addManualRateAction,
  changePasswordAction,
  clearSampleDataAction,
  deleteAccountAction,
  deleteManualRateAction,
  saveAiPrefsAction,
  saveNotificationPrefsAction,
  savePreferencesAction,
  saveRetentionAction,
  saveThemeAction,
} from "@/server/actions/settings";
import { aiCategorizeAction } from "@/server/actions/ai";
import { addHouseholdMemberAction, createHouseholdAction, removeHouseholdMemberAction, shareAccountAction } from "@/server/actions/household";
import { cn } from "@/lib/utils";

interface Prefs {
  baseCurrency: string;
  timezone: string;
  locale: string;
  weekStartsOn: number;
  includePending: boolean;
  excludeReimbursable: boolean;
  notifyEmail: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  billReminderDays: number;
  lowBalanceThreshold: string;
  budgetAlertLevels: number[];
  alertsEnabled: Record<string, boolean>;
  aiEnabled: boolean;
  aiAutoCategorize: boolean;
  aiConsentAt: string | null;
  auditRetentionDays: number;
  notificationRetentionDays: number;
}

interface Household {
  id: string;
  name: string;
  isOwner: boolean;
  myRole: string;
  myMemberId: string;
  members: { id: string; name: string | null; email: string; role: string }[];
  sharedAccounts: { id: string; name: string; owner: string; balance: string; currency: string }[];
  monthSpending: string;
  monthIncome: string;
  monthLabel: string;
}

const SECTIONS = [
  { id: "profile", label: "Profile & preferences", icon: User },
  { id: "appearance", label: "Appearance", icon: Monitor },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "currency", label: "Currency", icon: Globe },
  { id: "privacy", label: "Privacy & AI", icon: Sparkles },
  { id: "security", label: "Security", icon: Shield },
  { id: "household", label: "Household", icon: Users },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "data", label: "Your data", icon: Database },
];

const TIMEZONES = ["Asia/Kolkata", "UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai", "Australia/Sydney", "Pacific/Auckland"];
const LOCALES = [
  { v: "en-IN", l: "English (India) · 1,00,000.00" },
  { v: "en-US", l: "English (US) · 100,000.00" },
  { v: "en-GB", l: "English (UK) · 100,000.00" },
  { v: "de-DE", l: "Deutsch · 100.000,00" },
  { v: "fr-FR", l: "Français · 100 000,00" },
  { v: "ja-JP", l: "日本語 · 100,000" },
];

export function SettingsView(props: {
  profile: { name: string; email: string };
  prefs: Prefs;
  integrations: { ai: string | null; email: boolean; fx: string | null; bank: string | null; lastJob: { at: string; ok: boolean | null; name: string } | null };
  rates: { id: string; base: string; quote: string; date: string; rate: string }[];
  logs: { id: string; action: string; entityType: string; createdAt: string; ip: string | null }[];
  household: Household | null;
  myAccounts: { id: string; name: string; householdId: string | null }[];
  sampleCount: number;
}) {
  return (
    <div>
      <PageHeader title="Settings" description="Preferences, notifications, privacy and your data." />
      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                  <s.icon className="size-4" /> {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <ProfileSection profile={props.profile} prefs={props.prefs} />
          <AppearanceSection />
          <NotificationsSection prefs={props.prefs} emailAvailable={props.integrations.email} />
          <CurrencySection prefs={props.prefs} rates={props.rates} fx={props.integrations.fx} />
          <PrivacySection prefs={props.prefs} aiProvider={props.integrations.ai} />
          <SecuritySection logs={props.logs} />
          <HouseholdSection household={props.household} myAccounts={props.myAccounts} />
          <IntegrationsSection i={props.integrations} />
          <DataSection prefs={props.prefs} sampleCount={props.sampleCount} />
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 py-2.5", disabled && "opacity-60")}>
      <span className="text-[13px]">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-meta text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </label>
  );
}

function ProfileSection({ profile, prefs }: { profile: { name: string; email: string }; prefs: Prefs }) {
  const router = useRouter();
  const [v, setV] = React.useState({ name: profile.name, baseCurrency: prefs.baseCurrency, timezone: prefs.timezone, locale: prefs.locale, weekStartsOn: prefs.weekStartsOn, includePending: prefs.includePending, excludeReimbursable: prefs.excludeReimbursable });
  const [pending, start] = React.useTransition();
  const [confirmCurrency, setConfirmCurrency] = React.useState(false);
  const save = () =>
    start(async () => {
      const r = await savePreferencesAction(v);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data?.recomputed !== undefined ? `Saved · ${r.data.recomputed} transactions converted to ${v.baseCurrency}${r.data.missing ? ` (${r.data.missing} without a rate)` : ""}` : "Preferences saved");
      router.refresh();
    });
  const tzs = TIMEZONES.includes(v.timezone) ? TIMEZONES : [v.timezone, ...TIMEZONES];
  return (
    <Section id="profile" title="Profile & preferences">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name">
          <Input id="p-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="p-email" hint="Used to sign in">
          <Input id="p-email" value={profile.email} disabled />
        </Field>
        <Field label="Base currency" htmlFor="p-cur" hint="All totals are converted into this currency">
          <NativeSelect id="p-cur" value={v.baseCurrency} onChange={(e) => setV({ ...v, baseCurrency: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Time zone" htmlFor="p-tz" hint="Defines your days, weeks and months">
          <NativeSelect id="p-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
            {tzs.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Number format" htmlFor="p-loc">
          <NativeSelect id="p-loc" value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}>
            {LOCALES.map((l) => (
              <option key={l.v} value={l.v}>
                {l.l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Week starts on" htmlFor="p-week">
          <NativeSelect id="p-week" value={String(v.weekStartsOn)} onChange={(e) => setV({ ...v, weekStartsOn: Number(e.target.value) })}>
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        <ToggleRow label="Include pending transactions" description="Count pending transactions in balances, budgets and reports." checked={v.includePending} onChange={(c) => setV({ ...v, includePending: c })} />
        <ToggleRow label="Exclude reimbursable expenses from spending" description="Expenses marked reimbursable won't count toward spending or budgets." checked={v.excludeReimbursable} onChange={(c) => setV({ ...v, excludeReimbursable: c })} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" loading={pending} onClick={() => (v.baseCurrency !== prefs.baseCurrency ? setConfirmCurrency(true) : save())}>
          Save preferences
        </Button>
      </div>
      <ConfirmDialog
        open={confirmCurrency}
        onOpenChange={setConfirmCurrency}
        title={`Change base currency to ${v.baseCurrency}?`}
        description="Every transaction will be re-converted using the exchange rate for its date. Transactions without an available rate will be excluded from totals until you add one."
        confirmLabel="Change currency"
        onConfirm={() => {
          setConfirmCurrency(false);
          save();
        }}
      />
    </Section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const opts = [
    { v: "light", l: "Light", icon: Sun },
    { v: "dark", l: "Dark", icon: Moon },
    { v: "system", l: "System", icon: Monitor },
  ];
  return (
    <Section id="appearance" title="Appearance" description="Your choice is remembered on this device and in your profile.">
      <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
        {opts.map((o) => (
          <button
            key={o.v}
            role="radio"
            aria-checked={mounted && theme === o.v}
            onClick={() => {
              setTheme(o.v);
              saveThemeAction(o.v);
            }}
            className={cn("flex flex-col items-center gap-2 rounded-lg border border-border p-3 text-[13px] transition-colors hover:border-border-strong", mounted && theme === o.v && "border-accent bg-accent-soft/40 text-foreground ring-1 ring-accent")}
          >
            <o.icon className="size-5 text-muted-foreground" />
            {o.l}
          </button>
        ))}
      </div>
    </Section>
  );
}

const ALERTS = [
  { k: "budget", l: "Budget thresholds" },
  { k: "unusual", l: "Unusual transactions" },
  { k: "bills", l: "Upcoming & overdue bills" },
  { k: "subscriptions", l: "Subscription renewals" },
  { k: "lowBalance", l: "Low balances" },
  { k: "missingIncome", l: "Missing expected income" },
  { k: "goals", l: "Savings milestones" },
  { k: "duplicates", l: "Possible duplicate transactions" },
];

function NotificationsSection({ prefs, emailAvailable }: { prefs: Prefs; emailAvailable: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState({
    notifyEmail: prefs.notifyEmail,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
    billReminderDays: prefs.billReminderDays,
    lowBalanceThreshold: prefs.lowBalanceThreshold,
    budgetAlertLevels: prefs.budgetAlertLevels,
    alertsEnabled: prefs.alertsEnabled,
  });
  const [pending, start] = React.useTransition();
  return (
    <Section id="notifications" title="Notifications" description="In-app notifications are always on. Choose what to be alerted about.">
      <div className="grid gap-x-8 sm:grid-cols-2">
        {ALERTS.map((a) => (
          <label key={a.k} className="flex items-center gap-2 py-1.5 text-[13px]">
            <Checkbox checked={v.alertsEnabled[a.k] !== false} onCheckedChange={(c) => setV({ ...v, alertsEnabled: { ...v.alertsEnabled, [a.k]: !!c } })} /> {a.l}
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <Field label="Low balance threshold" htmlFor="n-low" hint="Alert when cash/bank accounts drop below" optional>
          <Input id="n-low" inputMode="decimal" className="num" value={v.lowBalanceThreshold} onChange={(e) => setV({ ...v, lowBalanceThreshold: e.target.value })} />
        </Field>
        <Field label="Quiet hours start" htmlFor="n-qs" hint="No emails during quiet hours" optional>
          <NativeSelect id="n-qs" value={v.quietHoursStart ?? ""} onChange={(e) => setV({ ...v, quietHoursStart: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Off</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Quiet hours end" htmlFor="n-qe" optional>
          <NativeSelect id="n-qe" value={v.quietHoursEnd ?? ""} onChange={(e) => setV({ ...v, quietHoursEnd: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Off</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-[13px] font-medium">Default budget alert levels</legend>
        <div className="flex flex-wrap gap-4">
          {[50, 75, 90, 100].map((l) => (
            <label key={l} className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={v.budgetAlertLevels.includes(l)} onCheckedChange={(c) => setV({ ...v, budgetAlertLevels: c ? [...v.budgetAlertLevels, l].sort((a, b) => a - b) : v.budgetAlertLevels.filter((x) => x !== l) })} /> {l}%
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 border-t border-border">
        <ToggleRow
          label="Email important alerts"
          description={emailAvailable ? "Warnings and critical alerts are also emailed to you." : "Email delivery isn't configured for this workspace (RESEND_API_KEY). In-app notifications still work."}
          checked={v.notifyEmail && emailAvailable}
          disabled={!emailAvailable}
          onChange={(c) => setV({ ...v, notifyEmail: c })}
        />
        <ToggleRow label="Push notifications" description="Not available yet — no push provider is configured. Finora won't pretend otherwise." checked={false} disabled onChange={() => undefined} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveNotificationPrefsAction({ ...v, lowBalanceThreshold: v.lowBalanceThreshold.trim() || null });
              if (r.ok) {
                toast.success("Notification settings saved");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          Save notifications
        </Button>
      </div>
    </Section>
  );
}

function CurrencySection({ prefs, rates, fx }: { prefs: Prefs; rates: { id: string; base: string; quote: string; date: string; rate: string }[]; fx: string | null }) {
  const router = useRouter();
  const [v, setV] = React.useState({ base: "USD", quote: prefs.baseCurrency, date: new Date().toISOString().slice(0, 10), rate: "" });
  return (
    <Section id="currency" title="Currency & exchange rates" description={fx ? `Rates come from ${fx}, cached with their date and source. Add a manual rate when one is missing or you want to override it.` : "Automatic rate lookup is disabled. Add manual rates for any foreign-currency accounts."}>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <Field label="1 unit of" htmlFor="r-base">
          <NativeSelect id="r-base" value={v.base} onChange={(e) => setV({ ...v, base: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="equals" htmlFor="r-rate">
          <Input id="r-rate" inputMode="decimal" className="num" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} placeholder="83.25" />
        </Field>
        <Field label="Currency" htmlFor="r-quote">
          <NativeSelect id="r-quote" value={v.quote} onChange={(e) => setV({ ...v, quote: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="On date" htmlFor="r-date">
          <Input id="r-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            const r = await addManualRateAction(v);
            if (r.ok) {
              toast.success(`Rate saved${r.data?.fixed ? ` · ${r.data.fixed} transactions now converted` : ""}`);
              setV({ ...v, rate: "" });
              router.refresh();
            } else toast.error(r.error);
          }}
        >
          <Plus /> Add rate
        </Button>
      </div>
      <p className="mt-2 text-meta text-muted-foreground">Manual rates apply for up to 7 days after their date and take priority over provider rates.</p>
      {rates.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border text-[13px]">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2">
              <span className="num">
                1 {r.base} = {Number(r.rate)} {r.quote} <span className="text-muted-foreground">· {r.date} · manual</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete rate"
                onClick={async () => {
                  await deleteManualRateAction(r.id);
                  router.refresh();
                }}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PrivacySection({ prefs, aiProvider }: { prefs: Prefs; aiProvider: string | null }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(prefs.aiEnabled);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const save = async (on: boolean) => {
    const r = await saveAiPrefsAction({ aiEnabled: on, aiAutoCategorize: on && prefs.aiAutoCategorize });
    if (r.ok) {
      setEnabled(on);
      toast.success(on ? "AI features enabled" : "AI features disabled — nothing more will be sent");
      router.refresh();
    } else toast.error(r.error);
  };
  return (
    <Section id="privacy" title="Privacy & AI" description="AI features are optional and off until you turn them on.">
      {!aiProvider ? (
        <Notice icon={<Lock />}>
          No AI provider is configured for this workspace (set <code>AI_PROVIDER=anthropic</code> and <code>ANTHROPIC_API_KEY</code>). The assistant works in offline analysis mode, and receipt OCR and AI categorization are unavailable. No financial data is sent anywhere.
        </Notice>
      ) : (
        <>
          <div className="rounded-lg border border-border p-4 text-[13px]">
            <p className="font-medium">What is shared when AI is on</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Assistant: your question plus the calculated figures needed to answer it (totals, budget status, matching transaction descriptions for searches).</li>
              <li>AI categorization: descriptions, merchants and amounts of uncategorized transactions, and your category names.</li>
              <li>Receipt OCR: the receipt image or PDF you upload.</li>
              <li>Never shared: your password, account numbers, or data unrelated to the request. Provider: {aiProvider}.</li>
            </ul>
          </div>
          <ToggleRow label="Enable AI features" description={enabled && prefs.aiConsentAt ? `Consent given ${new Date(prefs.aiConsentAt).toLocaleDateString()}` : "Requires your consent to the data sharing described above."} checked={enabled} onChange={(on) => (on ? setConfirm(true) : save(false))} />
          {enabled && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-[13px] text-muted-foreground">Suggest categories for up to 50 uncategorized transactions. Suggestions are marked for your review.</span>
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await aiCategorizeAction();
                  setBusy(false);
                  if (r.ok) toast.success(r.data!.suggested ? `${r.data!.suggested} suggestions added — review them in Transactions` : "Nothing to categorize");
                  else toast.error(r.error);
                  router.refresh();
                }}
              >
                <Sparkles /> Suggest categories
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Turn on AI features?"
        description="Finora will send the data described above to the configured AI provider only when you use an AI feature. You can turn this off at any time."
        confirmLabel="I agree, enable"
        onConfirm={async () => {
          setConfirm(false);
          await save(true);
        }}
      />
    </Section>
  );
}

function SecuritySection({ logs }: { logs: { id: string; action: string; entityType: string; createdAt: string; ip: string | null }[] }) {
  const f = useFormat();
  const [pw, setPw] = React.useState({ current: "", next: "" });
  const [pending, start] = React.useTransition();
  return (
    <Section id="security" title="Security" description="Sessions expire after 7 days. Repeated failed sign-ins lock the account for 15 minutes.">
      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await changePasswordAction(pw);
            if (r.ok) {
              toast.success("Password changed");
              setPw({ current: "", next: "" });
            } else toast.error(r.error);
          });
        }}
      >
        <Field label="Current password" htmlFor="s-cur">
          <Input id="s-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="s-new" hint="10+ characters with a letter and a number">
          <Input id="s-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <Button type="submit" loading={pending} className="sm:mb-5">
          <KeyRound /> Change password
        </Button>
      </form>
      <h3 className="mt-6 mb-2 text-[13px] font-semibold">Recent activity</h3>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-[12.5px]">
        {logs.map((l) => (
          <li key={l.id} className="flex justify-between gap-3 px-3 py-1.5">
            <span>
              <span className="font-medium">{l.action}</span> <span className="text-muted-foreground">· {l.entityType}</span>
            </span>
            <span className="whitespace-nowrap text-muted-foreground">
              {f.date(l.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {l.ip ? ` · ${l.ip}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HouseholdSection({ household: h, myAccounts }: { household: Household | null; myAccounts: { id: string; name: string; householdId: string | null }[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"VIEWER" | "EDITOR">("VIEWER");
  const run = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (r.ok) {
      toast.success(msg);
      router.refresh();
    } else toast.error(r.error);
  };
  return (
    <Section id="household" title="Household (optional)" description="Share chosen accounts with a partner or family. Off by default — nothing is shared unless you share it.">
      {!h ? (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(createHouseholdAction(name), "Household created");
          }}
        >
          <Field label="Household name" htmlFor="h-name" className="flex-1">
            <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Verma family" />
          </Field>
          <Button type="submit" className="sm:mb-0">
            <Users /> Create household
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">{h.name}</span>
            <Badge variant="outline">Your role: {h.myRole.toLowerCase()}</Badge>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Members</h3>
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {h.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2">
                  <span>
                    {m.name ?? m.email} <span className="text-muted-foreground">· {m.email} · {m.role.toLowerCase()}</span>
                  </span>
                  {(h.isOwner && m.role !== "OWNER") || m.id === h.myMemberId ? (
                    <Button size="sm" variant="ghost" onClick={() => run(removeHouseholdMemberAction(m.id), m.id === h.myMemberId ? "Left household" : "Member removed")}>
                      {m.id === h.myMemberId ? (h.isOwner ? "Dissolve" : "Leave") : "Remove"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {h.isOwner && (
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(addHouseholdMemberAction(email, role), "Member added");
                  setEmail("");
                }}
              >
                <Input placeholder="Member's Finora email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Member email" />
                <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "VIEWER" | "EDITOR")} aria-label="Role" className="sm:w-36">
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                </NativeSelect>
                <Button type="submit">Add member</Button>
              </form>
            )}
          </div>
          {h.myRole !== "VIEWER" && (
            <div>
              <h3 className="mb-2 text-[13px] font-semibold">Share my accounts</h3>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {myAccounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                    <Checkbox checked={a.householdId === h.id} onCheckedChange={(c) => run(shareAccountAction(a.id, !!c), c ? "Account shared" : "Account made private")} /> {a.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Shared overview · {h.monthLabel}</h3>
            {h.sharedAccounts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No accounts are shared yet.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 text-[13px]">
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="text-meta text-muted-foreground">Spending (shared accounts)</p>
                    <Money value={h.monthSpending} className="font-semibold" />
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="text-meta text-muted-foreground">Income (shared accounts)</p>
                    <Money value={h.monthIncome} className="font-semibold" />
                  </div>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                  {h.sharedAccounts.map((a) => (
                    <li key={a.id} className="flex justify-between px-3 py-2">
                      <span>
                        {a.name} <span className="text-muted-foreground">· {a.owner}</span>
                      </span>
                      <Money value={a.balance} currency={a.currency} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function IntegrationsSection({ i }: { i: { ai: string | null; email: boolean; fx: string | null; bank: string | null; lastJob: { at: string; ok: boolean | null; name: string } | null } }) {
  const f = useFormat();
  const rows = [
    { name: "AI provider", status: i.ai, off: "Not configured — offline analysis mode only" },
    { name: "Exchange rates", status: i.fx, off: "Disabled — manual rates only" },
    { name: "Email notifications", status: i.email ? "Resend" : null, off: "Not configured — in-app only" },
    { name: "Bank synchronization", status: i.bank, off: "Not connected — use manual entry, CSV/Excel/OFX import and reconciliation" },
    { name: "Push notifications", status: null, off: "Not available" },
    { name: "Background jobs", status: i.lastJob ? `Last run ${f.date(i.lastJob.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${i.lastJob.ok === false ? " (with errors)" : ""}` : null, off: "Worker hasn't run yet — jobs also run when you open the app" },
  ];
  return (
    <Section id="integrations" title="Integrations" description="Finora only reports a service as working when it is actually configured.">
      <ul className="divide-y divide-border text-[13px]">
        {rows.map((r) => (
          <li key={r.name} className="flex items-start justify-between gap-4 py-2.5">
            <span className="font-medium">{r.name}</span>
            <span className={cn("flex items-center gap-1.5 text-right", r.status ? "text-positive" : "text-muted-foreground")}>
              {r.status ? <CircleCheck className="size-4 shrink-0" /> : <CircleSlash className="size-4 shrink-0" />}
              {r.status ?? r.off}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DataSection({ prefs, sampleCount }: { prefs: Prefs; sampleCount: number }) {
  const router = useRouter();
  const [ret, setRet] = React.useState({ auditRetentionDays: prefs.auditRetentionDays, notificationRetentionDays: prefs.notificationRetentionDays });
  const [del, setDel] = React.useState({ password: "", confirm: "" });
  const [delOpen, setDelOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  return (
    <Section id="data" title="Your data" description="Export everything, control retention, or delete your account.">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href="/api/export/all">
            <Download /> Export all data (JSON)
          </a>
        </Button>
        <Button asChild>
          <a href="/api/export/transactions?format=csv">
            <Download /> Transactions (CSV)
          </a>
        </Button>
        {sampleCount > 0 && (
          <Button
            onClick={async () => {
              const r = await clearSampleDataAction();
              if (r.ok) {
                toast.success(`Removed ${r.data!.removed} sample records`);
                router.refresh();
              }
            }}
          >
            <Trash2 /> Remove sample data ({sampleCount})
          </Button>
        )}
      </div>
      <div className="mt-5 grid items-end gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Keep activity log for (days)" htmlFor="ret-a">
          <Input id="ret-a" type="number" min={30} max={3650} value={ret.auditRetentionDays} onChange={(e) => setRet({ ...ret, auditRetentionDays: Number(e.target.value) })} />
        </Field>
        <Field label="Keep read notifications for (days)" htmlFor="ret-n">
          <Input id="ret-n" type="number" min={7} max={3650} value={ret.notificationRetentionDays} onChange={(e) => setRet({ ...ret, notificationRetentionDays: Number(e.target.value) })} />
        </Field>
        <Button
          onClick={async () => {
            const r = await saveRetentionAction(ret);
            if (r.ok) toast.success("Retention saved");
          }}
        >
          Save retention
        </Button>
      </div>
      <p className="mt-2 text-meta text-muted-foreground">Deleted transactions are kept for 30 days so you can undo, then purged permanently.</p>
      <div className="mt-6 rounded-lg border border-negative/30 p-4">
        <p className="text-[13.5px] font-medium text-negative">Delete account</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Permanently deletes your account, all financial records, and all stored receipts. This cannot be undone — export your data first if you need it.</p>
        <Button variant="destructive" size="sm" className="mt-3" onClick={() => setDelOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </div>
      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        title="Delete your Finora account?"
        destructive
        loading={deleting}
        confirmLabel="Delete everything"
        description={
          <div className="space-y-3">
            <p>All accounts, transactions, budgets, goals, receipts and settings will be permanently removed.</p>
            <Input type="password" placeholder="Your password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} aria-label="Password" />
            <Input placeholder='Type "DELETE" to confirm' value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} aria-label="Confirmation" />
          </div>
        }
        onConfirm={async () => {
          setDeleting(true);
          const r = await deleteAccountAction(del);
          setDeleting(false);
          if (r && !r.ok) toast.error(r.error);
        }}
      />
    </Section>
  );
}
