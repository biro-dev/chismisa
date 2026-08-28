"use client";

import {
  useState,
  useCallback,
  useActionState,
  useEffect,
  useRef,
  useTransition,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  CornerUpLeft,
  Hash,
  LogOut,
  Menu,
  MessageSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { GroupSidebar } from "@/components/group-sidebar";
import { MessageBubble } from "@/components/message-bubble";
import { Modal } from "@/components/modal";
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeToTheme,
  toggleThemeInStore,
} from "@/lib/theme";
import type { DashboardProps, GroupDetails, Message } from "@/lib/types";
import { groupColor } from "@/lib/group-color";
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
import {
  setRealtimeHandlers,
  subscribeToGroup,
  subscribeToPresence,
  unsubscribeFromGroup,
  sendTyping,
} from "@/lib/realtime";



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
  // Real-time state
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce typing broadcasts so long messages don't fire one per keystroke
  const typingSentAtRef = useRef(0);
  const TYPING_DEBOUNCE_MS = 2000;
  // Theme: "dark" (default) or "light", persisted in localStorage.
  // useSyncExternalStore resolves the saved theme on the client without
  // a post-hydration setState cascade.
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );
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

  // Apply the theme whenever the snapshot changes (DOM-only sync - never
  // setState in an effect). SSR markup has no data-theme attribute, so the
  // dark theme is the default until this runs.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    toggleThemeInStore(theme);
  }, [theme]);

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
    // Slow backup poll — real-time via Pusher is the primary path.
    interval = setInterval(poll, 30000);

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

  // Real-time subscriptions — joins the group's private + presence channels
  // on Pusher. Falls back to the 30s poll above if Pusher isn't configured.
  useEffect(() => {
    const groupId = selectedGroupId;
    if (!groupId) return;

    // Register callback handlers once (they close over stable callbacks/setters)
    setRealtimeHandlers({
      onNewMessage: (msg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const merged = [...prev, msg].sort(
            (a, b) =>
              new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()
          );
          lastMessageTimeRef.current = msg.createdAt;
          return merged;
        });
      },
      onMessageDeleted: (messageId) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, deletedAt: new Date().toISOString(), content: "" }
              : m
          )
        );
      },
      onReactionUpdated: (messageId, reactions) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, reactions } : m
          )
        );
      },
      onTyping: (typerUserId) => {
        setTypingUsers((prev) => {
          if (typerUserId === userId) return prev; // don't show "you are typing"
          const next = new Set(prev);
          next.add(typerUserId);
          return next;
        });
        // Auto-hide typing indicator after 3s of no events
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setTypingUsers((prev) => {
            if (typerUserId === userId) return prev;
            const next = new Set(prev);
            next.delete(typerUserId);
            return next;
          });
        }, 3000);
      },
      onPresenceChange: (count) => {
        setOnlineCount(count);
      },
    });

    // Subscribe to private channel (messages, reactions, deletions, typing)
    subscribeToGroup(groupId);
    // Subscribe to presence channel (online count)
    const presence = subscribeToPresence(groupId);
    // If presence couldn't subscribe yet (auth pending), fetch count via poll fallback
    if (!presence) {
      fetch(`/api/messages?groupId=${groupId}`, {
        cache: "no-store",
      }).catch(() => {});
    }

    return () => {
      unsubscribeFromGroup(groupId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [selectedGroupId, userId]);

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
  const handleReply = useCallback(
    (msg: Message) => {
      setReplyTo(msg);
    },
    [setReplyTo]
  );

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
    [selectedGroupId, userId, username, setActionError]
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
    [selectedGroupId, setActionError]
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
      <GroupSidebar
        username={username}
        theme={theme}
        groups={groups}
        selectedGroupId={selectedGroupId}
        sidebarOpen={sidebarOpen}
        onToggleTheme={toggleTheme}
        onShowCreate={() => setShowCreateModal(true)}
        onShowJoin={() => setShowJoinModal(true)}
        onSelectGroup={selectGroup}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

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
                    {selectedGroup.memberCount} members{onlineCount > 0 && (
                      <span className="ml-1.5">
                        · <span className="text-emerald-400">🟢 {onlineCount} online</span>
                      </span>
                    )}
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
                      You&apos;re all caught up
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
                  {/* Typing indicator — shows when other users are typing */}
                  {typingUsers.size > 0 && (
                    <div className="px-1 py-2 text-xs text-zinc-400 animate-pulse">
                      Someone is typing...
                    </div>
                  )}
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
                  onChange={(e) => {
                    setMessageInput(e.target.value);
                    const value = e.target.value.trim();
                    if (value && selectedGroup) {
                      const now = Date.now();
                      if (now - typingSentAtRef.current >= TYPING_DEBOUNCE_MS) {
                        typingSentAtRef.current = now;
                        sendTyping(selectedGroup.id);
                      }
                    }
                  }}
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

