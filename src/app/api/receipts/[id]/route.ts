import { db } from "@/lib/db";
import { getUserOrNull } from "@/lib/session";
import { audit } from "@/lib/audit";
import { deletePrivateFile, getPrivateFile } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  // Ownership check: a receipt id belonging to another user is indistinguishable from a missing one.
  const r = await db.receipt.findFirst({ where: { id, userId: user.id } });
  if (!r) return new Response("Not found", { status: 404 });
  const data = await getPrivateFile(r.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": r.mimeType,
      "Content-Disposition": `inline; filename="${r.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const r = await db.receipt.findFirst({ where: { id, userId: user.id } });
  if (!r) return new Response("Not found", { status: 404 });
  await deletePrivateFile(r.storageKey);
  await db.receipt.delete({ where: { id } });
  await audit(user.id, "receipt.delete", "Receipt", id);
  return Response.json({ ok: true });
}

/** Link an uploaded receipt to a transaction. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { transactionId?: string };
  const [r, t] = await Promise.all([
    db.receipt.findFirst({ where: { id, userId: user.id } }),
    body.transactionId ? db.transaction.findFirst({ where: { id: body.transactionId, userId: user.id } }) : null,
  ]);
  if (!r || !t) return new Response("Not found", { status: 404 });
  await db.receipt.update({ where: { id }, data: { transactionId: t.id } });
  return Response.json({ ok: true });
}
