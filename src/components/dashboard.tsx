"use client";

import {
  useState,
  useCallback,
  useMemo,
  memo,
  useActionState,
  useEffect,
  useRef,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Plus,
  LogOut,
  Users,
  Hash,
  Copy,
  Check,
  X,
  Send,
  Shield,
  Menu,
  CornerUpLeft,
  Smile,
  Trash2,
  Sun,
  Moon,
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import {
  createGroupAction,
  joinGroupAction,
  leaveGroupAction,
  deleteGroupAction,
} from "@/lib/actions/groups";
import {
  sendMessageAction,
  reactToMessageAction,
  deleteMessageAction,
} from "@/lib/actions/messages";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

type Group = {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  memberCount: number;
  messageCount: number;
};

type GroupDetails = {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  memberCount: number;
  members: { id: string; username: string }[];
};

type MessageReaction = {
  id: string;
  emoji: string;
  userId: string;
  username: string;
};

type Message = {
  id: string;
  content: string;
  userId: string;
  username: string;
  deletedAt?: string | null;
  createdAt: string;
  replyTo: {
    id: string;
    content: string;
    username: string;
  } | null;
  reactions: MessageReaction[];
};

type DashboardProps = {
  username: string;
  userId: string;
  groups: Group[];
  activeGroup: GroupDetails | null;
  messages: Message[];
};

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮"];

// Generate a consistent color from a group name (for avatars)
const GROUP_COLORS = [
  "from-purple-600 to-fuchsia-600",
  "from-blue-600 to-cyan-500",
  "from-emerald-600 to-teal-500",
  "from-orange-500 to-amber-500",
  "from-pink-600 to-rose-500",
  "from-indigo-600 to-violet-500",
  "from-red-600 to-orange-500",
  "from-teal-600 to-emerald-500",
];

function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
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
// This prevents every bubble from re-rendering on each 2s poll.
const messageBubbleAreEqual = (
  prev: {
    msg: Message;
    isOwn: boolean;
    userId: string;
    onReply: (msg: Message) => void;
    onReact: (messageId: string, emoji: string) => void;
  },
  next: {
    msg: Message;
    isOwn: boolean;
    userId: string;
    onReply: (msg: Message) => void;
    onReact: (messageId: string, emoji: string) => void;
  }
) => {
  if (prev.msg.id !== next.msg.id) return false;
  if (prev.msg.content !== next.msg.content) return false;
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
const MessageBubble = memo(function MessageBubble({
  msg,
  isOwn,
  userId,
  onReply,
  onReact,
  onDelete,
}: {
  msg: Message;
  isOwn: boolean;
  userId: string;
  onReply: (msg: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [highlightedEmoji, setHighlightedEmoji] = useState<string | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const highlightedEmojiRef = useRef<string | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  // --- Messenger-style hold-and-slide reaction picker ---

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
        if (Capacitor.isNativePlatform()) {
          Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        }
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
        const emojiButtons = picker.querySelectorAll<HTMLButtonElement>(
          "[data-emoji]"
        );
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

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      clearPressTimer();
      startPosRef.current = null;
      if (isDraggingRef.current) {
        const emoji = highlightedEmojiRef.current;
        if (emoji) {
          onReact(msg.id, emoji);
          // Haptic feedback when an emoji is selected on native
          if (Capacitor.isNativePlatform()) {
            Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
          }
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
    },
    [clearPressTimer, onReact, msg.id]
  );

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

  return (
    <div
      className={`group msg-bubble flex ${isOwn ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] sm:max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}
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
                <p className="truncate opacity-80">
                  {msg.replyTo.content}
                </p>
              </div>
            </div>
          )}
          {msg.deletedAt ? (
            <p className="italic">This message was deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {msg.content}
            </p>
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
                title={`${reactions
                  .map((r) => r.username)
                  .join(", ")}`}
              >
                <span>{emoji}</span>
                <span className="font-medium">
                  {reactions.length}
                </span>
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
              {REACTION_EMOJIS.map((emoji, index) => (
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
            </div>
          )}
        </div>

        <p
          className={`mt-1 text-[10px] text-zinc-600 ${
            isOwn ? "text-right" : ""
          }`}
        >
          {formattedTime}
        </p>
      </div>
    </div>
  );
}, messageBubbleAreEqual);

export function Dashboard({
  username,
  userId,
  groups,
  activeGroup,
  messages: initialMessages,
}: DashboardProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  // Client-side group switching: keep the selected group in local state so
  // tapping a group is instant (no full page reload). The server still
  // provides the initial activeGroup + messages on first load.
  const [selectedGroup, setSelectedGroup] = useState<GroupDetails | null>(
    activeGroup
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    activeGroup?.id ?? null
  );
  // Per-group message cache so switching back to a previously-viewed group
  // shows its messages instantly while fresh data loads in the background.
  const messageCacheRef = useRef<Map<string, Message[]>>(new Map());
  // Per-group details cache (name, member count, etc.)
  const groupDetailsCacheRef = useRef<Map<string, GroupDetails>>(new Map());
  // Track the latest message timestamp per group for incremental polling
  const lastMessageTimeByGroupRef = useRef<Map<string, string>>(new Map());
  // Track the oldest loaded message per group for pagination
  const oldestMessageTimeByGroupRef = useRef<Map<string, string>>(new Map());
  // Track hasMore per group
  const hasMoreByGroupRef = useRef<Map<string, boolean>>(new Map());
  // Track loadingOlder per group
  const loadingOlderByGroupRef = useRef<Map<string, boolean>>(new Map());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  // Confirmation modal for leaving/deleting a group
  const [confirmModal, setConfirmModal] = useState<{
    type: "leave" | "delete";
    groupId: string;
    name: string;
  } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionError, setActionError] = useState("");
  // Theme: "dark" (default) or "light", persisted in localStorage
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const hasMoreRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const oldestMessageTimeRef = useRef<string | null>(
    initialMessages.length > 0 ? initialMessages[0].createdAt : null
  );
  // Track the latest message timestamp for incremental polling
  const lastMessageTimeRef = useRef<string | null>(
    initialMessages.length > 0
      ? initialMessages[initialMessages.length - 1].createdAt
      : null
  );
  const [createState, createAction, createPending] = useActionState(
    createGroupAction,
    undefined
  );
  const [joinState, joinAction, joinPending] = useActionState(
    joinGroupAction,
    undefined
  );
  const [, startTransition] = useTransition();

  // Load saved theme on mount and apply it
  useEffect(() => {
    const saved = localStorage.getItem("chismisa-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("chismisa-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  // Load older messages when the user scrolls to the top (Messenger-style).
  // Uses cursor-based pagination via the `before` timestamp.
  const loadOlderMessages = useCallback(async () => {
    const groupId = selectedGroupId;
    if (!groupId) return;
    if (loadingOlderRef.current || !hasMoreRef.current) return;

    const before = oldestMessageTimeRef.current;
    if (!before) {
      setHasMore(false);
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;

    try {
      const url = `/api/messages?groupId=${groupId}&before=${encodeURIComponent(
        before
      )}&limit=50`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.length === 0) {
          setHasMore(false);
        } else {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const olderMsgs = data.filter(
              (m: Message) => !existingIds.has(m.id)
            );
            return [...olderMsgs, ...prev];
          });
          // Track the new oldest message for the next page
          oldestMessageTimeRef.current = data[0].createdAt;
          // Preserve scroll position after prepending older messages
          requestAnimationFrame(() => {
            if (el) {
              el.scrollTop = el.scrollHeight - prevScrollHeight;
            }
          });
        }
      }
    } catch {
      // ignore load errors
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [selectedGroupId]);

  // Keep the ref in sync so handleScroll can call it without stale closures
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Track scroll position to avoid yanking the user when they scroll up.
  // rAF-throttled so it only runs once per frame instead of on every scroll event.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 100;
      // Trigger loading older messages when scrolled near the top
      if (el.scrollTop < 50) {
        loadOlderMessages();
      }
    });
  }, [loadOlderMessages]);

  // Incremental polling — only fetches messages newer than the last known one.
  // Pauses when the tab is hidden.
  useEffect(() => {
    const groupId = selectedGroupId;
    if (!groupId) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const since = lastMessageTimeRef.current || "";
        const url = `/api/messages?groupId=${groupId}${
          since ? `&since=${encodeURIComponent(since)}` : ""
        }`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newMsgs = data.filter((m: Message) => !existingIds.has(m.id));
              if (newMsgs.length === 0) return prev;
              const merged = [...prev, ...newMsgs].sort(
                (a, b) =>
                  new Date(a.createdAt).getTime() -
                  new Date(b.createdAt).getTime()
              );
              return merged.slice(-500);
            });
            // Update the latest timestamp for the next incremental poll
            const last = data[data.length - 1];
            if (last?.createdAt) lastMessageTimeRef.current = last.createdAt;
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    // Initial fetch (no `since` — gets the full history)
    poll();
    interval = setInterval(poll, 2000);

    // Resume polling immediately when the tab becomes visible again
    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedGroupId]);

  // Smart auto-scroll — only scrolls to bottom if the user is already near it.
  // Uses direct scrollTop + rAF instead of scrollIntoView for smoother, cheaper scrolling.
  useEffect(() => {
    if (isNearBottomRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }, [messages.length, selectedGroupId]);

  // Handle create group success
  useEffect(() => {
    if (createState?.success && createState.groupId) {
      router.push(`/?group=${createState.groupId}`);
      router.refresh();
    }
  }, [createState, router]);

  // Handle join group success
  useEffect(() => {
    if (joinState?.success && joinState.groupId) {
      router.push(`/?group=${joinState.groupId}`);
      router.refresh();
    }
  }, [joinState, router]);

  // Stable callback for replying to a message
  const handleReply = useCallback((msg: Message) => {
    setReplyTo(msg);
  }, []);

  // Optimistic message sending — append locally, reconcile with server
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !messageInput.trim()) return;

    const content = messageInput.trim();
    const replyToMsg = replyTo;
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      content,
      userId,
      username: "You",
      createdAt: new Date().toISOString(),
      replyTo: replyToMsg
        ? {
            id: replyToMsg.id,
            content: replyToMsg.content,
            username: replyToMsg.username,
          }
        : null,
      reactions: [],
    };

    // Optimistic append — instant feedback
    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageInput("");
    setReplyTo(null);
    setActionError("");

    const formData = new FormData();
    formData.append("groupId", selectedGroup.id);
    formData.append("content", content);
    if (replyToMsg) {
      formData.append("replyToId", replyToMsg.id);
    }

    try {
      const result = await sendMessageAction(formData);
      if (result.success && result.message) {
        // Replace optimistic message with the server-confirmed one.
        // First remove any copy the polling may have already appended
        // (e.g. if the poll fetched the confirmed message before this
        // action resolved), then swap the optimistic entry in.
        const confirmed = result.message as Message;
        setMessages((prev) => {
          const withoutPolledCopy = prev.filter((m) => m.id !== confirmed.id);
          return withoutPolledCopy.map((m) =>
            m.id === optimisticMsg.id ? confirmed : m
          );
        });
        lastMessageTimeRef.current = confirmed.createdAt;
      } else {
        // Rollback on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        setActionError(result.error || "Failed to send message.");
      }
    } catch {
      // Rollback on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setActionError("Failed to send message.");
    }
  };

  // Optimistic reactions — toggle locally, reconcile with server
  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      const groupId = selectedGroupId;
      if (!groupId) return;

      // Optimistic toggle
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions.find(
            (r) => r.userId === userId && r.emoji === emoji
          );
          if (existing) {
            return {
              ...m,
              reactions: m.reactions.filter((r) => r.id !== existing.id),
            };
          }
          return {
            ...m,
            reactions: [
              ...m.reactions,
              {
                id: `temp-${Date.now()}`,
                emoji,
                userId,
                username,
              },
            ],
          };
        })
      );

      try {
        const result = await reactToMessageAction(messageId, emoji);
        if (!result.success) {
          setActionError(result.error || "Failed to add reaction.");
          // Refetch to rollback to server state
          const res = await fetch(`/api/messages?groupId=${groupId}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const data = await res.json();
            setMessages(data);
          }
        }
      } catch {
        setActionError("Failed to add reaction.");
        // Refetch to rollback to server state
        const res = await fetch(`/api/messages?groupId=${groupId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data);
        }
      }
    },
    [selectedGroupId, userId, username]
  );

  // Delete a message (own messages only) — optimistic update
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      const groupId = selectedGroupId;
      if (!groupId) return;

      // Optimistic: mark as deleted locally
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deletedAt: new Date().toISOString(), content: "" }
            : m
        )
      );

      try {
        const result = await deleteMessageAction(messageId);
        if (!result.success) {
          setActionError(result.error || "Failed to delete message.");
          // Refetch to rollback
          const res = await fetch(`/api/messages?groupId=${groupId}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const data = await res.json();
            setMessages(data);
          }
        }
      } catch {
        setActionError("Failed to delete message.");
      }
    },
    [selectedGroupId]
  );

  const copyInviteCode = async () => {
    if (!selectedGroup) return;
    try {
      await navigator.clipboard.writeText(selectedGroup.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  // Copy a shareable invite link (auto-joins when opened)
  const copyInviteLink = async () => {
    if (!selectedGroup) return;
    try {
      const link = `${window.location.origin}/join/${selectedGroup.code}`;
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  // Handle leave/delete group confirmation
  const handleConfirmGroupAction = async () => {
    if (!confirmModal) return;
    setConfirmPending(true);
    setActionError("");
    try {
      const result =
        confirmModal.type === "leave"
          ? await leaveGroupAction(confirmModal.groupId)
          : await deleteGroupAction(confirmModal.groupId);

      if (result.success) {
        // Remove the group from the local groups list
        const remaining = groups.filter((g) => g.id !== confirmModal.groupId);
        // Clear caches for this group
        messageCacheRef.current.delete(confirmModal.groupId);
        groupDetailsCacheRef.current.delete(confirmModal.groupId);
        lastMessageTimeByGroupRef.current.delete(confirmModal.groupId);
        oldestMessageTimeByGroupRef.current.delete(confirmModal.groupId);
        hasMoreByGroupRef.current.delete(confirmModal.groupId);
        loadingOlderByGroupRef.current.delete(confirmModal.groupId);

        // If we were viewing this group, switch to another one
        if (selectedGroupId === confirmModal.groupId) {
          if (remaining.length > 0) {
            selectGroup(remaining[0].id);
          } else {
            setSelectedGroup(null);
            setSelectedGroupId(null);
            setMessages([]);
            router.replace("/", { scroll: false });
          }
        }
        setConfirmModal(null);
        router.refresh();
      } else {
        setActionError(result.error || "Failed to perform action.");
        setConfirmModal(null);
      }
    } catch {
      setActionError("Something went wrong. Please try again.");
      setConfirmModal(null);
    } finally {
      setConfirmPending(false);
    }
  };

  // Instant client-side group switching (no full page reload).
  // Shows cached messages immediately, fetches fresh ones in the background,
  // and updates the URL without triggering a server refresh.
  const selectGroup = useCallback(
    (groupId: string) => {
      setSidebarOpen(false);
      setReplyTo(null);
      setActionError("");

      // Build GroupDetails from the groups list (we have name/code/memberCount)
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;

      const cachedDetails = groupDetailsCacheRef.current.get(groupId);
      const details: GroupDetails = cachedDetails ?? {
        id: group.id,
        name: group.name,
        code: group.code,
        isOwner: group.isOwner,
        memberCount: group.memberCount,
        members: [],
      };
      groupDetailsCacheRef.current.set(groupId, details);

      // Switch the UI instantly
      setSelectedGroup(details);
      setSelectedGroupId(groupId);

      // Show cached messages instantly if we've loaded this group before
      const cached = messageCacheRef.current.get(groupId);
      if (cached) {
        setMessages(cached);
        // Restore per-group pagination state
        hasMoreRef.current = hasMoreByGroupRef.current.get(groupId) ?? true;
        loadingOlderRef.current =
          loadingOlderByGroupRef.current.get(groupId) ?? false;
        oldestMessageTimeRef.current =
          oldestMessageTimeByGroupRef.current.get(groupId) ?? null;
        lastMessageTimeRef.current =
          lastMessageTimeByGroupRef.current.get(groupId) ?? null;
      } else {
        // No cache — show empty state while fetching
        setMessages([]);
        hasMoreRef.current = true;
        loadingOlderRef.current = false;
        oldestMessageTimeRef.current = null;
        lastMessageTimeRef.current = null;
      }

      // Update the URL without a full refresh (keeps shareable links)
      startTransition(() => {
        router.replace(`/?group=${groupId}`, { scroll: false });
      });

      // Fetch fresh messages in the background
      fetch(`/api/messages?groupId=${groupId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Message[]) => {
          messageCacheRef.current.set(groupId, data);
          // Only apply to the UI if this is still the selected group
          setSelectedGroupId((current) => {
            if (current === groupId) {
              setMessages(data);
              if (data.length > 0) {
                oldestMessageTimeRef.current = data[0].createdAt;
                lastMessageTimeRef.current =
                  data[data.length - 1].createdAt;
                oldestMessageTimeByGroupRef.current.set(
                  groupId,
                  data[0].createdAt
                );
                lastMessageTimeByGroupRef.current.set(
                  groupId,
                  data[data.length - 1].createdAt
                );
              }
              hasMoreByGroupRef.current.set(groupId, data.length >= 50);
              hasMoreRef.current = data.length >= 50;
            }
            return current;
          });
        })
        .catch(() => {
          // ignore fetch errors — polling will retry
        });
    },
    [groups, router]
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar - responsive: hidden on mobile, show as overlay; visible on md+ */}
      <aside
        className={`fixed z-50 flex w-72 flex-col border-r border-zinc-800/60 bg-[#0d0818] transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
          title="Close menu"
        >
          <X className="h-4 w-4" />
        </button>

        {/* User profile header */}
        <div className="safe-top flex items-center justify-between border-b border-zinc-800/60 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 text-sm font-bold text-white">
              {username.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">{username}</p>
              <p className="text-xs text-zinc-500">Anonymous user</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-400"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <form action={logoutAction}>
              <button
                type="submit"
                title="Log out"
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Create / Join buttons */}
        <div className="flex gap-2 p-3">
          <button
            onClick={() => {
              setShowCreateModal(true);
              setSidebarOpen(false);
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 py-2 text-xs font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
          <button
            onClick={() => {
              setShowJoinModal(true);
              setSidebarOpen(false);
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <Users className="h-3.5 w-3.5" />
            Join
          </button>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Your Groups
          </p>
          {groups.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
              <p className="text-sm text-zinc-500">
                No groups yet. Create one or join with a code!
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => selectGroup(group.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selectedGroupId === group.id
                      ? "bg-purple-600/20 text-purple-200"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${groupColor(
                      group.name
                    )}`}
                  >
                    <span className="text-sm font-bold text-white">
                      {group.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{group.name}</p>
                    <p className="text-xs text-zinc-500">
                      {group.memberCount} members · {group.messageCount} msgs
                    </p>
                  </div>
                  {group.isOwner && (
                    <span className="shrink-0 rounded bg-purple-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                      OWNER
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Admin link */}
        <div className="border-t border-zinc-800/60 p-3">
          <a
            href="/chismis-admin"
            className="flex items-center gap-2 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
          >
            <Shield className="h-3.5 w-3.5" />
            Admin
          </a>
        </div>
      </aside>

      {/* Right Panel - Chat */}
      <main className="relative flex flex-1 flex-col bg-[#0a0612]">
        {/* Mobile top bar with hamburger menu */}
        <div className="safe-top flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600">
              <Hash className="h-3.5 w-3.5 text-white" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">
              {selectedGroup ? selectedGroup.name : "Chismisa"}
            </h2>
          </div>
        </div>

        {selectedGroup ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${groupColor(
                    selectedGroup.name
                  )}`}
                >
                  <span className="text-base font-bold text-white">
                    {selectedGroup.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    {selectedGroup.name}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {selectedGroup.memberCount} members
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedGroup.isOwner ? (
                  <>
                    <button
                      onClick={() => setShowInviteModal(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-purple-600/40 bg-purple-600/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-600/20"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Invite Code</span>
                    </button>
                    <button
                      onClick={() =>
                        setConfirmModal({
                          type: "delete",
                          groupId: selectedGroup.id,
                          name: selectedGroup.name,
                        })
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                      title="Delete group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() =>
                      setConfirmModal({
                        type: "leave",
                        groupId: selectedGroup.id,
                        name: selectedGroup.name,
                      })
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                    title="Leave group"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Leave</span>
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
            >
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-zinc-500">
                    No messages yet. Start the chismis! 🫢
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Loading indicator when fetching older messages */}
                  {loadingOlder && (
                    <div className="flex justify-center py-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                    </div>
                  )}
                  {/* All caught up indicator */}
                  {!hasMore && messages.length > 0 && (
                    <p className="py-2 text-center text-xs text-zinc-600">
                      You're all caught up
                    </p>
                  )}
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isOwn={msg.userId === userId}
                      userId={userId}
                      onReply={handleReply}
                      onReact={handleReact}
                      onDelete={handleDeleteMessage}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Action error banner */}
            {actionError && (
              <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-red-400">{actionError}</p>
                  <button
                    onClick={() => setActionError("")}
                    className="rounded p-0.5 text-red-400/70 transition-colors hover:text-red-300"
                    title="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Reply preview bar */}
            {replyTo && (
              <div className="border-t border-zinc-800/60 bg-[#120a1f] px-4 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <CornerUpLeft className="h-3 w-3 text-purple-400" />
                    <span>
                      Replying to{" "}
                      <span className="font-semibold text-purple-300">
                        {replyTo.username}
                      </span>
                      : <span className="truncate">{replyTo.content}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-300"
                    title="Cancel reply"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Message input */}
            <form
              onSubmit={handleSendMessage}
              className="safe-bottom border-t border-zinc-800/60 p-3 sm:p-4"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message #${selectedGroup.name}…`}
                  maxLength={2000}
                  className="flex-1 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white transition-all hover:from-purple-500 hover:to-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-600 to-fuchsia-600 shadow-xl shadow-purple-900/40">
              <MessageSquare className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-200">
              Welcome to Chismisa!
            </h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Create a group to start chatting, or join an existing one with an
              invite code.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500"
              >
                Create Group
              </button>
              <button
                onClick={() => setShowJoinModal(true)}
                className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Join Group
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Create Group Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create Group">
          <form action={createAction} className="space-y-4">
            {createState?.error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {createState.error}
              </div>
            )}
            <div>
              <label
                htmlFor="group-name"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                Group Name
              </label>
              <input
                id="group-name"
                name="name"
                type="text"
                required
                maxLength={50}
                placeholder="e.g. Tambayan ng mga Chismosa"
                className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={createPending}
              className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 py-2.5 text-sm font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-60"
            >
              {createPending ? "Creating…" : "Create Group"}
            </button>
          </form>
        </Modal>
      )}

      {/* Join Group Modal */}
      {showJoinModal && (
        <Modal onClose={() => setShowJoinModal(false)} title="Join Group">
          <form action={joinAction} className="space-y-4">
            {joinState?.error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {joinState.error}
              </div>
            )}
            <div>
              <label
                htmlFor="invite-code"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                Invite Code
              </label>
              <input
                id="invite-code"
                name="code"
                type="text"
                required
                placeholder="CHISMIS-XXXXXX"
                className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-2.5 text-sm uppercase tracking-wider text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={joinPending}
              className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 py-2.5 text-sm font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-60"
            >
              {joinPending ? "Joining…" : "Join Group"}
            </button>
          </form>
        </Modal>
      )}

      {/* Invite Code Modal (owner only) */}
      {showInviteModal && selectedGroup?.isOwner && (
        <Modal onClose={() => setShowInviteModal(false)} title="Invite Code">
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Share this code with friends to let them join{" "}
              <span className="font-semibold text-zinc-200">
                {selectedGroup.name}
              </span>
              :
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-purple-600/40 bg-purple-600/10 p-4">
              <code className="flex-1 text-center font-mono text-lg font-bold tracking-widest text-purple-300">
                {selectedGroup.code}
              </code>
              <button
                onClick={copyInviteCode}
                className="rounded-lg bg-purple-600/20 p-2 text-purple-300 transition-colors hover:bg-purple-600/30"
                title="Copy code"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              onClick={copyInviteLink}
              className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Copy Invite Link
            </button>
            {copied && (
              <p className="text-center text-xs text-emerald-400">
                Copied to clipboard!
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Leave/Delete Group Confirmation Modal */}
      {confirmModal && (
        <Modal
          onClose={() => setConfirmModal(null)}
          title={confirmModal.type === "leave" ? "Leave Group" : "Delete Group"}
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              {confirmModal.type === "leave" ? (
                <>
                  Are you sure you want to leave{" "}
                  <span className="font-semibold text-zinc-200">
                    {confirmModal.name}
                  </span>
                  ? You can rejoin later with the invite code.
                </>
              ) : (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-zinc-200">
                    {confirmModal.name}
                  </span>
                  ? This will permanently remove the group and all its messages.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                disabled={confirmPending}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGroupAction}
                disabled={confirmPending}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
                  confirmModal.type === "leave"
                    ? "bg-zinc-700 hover:bg-zinc-600"
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {confirmPending
                  ? confirmModal.type === "leave"
                    ? "Leaving..."
                    : "Deleting..."
                  : confirmModal.type === "leave"
                  ? "Leave"
                  : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-fade-in rounded-2xl border border-zinc-800 bg-[#120a1f] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}