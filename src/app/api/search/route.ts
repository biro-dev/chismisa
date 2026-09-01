import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

// Search messages within a group the user is a member of.
// Uses case-insensitive substring matching (ILIKE) — simple and index-free;
// can be upgraded to Postgres full-text search (tsvector) later if needed.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkRateLimit(`search:${session.userId}`, 30);
  if (limited) return limited;

  const groupId = request.nextUrl.searchParams.get("groupId");
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  // Require a minimum query length to avoid near-full-table scans, and cap
  // the length to keep the ILIKE pattern small.
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: "Query must be 2-100 characters" }, { status: 400 });
  }

  // Verify membership
  const member = await db.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: session.userId,
        groupId,
      },
    },
    select: { id: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch all members' read states (for computing seen counts)
  const memberReadStates = await db.groupMember.findMany({
    where: { groupId },
    select: { userId: true, lastReadAt: true },
  });

  const messages = await db.message.findMany({
    where: {
      groupId,
      deletedAt: null,
      content: { contains: query, mode: "insensitive" },
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
    take: 30,
  });

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      content: m.content,
      userId: m.userId,
      username: m.user.username,
      deletedAt: null,
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
