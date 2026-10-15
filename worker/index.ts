/**
 * Finora background worker.
 *
 *   npm run worker        # runs a pass every WORKER_INTERVAL_MINUTES (default 15)
 *   npm run worker:once   # single pass, then exit (for cron / scheduled tasks)
 *
 * All scheduling state is persisted in PostgreSQL (recurring next dates with unique
 * occurrence keys, notification dedupe keys, JobRun records), so the worker can be
 * stopped, restarted or run concurrently with the /api/cron endpoint without creating
 * duplicate transactions or notifications.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { runAllJobs } from "../src/server/services/worker";

const once = process.argv.includes("--once");
const intervalMs = Math.max(1, Number(process.env.WORKER_INTERVAL_MINUTES ?? 15)) * 60_000;
let stopping = false;
let timer: NodeJS.Timeout | null = null;

async function pass() {
  const started = Date.now();
  try {
    const r = await runAllJobs("worker");
    console.log(`[worker] pass ok · ${r.users} users · ${r.errors} errors · ${Date.now() - started}ms`);
  } catch (e) {
    console.error("[worker] pass failed", e);
  }
}

async function main() {
  console.log(`[worker] starting${once ? " (single pass)" : ` · every ${intervalMs / 60_000} min`}`);
  await pass();
  if (once) return shutdown(0);
  const loop = async () => {
    if (stopping) return;
    await pass();
    if (!stopping) timer = setTimeout(loop, intervalMs);
  };
  timer = setTimeout(loop, intervalMs);
}

async function shutdown(code: number) {
  stopping = true;
  if (timer) clearTimeout(timer);
  await db.$disconnect();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
main().catch(async (e) => {
  console.error(e);
  await shutdown(1);
});
