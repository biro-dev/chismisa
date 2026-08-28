import { describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

// The dev fallback secret from lib/session.ts (used when SESSION_SECRET is
// unset outside production). Vitest runs with NODE_ENV=test, so this applies.
const DEV_SECRET = "chismisa-dev-secret";

describe("session (lib/session.ts)", () => {
  it("round-trips a payload through encrypt/decrypt", async () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-for-roundtrip");
    const { encrypt, decrypt } = await import("@/lib/session");

    const token = await encrypt({
      userId: "user_123",
      username: "chismosa",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(token).toBeTruthy();

    const payload = await decrypt(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user_123");
    expect(payload!.username).toBe("chismosa");
    expect(payload!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    vi.unstubAllEnvs();
  });

  it("returns null for an expired token", async () => {
    vi.stubEnv("SESSION_SECRET", DEV_SECRET);
    const { decrypt } = await import("@/lib/session");

    const key = new TextEncoder().encode(DEV_SECRET);
    const expired = await new SignJWT({ userId: "u1", username: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 100)
      .sign(key);

    expect(await decrypt(expired)).toBeNull();

    vi.unstubAllEnvs();
  });

  it("returns null for a garbage token", async () => {
    vi.stubEnv("SESSION_SECRET", DEV_SECRET);
    const { decrypt } = await import("@/lib/session");

    expect(await decrypt("not-a-jwt")).toBeNull();
    expect(await decrypt("")).toBeNull();
    expect(await decrypt(undefined)).toBeNull();

    vi.unstubAllEnvs();
  });

  it("returns null for a token signed with a different secret", async () => {
    vi.stubEnv("SESSION_SECRET", "expected-secret");
    const { decrypt } = await import("@/lib/session");

    const otherKey = new TextEncoder().encode("attacker-secret");
    const forged = await new SignJWT({ userId: "u1", username: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(otherKey);

    expect(await decrypt(forged)).toBeNull();

    vi.unstubAllEnvs();
  });

  it("throws at import time in production without SESSION_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");

    vi.resetModules();
    await expect(import("@/lib/session")).rejects.toThrow(
      "SESSION_SECRET environment variable is required in production."
    );

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});