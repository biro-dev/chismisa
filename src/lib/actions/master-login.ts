"use server";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  ADMIN_COOKIE,
  verifyAdminSecret,
} from "@/lib/admin-auth";
import {
  ANALYTICS_COOKIE,
  verifyAnalyticsSecret,
} from "@/lib/analytics-auth";

export type MasterLoginResult = {
  error?: string;
  /** Which panel the secret unlocks — kept opaque to the client response. */
  destination?: "admin" | "analytics";
};

/**
 * Unified master-key login. The single secret word unlocks either the full
 * admin panel (ADMIN_SECRET) or the analytics panel (ANALYTICS_SECRET).
 * Which secret matched is never revealed — the client only learns where to
 * route. One shared per-IP rate limit guards both.
 */
export async function loginMasterAction(
  secret: string
): Promise<MasterLoginResult> {
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const limited = await checkRateLimit(`master-login:${ip}`, 5, 60_000);
  if (limited) {
    return { error: "Too many attempts. Please try again in a minute." };
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const cookieBase = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  };

  if (verifyAdminSecret(secret)) {
    cookieStore.set(ADMIN_COOKIE, secret, cookieBase);
    return { destination: "admin" };
  }

  if (verifyAnalyticsSecret(secret)) {
    cookieStore.set(ANALYTICS_COOKIE, secret, cookieBase);
    return { destination: "analytics" };
  }

  return { error: "Invalid master key." };
}