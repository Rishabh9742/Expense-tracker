import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { rateLimit } from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}
class AccountLocked extends CredentialsSignin {
  code = "locked";
}

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

// Constant-time-ish path for unknown emails so response timing doesn't reveal accounts.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5Ld9U8b7Yk5sZfWb2oUj8ZQ3t8G8u3e";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
        if (!rateLimit(`login:${ip}`, 20, 15 * 60_000).ok || !rateLimit(`login:${email}`, 10, 15 * 60_000).ok) {
          throw new TooManyAttempts();
        }
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) throw new AccountLocked();
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const failed = user.failedLogins + 1;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLogins: failed >= MAX_FAILED ? 0 : failed,
              lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
            },
          });
          return null;
        }
        if (user.failedLogins > 0 || user.lockedUntil) {
          await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
        }
        await db.auditLog.create({ data: { userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ip } });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Include at least one letter and one number");
