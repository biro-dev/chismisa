import { describe, expect, it } from "vitest";
import { chatDividerLabel } from "@/components/time-divider";

const BASE = new Date("2026-03-15T14:30:00");

function msgAt(offsetMs: number) {
  return { createdAt: new Date(BASE.getTime() + offsetMs).toISOString() };
}

describe("chatDividerLabel", () => {
  it("always labels the first message of a conversation", () => {
    const label = chatDividerLabel(null, msgAt(0));
    expect(label).toMatch(/at 2:30 PM|14:30/);
  });

  it("returns null when messages are close together on the same day", () => {
    // 5 minutes later — no divider
    expect(chatDividerLabel(msgAt(0), msgAt(5 * 60_000))).toBeNull();
  });

  it("shows a plain clock time for a 1-hour-plus gap on the same day", () => {
    // 2 hours later, same day → plain time, no day prefix
    const label = chatDividerLabel(msgAt(0), msgAt(2 * 60 * 60_000));
    expect(label).toMatch(/^\d{1,2}:\d{2}/);
    expect(label!.toLowerCase()).not.toContain("at ");
  });

  it("labels the day when the date changes", () => {
    // Next day → Yesterday/Today-style day label
    const label = chatDividerLabel(msgAt(0), msgAt(24 * 60 * 60_000));
    expect(label).toMatch(/at \d{1,2}:\d{2}|:\d{2}\s*(AM|PM)/i);
    expect(label).not.toBeNull();
  });
});
