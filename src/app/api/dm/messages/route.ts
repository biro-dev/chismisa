import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

// Polling fallback for direct messages: returns a conversation's messages
// (optionally only those newer than `since`) and marks the conversation read.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkRateLimit(`dm-messages:${session.userId}`, 240);
  if (limited) return limited;

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }
  const since = request.nextUrl.searchParams.get("since");

  // Verify membership
  const member = await db.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId: session.userId,
      },
    },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read receipts: keep lastReadAt fresh while the user is viewing the DM
  await db.conversationMember.updateMany({
    where: { userId: session.userId, conversationId },
    data: { lastReadAt: new Date() },
  });

  const otherMember = await db.conversationMember.findFirst({
    where: { conversationId, userId: { not: session.userId } },
    select: { lastReadAt: true },
  });

  const messages = await db.directMessage.findMany({
    where: {
      conversationId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    include: {
      sender: { select: { id: true, username: true } },
      replyTo: {
        select: {
          id: true,
          content: true,
          sender: { select: { username: true } },
        },
      },
      reactions: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  messages.reverse();

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      content: m.deletedAt ? "" : m.content,
      userId: m.senderId,
      username: m.sender.username,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      // Seen receipt: own messages show ✓✓ when the other member read them
      seenCount:
        m.senderId === session.userId &&
        otherMember?.lastReadAt &&
        new Date(otherMember.lastReadAt) >= m.createdAt
          ? 1
          : 0,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.content,
            username: m.replyTo.sender.username,
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
