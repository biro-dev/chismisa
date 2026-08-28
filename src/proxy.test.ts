import { SignJWT, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

process.env.SESSION_SECRET = "proxy-test-secret";

import { proxy } from "@/proxy";

const SESSION_SECRET = new TextEncoder().encode("proxy-test-secret");
const DAY_MS = 24 * 60 * 60 * 1000;

async function signSession(expiresInSeconds: number): Promise<string> {
  return new SignJWT({ userId: "user_1", username: "chismosa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(SESSION_SECRET);
}

// The proxy only reads the session cookie off the request, so a minimal
// request stub is enough (NextRequest works too, but this avoids any
// environment-specific request-parsing behavior).
function makeRequest(cookie?: string): NextRequest {
  return {
    cookies: { get: () => (cookie ? { name: "session", value: cookie } : undefined) },
  } as unknown as NextRequest;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "proxy-test-secret";
});

describe("proxy sliding session renewal", () => {
  it("does nothing when there is no session cookie", async () => {
    const res = await proxy(makeRequest());
    expect(res.cookies.get("session")).toBeUndefined();
  });

  it("does not renew a fresh session", async () => {
    // 6 days left — well above the halfway (3.5 day) renewal threshold
    const fresh = await signSession(6 * 24 * 60 * 60);
    const res = await proxy(makeRequest(fresh));
    expect(res.cookies.get("session")).toBeUndefined();
  });

  it("renews a session past the halfway point with a fresh 7-day expiry", async () => {
    // 1 hour left — below the renewal threshold
    const stale = await signSession(60 * 60);
    const res = await proxy(makeRequest(stale));

    const renewedCookie = res.cookies.get("session");
    expect(renewedCookie).toBeDefined();
    expect(renewedCookie?.httpOnly).toBe(true);
    expect(renewedCookie?.sameSite).toBe("lax");

    const { payload } = await jwtVerify(renewedCookie!.value, SESSION_SECRET, {
      algorithms: ["HS256"],
    });
    expect(payload.userId).toBe("user_1");
    expect(payload.username).toBe("chismosa");
    const newRemainingMs = (payload.exp as number) * 1000 - Date.now();
    // Renewed to ~7 days (allow some tolerance for test execution time)
    expect(newRemainingMs).toBeGreaterThan(6.9 * DAY_MS);
  });

  it("leaves an invalid session untouched", async () => {
    const res = await proxy(makeRequest("not-a-valid-jwt"));
    expect(res.cookies.get("session")).toBeUndefined();
  });
});