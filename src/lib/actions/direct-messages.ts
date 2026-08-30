"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { triggerDmEvent } from "@/lib/pusher";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type DmActionResult = {
  error?: string;
  success?: boolean;
  conversationId?: string;
};

/**
 * Verify the user is a member of the conversation and return both members'
 * user info. Returns null when the conversation doesn't exist or the user
 * isn't a member.
 */
async function getDmMembership(conversationId: string, userId: string) {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
  });
  if (!conversation) return null;

  const mine = conversation.members.find((m) => m.userId === userId);
  if (!mine) return null;

  const other = conversation.members.find((m) => m.userId !== userId);
  return { mine, other: other ?? null };
}

// Shape rows from Prisma into the shared Message type (used by MessageBubble)
function serializeDm(
  m: {
    id: string;
    content: string;
    senderId: string;
    deletedAt: Date | null;
    editedAt: Date | null;
    createdAt: Date;
    sender: { id: string; username: string };
    replyTo: {
      id: string;
      content: string;
      sender: { username: string };
    } | null;
    reactions: {
      id: string;
      emoji: string;
      userId: string;
      user: { username: string };
    }[];
  }
) {
  return {
    id: m.id,
    content: m.deletedAt ? "" : m.content,
    userId: m.senderId,
    username: m.sender.username,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
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
  };
}

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * Start (or resume) a 1-on-1 conversation with another user.
 * Returns the existing conversation when one already exists.
 */
export async function startConversationAction(
  otherUserId: string
): Promise<DmActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (otherUserId === session.userId) {
    return { error: "You can't message yourself." };
  }

  try {
    const otherUser = await db.user.findUnique({
      where: { id: otherUserId },
      select: { id: true },
    });
    if (!otherUser) return { error: "User not found." };

    // Find an existing 1:1 conversation between exactly these two users
    const existing = await db.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { userId: session.userId } } },
          { members: { some: { userId: otherUserId } } },
          {
            members: {
              every: { userId: { in: [session.userId, otherUserId] } },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (existing) return { success: true, conversationId: existing.id };

    const conversation = await db.conversation.create({
      data: {
        members: {
          create: [{ userId: session.userId }, { userId: otherUserId }],
        },
      },
    });

    revalidatePath("/");
    return { success: true, conversationId: conversation.id };
  } catch (err) {
    console.error("Start conversation error:", err);
    return { error: "Failed to start conversation." };
  }
}

/** List the user's conversations for the sidebar (with previews + unread). */
export async function getConversations() {
  const session = await getSession();
  if (!session) return [];

  try {
    const memberships = await db.conversationMember.findMany({
      where: { userId: session.userId },
      include: {
        conversation: {
          include: {
            members: {
              include: { user: { select: { id: true, username: true } } },
            },
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
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = [];
    for (const membership of memberships) {
      const other = membership.conversation.members.find(
        (m) => m.userId !== session.userId
      );
      if (!other) continue; // skip malformed conversations

      const unread = await db.directMessage.count({
        where: {
          conversationId: membership.conversationId,
          senderId: { not: session.userId },
          createdAt: { gt: membership.lastReadAt ?? new Date(0) },
          deletedAt: null,
        },
      });

      const last = membership.conversation.messages[0];
      result.push({
        id: membership.conversationId,
        otherUser: { id: other.user.id, username: other.user.username },
        lastMessage: last
          ? {
              content: last.deletedAt ? "" : last.content,
              createdAt: last.createdAt.toISOString(),
              senderId: last.senderId,
            }
          : null,
        unreadCount: unread,
      });
    }

    // Most recently active conversation first
    result.sort((a, b) => {
      const at = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0;
      const bt = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0;
      return bt - at;
    });

    return result;
  } catch (err) {
    console.error("Get conversations error:", err);
    return [];
  }
}

/** Fetch a conversation's messages (newest 50, chronological order). */
export async function getDirectMessages(conversationId: string) {
  const session = await getSession();
  if (!session) return [];

  const membership = await getDmMembership(conversationId, session.userId);
  if (!membership) return [];

  const messages = await db.directMessage.findMany({
    where: { conversationId },
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
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  messages.reverse();

  return messages.map((m) => serializeDm(m));
}

// ─── Messages ────────────────────────────────────────────────────────────────

export type DmMessageResult = DmActionResult & {
  message?: ReturnType<typeof serializeDm>;
};

/** Send a direct message (optionally as a reply). */
export async function sendDirectMessageAction(
  conversationId: string,
  content: string,
  replyToId?: string | null
): Promise<DmMessageResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const trimmed = content.trim();
  if (!trimmed) return { error: "Message content is required." };
  if (trimmed.length > 2000) {
    return { error: "Message is too long (max 2000 characters)." };
  }

  try {
    const membership = await getDmMembership(conversationId, session.userId);
    if (!membership) return { error: "Conversation not found." };

    // Validate the reply target belongs to this conversation
    let validReplyToId: string | null = null;
    if (replyToId) {
      const replyTo = await db.directMessage.findUnique({
        where: { id: replyToId },
        select: { conversationId: true },
      });
      if (replyTo?.conversationId === conversationId) {
        validReplyToId = replyToId;
      }
    }

    const message = await db.directMessage.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: trimmed,
        replyToId: validReplyToId,
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
    });

    const serialized = serializeDm(message);

    // Broadcast after the response — survives serverless teardown
    after(() => {
      triggerDmEvent(conversationId, "new-dm-message", {
        message: serialized,
      });
    });

    revalidatePath("/");
    return { success: true, message: serialized };
  } catch (err) {
    console.error("Send DM error:", err);
    return { error: "Failed to send message." };
  }
}

/** Edit one of your own direct messages. */
export async function editDirectMessageAction(
  messageId: string,
  content: string
): Promise<DmActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  const trimmed = content.trim();
  if (!trimmed) return { error: "Message content is required." };

  try {
    const message = await db.directMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return { error: "Message not found." };
    if (message.deletedAt) return { error: "This message was deleted." };
    if (message.senderId !== session.userId) {
      return { error: "You can only edit your own messages." };
    }

    const updated = await db.directMessage.update({
      where: { id: messageId },
      data: { content: trimmed, editedAt: new Date() },
    });

    after(() => {
      triggerDmEvent(message.conversationId, "dm-edited", {
        messageId,
        content: trimmed,
        editedAt: updated.editedAt ? updated.editedAt.toISOString() : null,
      });
    });

    return { success: true };
  } catch (err) {
    console.error("Edit DM error:", err);
    return { error: "Failed to edit message." };
  }
}

/** Soft-delete one of your own direct messages. */
export async function deleteDirectMessageAction(
  messageId: string
): Promise<DmActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };

  try {
    const message = await db.directMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) return { error: "Message not found." };
    if (message.senderId !== session.userId) {
      return { error: "You can only delete your own messages." };
    }

    await db.directMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: "" },
    });

    after(() => {
      triggerDmEvent(message.conversationId, "dm-deleted", { messageId });
    });

    return { success: true };
  } catch (err) {
    console.error("Delete DM error:", err);
    return { error: "Failed to delete message." };
  }
}

/** Toggle an emoji reaction on a direct message. */
export async function reactToDirectMessageAction(
  messageId: string,
  emoji: string
): Promise<DmActionResult> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated." };
  if (!emoji || emoji.length > 16) return { error: "Invalid emoji." };

  try {
    const message = await db.directMessage.findUnique({
      where: { id: messageId },
    });
    if (!message || message.deletedAt) {
      return { error: "Message not found." };
    }

    const membership = await getDmMembership(
      message.conversationId,
      session.userId
    );
    if (!membership) return { error: "Conversation not found." };

    const existing = await db.directMessageReaction.findUnique({
      where: {
        messageId_userId_emoji: { messageId, userId: session.userId, emoji },
      },
    });

    if (existing) {
      await db.directMessageReaction.delete({ where: { id: existing.id } });
    } else {
      // Different emoji: replace the user's previous reaction (Messenger-style)
      await db.directMessageReaction.deleteMany({
        where: { messageId, userId: session.userId },
      });
      await db.directMessageReaction.create({
        data: { messageId, userId: session.userId, emoji },
      });
    }

    const reactions = await db.directMessageReaction.findMany({
      where: { messageId },
      include: { user: { select: { id: true, username: true } } },
    });

    const serializedReactions = reactions.map((r) => ({
      id: r.id,
      emoji: r.emoji,
      userId: r.userId,
      username: r.user.username,
    }));

    after(() => {
      triggerDmEvent(message.conversationId, "dm-reaction", {
        messageId,
        reactions: serializedReactions,
      });
    });

    return { success: true };
  } catch (err) {
    console.error("React to DM error:", err);
    return { error: "Failed to react to message." };
  }
}

/** Mark a conversation as read for the current user (updates lastReadAt). */
export async function markDmAsRead(conversationId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;

  try {
    await db.conversationMember.updateMany({
      where: { userId: session.userId, conversationId },
      data: { lastReadAt: new Date() },
    });
  } catch {
    // non-critical — ignore errors
  }
}

/** Look up a user by exact username (for starting a new DM). */
export async function findUserByUsername(
  username: string
): Promise<{ id: string; username: string } | null> {
  const session = await getSession();
  if (!session) return null;

  const trimmed = username.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 20) return null;

  // Case-insensitive lookup; usernames are unique so at most one match
  const user = await db.user.findFirst({
    where: { username: { equals: trimmed, mode: "insensitive" } },
    select: { id: true, username: true },
  });
  return user ?? null;
}

