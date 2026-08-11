"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export type MessageResult = {
  error?: string;
  success?: boolean;
};

export async function sendMessageAction(formData: FormData): Promise<MessageResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const groupId = (formData.get("groupId") as string)?.trim();
  const content = (formData.get("content") as string)?.trim();

  if (!groupId || !content) {
    return { error: "Message content is required." };
  }

  if (content.length > 2000) {
    return { error: "Message is too long (max 2000 characters)." };
  }

  try {
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
      return { error: "You are not a member of this group." };
    }

    await db.message.create({
      data: {
        content,
        groupId,
        userId: session.userId,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Send message error:", err);
    return { error: "Failed to send message." };
  }
}

export async function getMessages(groupId: string) {
  const session = await getSession();
  if (!session) return [];

  // Verify membership
  const member = await db.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: session.userId,
        groupId,
      },
    },
  });

  if (!member) return [];

  const messages = await db.message.findMany({
    where: { groupId },
    include: {
      user: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return messages.map((m) => ({
    id: m.id,
    content: m.content,
    userId: m.userId,
    username: m.user.username,
    createdAt: m.createdAt.toISOString(),
  }));
}