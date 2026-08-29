import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getRatelimit() {
  if (ratelimit) return ratelimit;
  const r = getRedis();
  if (!r) return null;
  ratelimit = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(100, "60 s"),
    analytics: true,
    prefix: "chismisa:ratelimit",
  });
  return ratelimit;
}

const WINDOW_MS = 60_000;
const store = new Map<string, { count: number; resetAt: number }>();

function prune(now: number) {
  if (store.size < 10_000) {
    for (const [key, bucket] of store) {
      if (bucket.resetAt < now) store.delete(key);
    }
  } else {
    store.clear();
  }
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = WINDOW_MS
): Promise<NextResponse | null> {
  const rl = getRatelimit();
  if (rl) {
    return checkRateLimitRedis(rl, key, maxRequests);
  }
  return checkRateLimitMemory(key, maxRequests, windowMs);
}

async function checkRateLimitRedis(
  rl: Ratelimit,
  key: string,
  maxRequests: number
): Promise<NextResponse | null> {
  const { success, limit, remaining, reset } = await rl.limit(key, { rate: maxRequests });
  if (!success) {
    const headers = new Headers();
    headers.set("X-RateLimit-Limit", limit.toString());
    headers.set("X-RateLimit-Remaining", remaining.toString());
    headers.set("X-RateLimit-Reset", Math.ceil(reset / 1000).toString());
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers }
    );
  }
  return null;
}

function checkRateLimitMemory(
  key: string,
  maxRequests: number,
  windowMs: number
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
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429 }
    );
  }
  return null;
}

export function checkRateLimitSync(
  key: string,
  maxRequests: number,
  windowMs: number = WINDOW_MS
): NextResponse | null {
  return checkRateLimitMemory(key, maxRequests, windowMs);
}