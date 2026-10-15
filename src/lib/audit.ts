import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient | PrismaClient;

/** JSON-safe snapshot (Decimal/Date → string). */
export function snapshot<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function audit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  data: { before?: unknown; after?: unknown; ip?: string } = {},
  client: Tx = db,
) {
  await client.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      before: data.before === undefined ? undefined : snapshot(data.before),
      after: data.after === undefined ? undefined : snapshot(data.after),
      ip: data.ip,
    },
  });
}
