"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `CHISMIS-${code}`;
}

export type GroupActionResult = {
  error?: string;
  success?: boolean;
  groupId?: string;
};

export async function createGroupAction(
  _prevState: GroupActionResult | undefined,
  formData: FormData
): Promise<GroupActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 1 || name.length > 50) {
    return { error: "Group name must be between 1 and 50 characters." };
  }

  try {
    // Generate a unique invite code
    let code = generateInviteCode();
    let existing = await db.group.findUnique({ where: { code } });
    while (existing) {
      code = generateInviteCode();
      existing = await db.group.findUnique({ where: { code } });
    }

    const group = await db.group.create({
      data: {
        name,
        code,
        ownerId: session.userId,
        members: {
          create: {
            userId: session.userId,
          },
        },
      },
    });

    revalidatePath("/");
    return { success: true, groupId: group.id };
  } catch (err) {
    console.error("Create group error:", err);
    return { error: "Failed to create group." };
  }
}

export async function joinGroupAction(
  _prevState: GroupActionResult | undefined,
  formData: FormData
): Promise<GroupActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const code = (formData.get("code") as string)?.trim().toUpperCase();
  if (!code) {
    return { error: "Please enter an invite code." };
  }

  try {
    const group = await db.group.findUnique({ where: { code } });
    if (!group) {
      return { error: "Invalid invite code. Group not found." };
    }

    // Check if already a member
    const existingMember = await db.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: session.userId,
          groupId: group.id,
        },
      },
    });

    if (!existingMember) {
      await db.groupMember.create({
        data: {
          userId: session.userId,
          groupId: group.id,
        },
      });
    }

    revalidatePath("/");
    return { success: true, groupId: group.id };
  } catch (err) {
    console.error("Join group error:", err);
    return { error: "Failed to join group." };
  }
}

export async function leaveGroupAction(groupId: string): Promise<GroupActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  try {
    const group = await db.group.findUnique({ where: { id: groupId } });
    if (!group) return { error: "Group not found." };

    // Owners can't leave — they must delete the group instead
    if (group.ownerId === session.userId) {
      return { error: "You own this group. Use Delete instead." };
    }

    // Verify membership
    const member = await db.groupMember.findUnique({
      where: {
        userId_groupId: { userId: session.userId, groupId },
      },
    });
    if (!member) return { error: "You are not a member of this group." };

    await db.groupMember.delete({ where: { id: member.id } });

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Leave group error:", err);
    return { error: "Failed to leave group." };
  }
}

export async function deleteGroupAction(groupId: string): Promise<GroupActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  try {
    const group = await db.group.findUnique({ where: { id: groupId } });
    if (!group) return { error: "Group not found." };

    // Only the owner can delete
    if (group.ownerId !== session.userId) {
      return { error: "Only the group owner can delete this group." };
    }

    // Cascade deletes members, messages, and reactions via FK constraints
    await db.group.delete({ where: { id: groupId } });

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Delete group error:", err);
    return { error: "Failed to delete group." };
  }
}

export async function getUserGroups() {
  const session = await getSession();
  if (!session) return [];

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
  // Prisma can't express a per-row date filter in a grouped count, so do one
  // cheap count per membership (each is indexed on groupId + createdAt).
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

  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    // Don't expose the invite code to non-owners via the RSC payload.
    code: m.group.ownerId === session.userId ? m.group.code : "",
    isOwner: m.group.ownerId === session.userId,
    memberCount: m.group._count.members,
    messageCount: m.group._count.messages,
    unreadCount: unreadByGroup.get(m.group.id) ?? 0,
  }));
}

export async function getGroupDetails(groupId: string) {
  const session = await getSession();
  if (!session) return null;

  const group = await db.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
      },
    },
  });

  if (!group) return null;

  // Check if user is a member
  const isMember = group.members.some((m) => m.userId === session.userId);
  if (!isMember) return null;

  const isOwner = group.ownerId === session.userId;

  return {
    id: group.id,
    name: group.name,
    // Only expose the invite code to the group owner. Non-owners
    // shouldn't be able to extract it from the RSC payload.
    code: isOwner ? group.code : "",
    isOwner,
    memberCount: group.members.length,
    members: group.members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
    })),
  };
}

// ─── Unified sidebar ──────────────────────────────────────────────────────

import type { SidebarConversation } from "@/lib/types";

/**
 * Fetch all conversations (groups + DMs) for the unified sidebar.
 * Normalizes both into SidebarConversation and sorts by last activity (newest first).
 */
export async function getUnifiedConversations(): Promise<SidebarConversation[]> {
  const session = await getSession();
  if (!session) return [];

  try {
    // Fetch groups with last message preview
    const groups = await db.group.findMany({
      where: { members: { some: { userId: session.userId } } },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        members: { select: { userId: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
    });

    // Fetch DMs with last message preview
    const conversations = await db.conversation.findMany({
      where: { members: { some: { userId: session.userId } } },
      select: {
        id: true,
        createdAt: true,
        members: {
          where: { userId: { not: session.userId } },
          select: {
            user: { select: { id: true, username: true, lastActiveAt: true } },
          },
          take: 1,
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
    });

    // Compute unread counts for groups — batch the memberships in one query,
    // then run the message counts in parallel (no sequential N+1).
    const groupMemberships = await db.groupMember.findMany({
      where: { userId: session.userId },
      select: { groupId: true, lastReadAt: true },
    });
    const lastReadByGroup = new Map(
      groupMemberships.map((m) => [m.groupId, m.lastReadAt])
    );
    const groupUnreadCounts = new Map<string, number>();
    await Promise.all(
      groups.map(async (g) => {
        const lastRead = lastReadByGroup.get(g.id);
        const unread = await db.message.count({
          where: {
            groupId: g.id,
            ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
          },
        });
        groupUnreadCounts.set(g.id, unread);
      })
    );

    // Compute unread counts for DMs — same batching strategy
    const dmMemberships = await db.conversationMember.findMany({
      where: { userId: session.userId },
      select: { conversationId: true, lastReadAt: true },
    });
    const dmLastReadByConv = new Map(
      dmMemberships.map((m) => [m.conversationId, m.lastReadAt])
    );
    const dmUnreadCounts = new Map<string, number>();
    await Promise.all(
      conversations.map(async (c) => {
        const lastRead = dmLastReadByConv.get(c.id);
        const unread = await db.directMessage.count({
          where: {
            conversationId: c.id,
            senderId: { not: session.userId },
            ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
          },
        });
        dmUnreadCounts.set(c.id, unread);
      })
    );

    // Normalize groups
    const groupConvs: SidebarConversation[] = groups.map((g) => {
      const lastMsg = g.messages[0];
      return {
        kind: "group" as const,
        id: g.id,
        name: g.name,
        avatar: g.name.charAt(0).toUpperCase(),
        lastMessage: lastMsg?.content ?? null,
        lastActivity: lastMsg?.createdAt.toISOString() ?? g.createdAt.toISOString(),
        unreadCount: groupUnreadCounts.get(g.id) ?? 0,
        memberCount: g.members.length,
        isOwner: g.ownerId === session.userId,
      };
    });

    // Normalize DMs
    const dmConvs: SidebarConversation[] = conversations
      .filter((c) => c.members.length > 0)
      .map((c) => {
        const other = c.members[0].user;
        const lastMsg = c.messages[0];
        return {
          kind: "dm" as const,
          id: c.id,
          name: other.username,
          avatar: other.username.charAt(0).toUpperCase(),
          lastMessage: lastMsg?.content ?? null,
          lastActivity: lastMsg?.createdAt.toISOString() ?? c.createdAt.toISOString(),
          unreadCount: dmUnreadCounts.get(c.id) ?? 0,
          // Presence dot: the other user pinged within the last minute
          // (same "active in the last 60s" window the presence ping uses).
          online: other.lastActiveAt
            ? Date.now() - other.lastActiveAt.getTime() < 60_000
            : false,
        };
      });

    // Combine and sort by last activity (newest first)
    const all = [...groupConvs, ...dmConvs];
    all.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    return all;
  } catch (err) {
    console.error("Failed to fetch unified conversations:", err);
    return [];
  }
}

