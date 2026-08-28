// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  groupMember: { findMany: vi.fn() },
  message: { count: vi.fn() },
}));

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));

const rateLimitMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session", () => sessionMock);
vi.mock("@/lib/rate-limit", () => rateLimitMock);

import { GET } from "@/app/api/groups/route";

const SESSION = { userId: "user_1", username: "chismosa", expiresAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.getSession.mockResolvedValue(SESSION);
  rateLimitMock.checkRateLimit.mockReturnValue(null);
});

describe("GET /api/groups", () => {
  it("returns 401 for unauthenticated requests", async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate-limited", async () => {
    rateLimitMock.checkRateLimit.mockReturnValueOnce(
      new Response(JSON.stringify({ error: "Too many requests." }), {
        status: 429,
      })
    );
    const res = await GET();
    expect(res.status).toBe(429);
  });

  it("returns the groups with unread counts and no invite codes for non-owners", async () => {
    dbMock.groupMember.findMany.mockResolvedValue([
      {
        id: "gm_1",
        userId: "user_1",
        groupId: "group_1",
        lastReadAt: new Date("2026-01-05T00:00:00Z"),
        group: {
          id: "group_1",
          name: "Owned",
          code: "SECRET-1",
          ownerId: "user_1",
          _count: { members: 2, messages: 10 },
        },
      },
      {
        id: "gm_2",
        userId: "user_1",
        groupId: "group_2",
        lastReadAt: null,
        group: {
          id: "group_2",
          name: "Joined",
          code: "SECRET-2",
          ownerId: "user_9",
          _count: { members: 3, messages: 5 },
        },
      },
    ]);
    dbMock.message.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: "group_1", unreadCount: 4, code: "SECRET-1" });
    expect(body[1]).toMatchObject({ id: "group_2", unreadCount: 2, code: "" });
  });
});
