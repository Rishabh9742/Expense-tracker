"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Info, Link2, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Target, Trash2, Archive, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, ProgressBar } from "@/components/ui/misc";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, useFormat } from "@/components/finance/format";
import { EmptyState, PageHeader, StatRow } from "@/components/finance/primitives";
import { Icon } from "@/components/finance/icons";
import { useAppData } from "@/components/shell/app-shell";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { projectGoal } from "@/lib/finance/goals";
import { addContributionAction, archiveGoalAction, deleteGoalAction, saveGoalAction, type GoalFormValues } from "@/server/actions/planning";
import { isoToYmd, todayYmd } from "@/components/schedules/shared";
import { cn } from "@/lib/utils";

interface Goal {
  id: string;
  name: string;
  kind: string;
  icon: string;
  targetAmount: string;
  currency: string;
  manualBalance: string;
  targetDate: string | null;
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  monthlyContribution: string | null;
  priority: number;
  saved: string;
  manualSaved: string;
  accountSaved: string | null;
  savedBasis: "manual" | "linked-account";
  percent: number;
  remaining: string;
  requiredMonthly: string | null;
  projectedDate: string | null;
  onTrack: boolean | null;
  contributions: { id: string; amount: string; date: string; note: string | null }[];
}

const KINDS: Record<string, { label: string; icon: string }> = {
  EMERGENCY: { label: "Emergency fund", icon: "shield" },
  TRAVEL: { label: "Travel", icon: "plane" },
  EDUCATION: { label: "Education", icon: "graduation-cap" },
  GADGET: { label: "Gadget", icon: "smartphone" },
  VEHICLE: { label: "Vehicle", icon: "car" },
  HOME: { label: "Home", icon: "home" },
  MAJOR: { label: "Major expense", icon: "gift" },
  CUSTOM: { label: "Custom", icon: "target" },
};
const PRIORITY = { 1: "High", 2: "Medium", 3: "Low" } as Record<number, string>;

export function GoalsView({ goals, autoNew }: { goals: Goal[]; autoNew: boolean }) {
  const [editing, setEditing] = React.useState<Goal | "new" | null>(autoNew ? "new" : null);
  const [contrib, setContrib] = React.useState<Goal | null>(null);
  const [sim, setSim] = React.useState<Goal | null>(null);
  return (
    <div>
      <PageHeader
        title="Savings Goals"
        description="Plan for what matters. Progress comes from a linked account's real balance, or from contributions you record."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> New goal
          </Button>
        }
      />
      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target />}
            title="Set your first goal"
            description="An emergency fund, a trip, a new laptop or a home down payment — Finora shows how much to save each month to get there."
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus /> New goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => (
            <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} onContribute={() => setContrib(g)} onSimulate={() => setSim(g)} />
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New goal" : "Edit goal"}</DialogTitle>
            <DialogDescription>Link a savings account to track its real balance, or track progress manually.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-5">{editing && <GoalForm initial={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}</DialogBody>
        </DialogContent>
      </Dialog>
      {contrib && <ContributionDialog goal={contrib} onClose={() => setContrib(null)} />}
      {sim && <SimulateDialog goal={sim} onClose={() => setSim(null)} />}
    </div>
  );
}

function GoalCard({ g, onEdit, onContribute, onSimulate }: { g: Goal; onEdit: () => void; onContribute: () => void; onSimulate: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const [confirm, setConfirm] = React.useState(false);
  const done = g.percent >= 100;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-positive-soft text-positive">
            <Icon name={g.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">{g.name}</CardTitle>
            <CardDescription>
              {KINDS[g.kind]?.label ?? "Goal"} · {PRIORITY[g.priority]} priority
            </CardDescription>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSimulate}>
              <SlidersHorizontal /> Simulate contributions
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                await archiveGoalAction(g.id);
                router.refresh();
              }}
            >
              <Archive /> Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <Money value={g.saved} currency={g.currency} className="text-[22px] font-semibold" />
          <span className="text-[13px] text-muted-foreground">
            of <Money value={g.targetAmount} currency={g.currency} />
          </span>
        </div>
        <ProgressBar value={g.percent} tone="positive" label={`${g.name} ${g.percent}% funded`} className="mt-2.5" />
        <div className="mt-1.5 flex items-center justify-between text-[12px]">
          <span className="num font-medium">{g.percent}%</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {g.savedBasis === "linked-account" ? (
              <>
                <Link2 className="size-3" /> Balance of {g.linkedAccountName}
              </>
            ) : (
              <>Tracked manually</>
            )}
          </span>
        </div>
        <div className="mt-3 border-t border-border pt-2">
          {g.targetDate && <StatRow label="Target date" value={f.date(g.targetDate)} />}
          {!done && g.requiredMonthly && <StatRow label="Needed per month" value={<Money value={g.requiredMonthly} currency={g.currency} />} />}
          {g.monthlyContribution && <StatRow label="Planned per month" value={<Money value={g.monthlyContribution} currency={g.currency} />} />}
          <StatRow
            label="Projected completion"
            value={
              done ? (
                <span className="text-positive">Reached</span>
              ) : g.projectedDate ? (
                <span className={cn(g.onTrack === false && "text-warning")}>{f.date(g.projectedDate, { month: "short", year: "numeric" })}</span>
              ) : (
                <span className="text-muted-foreground">Set a monthly contribution</span>
              )
            }
          />
        </div>
        {g.onTrack === false && !done && (
          <p className="mt-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
            Behind schedule — save {f.money(g.requiredMonthly, g.currency)} a month to finish by {f.date(g.targetDate!, { month: "short", year: "numeric" })}.
          </p>
        )}
        {g.savedBasis === "linked-account" && Number(g.manualSaved) > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" /> Manual contributions ({f.money(g.manualSaved, g.currency)}) are ignored while the goal is linked to an account.
          </p>
        )}
        <div className="mt-auto flex gap-2 pt-4">
          <Button size="sm" variant="primary" className="flex-1" onClick={onContribute}>
            <PiggyBank /> Add money
          </Button>
          <Button size="sm" onClick={onSimulate}>
            <SlidersHorizontal /> Simulate
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${g.name}?`}
        description="Manual contributions for this goal are deleted. Linked account balances and transactions are not affected."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await deleteGoalAction(g.id);
          setConfirm(false);
          router.refresh();
        }}
      />
    </Card>
  );
}

function ContributionDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const router = useRouter();
  const { accounts } = useAppData();
  const [amount, setAmount] = React.useState(goal.monthlyContribution ? String(Number(goal.monthlyContribution)) : "");
  const [date, setDate] = React.useState(todayYmd());
  const [from, setFrom] = React.useState(accounts.find((a) => a.id !== goal.linkedAccountId)?.id ?? "");
  const [pending, start] = React.useTransition();
  const linked = !!goal.linkedAccountId;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add to {goal.name}</DialogTitle>
          <DialogDescription>
            {linked ? `Records a transfer into ${goal.linkedAccountName}. The goal tracks that account's real balance.` : "Records a contribution to this goal. Use a negative amount for a withdrawal."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <Field label={`Amount (${goal.currency})`} htmlFor="gc-amt">
            <Input id="gc-amt" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Date" htmlFor="gc-date">
            <Input id="gc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {linked && (
            <Field label="From account" htmlFor="gc-from">
              <NativeSelect id="gc-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {accounts
                  .filter((a) => a.id !== goal.linkedAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await addContributionAction({ goalId: goal.id, amount, date, fromAccountId: linked ? from : null });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Contribution recorded");
                onClose();
                router.refresh();
              })
            }
          >
            <CalendarCheck /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SimulateDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const f = useFormat();
  const base = Number(goal.monthlyContribution ?? goal.requiredMonthly ?? 0) || Math.max(100, Math.round(Number(goal.remaining) / 12));
  const [monthly, setMonthly] = React.useState(Math.round(base));
  const max = Math.max(Math.round(Number(goal.remaining)), Math.round(base * 3), 1000);
  const p = projectGoal({ saved: goal.saved, target: goal.targetAmount, monthlyContribution: monthly, targetDate: goal.targetDate ? new Date(goal.targetDate) : null });
  const current = projectGoal({ saved: goal.saved, target: goal.targetAmount, monthlyContribution: goal.monthlyContribution, targetDate: goal.targetDate ? new Date(goal.targetDate) : null });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Simulate · {goal.name}</DialogTitle>
          <DialogDescription>Try different monthly amounts. Nothing is saved.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 pb-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label htmlFor="sim" className="text-[13px] font-medium">
                Monthly contribution
              </label>
              <span className="num text-[18px] font-semibold">{f.money(monthly, goal.currency)}</span>
            </div>
            <input id="sim" type="range" min={0} max={max} step={Math.max(1, Math.round(max / 200))} value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </div>
          <div className="rounded-lg bg-surface-2 p-4">
            <StatRow label="Remaining" value={<Money value={goal.remaining} currency={goal.currency} />} />
            <StatRow label="Months to goal" value={p.monthsToGoal === null ? "Add a monthly amount" : p.monthsToGoal} />
            <StatRow label="Projected completion" value={p.projectedDate ? f.date(p.projectedDate, { month: "long", year: "numeric" }) : "—"} />
            {current.projectedDate && p.projectedDate && (
              <StatRow
                label="Versus current plan"
                value={
                  <span className={cn(p.projectedDate < current.projectedDate ? "text-positive" : p.projectedDate > current.projectedDate ? "text-warning" : "")}>
                    {Math.round((current.projectedDate.getTime() - p.projectedDate.getTime()) / (30.44 * 86400000))} months {p.projectedDate <= current.projectedDate ? "sooner" : "later"}
                  </span>
                }
              />
            )}
            {goal.targetDate && <StatRow label="Meets target date?" value={p.onTrack ? <Badge variant="positive">Yes</Badge> : <Badge variant="warning">No</Badge>} />}
          </div>
          <p className="text-meta text-muted-foreground">Estimate only — assumes a constant contribution and no interest or withdrawals.</p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ initial, onDone }: { initial?: Goal; onDone: () => void }) {
  const router = useRouter();
  const f = useFormat();
  const { accounts } = useAppData();
  const [v, setV] = React.useState<GoalFormValues>(
    initial
      ? {
          name: initial.name,
          kind: initial.kind as never,
          icon: initial.icon,
          targetAmount: String(Number(initial.targetAmount)),
          currency: initial.currency,
          manualBalance: String(Number(initial.manualBalance)),
          targetDate: initial.targetDate ? isoToYmd(initial.targetDate, f.timezone) : "",
          linkedAccountId: initial.linkedAccountId,
          monthlyContribution: initial.monthlyContribution ? String(Number(initial.monthlyContribution)) : "",
          priority: initial.priority,
        }
      : { name: "", kind: "EMERGENCY", icon: "shield", targetAmount: "", currency: f.currency, manualBalance: "0", targetDate: "", linkedAccountId: null, monthlyContribution: "", priority: 2 },
  );
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, start] = React.useTransition();
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveGoalAction(initial?.id ?? null, v);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          toast.success("Goal saved");
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Goal type" htmlFor="g-kind">
          <NativeSelect id="g-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as never, icon: KINDS[e.target.value].icon, name: v.name || KINDS[e.target.value].label })}>
            {Object.entries(KINDS).map(([k, x]) => (
              <option key={k} value={k}>
                {x.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Name" htmlFor="g-name" error={errors.name?.[0]}>
          <Input id="g-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. 6-month emergency fund" />
        </Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label="Target amount" htmlFor="g-target" error={errors.targetAmount?.[0]}>
            <Input id="g-target" inputMode="decimal" className="num" value={v.targetAmount} onChange={(e) => setV({ ...v, targetAmount: e.target.value })} />
          </Field>
          <Field label="Currency" htmlFor="g-cur">
            <NativeSelect id="g-cur" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Target date" htmlFor="g-date" optional>
          <Input id="g-date" type="date" value={v.targetDate ?? ""} onChange={(e) => setV({ ...v, targetDate: e.target.value })} />
        </Field>
        <Field label="Linked savings account" htmlFor="g-acct" optional hint="Progress = this account's actual balance">
          <NativeSelect id="g-acct" value={v.linkedAccountId ?? ""} onChange={(e) => setV({ ...v, linkedAccountId: e.target.value || null })}>
            <option value="">None — track manually</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!v.linkedAccountId && (
          <Field label="Already saved" htmlFor="g-man" hint="Starting amount set aside elsewhere">
            <Input id="g-man" inputMode="decimal" className="num" value={v.manualBalance} onChange={(e) => setV({ ...v, manualBalance: e.target.value })} />
          </Field>
        )}
        <Field label="Planned monthly contribution" htmlFor="g-monthly" optional>
          <Input id="g-monthly" inputMode="decimal" className="num" value={v.monthlyContribution ?? ""} onChange={(e) => setV({ ...v, monthlyContribution: e.target.value })} />
        </Field>
        <Field label="Priority" htmlFor="g-prio">
          <NativeSelect id="g-prio" value={String(v.priority)} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })}>
            <option value="1">High</option>
            <option value="2">Medium</option>
            <option value="3">Low</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save goal
        </Button>
      </div>
    </form>
  );
}
