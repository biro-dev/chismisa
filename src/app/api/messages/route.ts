import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Polling every ~2s plus history loads — allow a generous per-user budget
  const limited = await checkRateLimit(`messages:${session.userId}`, 240);
  if (limited) return limited;

  const groupId = request.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  // Optional: only fetch messages newer than this timestamp (incremental polling)
  const since = request.nextUrl.searchParams.get("since");
  // Optional: fetch messages older than this timestamp (infinite scroll up)
  const before = request.nextUrl.searchParams.get("before");
  // Optional: page size (default 50, max 200) — messages load 50 at a time,
  // with infinite scroll-up (the client fetches older pages on demand)
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

  // Read receipts: mark this group as read for the current user.
  // Polling happens every ~2s while viewing, keeping lastReadAt fresh.
  await db.groupMember.updateMany({
    where: { userId: session.userId, groupId },
    data: { lastReadAt: new Date() },
  });

  // Fetch all members' read states (for computing seen counts)
  const memberReadStates = await db.groupMember.findMany({
    where: { groupId },
    select: { userId: true, lastReadAt: true },
  });

  // Message history limit: purge messages older than 30 days.
  // Runs with ~2% probability per request to avoid overhead on every poll.
  if (Math.random() < 0.02) {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await db.message.deleteMany({
        where: { groupId, createdAt: { lt: cutoff } },
      });
    } catch {
      // ignore purge errors — non-critical
    }
  }

  const messages = await db.message.findMany({
    where: {
      groupId,
      ...(since || before
        ? {
            createdAt: {
              ...(since ? { gt: new Date(since) } : {}),
              ...(before ? { lt: new Date(before) } : {}),
            },
          }
        : {}),
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
      // Deleted messages show a placeholder instead of their content
      content: m.deletedAt ? "" : m.content,
      userId: m.userId,
      // Show the message author's username so other members can see who
      // sent each message. Anonymous/pseudonymous identity is the sender's
      // chosen username in this group.
      username: m.user.username,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      // Seen count: how many OTHER members have read up to this message
      seenCount:
        m.userId === session.userId
          ? memberReadStates.filter(
              (ms) =>
                ms.userId !== m.userId &&
                ms.lastReadAt !== null &&
                new Date(ms.lastReadAt) >= m.createdAt
            ).length
          : 0,
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