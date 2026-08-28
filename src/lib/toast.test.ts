import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissToast,
  getToasts,
  showToast,
  subscribeToasts,
} from "@/lib/toast";

beforeEach(() => {
  // Clear all toasts between tests
  getToasts().forEach((t) => dismissToast(t.id));
  vi.useRealTimers();
});

describe("toast store", () => {
  it("starts empty", () => {
    expect(getToasts()).toEqual([]);
  });

  it("adds a toast with a unique id and type", () => {
    const id = showToast("Copied!", "success");
    expect(getToasts()).toEqual([
      expect.objectContaining({ id, message: "Copied!", type: "success" }),
    ]);
  });

  it("defaults the type to success", () => {
    showToast("Welcome");
    expect(getToasts()[0].type).toBe("success");
  });

  it("dismisses a toast by id", () => {
    const id = showToast("one");
    showToast("two");
    dismissToast(id);
    expect(getToasts().map((t) => t.message)).toEqual(["two"]);
  });

  it("notifies subscribers when toasts change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    showToast("hello");
    expect(listener).toHaveBeenCalledTimes(1);
    dismissToast(getToasts()[0].id);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("auto-dismisses after the timeout", () => {
    vi.useFakeTimers();
    showToast("bye", "error");
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(3600);
    expect(getToasts()).toHaveLength(0);
  });
});