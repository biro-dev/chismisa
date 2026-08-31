"use server";

import { db } from "@/lib/db";
import {
  ADMIN_COOKIE,
  verifyAdminSecret,
} from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Verify the master secret and set the admin cookie so the
 * /chismis-admin page (server component) authorizes the session.
 */
export async function loginAdminAction(secret: string) {
  // Brute-force protection: small per-IP budget for secret attempts.
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await checkRateLimit(`admin-login:${ip}`, 5, 60_000);
  if (limited) {
    return { error: "Too many attempts. Please try again in a minute." };
  }
  if (!verifyAdminSecret(secret)) {
    return { error: "Invalid admin secret key." };
  }
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });
  return { success: true };
}

/** Clear the admin cookie (log out of the admin panel). */
export async function logoutAdminAction() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  return { success: true };
}


export async function getAdminStats(secret: string) {
  if (!verifyAdminSecret(secret)) return null;

  const [userCount, groupCount, messageCount, dmCount, conversationCount, groups] =
    await Promise.all([
      db.user.count(),
      db.group.count(),
      db.message.count(),
      db.directMessage.count(),
      db.conversation.count(),
      db.group.findMany({
        include: {
          _count: {
            select: { members: true, messages: true },
          },
          owner: {
            select: { username: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  return {
    userCount,
    groupCount,
    messageCount,
    dmCount,
    conversationCount,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      code: g.code,
      ownerUsername: g.owner.username,
      memberCount: g._count.members,
      messageCount: g._count.messages,
      createdAt: g.createdAt.toISOString(),
    })),
  };
}

export async function deleteGroupAction(secret: string, groupId: string) {
  if (!verifyAdminSecret(secret)) return { error: "Unauthorized." };

  await db.group.delete({ where: { id: groupId } });
  return { success: true };
}

export async function getGroupMembersAction(secret: string, groupId: string) {
  if (!verifyAdminSecret(secret)) return null;

  const group = await db.group.findUnique({
    where: { id: groupId },
    include: {
      owner: { select: { id: true, username: true } },
      members: {
        include: {
          user: { select: { id: true, username: true, createdAt: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!group) return null;

  return {
    id: group.id,
    name: group.name,
    owner: { id: group.owner.id, username: group.owner.username },
    // Filter out the owner from members — the owner is already shown separately
    members: group.members
      .filter((m) => m.userId !== group.ownerId)
      .map((m) => ({
        id: m.user.id,
        username: m.user.username,
        joinedAt: m.joinedAt.toISOString(),
      })),
  };
}

export async function removeMemberAction(
  secret: string,
  groupId: string,
  userId: string
) {
  if (!verifyAdminSecret(secret)) return { error: "Unauthorized." };

  // Check if target user is the group owner - cannot remove owner
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });

  if (!group) return { error: "Group not found." };
  if (group.ownerId === userId) {
    return { error: "Cannot remove the group owner." };
  }

  try {
    await db.groupMember.delete({
      where: {
        userId_groupId: {
          userId,
          groupId,
        },
      },
    });
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === "P2025") {
      return { error: "This user is not a member of the group." };
    }
    console.error("Remove member error:", err);
    return { error: "Failed to remove member." };
  }

  return { success: true };
}

export async function getGroupMessagesAction(
  secret: string,
  groupId: string,
  since?: string
) {
  if (!verifyAdminSecret(secret)) return null;

  const group = await db.group.findUnique({
    where: { id: groupId },
    include: {
      owner: { select: { username: true } },
      messages: {
        where: {
          ...(since ? { createdAt: { gt: new Date(since) } } : {}),
        },
        include: {
          user: { select: { id: true, username: true } },
          replyTo: {
            select: {
              id: true,
              content: true,
              user: { select: { username: true } },
            },
          },
          reactions: {
            include: {
              user: { select: { id: true, username: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!group) return null;

  return {
    id: group.id,
    name: group.name,
    ownerUsername: group.owner.username,
    messages: group.messages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      username: msg.user.username,
      createdAt: msg.createdAt.toISOString(),
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            content: msg.replyTo.content,
            username: msg.replyTo.user.username,
          }
        : null,
      reactions: msg.reactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        userId: r.userId,
        username: r.user.username,
      })),
    })),
  };
}

// ─── Direct messages (read-only monitoring) ─────────────────────────────────

export async function getDmConversationsAction(secret: string) {
  if (!verifyAdminSecret(secret)) return null;

  const conversations = await db.conversation.findMany({
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
      },
      _count: { select: { messages: true } },
      // Latest message per conversation, for the list preview
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          content: true,
          createdAt: true,
          senderId: true,
          deletedAt: true,
        },
      },
    },
  });

  return conversations
    .map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        members: c.members.map((m) => ({
          id: m.user.id,
          username: m.user.username,
        })),
        messageCount: c._count.messages,
        lastMessage: last
          ? {
              content: last.deletedAt ? "Message unsent" : last.content,
              createdAt: last.createdAt.toISOString(),
              senderId: last.senderId,
            }
          : null,
        lastActivityAt: (last?.createdAt ?? c.createdAt).toISOString(),
      };
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export async function getDmMessagesAction(
  secret: string,
  conversationId: string,
  since?: string
) {
  if (!verifyAdminSecret(secret)) return null;

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
      },
      messages: {
        where: {
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
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    members: conversation.members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
    })),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      content: m.content,
      userId: m.senderId,
      username: m.sender.username,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
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
    })),
  };
}
