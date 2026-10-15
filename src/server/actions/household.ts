"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/lib/utils";

/**
 * Optional household sharing — off by default. Members only ever see accounts an
 * owner explicitly shares with the household; everything else stays private.
 */

export async function createHouseholdAction(name: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const n = z.string().trim().min(1).max(60).safeParse(name);
  if (!n.success) return { ok: false, error: "Name your household" };
  const existing = await db.householdMember.findFirst({ where: { userId: user.id } });
  if (existing) return { ok: false, error: "You're already in a household" };
  const h = await db.household.create({ data: { name: n.data, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } } });
  await audit(user.id, "household.create", "Household", h.id);
  revalidatePath("/settings");
  return { ok: true, data: { id: h.id } };
}

async function ownerHousehold(userId: string) {
  return db.household.findFirst({ where: { ownerId: userId } });
}

export async function addHouseholdMemberAction(email: string, role: "EDITOR" | "VIEWER"): Promise<ActionResult> {
  const user = await requireUser();
  const h = await ownerHousehold(user.id);
  if (!h) return { ok: false, error: "Only the household owner can add members" };
  const e = z.string().trim().toLowerCase().email().safeParse(email);
  if (!e.success) return { ok: false, error: "Enter a valid email" };
  const target = await db.user.findUnique({ where: { email: e.data } });
  // Same message whether or not the email exists, to avoid revealing registered users.
  if (!target || target.id === user.id) return { ok: false, error: "That person needs a Finora account first. Ask them to sign up, then add them." };
  if (await db.householdMember.findFirst({ where: { userId: target.id } })) return { ok: false, error: "That person needs a Finora account first. Ask them to sign up, then add them." };
  await db.householdMember.create({ data: { householdId: h.id, userId: target.id, role: role === "EDITOR" ? "EDITOR" : "VIEWER" } });
  await audit(user.id, "household.member_add", "Household", h.id, { after: { memberId: target.id, role } });
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeHouseholdMemberAction(memberId: string): Promise<ActionResult> {
  const user = await requireUser();
  const m = await db.householdMember.findFirst({ where: { id: memberId }, include: { household: true } });
  if (!m) return { ok: false, error: "Member not found" };
  const isOwner = m.household.ownerId === user.id;
  if (!isOwner && m.userId !== user.id) return { ok: false, error: "Not allowed" };
  if (m.role === "OWNER") {
    // Owner leaving dissolves the household; shared accounts become private again.
    await db.account.updateMany({ where: { householdId: m.householdId }, data: { householdId: null } });
    await db.household.delete({ where: { id: m.householdId } });
  } else {
    await db.account.updateMany({ where: { householdId: m.householdId, userId: m.userId }, data: { householdId: null } });
    await db.householdMember.delete({ where: { id: memberId } });
  }
  await audit(user.id, "household.member_remove", "Household", m.householdId, { after: { memberId } });
  revalidatePath("/settings");
  return { ok: true };
}

export async function shareAccountAction(accountId: string, share: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const membership = await db.householdMember.findFirst({ where: { userId: user.id } });
  if (!membership) return { ok: false, error: "Join or create a household first" };
  if (membership.role === "VIEWER") return { ok: false, error: "Viewers can't share accounts" };
  const r = await db.account.updateMany({ where: { id: accountId, userId: user.id }, data: { householdId: share ? membership.householdId : null } });
  if (!r.count) return { ok: false, error: "Account not found" };
  await audit(user.id, share ? "household.account_share" : "household.account_unshare", "Account", accountId);
  revalidatePath("/settings");
  return { ok: true };
}
