import { db } from "@/lib/db";
import { processRecurring, runUserJobs } from "./jobs";

/**
 * One full scheduler pass. Job state lives in the database (next dates, unique
 * occurrence keys, notification dedupe keys), so passes are idempotent and safe to
 * resume after a crash or restart. Each run is recorded in JobRun.
 */
export async function runAllJobs(trigger: string) {
  const run = await db.jobRun.create({ data: { name: `scheduler:${trigger}` } });
  const errors: string[] = [];
  let users = 0;
  try {
    await processRecurring(); // all users, due schedules only
    const ids = await db.user.findMany({ select: { id: true } });
    for (const { id } of ids) {
      try {
        await runUserJobs(id);
        users++;
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
      }
    }
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: errors.length === 0, detail: { users, errors: errors.slice(0, 20) } } });
  } catch (e) {
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, detail: { error: (e as Error).message } } });
    throw e;
  }
  // Keep the job log small.
  await db.jobRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
  return { users, errors: errors.length };
}
