/**
 * In-memory IP rate limiter. Best-effort — on serverless platforms each
 * runtime instance has its own Map, so the effective limit is per-instance.
 * Good enough as a first line of defense; pair with a DB-backed limiter if
 * abuse becomes a real problem.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/**
 * Returns true if the request is allowed (under the limit), false if it
 * should be rejected. Increments the counter as a side-effect on allow.
 */
export function checkRateLimit(
  key: string,
  maxPerWindow: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now > existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= maxPerWindow) return false
  existing.count++
  return true
}

/** For tests. Resets all buckets. */
export function _resetRateLimitForTests(): void {
  buckets.clear()
}
