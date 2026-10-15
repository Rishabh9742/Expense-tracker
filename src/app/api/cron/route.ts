import { timingSafeEqual } from "node:crypto";
import { runAllJobs } from "@/server/services/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** For external schedulers (Vercel Cron, GitHub Actions, cron + curl). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret ?? "");
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Unauthorized", { status: 401 });
  const result = await runAllJobs("cron-endpoint");
  return Response.json(result);
}

export const GET = POST;
