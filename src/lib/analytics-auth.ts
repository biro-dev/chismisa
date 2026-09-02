import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ANALYTICS_COOKIE = "analytics_secret";

/**
 * Timing-safe comparison of a provided secret against ANALYTICS_SECRET.
 * Shared by the analytics server actions and the analytics page gate.
 */
export function verifyAnalyticsSecret(secret: string): boolean {
  const masterSecret = process.env.ANALYTICS_SECRET;
  if (!masterSecret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(masterSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether the current request carries a valid analytics cookie. Used by the
 * /chismis-analytics server component to decide between the panel and a
 * redirect to the unified /admin login.
 */
export async function isAnalyticsCookieValid(): Promise<boolean> {
  const cookieStore = await cookies();
  const secret = cookieStore.get(ANALYTICS_COOKIE)?.value;
  if (!secret) return false;
  return verifyAnalyticsSecret(secret);
}