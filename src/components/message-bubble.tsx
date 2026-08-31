"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerUpLeft, Pencil, Plus, Search, Smile, Trash2, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { Message, MessageReaction } from "@/lib/types";
import { EMOJI_CATEGORIES, QUICK_EMOJIS, searchEmojis } from "@/lib/emoji-data";

// Check if Haptics plugin is available
const hapticsAvailable = Capacitor.isPluginAvailable("Haptics");

function triggerHaptic(style: ImpactStyle) {
  if (hapticsAvailable) {
    Haptics.impact({ style }).catch(() => {});
  }
}

// Messenger-style default reactions (left to right)
const MESSENGER_REACTIONS = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83E\uDD70", "\uD83D\uDE02", "\uD83D\uDE2E", "\uD83D\uDE22", "\uD83D\uDE21"];
const SWIPE_TRIGGER_PX = 60;
const LONG_PRESS_MS = 450;

// Deep-compare reactions to avoid re-rendering bubbles when data didn\'t change
const areReactionsEqual = (a: MessageReaction[], b: MessageReaction[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].emoji !== b[i].emoji ||
      a[i].userId !== b[i].userId
    ) {
      return false;
    }
  }
  return true;
};

// Custom memo comparator - only re-renders a bubble when its own data changed.
type MessageBubbleProps = {
  msg: Message;
  isOwn: boolean;
  userId: string;
  onReply: (msg: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => Promise<{ error?: string }>;
};
const messageBubbleAreEqual = (
  prev: MessageBubbleProps,
  next: MessageBubbleProps
) => {
  if (prev.msg.id !== next.msg.id) return false;
  if (prev.msg.content !== next.msg.content) return false;
  if (prev.msg.editedAt !== next.msg.editedAt) return false;
  if (prev.msg.username !== next.msg.username) return false;
  if (prev.msg.createdAt !== next.msg.createdAt) return false;
  if (prev.isOwn !== next.isOwn) return false;
  if (prev.userId !== next.userId) return false;
  if (prev.msg.replyTo?.id !== next.msg.replyTo?.id) return false;
  if (prev.msg.replyTo?.content !== next.msg.replyTo?.content) return false;
  if (prev.msg.replyTo?.username !== next.msg.replyTo?.username) return false;
  if (!areReactionsEqual(prev.msg.reactions || [], next.msg.reactions || []))
    return false;
  return true;
};

// Memoized message bubble - only re-renders when its own message data changes
export const MessageBubble = memo(function MessageBubble({
  msg,
  isOwn,
  userId,
  onReply,
  onReact,
  onDelete,
  onEdit,
}: MessageBubbleProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [highlightedEmoji, setHighlightedEmoji] = useState<string | null>(null);
  // Full emoji picker state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  // Inline edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiSearchRef = useRef<HTMLInputElement>(null);
  const [overlayAnchor, setOverlayAnchor] = useState<{
    x: number;
    y: number;
    bottomY: number;
    below: boolean;
  } | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureModeRef = useRef<"idle" | "pending" | "longpress" | "swipe">("idle");
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const lastPointerTypeRef = useRef<string>("mouse");
  const highlightedEmojiRef = useRef<string | null>(null);
  // Filter emojis based on search query
  const filteredEmojis = useMemo(() => {
    if (!emojiSearchQuery.trim()) return null;
    return searchEmojis(emojiSearchQuery);
  }, [emojiSearchQuery]);

  // Reset search when closing picker
  useEffect(() => {
    if (!emojiPickerOpen) {
      setEmojiSearchQuery("");
      setActiveEmojiCategory(0);
    }
  }, [emojiPickerOpen]);

  // Group reactions by emoji - memoized so it only recomputes when reactions change
  const groupedReactions = useMemo(() => {
    const grouped = new Map<string, MessageReaction[]>();
    for (const r of msg.reactions || []) {
      const existing = grouped.get(r.emoji) || [];
      existing.push(r);
      grouped.set(r.emoji, existing);
    }
    return Array.from(grouped.entries());
  }, [msg.reactions]);

  // Close overlay when another bubble opens its overlay
  useEffect(() => {
    if (!overlayOpen) return;
    const handler = () => setOverlayOpen(false);
    window.addEventListener("chismis-overlay-close", handler);
    return () => window.removeEventListener("chismis-overlay-close", handler);
  }, [overlayOpen]);

  // Lock body scroll while the overlay is open
  useEffect(() => {
    if (!overlayOpen && !emojiPickerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlayOpen, emojiPickerOpen]);

  // Dismiss the reaction overlay if the chat scrolls underneath it or the
  // window resizes, but ignore scrolls originating inside the overlay itself
  // (e.g. the emoji picker's scrollable grid).
  useEffect(() => {
    if (!overlayOpen) return;
    const dismiss = () => setOverlayOpen(false);
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (
        target &&
        (pickerRef.current?.contains(target) ||
          emojiPickerRef.current?.contains(target))
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [overlayOpen]);

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  // Clean up timer on unmount
  useEffect(() => clearPressTimer, [clearPressTimer]);
  const openOverlay = useCallback(() => {
    // Close any other open overlay
    window.dispatchEvent(new Event("chismis-overlay-close"));
    const el = bubbleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = rect.top < 300;
    // Clamp so the pill (half-width ~170px) never exits the viewport. On very
    // narrow viewports (<340px) the clamp bounds conflict — center instead.
    const vw = typeof window !== "undefined" ? window.innerWidth : 360;
    const centerX = Math.round(rect.left + rect.width / 2);
    const x =
      vw < 340 ? Math.round(vw / 2) : Math.max(170, Math.min(vw - 170, centerX));
    setOverlayAnchor({
      x,
      y: Math.round(rect.top),
      bottomY: Math.round(rect.bottom),
      below,
    });
    setOverlayOpen(true);
    setHighlightedEmoji(null);
    highlightedEmojiRef.current = null;
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setHighlightedEmoji(null);
    highlightedEmojiRef.current = null;
  }, []);

  // --- Touch gesture handling on the bubble ---
  // - Long-press (>450ms) opens the reaction overlay
  // - Horizontal swipe (>60px) triggers reply
  // - Scroll is still possible vertically (touch-action: pan-y)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (msg.deletedAt || isEditing) return;
      const isTouch = e.pointerType !== "mouse";
      lastPointerTypeRef.current = e.pointerType;
      suppressClickRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      gestureModeRef.current = "pending";
      // Capture the pointer for touch so we keep receiving pointerup/cancel
      // even when the finger leaves the bubble mid-gesture. (Mouse is NOT
      // captured: a desktop drag-off-release shouldn't synthesize a click —
      // the window-level safety net below resets the mode instead.)
      if (isTouch) {
        e.currentTarget.setPointerCapture(e.pointerId);
        // Long-press threshold
        pressTimerRef.current = setTimeout(() => {
          if (gestureModeRef.current !== "pending") return;
          gestureModeRef.current = "longpress";
          triggerHaptic(ImpactStyle.Light);
          openOverlay();
        }, LONG_PRESS_MS);
      }
    },
    [msg.deletedAt, isEditing, openOverlay]
  );

  // Block the native long-press "select to copy" UI on touch pointers: it
  // highlights the text and fires pointercancel, which kills the long-press
  // timer before the reaction overlay can open. Desktop right-click (mouse)
  // is left untouched.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (lastPointerTypeRef.current !== "mouse") {
        e.preventDefault();
      }
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = startPosRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;

      if (gestureModeRef.current === "pending") {
        // Movement cancels long-press unless it's a clear horizontal swipe
        // in the bubble's swipe direction (received: right, own: left)
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const validDir = isOwn ? dx < 0 : dx > 0;
        if (absDx > 14 && absDx > absDy * 1.2 && validDir) {
          clearPressTimer();
          gestureModeRef.current = "swipe";
          setIsSwiping(true);
          suppressClickRef.current = true;
          setSwipeX(
            isOwn ? Math.max(-110, Math.min(0, dx)) : Math.min(110, Math.max(0, dx))
          );
        } else if (absDy > 14 || (absDx > 14 && absDy > absDx)) {
          // Vertical or diagonal movement - cancel long-press
          clearPressTimer();
          gestureModeRef.current = "idle";
        }
        return;
      }

      if (gestureModeRef.current === "swipe") {
        // Follow finger 1:1, clamp to 110px in the swipe direction
        const next = isOwn
          ? Math.max(-110, Math.min(0, dx))
          : Math.min(110, Math.max(0, dx));
        setSwipeX(next);
      }
    },
    [clearPressTimer, isOwn]
  );

  const finishSwipe = useCallback(
    (threshold: boolean) => {
      const start = startPosRef.current;
      if (threshold && start) {
        onReply(msg);
      }
      setSwipeX(0);
    },
    [onReply, msg]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      clearPressTimer();
      const start = startPosRef.current;
      if (gestureModeRef.current === "swipe") {
        const dx = e.clientX - (start?.x ?? e.clientX);
        finishSwipe(Math.abs(dx) >= SWIPE_TRIGGER_PX);
        gestureModeRef.current = "idle";
        startPosRef.current = null;
        setIsSwiping(false);
        suppressClickRef.current = true;
        requestAnimationFrame(() => {
          suppressClickRef.current = false;
        });
        return;
      }
      if (gestureModeRef.current === "longpress") {
        // Keep overlay open - pointer release shouldn't immediately close it
        gestureModeRef.current = "idle";
        startPosRef.current = null;
        return;
      }
      gestureModeRef.current = "idle";
      startPosRef.current = null;
    },
    [clearPressTimer, finishSwipe]
  );

  const handlePointerCancel = useCallback(() => {
    clearPressTimer();
    startPosRef.current = null;
    gestureModeRef.current = "idle";
    setIsSwiping(false);
    setSwipeX(0);
  }, [clearPressTimer]);

  // Safety net: if a mouse gesture ends outside the bubble (drag off, release
  // elsewhere), no pointerup reaches the bubble's handlers and a stale
  // "pending"/"swipe" mode would swallow the next click. Reset on any
  // window-level pointer end that the bubble handlers didn't already handle.
  useEffect(() => {
    const onWindowPointerEnd = () => {
      if (gestureModeRef.current === "idle") return;
      clearPressTimer();
      gestureModeRef.current = "idle";
      startPosRef.current = null;
      setIsSwiping(false);
      setSwipeX(0);
    };
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };
  }, [clearPressTimer]);

  // Desktop: click toggles overlay (suppressed after a swipe/long-press)
  // Touch uses long-press only - quick taps shouldn't open the overlay
  const handleBubbleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (msg.deletedAt || isEditing) return;
      if (suppressClickRef.current) return;
      if (gestureModeRef.current !== "idle") return;
      const pt = (e.nativeEvent as PointerEvent | undefined)?.pointerType;
      if (pt === "touch" || pt === "pen") return;
      openOverlay();
    },
    [msg.deletedAt, isEditing, openOverlay]
  );
  // --- Inline editing ---

  const startEditing = useCallback(() => {
    setEditDraft(msg.content);
    setEditError("");
    setIsEditing(true);
    setOverlayOpen(false);
    requestAnimationFrame(() => editInputRef.current?.focus());
  }, [msg.content]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditDraft("");
    setEditError("");
  }, []);

  const saveEdit = useCallback(async () => {
    const result = await onEdit(msg.id, editDraft);
    if (result.error) {
      setEditError(result.error);
      return;
    }
    setIsEditing(false);
    setEditDraft("");
    setEditError("");
  }, [onEdit, msg.id, editDraft]);

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      onReact(msg.id, emoji);
      setEmojiPickerOpen(false);
      setOverlayOpen(false);
      setHighlightedEmoji(null);
      highlightedEmojiRef.current = null;
    },
    [msg.id, onReact]
  );

  const commitReaction = useCallback(
    (emoji: string) => {
      onReact(msg.id, emoji);
      triggerHaptic(ImpactStyle.Medium);
      setOverlayOpen(false);
      setHighlightedEmoji(null);
      highlightedEmojiRef.current = null;
    },
    [msg.id, onReact]
  );

  // Esc closes the overlay or emoji picker
  useEffect(() => {
    if (!overlayOpen && !emojiPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOverlayOpen(false);
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlayOpen, emojiPickerOpen]);

  // Click outside the emoji picker closes it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node)
      ) {
        setEmojiPickerOpen(false);
      }
    }
    if (emojiPickerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [emojiPickerOpen]);
  return (
    <div
      data-message-id={msg.id}
      className={`group msg-bubble flex ${
        isOwn ? "justify-end" : "justify-start"
      } ${groupedReactions.length > 0 ? "pb-3" : ""}`}
    >
      <div
        className={`w-fit min-w-0 max-w-[85%] sm:max-w-[70%] ${
          isOwn ? "items-end" : "items-start"
        }`}
      >
        <p
          className={`mb-1 text-xs font-medium ${
            isOwn ? "text-right text-fuchsia-400" : "text-purple-400"
          }`}
        >
          {isOwn ? "You" : msg.username}
        </p>
        <div
          ref={bubbleRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClick={handleBubbleClick}
          onContextMenu={handleContextMenu}
          className={`msg-bubble-interactive relative rounded-2xl px-4 pt-2.5 pb-3 text-sm transition-transform duration-300 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)] select-none ${
            msg.deletedAt
              ? "border border-dashed border-zinc-700 italic text-zinc-500"
              : isOwn
              ? "rounded-br-sm bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
              : "rounded-bl-sm bg-zinc-800 text-zinc-100"
          }`}
          style={{
            transform: `translateX(${swipeX}px)`,
            transition: isSwiping ? "none" : undefined,
          }}
        >
          {/* Reply indicator */}
          {msg.replyTo && !msg.deletedAt && (
            <div
              className={`mb-2 flex items-start gap-1.5 border-l-2 pl-2 text-xs ${
                isOwn
                  ? "border-white/40 text-white/80"
                  : "border-purple-400/60 text-zinc-400"
              }`}
            >
              <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Replying to {msg.replyTo.username}</p>
                <p className="truncate opacity-80">
                  {msg.replyTo.content || "Original message was deleted"}
                </p>
              </div>
            </div>
          )}
          {msg.deletedAt ? (
            <p className="italic">Message unsent</p>
          ) : isEditing ? (
            <div className="space-y-2">
              <textarea
                ref={editInputRef}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  } else if (e.key === "Escape") {
                    cancelEditing();
                  }
                }}
                rows={Math.min(4, Math.max(1, editDraft.split("\n").length))}
                maxLength={2000}
                placeholder="Edit your message..."
                className="w-full resize-none rounded-lg bg-black/20 p-2 text-sm text-white outline-none placeholder:text-zinc-400"
              />
              {editError && <p className="text-xs text-red-300">{editError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelEditing}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-300 transition-colors hover:bg-black/20"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editDraft.trim()}
                  className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {msg.content}
              {!msg.deletedAt && msg.editedAt && (
                <span className="ml-1 align-baseline text-[10px] italic opacity-70">
                  (edited)
                </span>
              )}
            </p>
          )}

          {/* Applied reaction badges - overlapping on the bubble's bottom corner */}
          {!msg.deletedAt && groupedReactions.length > 0 && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute bottom-[-10px] z-10 flex ${
                isOwn ? "right-2" : "left-2"
              }`}
            >
              {groupedReactions.slice(0, 3).map(([emoji, reactions], i) => (
                <button
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReact(msg.id, emoji);
                  }}
                  className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs shadow-md transition-transform hover:scale-105 ${
                    reactions.some((r) => r.userId === userId)
                      ? "border-purple-400 bg-purple-600 text-white"
                      : "border-zinc-700 bg-[#150d24] text-zinc-200"
                  } ${i > 0 ? "-ml-1.5" : ""}`}
                  title={`${reactions.map((r) => r.username).join(", ")}`}
                >
                  <span className="mr-0.5">{emoji}</span>
                  <span className="font-semibold">{reactions.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Read receipt — below the bubble (in flow) so it can never overlap
            the message text or the reaction badges */}
        {isOwn && !msg.deletedAt && (msg.seenCount ?? 0) > 0 && (
          <p className="mt-0.5 pr-1 text-right text-[10px] leading-none text-emerald-400">
            Seen by {msg.seenCount}
          </p>
        )}
      </div>

      {/* --- Messenger-style reaction/action overlay (portaled to body) --- */}
      {overlayOpen &&
      !msg.deletedAt &&
      !isEditing &&
      overlayAnchor &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[70] backdrop-blur-[2px]"
              style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
              onClick={closeOverlay}
            >
              {/* Reaction pill + action menu anchored above/below the bubble */}
              <div
                ref={pickerRef}
                onClick={(e) => e.stopPropagation()}
                className={`absolute z-10 flex items-center gap-2 ${
                  overlayAnchor.below ? "flex-col" : "flex-col-reverse"
                }`}
                style={{
                  left: overlayAnchor.x,
                  transform: "translateX(-50%)",
                  ...(overlayAnchor.below
                    ? { top: overlayAnchor.bottomY + 8 }
                    : {
                        bottom:
                          (typeof window !== "undefined"
                            ? window.innerHeight
                            : 800) -
                          overlayAnchor.y +
                          8,
                      }),
                }}
              >
                {/* Action menu - stack above the pill */}
                <div
                  className={`mb-2 flex items-center gap-1 rounded-2xl bg-white p-1 shadow-lg ${
                    overlayAnchor.below ? "flex-row" : "flex-col"
                  } animate-reaction-picker`}
                >
                                    {/* React option - opens full emoji picker */}
                  <button
                    title="React"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmojiPickerOpen(true);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                  >
                    <Smile className="h-4 w-4" /> React
                  </button>
                                    {!isOwn && (
                    <button
                      title="Reply"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReply(msg);
                        setOverlayOpen(false);
                      }}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                    >
                      <CornerUpLeft className="h-4 w-4" /> Reply
                    </button>
                  )}
                  {isOwn && (
                    <>
                      <button
                        title="Reply"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReply(msg);
                          setOverlayOpen(false);
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                      >
                        <CornerUpLeft className="h-4 w-4" /> Reply
                      </button>
                      <button
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing();
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                      <button
                        title="Delete message"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(msg.id);
                          setOverlayOpen(false);
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </>
                  )}
                </div>

                {/* White reaction pill */}
                <div
                  className="flex items-center gap-1 rounded-[30px] bg-white px-3 py-2 animate-reaction-picker"
                  style={{ boxShadow: "0px 8px 24px rgba(0,0,0,0.18)" }}
                >
                  {MESSENGER_REACTIONS.map((emoji, index) => (
                    <button
                      key={emoji}
                      data-emoji={emoji}
                      onClick={(e) => {
                        e.stopPropagation();
                        commitReaction(emoji);
                      }}
                      className={`relative rounded-full p-1 text-2xl leading-none transition-transform duration-100 animate-emoji-pop transform-gpu ${
                        highlightedEmoji === emoji
                          ? "scale-[1.3] -translate-y-1"
                          : "hover:scale-[1.3] hover:-translate-y-1"
                      }`}
                      style={{ animationDelay: `${index * 40}ms` }}
                      title={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                  {/* Open full emoji picker */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmojiPickerOpen(true);
                    }}
                    className="flex items-center justify-center rounded-full border border-gray-200 p-1 text-lg text-gray-600 transition-colors hover:bg-gray-100"
                    title="More emojis"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* --- Full Emoji Picker Modal (portaled) --- */}
      {emojiPickerOpen &&
        (typeof document !== "undefined"
          ? createPortal(
              <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
                <div
                  ref={emojiPickerRef}
                  className="flex max-h-[88dvh] w-full max-w-sm flex-col rounded-2xl border border-zinc-700 bg-[#150d24] shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                    <h3 className="font-semibold text-zinc-200">React with emoji</h3>
                    <button
                      onClick={() => setEmojiPickerOpen(false)}
                      className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="px-4 py-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        ref={emojiSearchRef}
                        type="text"
                        placeholder="Search emoji..."
                        value={emojiSearchQuery}
                        onChange={(e) => setEmojiSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-zinc-600 bg-zinc-800 py-2 pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  {/* Quick Emojis (hidden while searching) */}
                  {!emojiSearchQuery && (
                    <div className="px-4 pb-2">
                      <div className="flex flex-wrap gap-1">
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleSelectEmoji(emoji)}
                            className="rounded-lg p-2 text-xl transition-colors hover:bg-zinc-700"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Category Tabs (hidden while searching) */}
                  {!emojiSearchQuery && (
                    <div className="flex gap-1 overflow-x-auto border-b border-zinc-700 px-4 pb-2">
                      {EMOJI_CATEGORIES.map((category, index) => (
                        <button
                          key={category.name}
                          onClick={() => setActiveEmojiCategory(index)}
                          className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                            activeEmojiCategory === index
                              ? "bg-purple-600 text-white"
                              : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                          }`}
                        >
                          <span>{category.icon}</span>
                          <span className="hidden sm:inline">{category.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Emoji Grid */}
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {filteredEmojis ? (
                      filteredEmojis.length > 0 ? (
                        <div className="grid grid-cols-8 gap-1">
                          {filteredEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => handleSelectEmoji(emoji)}
                              className="rounded-lg p-2 text-xl transition-colors hover:bg-zinc-700"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="py-8 text-center text-zinc-500">
                          No emoji found for &quot;{emojiSearchQuery}&quot;
                        </p>
                      )
                    ) : (
                      <div className="grid grid-cols-8 gap-1">
                        {EMOJI_CATEGORIES[activeEmojiCategory]?.emojis.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleSelectEmoji(emoji)}
                            className="rounded-lg p-2 text-xl transition-colors hover:bg-zinc-700"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null)}
    </div>
  );
},
messageBubbleAreEqual);
