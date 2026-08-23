import { NextResponse } from "next/server";

// Best-effort, in-memory sliding-window rate limiter.
//
// NOTE: On serverless platforms (e.g. Vercel) each warm container holds its
// own in-memory map, so this is NOT a global limit across instances — it
// deters abusive bursts rather than enforcing a hard distributed cap. For a
// production-grade limiter that spans instances, swap in Upstash Redis or
// Vercel's built-in edge rate limiting.

const WINDOW_MS = 60_000;

// bucket key -> { count, resetAt }
const store = new Map<string, { count: number; resetAt: number }>();

function prune(now: number) {
  if (store.size < 10_000) {
    for (const [key, bucket] of store) {
      if (bucket.resetAt < now) store.delete(key);
    }
  } else {
    store.clear(); // grew unexpectedly — reset to avoid leaking memory
  }
}

/**
 * Returns a 429 NextResponse if the caller exceeded `maxRequests` within the
 * window, otherwise `null` (the request may proceed).
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = WINDOW_MS
): NextResponse | null {
  const now = Date.now();
  prune(now);

  const bucket = store.get(key);
  if (!bucket || bucket.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > maxRequests) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  return null;
}