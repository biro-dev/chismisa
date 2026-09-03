import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // fixed reference point

describe("formatRelativeTime", () => {
  it('returns "now" for timestamps under a minute old', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe(
      "now"
    );
  });

  it("formats minutes", () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(
      "5m"
    );
  });

  it("formats hours", () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe(
      "3h"
    );
  });

  it("formats days under a week", () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe(
      "2d"
    );
  });

  it("formats older timestamps as a short date", () => {
    const result = formatRelativeTime(
      new Date(NOW - 10 * 86_400_000).toISOString(),
      NOW
    );
    expect(result).toBe("Jan 5");
  });

  it('returns "" for invalid input', () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });

  it('returns "now" for future timestamps (clock skew)', () => {
    expect(formatRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe(
      "now"
    );
  });
});
