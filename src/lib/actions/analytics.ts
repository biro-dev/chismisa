"use server";

import { db } from "@/lib/db";
import {
  ANALYTICS_COOKIE,
  verifyAnalyticsSecret,
} from "@/lib/analytics-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const ONLINE_WINDOW_MS = 60_000; // active in the last 1 minute

/**
 * Set the analytics cookie for an analytics secret. Used on panel mount to
 * re-verify the secret stored in sessionStorage (covers new-tab sessions).
 */
export async function loginAnalyticsAction(secret: string) {
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await checkRateLimit(`analytics-login:${ip}`, 5, 60_000);
  if (limited) {
    return { error: "Too many attempts. Please try again in a minute." };
  }
  if (!verifyAnalyticsSecret(secret)) {
    return { error: "Invalid master key." };
  }
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.set(ANALYTICS_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });
  return { success: true };
}

/** Clear the analytics cookie (log out of the analytics panel). */
export async function logoutAnalyticsAction() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete(ANALYTICS_COOKIE);
  return { success: true };
}

/**
 * Read-only analytics for the analytics panel. Returns null when the
 * provided secret isn't the analytics master key.
 */
export async function getAnalyticsStats(secret: string) {
  if (!verifyAnalyticsSecret(secret)) return null;

  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - ONLINE_WINDOW_MS);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

  const [
    userCount,
    onlineUsers,
    groupCount,
    messageCount,
    dmCount,
    groupReactionCount,
    dmReactionCount,
    topGroups,
    recentSignups,
    todayNewUsers,
    todayMessages,
    todayGroups,
    weekNewUsers,
    weekMessages,
    weekGroups,
    monthNewUsers,
    monthMessages,
    monthGroups,
  ] = await Promise.all([
    db.user.count(),
    db.user.findMany({
      where: { lastActiveAt: { gte: oneMinuteAgo } },
      select: { id: true, username: true, lastActiveAt: true },
      orderBy: { lastActiveAt: "desc" },
    }),
    db.group.count(),
    db.message.count(),
    db.directMessage.count(),
    db.messageReaction.count(),
    db.directMessageReaction.count(),
    db.group.findMany({
      include: {
        _count: { select: { members: true, messages: true } },
      },
      orderBy: { messages: { _count: "desc" } },
      take: 5,
    }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, username: true, createdAt: true },
    }),
    db.user.count({ where: { createdAt: { gte: startOfToday } } }),
    db.message.count({ where: { createdAt: { gte: startOfToday } } }),
    db.group.count({ where: { createdAt: { gte: startOfToday } } }),
    db.user.count({ where: { createdAt: { gte: startOfWeek } } }),
    db.message.count({ where: { createdAt: { gte: startOfWeek } } }),
    db.group.count({ where: { createdAt: { gte: startOfWeek } } }),
    db.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    db.message.count({ where: { createdAt: { gte: startOfMonth } } }),
    db.group.count({ where: { createdAt: { gte: startOfMonth } } }),
  ]);

  return {
    userCount,
    onlineNow: onlineUsers.map((u) => ({
      id: u.id,
      username: u.username,
      lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
    })),
    groupCount,
    totalActivity:
      messageCount + dmCount + groupReactionCount + dmReactionCount,
    messageCount,
    dmCount,
    periods: {
      today: { newUsers: todayNewUsers, messages: todayMessages, groups: todayGroups },
      week: { newUsers: weekNewUsers, messages: weekMessages, groups: weekGroups },
      month: { newUsers: monthNewUsers, messages: monthMessages, groups: monthGroups },
    },
    topGroups: topGroups.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g._count.members,
      messageCount: g._count.messages,
    })),
    recentSignups: recentSignups.map((u) => ({
      id: u.id,
      username: u.username,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}