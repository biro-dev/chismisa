"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getMessaging } from "@/lib/firebase";
import { triggerGroupEvent } from "@/lib/pusher";

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

// Send an FCM push notification to every group member that has a registered
// device token, excluding the sender. Called (but not awaited) after a message
// is created so the chat stays snappy.
export async function sendGroupMessagePush(
  groupId: string,
  senderId: string,
  senderUsername: string,
  content: string
) {
  // Bail out fast if no Firebase credentials are configured (e.g. local dev)
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return;

  try {
    const group = await db.group.findUnique({
      where: { id: groupId },
      select: { name: true },
    });

    // All members of this group except the sender
    const memberIds = await db.groupMember
      .findMany({
        where: { groupId, userId: { not: senderId } },
        select: { userId: true },
      })
      .then((rows) => rows.map((r) => r.userId));

    if (memberIds.length === 0) return;

    // Device tokens belonging to those members
    const tokens = await db.deviceToken.findMany({
      where: { userId: { in: memberIds } },
      select: { token: true },
    });

    const validTokens = tokens.map((t) => t.token);
    if (validTokens.length === 0) return;

    // Build the notification preview (truncate long messages)
    const body = `${senderUsername}: ${content.slice(0, 100)}`;

    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens: validTokens,
      notification: {
        title: group?.name ?? "New message",
        body,
      },
      data: {
        groupId,
        senderId,
        click_action: "/chat",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          clickAction: "/chat",
        },
      },
    });

    // Clean up tokens that are no longer valid (device uninstalled the app)
    const tokensToRemove: string[] = [];
    response.responses.forEach((res: { error?: { code?: string } }, index: number) => {
      const err = res.error;
      if (
        err &&
        (err.code === "messaging/invalid-registration-token" ||
          err.code === "messaging/registration-token-not-registered")
      ) {
        tokensToRemove.push(validTokens[index]);
      }
    });

    if (tokensToRemove.length > 0) {
      await db.deviceToken.deleteMany({
        where: { token: { in: tokensToRemove } },
      });
    }
  } catch (err) {
    console.error("FCM push error:", err);
  }
}

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

    // Send FCM push notifications to every other group member's devices
    sendGroupMessagePush(
      groupId,
      session.userId,
      created.user.username,
      content
    ).catch((err) => console.error("FCM notification error:", err));

    // Build the message payload (shared between return value and realtime broadcast)
    const messagePayload = {
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
    };

    // Broadcast to other group members via real-time (non-blocking)
    triggerGroupEvent(groupId, "new-message", {
      message: messagePayload,
    });

    revalidatePath("/");
    return {
      success: true,
      message: messagePayload,
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

    // Fetch the updated reactions to broadcast the full current state
    const updatedReactions = await db.messageReaction.findMany({
      where: { messageId },
      include: { user: { select: { id: true, username: true } } },
    });

    // Broadcast the updated reactions via real-time (non-blocking)
    triggerGroupEvent(message.groupId, "reaction-updated", {
      messageId,
      reactions: updatedReactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        userId: r.userId,
        username: r.user.username,
      })),
    });

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("React to message error:", err);
    return { error: "Failed to add reaction." };
  }
}

export async function deleteMessageAction(
  messageId: string
): Promise<MessageResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  try {
    const message = await db.message.findUnique({
      where: { id: messageId },
    });
    if (!message) return { error: "Message not found." };

    // Only the sender (or the group owner) can delete
    const group = await db.group.findUnique({
      where: { id: message.groupId },
      select: { ownerId: true },
    });

    const canDelete =
      message.userId === session.userId || group?.ownerId === session.userId;
    if (!canDelete) {
      return { error: "You can only delete your own messages." };
    }

    if (message.deletedAt) {
      return { success: true }; // already deleted
    }

    await db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // Broadcast deletion to other group members via real-time (non-blocking)
    triggerGroupEvent(message.groupId, "message-deleted", {
      messageId,
    });

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Delete message error:", err);
    return { error: "Failed to delete message." };
  }
}

// Mark the group as read for the current user (updates lastReadAt).
// Called automatically while the user is viewing the group.
export async function markGroupAsRead(groupId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;

  try {
    await db.groupMember.updateMany({
      where: { userId: session.userId, groupId },
      data: { lastReadAt: new Date() },
    });
  } catch {
    // non-critical — ignore errors
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
    // Deleted messages show a placeholder instead of their content
    content: m.deletedAt ? "" : m.content,
    userId: m.userId,
    // Anonymous chat: only the sender sees their own username; everyone
    // else sees "Anonymous". The admin panel uses a separate action that
    // still exposes real usernames.
    username: m.userId === session.userId ? m.user.username : "Anonymous",
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          content: m.replyTo.content,
          username: "Anonymous",
        }
      : null,
    reactions: m.reactions.map((r) => ({
      id: r.id,
      emoji: r.emoji,
      userId: r.userId,
      username: "Anonymous",
    })),
  }));
}
