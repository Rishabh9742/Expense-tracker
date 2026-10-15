"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, passwordSchema, signIn, signOut } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/session";
import { ensureDefaultCategories } from "@/server/services/categories";
import { SUPPORTED_CURRENCIES } from "@/lib/money";

export type AuthState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password: passwordSchema,
  baseCurrency: z.enum(SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]]),
  timezone: z.string().max(64).optional(),
});

function validTz(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  const ip = await clientIp();
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000).ok) return { error: "Too many sign-up attempts. Try again later." };
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const { name, email, password, baseCurrency, timezone } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { fieldErrors: { email: "An account with this email already exists" } };
  const locale = baseCurrency === "INR" ? "en-IN" : baseCurrency === "GBP" ? "en-GB" : baseCurrency === "EUR" ? "en-IE" : "en-US";
  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      preferences: { create: { baseCurrency, timezone: validTz(timezone), locale } },
    },
  });
  await ensureDefaultCategories(user.id);
  await db.auditLog.create({ data: { userId: user.id, action: "auth.register", entityType: "User", entityId: user.id, ip } });
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Account created, but sign-in failed. Please log in." };
    throw e;
  }
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  try {
    await signIn("credentials", { email, password, redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/" });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      if (code === "rate_limited") return { error: "Too many attempts. Wait a few minutes and try again." };
      if (code === "locked") return { error: "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes." };
      return { error: "Incorrect email or password." };
    }
    throw e;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
