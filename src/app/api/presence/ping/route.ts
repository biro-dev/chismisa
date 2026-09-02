import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Presence heartbeat. The dashboard pings this on mount, every 30s while the
 * tab is visible, and whenever the tab returns to the foreground. It updates
 * the user's lastActiveAt, which the analytics panel uses to compute the
 * "Online Now" count (active in the last minute).
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkRateLimit(`presence-ping:${session.userId}`, 60);
  if (limited) return limited;

  try {
    await db.user.update({
      where: { id: session.userId },
      data: { lastActiveAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Presence ping error:", err);
    return NextResponse.json({ error: "Failed to update presence" }, { status: 500 });
  }
}