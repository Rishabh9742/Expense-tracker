import { db } from "@/lib/db";
import { ensureDefaultCategories } from "@/server/services/categories";
import type { CurrentUser } from "@/lib/session";

/** Creates an isolated test user with default categories. Callers delete it in afterAll. */
export async function makeUser(label: string, baseCurrency = "INR", timezone = "Asia/Kolkata"): Promise<CurrentUser> {
  const u = await db.user.create({
    data: {
      email: `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@finora.test`,
      name: `IT ${label}`,
      preferences: { create: { baseCurrency, timezone, locale: "en-IN" } },
    },
    include: { preferences: true },
  });
  await ensureDefaultCategories(u.id);
  return { id: u.id, email: u.email, name: u.name, prefs: u.preferences! };
}

export async function cat(userId: string, name: string) {
  return (await db.category.findFirstOrThrow({ where: { userId, name } })).id;
}

export async function cleanup(...users: CurrentUser[]) {
  for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
}

export const dbAvailable = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};
