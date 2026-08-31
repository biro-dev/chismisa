import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "admin_secret";

/**
 * Timing-safe comparison of a provided secret against ADMIN_SECRET.
 * Shared by the admin server actions and the admin page gate so the
 * verification logic lives in exactly one place.
 */
export function verifyAdminSecret(secret: string): boolean {
  const masterSecret = process.env.ADMIN_SECRET;
  if (!masterSecret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(masterSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether the current request carries a valid admin cookie. Used by the
 * /chismis-admin server component to decide between the login form and the
 * panel. (Deliberately NOT exported from the "use server" module, so it
 * doesn't become a callable server action.)
 */
export async function isAdminCookieValid(): Promise<boolean> {
  const cookieStore = await cookies();
  const secret = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!secret) return false;
  return verifyAdminSecret(secret);
}
