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

  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    // Don't expose the invite code to non-owners via the RSC payload.
    code: m.group.ownerId === session.userId ? m.group.code : "",
    isOwner: m.group.ownerId === session.userId,
    memberCount: m.group._count.members,
    messageCount: m.group._count.messages,
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
