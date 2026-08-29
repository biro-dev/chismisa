import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Polled every ~30s from the dashboard for unread badges.
  const limited = await checkRateLimit(`groups:${session.userId}`, 120);
  if (limited) return limited;

  const memberships = await db.groupMember.findMany({
    where: { userId: session.userId },
    include: {
      group: {
        include: {
          _count: {
            select: { members: true, messages: true },
          },
        },
      },
    },
    orderBy: {
      joinedAt: "desc",
    },
  });

  // Unread = messages in the group newer than this member's lastReadAt.
  const unreadByGroup = new Map<string, number>();
  for (const m of memberships) {
    const unread = await db.message.count({
      where: {
        groupId: m.groupId,
        createdAt: { gt: m.lastReadAt ?? new Date(0) },
      },
    });
    unreadByGroup.set(m.groupId, unread);
  }

  return NextResponse.json(
    memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      // Never expose the invite code to non-owners.
      code: m.group.ownerId === session.userId ? m.group.code : "",
      isOwner: m.group.ownerId === session.userId,
      memberCount: m.group._count.members,
      messageCount: m.group._count.messages,
      unreadCount: unreadByGroup.get(m.group.id) ?? 0,
    }))
  );
}