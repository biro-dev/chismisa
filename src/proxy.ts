import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { getEncodedSessionKey } from "@/lib/session-secret";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Renew when less than half the lifetime remains, so active users never hit
// an unexpected logout while inactive users' sessions still expire.
const RENEW_THRESHOLD_MS = SESSION_MAX_AGE_MS / 2;

/**
 * Sliding session renewal: verifies the session cookie on every matched
 * request and re-issues it (fresh 7-day expiry) once it is past the halfway
 * point. Runs in the Edge runtime, so the signing logic is duplicated here
 * via the shared secret module instead of importing `session.ts` (which uses
 * `next/headers`).
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return response;

  try {
    const { payload } = await jwtVerify(session, getEncodedSessionKey(), {
      algorithms: ["HS256"],
    });
    const expiresAtMs = (payload.exp as number) * 1000;
    const remaining = expiresAtMs - Date.now();
    if (remaining > 0 && remaining < RENEW_THRESHOLD_MS) {
      const renewed = await new SignJWT({
        userId: payload.userId as string,
        username: payload.username as string,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(getEncodedSessionKey());

      response.cookies.set(SESSION_COOKIE, renewed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        expires: new Date(Date.now() + SESSION_MAX_AGE_MS),
        sameSite: "lax",
        path: "/",
      });
    }
  } catch {
    // Invalid/expired session — leave the response untouched; the app-level
    // auth checks handle unauthenticated visitors.
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and public static files
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|firebase-messaging-sw.js|icon-).*)",
  ],
};