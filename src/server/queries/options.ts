import { db } from "@/lib/db";
import type { AccountOption, CategoryOption } from "@/lib/dto";

export async function getAccountOptions(userId: string): Promise<AccountOption[]> {
  return db.account.findMany({
    where: { userId, status: "ACTIVE" },
    select: { id: true, name: true, type: true, currency: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function getCategoryOptions(userId: string): Promise<CategoryOption[]> {
  return db.category.findMany({
    where: { userId, archived: false },
    select: { id: true, name: true, kind: true, icon: true, color: true, parentId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
