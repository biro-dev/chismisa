import type { Message } from "@/lib/types";

function dayLabel(date: Date): string {
  const now = new Date();
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${time}`;
  }
  return `${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} at ${time}`;
}

/**
 * Messenger-style centered time divider label. Returns the label to show
 * above `current`, or null when no divider is needed (message is close to
 * the previous one on the same day).
 *
 * Rules:
 * - First message (no prev) → always show a day-labelled divider.
 * - Day changed since the previous message → day-labelled divider.
 * - Same day but ≥60 min gap → plain clock-time divider.
 * - Otherwise → null (no divider).
 */
export function chatDividerLabel(
  prev: Pick<Message, "createdAt"> | null,
  current: Pick<Message, "createdAt">
): string | null {
  const date = new Date(current.createdAt);
  if (!prev) return dayLabel(date);

  const prevDate = new Date(prev.createdAt);
  if (date.toDateString() !== prevDate.toDateString()) {
    return dayLabel(date);
  }

  const gapMinutes = (date.getTime() - prevDate.getTime()) / 60_000;
  if (gapMinutes < 60) return null;

  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Centered, pill-styled time divider (Facebook Messenger style). */
export function TimeDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1" role="separator">
      <span className="rounded-full bg-zinc-800/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
    </div>
  );
}
