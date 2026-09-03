"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerUpLeft, Pencil, Plus, RefreshCw, Search, Smile, Trash2, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { Message, MessageReaction } from "@/lib/types";
import { EMOJI_CATEGORIES, QUICK_EMOJIS, searchEmojis } from "@/lib/emoji-data";

function triggerHaptic(style: ImpactStyle) {
  if (Capacitor.isPluginAvailable("Haptics")) {
    Haptics.impact({ style }).catch(() => {});
  }
}

// Circular upload progress — Messenger-style ring shown over media bubbles
// while the attachment is still uploading.
function UploadProgressRing({ progress }: { progress: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, progress));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={radius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span className="absolute text-[9px] font-semibold text-white">
        {Math.round(clamped)}%
      </span>
    </div>
  );
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
  /** Retries a media upload that failed (own optimistic bubbles only). */
  onMediaRetry?: (messageId: string) => void;
  /**
   * Messenger-style clustering: this message directly follows another from
   * the same sender, so the name label is hidden and the tail corner is
   * squared off. Defaults to false (standalone bubble).
   */
  grouped?: boolean;
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
  // Media fields — the optimistic upload flow mutates these on the fly
  if (prev.msg.mediaUrl !== next.msg.mediaUrl) return false;
  if (prev.msg.mediaStatus !== next.msg.mediaStatus) return false;
  if (prev.msg.mediaProgress !== next.msg.mediaProgress) return false;
  if (prev.onMediaRetry !== next.onMediaRetry) return false;
  if (prev.grouped !== next.grouped) return false;
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
  onMediaRetry,
  grouped = false,
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

  // Close the emoji picker and reset its transient search/category state.
  // Done at the call sites (event handlers) rather than in an effect to avoid
  // cascading setState-in-effect renders.
  const closeEmojiPicker = useCallback(() => {
    setEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setActiveEmojiCategory(0);
  }, []);

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
      closeEmojiPicker();
      setOverlayOpen(false);
      setHighlightedEmoji(null);
      highlightedEmojiRef.current = null;
    },
    [msg.id, onReact, closeEmojiPicker]
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
        closeEmojiPicker();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlayOpen, emojiPickerOpen, closeEmojiPicker]);

  // Click outside the emoji picker closes it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node)
      ) {
        closeEmojiPicker();
      }
    }
    if (emojiPickerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [emojiPickerOpen, closeEmojiPicker]);
  return (
    <div
      data-message-id={msg.id}
      className={`group msg-bubble animate-bubble-in flex ${
        isOwn ? "justify-end" : "justify-start"
      } ${grouped ? "mt-0.5" : ""} ${
        groupedReactions.length > 0 ? "pb-3" : ""
      }`}
    >
      <div
        className={`w-fit min-w-0 max-w-[85%] sm:max-w-[70%] ${
          isOwn ? "items-end" : "items-start"
        }`}
      >
        {/* Sender name — hidden for clustered (grouped) messages, Messenger-style */}
        {!grouped && (
          <p
            className={`mb-1 text-xs font-medium ${
              isOwn ? "text-right text-gossip" : "text-ink-muted"
            }`}
          >
            {isOwn ? "You" : msg.username}
          </p>
        )}
        <div
          ref={bubbleRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClick={handleBubbleClick}
          onContextMenu={handleContextMenu}
          className={`msg-bubble-interactive relative rounded-[18px] px-4 pt-2.5 pb-3 text-sm transition-transform duration-300 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)] select-none ${
            msg.deletedAt
              ? "border border-dashed border-hairline italic text-ink-muted"
              : isOwn
              ? `bg-gossip-deep text-white ${
                  grouped ? "rounded-br-[18px]" : "rounded-br-[6px]"
                }`
              : `bg-surface text-ink-text ${
                  grouped ? "rounded-bl-[18px]" : "rounded-bl-[6px]"
                }`
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
                  : "border-gossip/60 text-ink-muted"
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
            <>
              {/* Media attachment */}
              {msg.mediaUrl && msg.mediaType && (
                <div className="relative mb-2">
                  {msg.mediaType === "image" && (
                    <img
                      src={msg.mediaUrl}
                      alt={`Image shared by ${msg.username}`}
                      loading="lazy"
                      decoding="async"
                      className="max-h-60 max-w-full cursor-pointer rounded-xl object-contain"
                      onClick={() => {
                        // Open fullscreen lightbox
                        window.open(msg.mediaUrl!, "_blank");
                      }}
                    />
                  )}
                  {msg.mediaType === "video" && (
                    <video
                      src={msg.mediaUrl}
                      poster={msg.mediaThumb ?? undefined}
                      controls
                      preload="metadata"
                      aria-label={`Video shared by ${msg.username}`}
                      className="max-h-60 max-w-full rounded-xl"
                    />
                  )}
                  {msg.mediaType === "voice" && (
                    <div className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2">
                      <audio src={msg.mediaUrl} preload="metadata" className="hidden" id={`audio-${msg.id}`} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const audio = document.getElementById(`audio-${msg.id}`) as HTMLAudioElement;
                          if (audio) {
                            if (audio.paused) audio.play();
                            else audio.pause();
                          }
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-white"
                      >
                        ▶
                      </button>
                      <div className="flex-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                          <div className="h-full w-0 rounded-full bg-white/60" />
                        </div>
                        {msg.mediaDuration && (
                          <p className="mt-0.5 text-[10px] opacity-70">
                            {Math.floor(msg.mediaDuration / 60)}:{(msg.mediaDuration % 60).toString().padStart(2, "0")}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                {/* Uploading overlay — Messenger-style progress ring */}
                {msg.mediaStatus === "uploading" && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/50">
                    <UploadProgressRing progress={msg.mediaProgress ?? 0} />
                  </div>
                )}
                {/* Failed upload — tap the bubble to retry */}
                {msg.mediaStatus === "failed" && isOwn && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMediaRetry?.(msg.id);
                    }}
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/60 text-white transition-colors hover:bg-black/70"
                    title="Tap to retry"
                  >
                    <RefreshCw className="h-6 w-6" />
                    <span className="text-xs font-medium">Tap to retry</span>
                  </button>
                )}
                </div>
              )}
              {/* Text content */}
              {msg.content && (
                <p className="whitespace-pre-wrap break-words">
                  {msg.content}
                  {!msg.deletedAt && msg.editedAt && (
                    <span className="ml-1 align-baseline text-[10px] italic opacity-70">
                      (edited)
                    </span>
                  )}
                </p>
              )}
              {/* Media-only message with no caption — show type indicator */}
              {!msg.content && msg.mediaUrl && msg.mediaType === "voice" && (
                <p className="text-[10px] italic opacity-50">Voice message</p>
              )}
            </>
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
                      ? "border-gossip bg-gossip-deep text-white"
                      : "border-hairline bg-surface-raised text-ink-text"
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
          <p className="mt-0.5 pr-1 text-right text-[10px] leading-none text-gossip">
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
                  className={`mb-2 flex items-center gap-1 rounded-2xl bg-surface-raised p-1 shadow-xl ${
                    overlayAnchor.below ? "flex-row" : "flex-col"
                  } animate-reaction-picker`}
                >
                                    {/* React option - opens full emoji picker */}
                  <button
                    title="React"
                    aria-label="Open emoji picker"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmojiPickerOpen(true);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-text transition-colors hover:bg-white/10"
                  >
                    <Smile className="h-4 w-4" /> React
                  </button>
                                    {!isOwn && (
                    <button
                      title="Reply"
                      aria-label="Reply to this message"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReply(msg);
                        setOverlayOpen(false);
                      }}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-text transition-colors hover:bg-white/10"
                    >
                      <CornerUpLeft className="h-4 w-4" /> Reply
                    </button>
                  )}
                  {isOwn && (
                    <>
                      <button
                        title="Reply"
                        aria-label="Reply to this message"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReply(msg);
                          setOverlayOpen(false);
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-text transition-colors hover:bg-white/10"
                      >
                        <CornerUpLeft className="h-4 w-4" /> Reply
                      </button>
                      <button
                        title="Edit"
                        aria-label="Edit this message"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing();
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-text transition-colors hover:bg-white/10"
                      >
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                      <button
                        title="Delete message"
                        aria-label="Delete this message"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(msg.id);
                          setOverlayOpen(false);
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </>
                  )}
                </div>

                {/* White reaction pill */}
                <div
                  className="flex items-center gap-1 rounded-[30px] bg-surface-raised px-3 py-2 animate-reaction-picker"
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
                    className="flex items-center justify-center rounded-full border border-hairline p-1 text-lg text-ink-muted transition-colors hover:bg-white/10"
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
                  className="app-max-h flex w-full max-w-sm flex-col rounded-2xl border border-hairline bg-surface-raised shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                    <h3 className="font-semibold text-ink-text">React with emoji</h3>
                    <button
                      onClick={closeEmojiPicker}
                      className="rounded-lg p-1 text-ink-muted hover:bg-white/10 hover:text-ink-text"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="px-4 py-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                      <input
                        ref={emojiSearchRef}
                        type="text"
                        placeholder="Search emoji..."
                        value={emojiSearchQuery}
                        onChange={(e) => setEmojiSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-hairline bg-surface py-2 pl-10 pr-4 text-sm text-ink-text placeholder:text-ink-muted focus:border-gossip focus:outline-none"
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
                            className="rounded-lg p-2 text-xl transition-colors hover:bg-white/10"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Category Tabs (hidden while searching) */}
                  {!emojiSearchQuery && (
                    <div className="flex gap-1 overflow-x-auto border-b border-hairline px-4 pb-2">
                      {EMOJI_CATEGORIES.map((category, index) => (
                        <button
                          key={category.name}
                          onClick={() => setActiveEmojiCategory(index)}
                          className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                            activeEmojiCategory === index
                              ? "bg-gossip-deep text-white"
                              : "text-ink-muted hover:bg-white/10 hover:text-ink-text"
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
                              className="rounded-lg p-2 text-xl transition-colors hover:bg-white/10"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="py-8 text-center text-ink-muted">
                          No emoji found for &quot;{emojiSearchQuery}&quot;
                        </p>
                      )
                    ) : (
                      <div className="grid grid-cols-8 gap-1">
                        {EMOJI_CATEGORIES[activeEmojiCategory]?.emojis.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleSelectEmoji(emoji)}
                            className="rounded-lg p-2 text-xl transition-colors hover:bg-white/10"
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
