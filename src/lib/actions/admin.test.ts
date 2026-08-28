import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: {
    count: vi.fn(),
  },
  group: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  message: {
    count: vi.fn(),
  },
  groupMember: {
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  deleteGroupAction,
  getAdminStats,
  getGroupMembersAction,
  getGroupMessagesAction,
  removeMemberAction,
} from "@/lib/actions/admin";

const SECRET = "master-secret-123";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyAdminSecret (via the public actions)", () => {
  it("rejects a wrong secret of the same length", async () => {
    const wrong = "x".repeat(SECRET.length);
    expect(await getAdminStats(wrong)).toBeNull();
    expect(await deleteGroupAction(wrong, "group_1")).toEqual({
      error: "Unauthorized.",
    });
    expect(await getGroupMembersAction(wrong, "group_1")).toBeNull();
    expect(await removeMemberAction(wrong, "group_1", "user_2")).toEqual({
      error: "Unauthorized.",
    });
    expect(await getGroupMessagesAction(wrong, "group_1")).toBeNull();
    // No action should have touched the database
    expect(dbMock.group.delete).not.toHaveBeenCalled();
    expect(dbMock.group.findUnique).not.toHaveBeenCalled();
    expect(dbMock.groupMember.delete).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret of a different length", async () => {
    expect(await getAdminStats("short")).toBeNull();
    expect(await deleteGroupAction("a-much-longer-wrong-secret-value", "g")).toEqual({
      error: "Unauthorized.",
    });
  });

  it("locks everything out when ADMIN_SECRET is unset", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    expect(await getAdminStats("")).toBeNull();
    expect(await deleteGroupAction("", "group_1")).toEqual({
      error: "Unauthorized.",
    });
  });
});

describe("getAdminStats", () => {
  it("returns counts and mapped group fields", async () => {
    dbMock.user.count.mockResolvedValue(12);
    dbMock.group.count.mockResolvedValue(3);
    dbMock.message.count.mockResolvedValue(456);
    dbMock.group.findMany.mockResolvedValue([
      {
        id: "group_1",
        name: "Tambayan",
        code: "CHISMIS-ABC123",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        owner: { username: "chismosa" },
        _count: { members: 5, messages: 100 },
      },
    ]);

    const stats = await getAdminStats(SECRET);
    expect(stats).toEqual({
      userCount: 12,
      groupCount: 3,
      messageCount: 456,
      groups: [
        {
          id: "group_1",
          name: "Tambayan",
          code: "CHISMIS-ABC123",
          ownerUsername: "chismosa",
          memberCount: 5,
          messageCount: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("deleteGroupAction", () => {
  it("deletes the group when authorized", async () => {
    dbMock.group.delete.mockResolvedValue({ id: "group_1" });

    expect(await deleteGroupAction(SECRET, "group_1")).toEqual({ success: true });
    expect(dbMock.group.delete).toHaveBeenCalledWith({
      where: { id: "group_1" },
    });
  });
});

describe("getGroupMembersAction", () => {
  it("returns the owner separately and filters them out of members", async () => {
    dbMock.group.findUnique.mockResolvedValue({
      id: "group_1",
      name: "Tambayan",
      ownerId: "user_1",
      owner: { id: "user_1", username: "chismosa" },
      members: [
        {
          userId: "user_1",
          joinedAt: new Date("2026-01-01T00:00:00Z"),
          user: { id: "user_1", username: "chismosa", createdAt: new Date() },
        },
        {
          userId: "user_2",
          joinedAt: new Date("2026-01-02T00:00:00Z"),
          user: { id: "user_2", username: "marites", createdAt: new Date() },
        },
      ],
    });

    const result = await getGroupMembersAction(SECRET, "group_1");
    expect(result!.owner).toEqual({ id: "user_1", username: "chismosa" });
    expect(result!.members).toEqual([
      {
        id: "user_2",
        username: "marites",
        joinedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns null for a missing group", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);
    expect(await getGroupMembersAction(SECRET, "nope")).toBeNull();
  });
});

describe("removeMemberAction", () => {
  it("rejects removing the group owner", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ownerId: "user_1" });

    expect(await removeMemberAction(SECRET, "group_1", "user_1")).toEqual({
      error: "Cannot remove the group owner.",
    });
    expect(dbMock.groupMember.delete).not.toHaveBeenCalled();
  });

  it("reports a missing group", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);

    expect(await removeMemberAction(SECRET, "nope", "user_2")).toEqual({
      error: "Group not found.",
    });
  });

  it("deletes the membership via the composite key", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ownerId: "user_1" });

    expect(await removeMemberAction(SECRET, "group_1", "user_2")).toEqual({
      success: true,
    });
    expect(dbMock.groupMember.delete).toHaveBeenCalledWith({
      where: { userId_groupId: { userId: "user_2", groupId: "group_1" } },
    });
  });

  it("maps Prisma P2025 to a friendly error", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ownerId: "user_1" });
    dbMock.groupMember.delete.mockRejectedValue({ code: "P2025" });

    expect(await removeMemberAction(SECRET, "group_1", "user_2")).toEqual({
      error: "This user is not a member of the group.",
    });
  });

  it("returns a generic error for unexpected failures", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ownerId: "user_1" });
    dbMock.groupMember.delete.mockRejectedValue(new Error("db down"));

    expect(await removeMemberAction(SECRET, "group_1", "user_2")).toEqual({
      error: "Failed to remove member.",
    });
  });
});

describe("getGroupMessagesAction", () => {
  const messages = [
    {
      id: "msg_1",
      content: "hello",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      user: { id: "user_2", username: "marites" },
      replyTo: null,
      reactions: [],
    },
    {
      id: "msg_2",
      content: "reply",
      createdAt: new Date("2026-01-01T00:01:00Z"),
      user: { id: "user_1", username: "chismosa" },
      replyTo: {
        id: "msg_1",
        content: "hello",
        user: { username: "marites" },
      },
      reactions: [
        { id: "r1", emoji: "❤️", userId: "user_2", user: { id: "user_2", username: "marites" } },
      ],
    },
  ];

  function mockGroup() {
    dbMock.group.findUnique.mockResolvedValue({
      id: "group_1",
      name: "Tambayan",
      owner: { username: "chismosa" },
      messages,
    });
  }

  it("maps messages with reply and reaction data", async () => {
    mockGroup();

    const result = await getGroupMessagesAction(SECRET, "group_1");
    expect(result!.ownerUsername).toBe("chismosa");
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0].replyTo).toBeNull();
    expect(result!.messages[1]).toMatchObject({
      id: "msg_2",
      replyTo: { id: "msg_1", content: "hello", username: "marites" },
      reactions: [{ emoji: "❤️", username: "marites" }],
    });
    // Dates must be serialized as ISO strings
    expect(result!.messages[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("passes the since filter as a createdAt cursor", async () => {
    mockGroup();
    const since = "2026-01-01T00:00:00.000Z";

    await getGroupMessagesAction(SECRET, "group_1", since);

    const call = dbMock.group.findUnique.mock.calls[0][0];
    expect(call.include.messages.where).toEqual({
      createdAt: { gt: new Date(since) },
    });
  });

  it("omits the where clause when since is not provided", async () => {
    mockGroup();

    await getGroupMessagesAction(SECRET, "group_1");

    const call = dbMock.group.findUnique.mock.calls[0][0];
    expect(call.include.messages.where).toEqual({});
  });

  it("returns null for a missing group", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);
    expect(await getGroupMessagesAction(SECRET, "nope")).toBeNull();
  });
});



