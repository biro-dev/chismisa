import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkRateLimit(`devices:${session.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json();
    const action: "register" | "unregister" = body.action;
    const token: string = body.token?.trim();
    const platform: string = body.platform || "android";

    if (!action || !token) {
      return NextResponse.json({ error: "Missing action or token" }, { status: 400 });
    }

    if (action === "register") {
      // upsert so re-registering just refreshes the platform/updatedAt
      await db.deviceToken.upsert({
        where: { token },
        update: { userId: session.userId, platform },
        create: { token, userId: session.userId, platform },
      });
    } else if (action === "unregister") {
      await db.deviceToken.deleteMany({ where: { token, userId: session.userId } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Device token error:", err);
    return NextResponse.json({ error: "Something went wrong updating device token." }, { status: 500 });
  }
}
