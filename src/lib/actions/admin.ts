"use server";

import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

function verifyAdminSecret(secret: string): boolean {
  const masterSecret = process.env.ADMIN_SECRET;
  if (!masterSecret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(masterSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const ADMIN_COOKIE = "admin_secret";

/**
 * Verify the master secret and set the admin cookie so the
 * /chismis-admin page (server component) authorizes the session.
 */
export async function loginAdminAction(secret: string) {
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

  const [userCount, groupCount, messageCount, groups] = await Promise.all([
    db.user.count(),
    db.group.count(),
    db.message.count(),
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
