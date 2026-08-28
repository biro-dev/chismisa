import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const dbMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

const sessionMock = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/session", () => sessionMock);

import { loginAction } from "@/lib/actions/auth";

function makeForm(username: string, password: string): FormData {
  const fd = new FormData();
  fd.set("username", username);
  fd.set("password", password);
  return fd;
}

const existingUser = {
  id: "user_1",
  username: "chismosa",
  password: "", // set per-test via bcrypt.hash
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginAction", () => {
  it("rejects missing username or password", async () => {
    expect(await loginAction(undefined, makeForm("", "pass1234"))).toEqual({
      error: "Username and password are required.",
    });
    expect(await loginAction(undefined, makeForm("chismosa", ""))).toEqual({
      error: "Username and password are required.",
    });
  });

  it("rejects usernames outside 3-20 characters", async () => {
    expect(await loginAction(undefined, makeForm("ab", "pass1234"))).toEqual({
      error: "Username must be between 3 and 20 characters.",
    });
    expect(
      await loginAction(undefined, makeForm("a".repeat(21), "pass1234"))
    ).toEqual({ error: "Username must be between 3 and 20 characters." });
    // Neither validation nor DB lookup should have run
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 4 characters", async () => {
    expect(await loginAction(undefined, makeForm("chismosa", "abc"))).toEqual({
      error: "Password must be at least 4 characters.",
    });
  });

  it("requires an 8+ character password when auto-registering a new user", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);

    const result = await loginAction(undefined, makeForm("newbie", "short"));
    expect(result).toEqual({
      error: "New accounts require a password with at least 8 characters.",
    });
    expect(dbMock.user.create).not.toHaveBeenCalled();
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it("auto-registers a new user with a strong password", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({
      id: "user_2",
      username: "newbie",
      password: "hashed",
    });

    const result = await loginAction(undefined, makeForm("newbie", "longenough1"));
    expect(result).toEqual({ success: true });
    expect(dbMock.user.create).toHaveBeenCalledTimes(1);
    const created = dbMock.user.create.mock.calls[0][0].data;
    expect(created.username).toBe("newbie");
    // Password is stored hashed, not plaintext
    expect(created.password).not.toBe("longenough1");
    expect(await bcrypt.compare("longenough1", created.password)).toBe(true);
    expect(sessionMock.createSession).toHaveBeenCalledWith("user_2", "newbie");
  });

  it("rejects a wrong password for an existing user", async () => {
    existingUser.password = await bcrypt.hash("correct-pass", 10);
    dbMock.user.findUnique.mockResolvedValue({ ...existingUser });

    const result = await loginAction(undefined, makeForm("chismosa", "wrong-pass"));
    expect(result).toEqual({
      error: "Invalid credentials. Wrong password for this username.",
    });
    expect(sessionMock.createSession).not.toHaveBeenCalled();
  });

  it("logs in an existing user with the correct password", async () => {
    existingUser.password = await bcrypt.hash("correct-pass", 10);
    dbMock.user.findUnique.mockResolvedValue({ ...existingUser });

    const result = await loginAction(undefined, makeForm("chismosa", "correct-pass"));
    expect(result).toEqual({ success: true });
    expect(sessionMock.createSession).toHaveBeenCalledWith("user_1", "chismosa");
  });

  it("lets an existing user keep a short password (< 8 chars)", async () => {
    // Existing users aren't locked out by the newer 8-char registration rule
    existingUser.password = await bcrypt.hash("abc1", 10);
    dbMock.user.findUnique.mockResolvedValue({ ...existingUser });

    const result = await loginAction(undefined, makeForm("chismosa", "abc1"));
    expect(result).toEqual({ success: true });
  });

  it("handles the P2002 registration race: correct password wins", async () => {
    dbMock.user.findUnique
      .mockResolvedValueOnce(null) // initial lookup: user doesn't exist
      .mockResolvedValueOnce({ ...existingUser, password: await bcrypt.hash("longenough1", 10) }); // re-lookup after race
    dbMock.user.create.mockRejectedValue({ code: "P2002" });

    const result = await loginAction(undefined, makeForm("chismosa", "longenough1"));
    expect(result).toEqual({ success: true });
  });

  it("handles the P2002 registration race: wrong password is rejected", async () => {
    dbMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...existingUser, password: await bcrypt.hash("other-pass", 10) });
    dbMock.user.create.mockRejectedValue({ code: "P2002" });

    const result = await loginAction(undefined, makeForm("chismosa", "longenough1"));
    expect(result).toEqual({
      error: "Invalid credentials. Wrong password for this username.",
    });
  });

  it("returns a generic error when the database fails", async () => {
    dbMock.user.findUnique.mockRejectedValue(new Error("db down"));

    const result = await loginAction(undefined, makeForm("chismosa", "pass1234"));
    expect(result).toEqual({ error: "Something went wrong. Please try again." });
  });
});