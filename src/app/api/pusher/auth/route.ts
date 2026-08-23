import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getPusherServer } from "@/lib/pusher";
import { checkRateLimit } from "@/lib/rate-limit";

// Pusher auth endpoint for private + presence channels.
// Verifies the user is logged in AND a member of the requested group.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = checkRateLimit(`pusher-auth:${session.userId}`, 60);
  if (limited) return limited;

  const pusher = getPusherServer();
  if (!pusher) {
    return NextResponse.json({ error: "Real-time not configured" }, { status: 503 });
  }

  try {
    // pusher-js sends channel authorization as `application/x-www-form-urlencoded`
    // (socket_id + channel_name), but some clients may POST JSON. Parse both.
    const raw = await request.text();
    let channel: string | undefined;
    let socketId: string | undefined;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = JSON.parse(raw || "{}");
      channel = body.channel_name;
      socketId = body.socket_id;
    } else {
      const params = new URLSearchParams(raw || "");
      channel = params.get("channel_name") || undefined;
      socketId = params.get("socket_id") || undefined;
    }

    if (!channel || !socketId) {
      return NextResponse.json({ error: "Missing channel_name or socket_id" }, { status: 400 });
    }

    // Only allow subscription to channels for groups the user is a member of.
    // Channel format: private-group-{groupId} or presence-group-{groupId}
    const privateMatch = channel.match(/^private-group-(.+)$/);
    const presenceMatch = channel.match(/^presence-group-(.+)$/);

    const groupId = (privateMatch || presenceMatch)?.[1];
    if (!groupId) {
      return NextResponse.json({ error: "Invalid channel name" }, { status: 400 });
    }

    const isMember = await db.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: session.userId,
          groupId,
        },
      },
      select: { id: true },
    });

    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // For presence channels, Pusher needs a unique user ID and optional user_info.
    let presenceData: { user_id: string; user_info?: Record<string, unknown> } | undefined;
    if (presenceMatch) {
      presenceData = {
        user_id: session.userId,
        user_info: { username: session.username },
      };
    }

    const auth = pusher.authorizeChannel(socketId, channel, presenceData);
    return NextResponse.json(auth);
  } catch (err) {
    console.error("Pusher auth error:", err);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}
      