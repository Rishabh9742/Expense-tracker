import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_CATEGORIES } from "@/lib/categories-default";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function ensureDefaultCategories(userId: string, client: Tx = db) {
  const existing = await client.category.count({ where: { userId } });
  if (existing > 0) return;
  let order = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const parent = await client.category.create({
      data: { userId, name: c.name, kind: c.kind, icon: c.icon, color: c.color, isEssential: !!c.essential, isSystem: true, sortOrder: order++ },
    });
    for (const child of c.children ?? []) {
      await client.category.create({
        data: { userId, name: child.name, kind: c.kind, icon: child.icon, color: c.color, isEssential: !!c.essential, parentId: parent.id, isSystem: true, sortOrder: order++ },
      });
    }
  }
}

/** All descendant ids including the category itself. */
export async function categoryWithDescendants(userId: string, categoryId: string): Promise<string[]> {
  const all = await db.category.findMany({ where: { userId }, select: { id: true, parentId: true } });
  const out = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
      out.add(c.id);
      grew = true;
    }
  }
  return [...out];
}
