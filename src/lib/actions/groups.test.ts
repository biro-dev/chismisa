import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  group: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  groupMember: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
  },
  message: {
    count: vi.fn(),
  },
}));

const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session", () => sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createGroupAction,
  deleteGroupAction,
  getGroupDetails,
  getUserGroups,
  joinGroupAction,
  leaveGroupAction,
} from "@/lib/actions/groups";

const SESSION = { userId: "user_1", username: "chismosa", expiresAt: new Date() };

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const group = { id: "group_1", name: "Tambayan", code: "CHISMIS-ABC123", ownerId: "user_1" };

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.getSession.mockResolvedValue(SESSION);
});

describe("createGroupAction", () => {
  it("rejects unauthenticated users", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    expect(await createGroupAction(undefined, makeForm({ name: "X" }))).toEqual({
      error: "Not authenticated.",
    });
    expect(dbMock.group.create).not.toHaveBeenCalled();
  });

  it("rejects empty and over-length names", async () => {
    expect(await createGroupAction(undefined, makeForm({ name: "   " }))).toEqual({
      error: "Group name must be between 1 and 50 characters.",
    });
    expect(await createGroupAction(undefined, makeForm({ name: "a".repeat(51) }))).toEqual({
      error: "Group name must be between 1 and 50 characters.",
    });
    expect(dbMock.group.create).not.toHaveBeenCalled();
  });

  it("creates the group with a valid invite code and adds the owner as first member", async () => {
    dbMock.group.findUnique.mockResolvedValue(null); // code never collides
    dbMock.group.create.mockResolvedValue({ ...group, members: [] });

    const result = await createGroupAction(undefined, makeForm({ name: "Tambayan" }));
    expect(result.success).toBe(true);
    expect(result.groupId).toBe("group_1");

    const data = dbMock.group.create.mock.calls[0][0].data;
    expect(data.name).toBe("Tambayan");
    expect(data.code).toMatch(/^CHISMIS-[A-Z0-9]{6}$/);
    expect(data.ownerId).toBe("user_1");
    expect(data.members.create.userId).toBe("user_1");
  });

  it("regenerates the invite code on collision", async () => {
    dbMock.group.findUnique
      .mockResolvedValueOnce({ id: "other" }) // first code taken
      .mockResolvedValue(null); // second code free
    dbMock.group.create.mockResolvedValue(group);

    const result = await createGroupAction(undefined, makeForm({ name: "Tambayan" }));
    expect(result.success).toBe(true);
    expect(dbMock.group.findUnique).toHaveBeenCalledTimes(2);
  });

  it("returns an error when the database fails", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);
    dbMock.group.create.mockRejectedValue(new Error("db down"));

    expect(await createGroupAction(undefined, makeForm({ name: "Tambayan" }))).toEqual({
      error: "Failed to create group.",
    });
  });
});

describe("joinGroupAction", () => {
  it("rejects an unknown invite code", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);

    expect(await joinGroupAction(undefined, makeForm({ code: "chismis-nope00" }))).toEqual({
      error: "Invalid invite code. Group not found.",
    });
  });

  it("normalizes the code to uppercase before lookup", async () => {
    dbMock.group.findUnique.mockResolvedValue(group);
    dbMock.groupMember.findUnique.mockResolvedValue(null);

    await joinGroupAction(undefined, makeForm({ code: "chismis-abc123" }));
    expect(dbMock.group.findUnique).toHaveBeenCalledWith({
      where: { code: "CHISMIS-ABC123" },
    });
  });

  it("joins a group the user is not yet a member of", async () => {
    dbMock.group.findUnique.mockResolvedValue(group);
    dbMock.groupMember.findUnique.mockResolvedValue(null);

    const result = await joinGroupAction(undefined, makeForm({ code: "CHISMIS-ABC123" }));
    expect(result).toEqual({ success: true, groupId: "group_1" });
    expect(dbMock.groupMember.create).toHaveBeenCalledWith({
      data: { userId: "user_1", groupId: "group_1" },
    });
  });

  it("is idempotent for an existing member", async () => {
    dbMock.group.findUnique.mockResolvedValue(group);
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1" });

    const result = await joinGroupAction(undefined, makeForm({ code: "CHISMIS-ABC123" }));
    expect(result).toEqual({ success: true, groupId: "group_1" });
    expect(dbMock.groupMember.create).not.toHaveBeenCalled();
  });
});

describe("leaveGroupAction", () => {
  it("blocks owners — they must delete the group instead", async () => {
    dbMock.group.findUnique.mockResolvedValue(group);

    expect(await leaveGroupAction("group_1")).toEqual({
      error: "You own this group. Use Delete instead.",
    });
    expect(dbMock.groupMember.delete).not.toHaveBeenCalled();
  });

  it("rejects non-members", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ...group, ownerId: "user_9" });
    dbMock.groupMember.findUnique.mockResolvedValue(null);

    expect(await leaveGroupAction("group_1")).toEqual({
      error: "You are not a member of this group.",
    });
  });

  it("removes the membership for a regular member", async () => {
    dbMock.group.findUnique.mockResolvedValue({ ...group, ownerId: "user_9" });
    dbMock.groupMember.findUnique.mockResolvedValue({ id: "m1", userId: "user_1" });

    const result = await leaveGroupAction("group_1");
    expect(result).toEqual({ success: true });
    expect(dbMock.groupMember.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });
});

describe("deleteGroupAction", () => {
  it("rejects non-owners", async () => {
    dbMock.group.findUnique.mockResolvedValue(group); // owned by user_1
    sessionMock.getSession.mockResolvedValueOnce({ ...SESSION, userId: "user_2" });

    expect(await deleteGroupAction("group_1")).toEqual({
      error: "Only the group owner can delete this group.",
    });
    expect(dbMock.group.delete).not.toHaveBeenCalled();
  });

  it("deletes the group when called by the owner", async () => {
    dbMock.group.findUnique.mockResolvedValue(group);

    const result = await deleteGroupAction("group_1");
    expect(result).toEqual({ success: true });
    expect(dbMock.group.delete).toHaveBeenCalledWith({ where: { id: "group_1" } });
  });
});

describe("getUserGroups", () => {
  it("exposes the invite code to owners but hides it from members", async () => {
    dbMock.groupMember.findMany.mockResolvedValue([
      {
        id: "gm_1",
        userId: "user_1",
        groupId: "group_1",
        lastReadAt: new Date("2026-01-05T00:00:00Z"),
        joinedAt: new Date(),
        group: {
          id: "group_1",
          name: "Owned",
          code: "CHISMIS-ABC123",
          ownerId: "user_1",
          _count: { members: 2, messages: 10 },
        },
      },
      {
        id: "gm_2",
        userId: "user_1",
        groupId: "group_2",
        lastReadAt: null,
        joinedAt: new Date(),
        group: {
          id: "group_2",
          name: "Joined",
          code: "CHISMIS-XYZ789",
          ownerId: "user_9",
          _count: { members: 3, messages: 5 },
        },
      },
    ]);
    dbMock.message.count
      .mockResolvedValueOnce(4) // group_1: 4 unread since lastReadAt
      .mockResolvedValueOnce(2); // group_2: no lastReadAt → all 2 messages unread

    const groups = await getUserGroups();
    expect(groups).toHaveLength(2);

    const owned = groups.find((g: { id: string }) => g.id === "group_1");
    expect(owned!.code).toBe("CHISMIS-ABC123");
    expect(owned!.isOwner).toBe(true);
    expect(owned!.unreadCount).toBe(4);

    const joined = groups.find((g: { id: string }) => g.id === "group_2");
    // Non-owner must not receive the invite code via the RSC payload
    expect(joined!.code).toBe("");
    expect(joined!.isOwner).toBe(false);
    expect(joined!.unreadCount).toBe(2);
  });

  it("returns an empty list for unauthenticated users", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    expect(await getUserGroups()).toEqual([]);
    expect(dbMock.groupMember.findMany).not.toHaveBeenCalled();
  });
});

describe("getGroupDetails", () => {
  it("returns null for a non-existent group", async () => {
    dbMock.group.findUnique.mockResolvedValue(null);
    expect(await getGroupDetails("nope")).toBeNull();
  });

  it("returns null when the user is not a member", async () => {
    dbMock.group.findUnique.mockResolvedValue({
      ...group,
      members: [{ userId: "user_2", user: { id: "user_2", username: "other" } }],
    });
    expect(await getGroupDetails("group_1")).toBeNull();
  });

  it("returns details with the code only for the owner", async () => {
    dbMock.group.findUnique.mockResolvedValue({
      ...group,
      members: [
        { userId: "user_1", user: { id: "user_1", username: "chismosa" } },
        { userId: "user_2", user: { id: "user_2", username: "other" } },
      ],
    });

    const owner = await getGroupDetails("group_1");
    expect(owner).not.toBeNull();
    expect(owner!.code).toBe("CHISMIS-ABC123");
    expect(owner!.isOwner).toBe(true);
    expect(owner!.members).toHaveLength(2);

    sessionMock.getSession.mockResolvedValueOnce({ ...SESSION, userId: "user_2" });
    const member = await getGroupDetails("group_1");
    expect(member!.code).toBe("");
    expect(member!.isOwner).toBe(false);
  });
});