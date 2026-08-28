import { describe, expect, it } from "vitest";
import { formatTypingIndicator } from "@/lib/hooks/use-chat";

describe("formatTypingIndicator", () => {
  it("returns an empty string for no typers", () => {
    expect(formatTypingIndicator([])).toBe("");
  });

  it("formats a single typer", () => {
    expect(formatTypingIndicator(["mara"])).toBe("mara is typing...");
  });

  it("formats two typers", () => {
    expect(formatTypingIndicator(["mara", "ana"])).toBe(
      "mara and ana are typing..."
    );
  });

  it("formats three or more typers with an others count", () => {
    expect(formatTypingIndicator(["mara", "ana", "joy"])).toBe(
      "mara and 2 others are typing..."
    );
    expect(formatTypingIndicator(["mara", "ana", "joy", "ben"])).toBe(
      "mara and 3 others are typing..."
    );
  });
});