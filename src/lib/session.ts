import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { UserPreferences } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  prefs: UserPreferences;
}

/** Resolve the signed-in user (cached per request). Redirects to /login if absent. */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const user = await db.user.findUnique({ where: { id }, include: { preferences: true } });
  if (!user) redirect("/login"); // deleted account with a stale token
  const prefs = user.preferences ?? (await db.userPreferences.create({ data: { userId: user.id } }));
  return { id: user.id, email: user.email, name: user.name, prefs };
});

/** For route handlers: returns null instead of redirecting. */
export async function getUserOrNull(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({ where: { id }, include: { preferences: true } });
  if (!user) return null;
  const prefs = user.preferences ?? (await db.userPreferences.create({ data: { userId: user.id } }));
  return { id: user.id, email: user.email, name: user.name, prefs };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
}
