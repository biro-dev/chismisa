"use server";

import { db } from "@/lib/db";

function verifyAdminSecret(secret: string): boolean {
  const masterSecret = process.env.ADMIN_SECRET;
  if (!masterSecret) return false;
  return secret === masterSecret;
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