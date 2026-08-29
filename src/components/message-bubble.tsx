"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Deep-compare reactions to avoid re-rendering bubbles when data didn't change
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

// Custom memo comparator — only re-renders a bubble when its own data changed.
// This prevents every bubble from re-rendering on each 30s poll.
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

// Memoized message bubble — only re-renders when its own message data changes
export const MessageBubble = memo(function MessageBubble({
  msg,
  isOwn,
  userId,
  onReply,
  onReact,
  onDelete,
  onEdit,
}: MessageBubbleProps) {
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [highlightedEmoji, setHighlightedEmoji] = useState<string | null>(null);
  // Full emoji picker state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  // Inline edit state — the editor lives in the bubble so each message owns
  // its own open/closed state without any global tracking.
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const highlightedEmojiRef = useRef<string | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiSearchRef = useRef<HTMLInputElement>(null);

  // Filter emojis based on search query
  const filteredEmojis = useMemo(() => {
    if (!emojiSearchQuery.trim()) return null;
    return searchEmojis(emojiSearchQuery);
  }, [emojiSearchQuery]);

  // Close emoji picker when clicking outside
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

  // Reset search when closing picker
  useEffect(() => {
    if (!emojiPickerOpen) {
      setEmojiSearchQuery("");
      setActiveEmojiCategory(0);
    }
  }, [emojiPickerOpen]);

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      onReact(msg.id, emoji);
      setEmojiPickerOpen(false);
      setReactionMenuOpen(false);
    },
    [msg.id, onReact]
  );

  // Memoized formatted timestamp — computed once per message
  const formattedTime = useMemo(
    () =>
      new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    [msg.createdAt]
  );

  // Group reactions by emoji — memoized so it only recomputes when reactions change
  const groupedReactions = useMemo(() => {
    const grouped = new Map<string, MessageReaction[]>();
    for (const r of msg.reactions || []) {
      const existing = grouped.get(r.emoji) || [];
      existing.push(r);
      grouped.set(r.emoji, existing);
    }
    return Array.from(grouped.entries());
  }, [msg.reactions]);

  // --- Messenger-style hold-and-slide reaction picker (quick reactions) ---

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  // Clean up timer on unmount
  useEffect(() => clearPressTimer, [clearPressTimer]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse") return; // desktop uses click
      isDraggingRef.current = false;
      highlightedEmojiRef.current = null;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      // Capture pointer so we keep receiving move/up events even off the button
      e.currentTarget.setPointerCapture(e.pointerId);
// Long-press (~200ms) opens the picker and starts drag tracking
        pressTimerRef.current = setTimeout(() => {
          isDraggingRef.current = true;
          setReactionMenuOpen(true);
          setHighlightedEmoji(null);
          // Light haptic feedback on native (Capacitor) platforms
          triggerHaptic(ImpactStyle.Light);
        }, 200);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // If not dragging yet, check if pointer moved too much (scroll gesture)
      if (!isDraggingRef.current) {
        const start = startPosRef.current;
        if (start) {
          const dx = Math.abs(e.clientX - start.x);
          const dy = Math.abs(e.clientY - start.y);
          if (dx > 10 || dy > 10) {
            clearPressTimer();
            startPosRef.current = null;
          }
        }
        return;
      }
      if (!reactionMenuOpen) return;
      const picker = pickerRef.current;
      if (!picker) return;
      const rect = picker.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      // Check if pointer is within picker bounds (with padding for easier targeting)
      const isInside =
        x >= rect.left - 12 &&
        x <= rect.right + 12 &&
        y >= rect.top - 12 &&
        y <= rect.bottom + 12;
      if (isInside) {
        const emojiButtons =
          picker.querySelectorAll<HTMLButtonElement>("[data-emoji]");
        let found: string | null = null;
        for (const btn of emojiButtons) {
          const r = btn.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            found = btn.dataset.emoji || null;
            break;
          }
        }
        highlightedEmojiRef.current = found;
        setHighlightedEmoji(found);
      } else {
        highlightedEmojiRef.current = null;
        setHighlightedEmoji(null);
      }
    },
    [reactionMenuOpen, clearPressTimer]
  );

  const handlePointerUp = useCallback(() => {
    clearPressTimer();
    startPosRef.current = null;
    if (isDraggingRef.current) {
      const emoji = highlightedEmojiRef.current;
      if (emoji) {
        onReact(msg.id, emoji);
        // Haptic feedback when an emoji is selected on native
        triggerHaptic(ImpactStyle.Medium);
      }
      isDraggingRef.current = false;
      suppressClickRef.current = true;
      setReactionMenuOpen(false);
      setHighlightedEmoji(null);
      highlightedEmojiRef.current = null;
      // Reset after the click event has a chance to fire
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    }
  }, [clearPressTimer, onReact, msg.id]);

  const handlePointerCancel = useCallback(() => {
    clearPressTimer();
    startPosRef.current = null;
    isDraggingRef.current = false;
    setReactionMenuOpen(false);
    setHighlightedEmoji(null);
    highlightedEmojiRef.current = null;
  }, [clearPressTimer]);

  // Desktop click toggle — ignored if a drag interaction just happened
  const handleReactButtonClick = useCallback(() => {
    if (suppressClickRef.current) return;
    setReactionMenuOpen((open) => !open);
  }, []);

  // --- Inline editing ---

  const startEditing = useCallback(() => {
    setEditDraft(msg.content);
    setEditError("");
    setIsEditing(true);
    // Focus the textarea once it has rendered
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

  return (
    <div
      data-message-id={msg.id}
      className={`group msg-bubble flex ${
        isOwn ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[85%] sm:max-w-[70%] ${
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
          className={`msg-bubble-content rounded-2xl px-4 py-2.5 text-sm ${
            msg.deletedAt
              ? "border border-dashed border-zinc-700 italic text-zinc-500"
              : isOwn
              ? "rounded-br-sm bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
              : "rounded-bl-sm bg-zinc-800 text-zinc-100"
          }`}
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
                <p className="font-medium">
                  Replying to {msg.replyTo.username}
                </p>
                <p className="truncate opacity-80">{msg.replyTo.content}</p>
              </div>
            </div>
          )}
          {msg.deletedAt ? (
            <p className="italic">This message was deleted</p>
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
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          )}
        </div>

        {/* Reactions */}
        {groupedReactions.length > 0 && (
          <div
            className={`mt-1 flex flex-wrap gap-1 ${
              isOwn ? "justify-end" : ""
            }`}
          >
            {groupedReactions.map(([emoji, reactions]) => (
              <button
                key={emoji}
                onClick={() => onReact(msg.id, emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  reactions.some((r) => r.userId === userId)
                    ? "border-purple-500/50 bg-purple-600/20 text-purple-200"
                    : "border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60"
                }`}
                title={`${reactions.map((r) => r.username).join(", ")}`}
              >
                <span>{emoji}</span>
                <span className="font-medium">{reactions.length}</span>
              </button>
            ))}
          </div>
        )}

        {/* Action buttons - always visible on mobile, hover-only on desktop */}
        <div
          className={`relative mt-1 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 ${
            isOwn ? "justify-end" : ""
          }`}
        >
          {/* Reply button */}
          {!msg.deletedAt && (
            <button
              onClick={() => onReply(msg)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-purple-400"
              title="Reply"
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Edit button — only on own non-deleted messages, hidden while editing */}
          {isOwn && !msg.deletedAt && !isEditing && (
            <button
              onClick={startEditing}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-sky-400"
              title="Edit message"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Delete button — only on own messages that aren't already deleted */}
          {isOwn && !msg.deletedAt && (
            <button
              onClick={() => onDelete(msg.id)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
              title="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Reaction button - hold and slide on touch, click on desktop */}
          <button
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClick={handleReactButtonClick}
            className="relative touch-none select-none rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-amber-400"
            title="React"
          >
            <Smile className="h-3.5 w-3.5" />
          </button>

          {/* Reaction quick actions - appears above the buttons (Messenger-style) */}
          {reactionMenuOpen && (
            <div
              ref={pickerRef}
              className="absolute bottom-full mb-1.5 z-30 flex gap-1 rounded-full border border-zinc-700 bg-[#150d24] px-2 py-1.5 shadow-xl animate-reaction-picker transform-gpu"
            >
              {QUICK_EMOJIS.slice(0, 6).map((emoji, index) => (
                <button
                  key={emoji}
                  data-emoji={emoji}
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    onReact(msg.id, emoji);
                    setReactionMenuOpen(false);
                  }}
                  className={`rounded-full p-1 text-lg transition-transform duration-150 transform-gpu animate-emoji-pop ${
                    highlightedEmoji === emoji
                      ? "scale-150 bg-purple-600/30"
                      : "hover:scale-125"
                  }`}
                  style={{ animationDelay: `${index * 40}ms` }}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              {/* Open full emoji picker */}
              <button
                onClick={() => {
                  setReactionMenuOpen(false);
                  setEmojiPickerOpen(true);
                }}
                className="flex items-center justify-center rounded-full border border-dashed border-zinc-600 p-1 text-xs text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
                title="More emojis..."
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Full Emoji Picker Modal */}
        {emojiPickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              ref={emojiPickerRef}
              className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-[#150d24] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                <h3 className="font-semibold text-zinc-200">
                  React with emoji
                </h3>
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
                    </button>
                  ))}
                </div>
              )}

              {/* Emoji Grid */}
              <div className="max-h-64 overflow-y-auto p-4">
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
                    {EMOJI_CATEGORIES[activeEmojiCategory]?.emojis.map(
                      (emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleSelectEmoji(emoji)}
                          className="rounded-lg p-2 text-xl transition-colors hover:bg-zinc-700"
                        >
                          {emoji}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <p
          className={`mt-1 text-[10px] text-zinc-600 ${
            isOwn ? "text-right" : ""
          }`}
        >
          {formattedTime}
          {/* Edited marker */}
          {!msg.deletedAt && msg.editedAt && (
            <span className="ml-1.5 italic text-zinc-500">(edited)</span>
          )}
          {/* Read receipt — anonymous count of who has seen it */}
          {isOwn && !msg.deletedAt && (msg.seenCount ?? 0) > 0 && (
            <span className="ml-1.5 text-emerald-500">
              Seen by {msg.seenCount}
            </span>
          )}
        </p>
      </div>
    </div>
  );
},
messageBubbleAreEqual);
