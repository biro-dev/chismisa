import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupId = request.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  // Optional: only fetch messages newer than this timestamp (incremental polling)
  const since = request.nextUrl.searchParams.get("since");
  // Optional: fetch messages older than this timestamp (infinite scroll up)
  const before = request.nextUrl.searchParams.get("before");
  // Optional: page size (default 50, max 200)
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(limitParam || "50", 10) || 50, 1),
    200
  );

  // Verify membership
  const member = await db.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: session.userId,
        groupId,
      },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await db.message.findMany({
    where: {
      groupId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: {
      user: {
        select: { id: true, username: true },
      },
      replyTo: {
        select: {
          id: true,
          content: true,
          user: {
            select: { username: true },
          },
        },
      },
      reactions: {
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  // Reverse to display in chronological order (oldest → newest)
  messages.reverse();

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      content: m.content,
      userId: m.userId,
      // Anonymous chat: only the sender sees their own username; everyone
      // else sees "Anonymous". The admin panel uses a separate action that
      // still exposes real usernames.
      username: m.userId === session.userId ? m.user.username : "Anonymous",
      createdAt: m.createdAt.toISOString(),
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.content,
            username: "Anonymous",
          }
        : null,
      reactions: m.reactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        userId: r.userId,
        username: "Anonymous",
      })),
    }))
  );
}