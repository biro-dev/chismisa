import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimitSync } from "@/lib/rate-limit-redis";

// NOTE: the module-level `store` Map is shared across tests in this file, so
// every test uses a unique bucket key prefix to stay independent.
let n = 0;
function uniqueKey() {
  return `test-${++n}`;
}

describe("checkRateLimitSync (in-memory fallback)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests under the limit", () => {
    const key = uniqueKey();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimitSync(key, 5)).toBeNull();
    }
  });

  it("returns a 429 response once the limit is exceeded", async () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimitSync(key, 3)).toBeNull();
    }
    const limited = checkRateLimitSync(key, 3);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);

    const body = (await limited!.json()) as { error?: string };
    expect(body.error).toBe("Too many requests.");
  });

  it("resets the bucket after the window elapses", () => {
    const key = uniqueKey();
    for (let i = 0; i < 2; i++) {
      expect(checkRateLimitSync(key, 2)).toBeNull();
    }
    expect(checkRateLimitSync(key, 2)).not.toBeNull();

    // Advance past the default 60s window
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimitSync(key, 2)).toBeNull();
  });

  it("honours a custom window size", () => {
    const key = uniqueKey();
    expect(checkRateLimitSync(key, 1, 10_000)).toBeNull();
    expect(checkRateLimitSync(key, 1, 10_000)).not.toBeNull();

    // Custom window is 10s — 5s later the bucket is still exhausted
    vi.advanceTimersByTime(5_000);
    expect(checkRateLimitSync(key, 1, 10_000)).not.toBeNull();

    // ...but 11s later it has reset
    vi.advanceTimersByTime(6_000);
    expect(checkRateLimitSync(key, 1, 10_000)).toBeNull();
  });

  it("tracks keys independently", () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();
    expect(checkRateLimitSync(keyA, 1)).toBeNull();
    expect(checkRateLimitSync(keyA, 1)).not.toBeNull();
    // Key B is unaffected by key A's exhausted bucket
    expect(checkRateLimitSync(keyB, 1)).toBeNull();
  });

  it("restarts the window when a new request arrives after reset", () => {
    const key = uniqueKey();
    expect(checkRateLimitSync(key, 1, 30_000)).toBeNull();
    vi.advanceTimersByTime(31_000);
    expect(checkRateLimitSync(key, 1, 30_000)).toBeNull();

    // The new window started at the reset time, not the original one
    vi.advanceTimersByTime(29_000);
    expect(checkRateLimitSync(key, 1, 30_000)).not.toBeNull();
  });
});