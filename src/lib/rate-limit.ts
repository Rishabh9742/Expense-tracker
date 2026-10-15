// Fixed-window in-memory rate limiter. Sufficient for a single instance; for
// multi-instance deployments swap the store for Redis/Upstash (see DEPLOYMENT.md).
const buckets = new Map<string, { count: number; reset: number }>();

// RATE_LIMIT_SCALE multiplies every limit (e.g. raised for automated test runs). Defaults to 1.
const SCALE = Math.max(1, Number(process.env.RATE_LIMIT_SCALE ?? 1) || 1);

export function rateLimit(key: string, baseLimit: number, windowMs: number): { ok: boolean; remaining: number; resetIn: number } {
  const limit = baseLimit * SCALE;
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1, resetIn: windowMs };
  }
  b.count++;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetIn: b.reset - now };
}

export function resetRateLimits() {
  buckets.clear();
}
