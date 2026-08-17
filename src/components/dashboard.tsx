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
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { createGroupAction, joinGroupAction } from "@/lib/actions/groups";
import {
  sendMessageAction,
  reactToMessageAction,
} from "@/lib/actions/messages";

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

// Memoized message bubble — only re-renders when its own message data changes
const MessageBubble = memo(function MessageBubble({
  msg,
  isOwn,
  userId,
  onReply,
  onReact,
}: {
  msg: Message;
  isOwn: boolean;
  userId: string;
  onReply: (msg: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);

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

  return (
    <div
      className={`group flex ${isOwn ? "justify-end" : "justify-start"}`}
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
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isOwn
              ? "rounded-br-sm bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
              : "rounded-bl-sm bg-zinc-800 text-zinc-100"
          }`}
        >
          {/* Reply indicator */}
          {msg.replyTo && (
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
          <p className="whitespace-pre-wrap break-words">
            {msg.content}
          </p>
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

        {/* Action buttons - visible on hover */}
        <div
          className={`relative mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${
            isOwn ? "justify-end" : ""
          }`}
        >
          {/* Reply button */}
          <button
            onClick={() => onReply(msg)}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-purple-400"
            title="Reply"
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
          {/* Reaction button */}
          <button
            onClick={() => setReactionMenuOpen(!reactionMenuOpen)}
            className="relative rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-amber-400"
            title="React"
          >
            <Smile className="h-3.5 w-3.5" />
          </button>

          {/* Reaction quick actions */}
          {reactionMenuOpen && (
            <div className="absolute z-30 mt-1 flex gap-1 rounded-full border border-zinc-700 bg-[#150d24] px-2 py-1 shadow-xl">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReact(msg.id, emoji);
                    setReactionMenuOpen(false);
                  }}
                  className="rounded-full p-1 text-lg transition-transform hover:scale-125"
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
          {new Date(msg.createdAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
});

export function Dashboard({
  username,
  userId,
  groups,
  activeGroup,
  messages: initialMessages,
}: DashboardProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionError, setActionError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
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

  // Track scroll position to avoid yanking the user when they scroll up
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;
  }, []);

  // Incremental polling — only fetches messages newer than the last known one.
  // Pauses when the tab is hidden.
  useEffect(() => {
    const groupId = activeGroup?.id;
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
              return merged.slice(-200);
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
  }, [activeGroup?.id]);

  // Smart auto-scroll — only scrolls to bottom if the user is already near it
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, activeGroup?.id]);

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
    if (!activeGroup || !messageInput.trim()) return;

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
    formData.append("groupId", activeGroup.id);
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
      const groupId = activeGroup?.id;
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
    [activeGroup?.id, userId, username]
  );

  const copyInviteCode = async () => {
    if (!activeGroup) return;
    try {
      await navigator.clipboard.writeText(activeGroup.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const selectGroup = (groupId: string) => {
    setSidebarOpen(false);
    setReplyTo(null);
    // Use startTransition for non-blocking UI updates during navigation
    startTransition(() => {
      router.push(`/?group=${groupId}`);
      router.refresh();
    });
  };

  return (
    <div className="flex h-screen overflow-hidden">
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
        <div className="flex items-center justify-between border-b border-zinc-800/60 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 text-sm font-bold text-white">
              {username.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">{username}</p>
              <p className="text-xs text-zinc-500">Anonymous user</p>
            </div>
          </div>
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
                    activeGroup?.id === group.id
                      ? "bg-purple-600/20 text-purple-200"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      activeGroup?.id === group.id
                        ? "bg-purple-600/30"
                        : "bg-zinc-800"
                    }`}
                  >
                    <Hash className="h-4 w-4" />
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
        <div className="flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2 md:hidden">
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
              {activeGroup ? activeGroup.name : "Chismisa"}
            </h2>
          </div>
        </div>

        {activeGroup ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-fuchsia-600">
                  <Hash className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    {activeGroup.name}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {activeGroup.memberCount} members
                  </p>
                </div>
              </div>
              {activeGroup.isOwner && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-purple-600/40 bg-purple-600/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-600/20"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Invite Code</span>
                </button>
              )}
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
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isOwn={msg.userId === userId}
                      userId={userId}
                      onReply={handleReply}
                      onReact={handleReact}
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
              className="border-t border-zinc-800/60 p-3 sm:p-4"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message #${activeGroup.name}…`}
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
      {showInviteModal && activeGroup?.isOwner && (
        <Modal onClose={() => setShowInviteModal(false)} title="Invite Code">
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Share this code with friends to let them join{" "}
              <span className="font-semibold text-zinc-200">
                {activeGroup.name}
              </span>
              :
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-purple-600/40 bg-purple-600/10 p-4">
              <code className="flex-1 text-center font-mono text-lg font-bold tracking-widest text-purple-300">
                {activeGroup.code}
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
            {copied && (
              <p className="text-center text-xs text-emerald-400">
                Copied to clipboard!
              </p>
            )}
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