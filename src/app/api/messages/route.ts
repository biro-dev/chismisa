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
    take: 200,
  });
  // Reverse to display in chronological order (oldest → newest)
  messages.reverse();

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      content: m.content,
      userId: m.userId,
      username: m.user.username,
      createdAt: m.createdAt.toISOString(),
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.content,
            username: m.replyTo.user.username,
          }
        : null,
      reactions: m.reactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        userId: r.userId,
        username: r.user.username,
      })),
    }))
  );
}