// @vitest-environment jsdom
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  groupMember: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  message: { deleteMany: vi.fn(), findMany: vi.fn() },
}));

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));

const rateLimitMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session", () => sessionMock);
vi.mock("@/lib/rate-limit", () => rateLimitMock);

import { GET } from "@/app/api/messages/route";

const SESSION = {
  userId: "user_1",
  username: "chismosa",
  expiresAt: new Date(),
};

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/messages${query}`);
}

const DB_MESSAGE = {
  id: "msg_2",
  content: "Kumusta?",
  userId: "user_1",
  deletedAt: null,
  createdAt: new Date("2026-01-02T10:00:00Z"),
  user: { id: "user_1", username: "chismosa" },
  replyTo: {
    id: "msg_1",
    content: "Hi!",
    user: { username: "mara" },
  },
  reactions: [
    { id: "r_1", emoji: "😂", userId: "user_2", user: { username: "mara" } },
  ],
};

// Keep the probabilistic 30-day purge path out of these tests
vi.spyOn(Math, "random").mockReturnValue(0.5);

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.getSession.mockResolvedValue(SESSION);
  rateLimitMock.checkRateLimit.mockReturnValue(null);
  dbMock.groupMember.updateMany.mockResolvedValue({ count: 1 });
  dbMock.groupMember.findMany.mockResolvedValue([
    { userId: "user_1", lastReadAt: new Date("2026-01-02T11:00:00Z") },
    { userId: "user_2", lastReadAt: new Date("2026-01-02T12:00:00Z") },
  ]);
  dbMock.message.findMany.mockResolvedValue([DB_MESSAGE]);
  dbMock.message.deleteMany.mockResolvedValue({ count: 0 });
  // clearAllMocks resets the Math.random spy's mockReturnValue? No — it only
  // clears calls, but re-pin it to be safe.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

describe("GET /api/messages", () => {
  it("returns 401 for unauthenticated requests", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("?groupId=group_1"));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate-limited", async () => {
    rateLimitMock.checkRateLimit.mockReturnValueOnce(
      new Response(JSON.stringify({ error: "Too many requests." }), {
        status: 429,
      })
    );
    const res = await GET(makeRequest("?groupId=group_1"));
    expect(res.status).toBe(429);
  });

  it("returns 400 when groupId is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns 403 when the user is not a member of the group", async () => {
    dbMock.groupMember.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("?groupId=group_1"));
    expect(res.status).toBe(403);
  });

  it("marks the group as read and returns mapped messages", async () => {
    dbMock.groupMember.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      groupId: "group_1",
    });

    const res = await GET(makeRequest("?groupId=group_1"));
    expect(res.status).toBe(200);

    // Read receipt was refreshed for the current user
    expect(dbMock.groupMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", groupId: "group_1" },
      data: { lastReadAt: expect.any(Date) },
    });

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "msg_2",
      content: "Kumusta?",
      userId: "user_1",
      username: "chismosa",
      deletedAt: null,
      createdAt: "2026-01-02T10:00:00.000Z",
      replyTo: { id: "msg_1", content: "Hi!", username: "mara" },
      reactions: [
        { id: "r_1", emoji: "😂", userId: "user_2", username: "mara" },
      ],
    });
  });

  it("computes seenCount from other members' read states for own messages", async () => {
    dbMock.groupMember.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      groupId: "group_1",
    });

    const res = await GET(makeRequest("?groupId=group_1"));
    const body = await res.json();
    // user_2's lastReadAt (12:00) is after the message (10:00) → seen by 1
    expect(body[0].seenCount).toBe(1);
  });

  it("hides content of deleted messages", async () => {
    dbMock.groupMember.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      groupId: "group_1",
    });
    dbMock.message.findMany.mockResolvedValueOnce([
      { ...DB_MESSAGE, deletedAt: new Date("2026-01-02T10:05:00Z") },
    ]);

    const res = await GET(makeRequest("?groupId=group_1"));
    const body = await res.json();
    expect(body[0].content).toBe("");
    expect(body[0].deletedAt).toBe("2026-01-02T10:05:00.000Z");
  });

  it("passes since/before/limit filters through to the database query", async () => {
    dbMock.groupMember.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      groupId: "group_1",
    });

    const since = encodeURIComponent("2026-01-01T00:00:00Z");
    const before = encodeURIComponent("2026-01-03T00:00:00Z");
    await GET(
      makeRequest(`?groupId=group_1&since=${since}&before=${before}&limit=10`)
    );

    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          groupId: "group_1",
          createdAt: {
            gt: new Date("2026-01-01T00:00:00Z"),
            lt: new Date("2026-01-03T00:00:00Z"),
          },
        },
        take: 10,
      })
    );
  });

  it("clamps the limit to the 1-200 range and defaults invalid values", async () => {
    dbMock.groupMember.findUnique.mockResolvedValue({
      userId: "user_1",
      groupId: "group_1",
    });

    await GET(makeRequest("?groupId=group_1&limit=9999"));
    expect(dbMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );

    await GET(makeRequest("?groupId=group_1&limit=not-a-number"));
    expect(dbMock.message.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });
});