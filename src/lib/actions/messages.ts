"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export type MessageResult = {
  error?: string;
  success?: boolean;
  message?: {
    id: string;
    content: string;
    userId: string;
    username: string;
    createdAt: string;
    replyTo: {
      id: string;
      content: string;
      username: string;
    } | null;
    reactions: {
      id: string;
      emoji: string;
      userId: string;
      username: string;
    }[];
  };
};

export async function sendMessageAction(formData: FormData): Promise<MessageResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const groupId = (formData.get("groupId") as string)?.trim();
  const content = (formData.get("content") as string)?.trim();
  const replyToId = (formData.get("replyToId") as string)?.trim() || null;

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

    // If replyToId is provided, verify the message exists in the same group
    if (replyToId) {
      const replyTo = await db.message.findFirst({
        where: {
          id: replyToId,
          groupId,
        },
      });
      if (!replyTo) {
        return { error: "The message you're replying to no longer exists." };
      }
    }

    const created = await db.message.create({
      data: {
        content,
        groupId,
        userId: session.userId,
        replyToId: replyToId || null,
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
        reactions: true,
      },
    });

    revalidatePath("/");
    return {
      success: true,
      message: {
        id: created.id,
        content: created.content,
        userId: created.userId,
        username: created.user.username,
        createdAt: created.createdAt.toISOString(),
        replyTo: created.replyTo
          ? {
              id: created.replyTo.id,
              content: created.replyTo.content,
              username: created.replyTo.user.username,
            }
          : null,
        reactions: [],
      },
    };
  } catch (err) {
    console.error("Send message error:", err);
    return { error: "Failed to send message." };
  }
}

export async function reactToMessageAction(
  messageId: string,
  emoji: string
): Promise<MessageResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  if (!emoji || emoji.length > 4) {
    return { error: "Invalid emoji." };
  }

  try {
    // Verify membership in the group that owns this message
    const message = await db.message.findUnique({
      where: { id: messageId },
      include: { group: true },
    });

    if (!message) return { error: "Message not found." };

    const member = await db.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: session.userId,
          groupId: message.groupId,
        },
      },
    });

    if (!member) {
      return { error: "You are not a member of this group." };
    }

    // Check if reaction already exists - if so, remove it (toggle off)
    const existing = await db.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: session.userId,
          emoji,
        },
      },
    });

    if (existing) {
      await db.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await db.messageReaction.create({
        data: {
          messageId,
          userId: session.userId,
          emoji,
        },
      });
    }

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("React to message error:", err);
    return { error: "Failed to add reaction." };
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
    take: 50,
  });
  // Reverse to display in chronological order (oldest → newest)
  messages.reverse();

  return messages.map((m) => ({
    id: m.id,
    content: m.content,
    userId: m.userId,
    username: m.user.username,
    createdAt: m.createdAt.toISOString(),
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
  }));
}