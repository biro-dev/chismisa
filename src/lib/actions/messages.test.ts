import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  group: {
    findUnique: vi.fn(),
  },
  groupMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  message: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  messageReaction: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  deviceToken: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

// Capture `after()` callbacks so tests can run the deferred side-effects
// (realtime broadcasts, push notifications) and assert on them.
const afterCallbacks = vi.hoisted(() => {
  return {
    callbacks: [] as Array<() => void | Promise<void>>,
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session", () => sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (cb: () => void | Promise<void>) => {
    afterCallbacks.callbacks.push(cb);
  },
}));
vi.mock("@/lib/firebase", () => ({ getMessaging: vi.fn() }));
vi.mock("@/lib/pusher", () => ({ triggerGroupEvent: vi.fn() }));

import { triggerGroupEvent } from "@/lib/pusher";
import {
  deleteMessageAction,
  editMessageAction,
  getMessages,
  markGroupAsRead,
  reactToMessageAction,
  sendMessageAction,
} from "@/lib/actions/messages";

const SESSION = { userId: "user_1", username: "chismosa", expiresAt: new Date() };

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function runAfterCallbacks() {
  const cbs = [...afterCallbacks.callbacks];
  afterCallbacks.callbacks.length = 0;
  return Promise.all(cbs.map((cb) => cb()));
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.callbacks.length = 0;
  sessionMock.getSession.mockResolvedValue(SESSION);
});

describe("sendMessageAction", () => {
  it("rejects unauthenticated users", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    expect(await sendMessageAction(makeForm({ groupId: "g1", content: "hi" }))).toEqual({
      error: "Not authenticated.",
    });
  });

  it("rejects empty content", async () => {
    expect(await sendMessageAction(makeForm({ groupId: "g1", content: "   " }))).toEqual({
      error: "Message content is required.",
    });
  });

  it("rejects messages over 2000 characters", async () => {
    expect(await sendMessageAction(makeForm({ groupId: "g1", content: "x".repeat(2001) }))).toEqual({
      error: "Message is too long (max 2000 characters).",
    });
  });

  it("rejects non-members", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue(null);

    expect(await sendMessageAction(makeForm({ groupId: "g1", content: "hi" }))).toEqual({
      error: "You are not a member of this group.",
    });
    expect(dbMock.message.create).not.toHaveBeenCalled();
  });

  it("rejects a reply to a message that doesn't exist in the group", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });
    dbMock.message.findFirst.mockResolvedValue(null);

    expect(
      await sendMessageAction(makeForm({ groupId: "g1", content: "hi", replyToId: "missing" }))
    ).toEqual({ error: "The message you're replying to no longer exists." });
  });

  it("creates the message and broadcasts a realtime event", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });
    dbMock.message.create.mockResolvedValue({
      id: "msg_1",
      content: "hi",
      userId: "user_1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      user: { id: "user_1", username: "chismosa" },
      replyTo: null,
      reactions: [],
    });

    const result = await sendMessageAction(makeForm({ groupId: "g1", content: "hi" }));
    expect(result.success).toBe(true);
    expect(result.message).toMatchObject({
      id: "msg_1",
      content: "hi",
      username: "chismosa",
      replyTo: null,
      reactions: [],
    });

    await runAfterCallbacks();
    expect(triggerGroupEvent).toHaveBeenCalledWith("g1", "new-message", {
      message: expect.objectContaining({ id: "msg_1" }),
    });
  });
});

describe("reactToMessageAction", () => {
  const message = { id: "msg_1", groupId: "g1", userId: "user_2" };

  it("rejects an invalid emoji", async () => {
    expect(await reactToMessageAction("msg_1", "")).toEqual({ error: "Invalid emoji." });
    expect(await reactToMessageAction("msg_1", "x".repeat(5))).toEqual({
      error: "Invalid emoji.",
    });
  });

  it("rejects a message that doesn't exist", async () => {
    dbMock.message.findUnique.mockResolvedValue(null);
    expect(await reactToMessageAction("nope", "👍")).toEqual({ error: "Message not found." });
  });

  it("rejects non-members of the message's group", async () => {
    dbMock.message.findUnique.mockResolvedValue(message);
    dbMock.groupMember.findUnique.mockResolvedValue(null);

    expect(await reactToMessageAction("msg_1", "👍")).toEqual({
      error: "You are not a member of this group.",
    });
  });

  it("adds a reaction when none exists and broadcasts the new state", async () => {
    dbMock.message.findUnique.mockResolvedValue(message);
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });
    dbMock.messageReaction.findUnique.mockResolvedValue(null); // not reacted yet
    dbMock.messageReaction.findMany.mockResolvedValue([
      { id: "r1", emoji: "👍", userId: "user_1", user: { id: "user_1", username: "chismosa" } },
    ]);

    const result = await reactToMessageAction("msg_1", "👍");
    expect(result).toEqual({ success: true });
    expect(dbMock.messageReaction.create).toHaveBeenCalledWith({
      data: { messageId: "msg_1", userId: "user_1", emoji: "👍" },
    });

    await runAfterCallbacks();
    expect(triggerGroupEvent).toHaveBeenCalledWith("g1", "reaction-updated", {
      messageId: "msg_1",
      reactions: [{ id: "r1", emoji: "👍", userId: "user_1", username: "chismosa" }],
    });
  });

  it("toggles an existing reaction off", async () => {
    dbMock.message.findUnique.mockResolvedValue(message);
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });
    dbMock.messageReaction.findUnique.mockResolvedValue({ id: "r1" });
    dbMock.messageReaction.findMany.mockResolvedValue([]);

    const result = await reactToMessageAction("msg_1", "👍");
    expect(result).toEqual({ success: true });
    expect(dbMock.messageReaction.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(dbMock.messageReaction.create).not.toHaveBeenCalled();
  });
});

describe("deleteMessageAction", () => {
  const message = { id: "msg_1", groupId: "g1", userId: "user_2", deletedAt: null };

  it("rejects a message that doesn't exist", async () => {
    dbMock.message.findUnique.mockResolvedValue(null);
    expect(await deleteMessageAction("nope")).toEqual({ error: "Message not found." });
  });

  it("rejects a user who is neither sender nor group owner", async () => {
    dbMock.message.findUnique.mockResolvedValue(message);
    dbMock.group.findUnique.mockResolvedValue({ id: "g1", ownerId: "user_9" });
    sessionMock.getSession.mockResolvedValueOnce({ ...SESSION, userId: "user_3" });

    expect(await deleteMessageAction("msg_1")).toEqual({
      error: "You can only delete your own messages.",
    });
  });

  it("lets the sender soft-delete their own message", async () => {
    dbMock.message.findUnique.mockResolvedValue({ ...message, userId: "user_1" });
    dbMock.group.findUnique.mockResolvedValue({ id: "g1", ownerId: "user_9" });

    const result = await deleteMessageAction("msg_1");
    expect(result).toEqual({ success: true });
    expect(dbMock.message.update).toHaveBeenCalledWith({
      where: { id: "msg_1" },
      data: { deletedAt: expect.any(Date) },
    });

    await runAfterCallbacks();
    expect(triggerGroupEvent).toHaveBeenCalledWith("g1", "message-deleted", {
      messageId: "msg_1",
    });
  });

  it("lets the group owner delete a member's message", async () => {
    dbMock.message.findUnique.mockResolvedValue(message);
    dbMock.group.findUnique.mockResolvedValue({ id: "g1", ownerId: "user_1" });

    const result = await deleteMessageAction("msg_1");
    expect(result).toEqual({ success: true });
    expect(dbMock.message.update).toHaveBeenCalled();
  });

  it("is idempotent for an already-deleted message", async () => {
    dbMock.message.findUnique.mockResolvedValue({
      ...message,
      userId: "user_1",
      deletedAt: new Date(),
    });

    const result = await deleteMessageAction("msg_1");
    expect(result).toEqual({ success: true });
    expect(dbMock.message.update).not.toHaveBeenCalled();
  });
});

describe("markGroupAsRead", () => {
  it("updates lastReadAt for the current user's membership", async () => {
    await markGroupAsRead("g1");
    expect(dbMock.groupMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", groupId: "g1" },
      data: { lastReadAt: expect.any(Date) },
    });
  });

  it("silently ignores failures (non-critical)", async () => {
    dbMock.groupMember.updateMany.mockRejectedValue(new Error("db down"));
    await expect(markGroupAsRead("g1")).resolves.toBeUndefined();
  });

  it("does nothing when unauthenticated", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    await markGroupAsRead("g1");
    expect(dbMock.groupMember.updateMany).not.toHaveBeenCalled();
  });
});

describe("getMessages", () => {
  it("returns an empty list for non-members", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue(null);
    expect(await getMessages("g1")).toEqual([]);
    expect(dbMock.message.findMany).not.toHaveBeenCalled();
  });

describe("editMessageAction", () => {
  const OWN_MESSAGE = {
    id: "msg_9",
    content: "original",
    groupId: "g1",
    userId: "user_1",
    deletedAt: null,
  };

  it("rejects unauthenticated users", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    expect(await editMessageAction("msg_9", "new text")).toEqual({
      error: "Not authenticated.",
    });
  });

  it("rejects empty content", async () => {
    expect(await editMessageAction("msg_9", "   ")).toEqual({
      error: "Message content is required.",
    });
  });

  it("rejects content over 2000 characters", async () => {
    expect(await editMessageAction("msg_9", "x".repeat(2001))).toEqual({
      error: "Message is too long (max 2000 characters).",
    });
  });

  it("rejects edits to a deleted message", async () => {
    dbMock.message.findUnique.mockResolvedValueOnce({
      ...OWN_MESSAGE,
      deletedAt: new Date(),
    });
    expect(await editMessageAction("msg_9", "new text")).toEqual({
      error: "This message was deleted.",
    });
  });

  it("rejects edits to another user's message", async () => {
    dbMock.message.findUnique.mockResolvedValueOnce({
      ...OWN_MESSAGE,
      userId: "user_2",
    });
    expect(await editMessageAction("msg_9", "new text")).toEqual({
      error: "You can only edit your own messages.",
    });
  });

  it("updates the message, stamps editedAt, and broadcasts the edit", async () => {
    const editedAt = new Date("2026-01-03T12:00:00Z");
    dbMock.message.findUnique.mockResolvedValueOnce(OWN_MESSAGE);
    dbMock.message.update.mockResolvedValueOnce({
      ...OWN_MESSAGE,
      content: "new text",
      editedAt,
    });

    const result = await editMessageAction("msg_9", "  new text  ");
    expect(result).toEqual({ success: true });
    expect(dbMock.message.update).toHaveBeenCalledWith({
      where: { id: "msg_9" },
      data: { content: "new text", editedAt: expect.any(Date) },
    });

    // The realtime broadcast must fire via after() with the trimmed content
    await runAfterCallbacks();
    expect(triggerGroupEvent).toHaveBeenCalledWith("g1", "message-edited", {
      messageId: "msg_9",
      content: "new text",
      editedAt: "2026-01-03T12:00:00.000Z",
    });
  });

  it("returns an error when the message does not exist", async () => {
    dbMock.message.findUnique.mockResolvedValueOnce(null);
    expect(await editMessageAction("missing", "new text")).toEqual({
      error: "Message not found.",
    });
  });
});


  it("returns messages in chronological order with mapped fields", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });
    dbMock.message.findMany.mockResolvedValue([
      // DB query is ordered desc (newest first) — the action must reverse it
      {
        id: "msg_2",
        content: "second",
        userId: "user_1",
        deletedAt: new Date("2026-01-02T00:00:00Z"),
        createdAt: new Date("2026-01-02T00:00:00Z"),
        user: { id: "user_1", username: "chismosa" },
        replyTo: {
          id: "msg_1",
          content: "first",
          user: { username: "marites" },
        },
        reactions: [
          { id: "r1", emoji: "❤️", userId: "user_2", user: { id: "user_2", username: "marites" } },
        ],
      },
      {
        id: "msg_1",
        content: "first",
        userId: "user_2",
        deletedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        user: { id: "user_2", username: "marites" },
        replyTo: null,
        reactions: [],
      },
    ]);

    const messages = await getMessages("g1");
    // DB returns desc; the action must reverse to chronological order
    expect(messages.map((m) => m.id)).toEqual(["msg_1", "msg_2"]);
    expect(messages[1].deletedAt).toBe("2026-01-02T00:00:00.000Z");
    // Deleted messages must not leak their content
    expect(messages[1].content).toBe("");
    expect(messages[1].replyTo).toEqual({
      id: "msg_1",
      content: "first",
      username: "marites",
    });
    expect(messages[1].reactions[0]).toMatchObject({ emoji: "❤️", username: "marites" });
  });
});