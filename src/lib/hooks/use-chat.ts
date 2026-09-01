"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Group, GroupDetails, Message } from "@/lib/types";
import {
  deleteMessageAction,
  editMessageAction,
  markGroupAsRead,
  reactToMessageAction,
  sendMessageAction,
} from "@/lib/actions/messages";
import {
  sendTyping,
  setRealtimeHandlers,
  subscribeToGroup,
  subscribeToPresence,
  unsubscribeFromGroup,
} from "@/lib/realtime";

const POLL_CHANNEL_NAME = "chismisa-poll";

type UseChatParams = {
  groups: Group[];
  activeGroup: GroupDetails | null;
  initialMessages: Message[];
  userId: string;
  username: string;
};

/**
 * Human-friendly typing indicator text from the list of typer usernames.
 * One typer: "Mara is typing..." — two: "Mara and Ana are typing..." —
 * more: "Mara and 2 others are typing..."
 */
export function formatTypingIndicator(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]} and ${names.length - 1} others are typing...`;
}

/**
 * All messaging state and side-effects for the dashboard: messages, group
 * switching + per-group caches, incremental polling, realtime (Pusher)
 * subscriptions, optimistic send/react/delete, pagination, typing
 * indicators, presence, and prompt read receipts.
 *
 * The Dashboard stays a mostly-presentational component: it renders the
 * layout and wires UI state (modals, theme) around whatever this hook
 * returns.
 */
export function useChat({
  groups,
  activeGroup,
  initialMessages,
  userId,
  username,
}: UseChatParams) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
  const [messageInput, setMessageInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionError, setActionError] = useState("");
  // Track optimistic message IDs to avoid duplication when poll returns confirmed message
  // Stores both temp IDs (optimistic) and server IDs (confirmed) to prevent duplicates
  const optimisticMessageIdsRef = useRef<Set<string>>(new Set());
  // Real-time state
  // Map of userId → username for users currently typing (per-user timeouts)
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(
    new Map()
  );
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  // Debounce typing broadcasts so long messages don't fire one per keystroke
  const typingSentAtRef = useRef(0);
  const TYPING_DEBOUNCE_MS = 2000;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // State mirror of isNearBottomRef so the UI (jump-to-bottom button) can react
  const [isNearBottom, setIsNearBottom] = useState(true);
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

  // Keep the refs in sync so handleScroll can call it without stale closures
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
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 100;
      setIsNearBottom(distanceFromBottom < 100);
      // Trigger loading older messages when scrolled near the top
      if (el.scrollTop < 50) {
        loadOlderMessages();
      }
    });
  }, [loadOlderMessages]);

  // Scroll the message list back to the newest message (jump-to-bottom button)
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }, []);

  // Incremental polling — only fetches messages newer than the last known one.
  // Pauses when the tab is hidden. Uses BroadcastChannel to coordinate across tabs.
  useEffect(() => {
    const groupId = selectedGroupId;
    if (!groupId) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let channel: BroadcastChannel | null = null;
    let isLeader = false;

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
            // Filter out any optimistic messages from the poll results
            const serverMessages = data.filter(
              (m: Message) => !optimisticMessageIdsRef.current.has(m.id)
            );
            if (serverMessages.length > 0) {
              setMessages((prev) => {
                // Merge by id: replace stale local copies with the fresh
                // versions (so edits/deletions propagate even via the 30s poll)
                // and append genuinely new messages.
                const freshMap = new Map(serverMessages.map((m: Message) => [m.id, m]));
                const updated = prev.map((p) => freshMap.get(p.id) ?? p);
                const newMsgs = serverMessages.filter(
                  (m: Message) => !prev.some((p) => p.id === m.id)
                );
                // Skip the re-render only when nothing actually changed: no new
                // ids AND every existing message is still the same reference.
                // (freshMap.get(p.id) ?? p) returns p unchanged iff the message
                // wasn't in the payload, so ref-identity catches edits/deletions.
                if (
                  newMsgs.length === 0 &&
                  updated.every((u, i) => u === prev[i])
                )
                  return prev;
                const merged = [...updated, ...newMsgs].sort(
                  (a, b) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime()
                );
                return merged.slice(-500);
              });
              // Update the latest timestamp for the next incremental poll
              const last = serverMessages[serverMessages.length - 1];
              if (last?.createdAt) lastMessageTimeRef.current = last.createdAt;
              
              // Broadcast new messages to other tabs
              if (isLeader && channel && serverMessages.length > 0) {
                channel.postMessage({ type: "new-messages", messages: serverMessages, groupId });
              }
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    // BroadcastChannel for cross-tab coordination
    try {
      channel = new BroadcastChannel(POLL_CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data.type === "new-messages" && event.data.groupId === groupId) {
          // Non-leader tabs receive new messages from the leader
          const newMsgs = event.data.messages;
          if (newMsgs.length > 0) {
            setMessages((prev) => {
              const freshMap = new Map(newMsgs.map((m: Message) => [m.id, m]));
              const updated = prev.map((p) => freshMap.get(p.id) ?? p);
              const merged = [...updated, ...newMsgs].sort(
                (a, b) =>
                  new Date(a.createdAt).getTime() -
                  new Date(b.createdAt).getTime()
              );
              return merged.slice(-500);
            });
            const last = newMsgs[newMsgs.length - 1];
            if (last?.createdAt) lastMessageTimeRef.current = last.createdAt;
          }
        } else if (event.data.type === "leader-elected" && event.data.groupId === groupId) {
          // Another tab became leader, stop our interval
          if (interval && isLeader) {
            clearInterval(interval);
            interval = null;
            isLeader = false;
          }
        }
      };
    } catch {
      // BroadcastChannel not available (e.g. Safari private mode), fall back to per-tab polling
      channel = null;
    }

    // Leader election: first tab to connect becomes leader
    if (channel) {
      isLeader = true;
      channel.postMessage({ type: "leader-elected", groupId });
    }

    // Initial fetch (no `since` — gets the full history)
    poll();
    // Slow backup poll — real-time via Pusher is the primary path.
    // Only the leader polls.
    if (isLeader || !channel) {
      interval = setInterval(poll, 30000);
    }

    // Resume polling immediately when the tab becomes visible again
    const onVisibility = () => {
      if (!document.hidden && (isLeader || !channel)) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) {
        channel.close();
      }
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
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
      onMessageEdited: (messageId, content, editedAt) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content, editedAt } : m
          )
        );
      },
      onReactionUpdated: (messageId, reactions) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
        );
      },
      onTyping: (typerUserId, typerUsername) => {
        if (typerUserId === userId) return; // don't show "you are typing"
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(typerUserId, typerUsername);
          return next;
        });
        // Auto-hide this user's indicator after 3s of no events
        const existing = typingTimeoutsRef.current.get(typerUserId);
        if (existing) clearTimeout(existing);
        typingTimeoutsRef.current.set(
          typerUserId,
          setTimeout(() => {
            typingTimeoutsRef.current.delete(typerUserId);
            setTypingUsers((prev) => {
              const next = new Map(prev);
              next.delete(typerUserId);
              return next;
            });
          }, 3000)
        );
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

    // Stable map of per-user typing timeouts (captured for the cleanup)
    const typingTimeouts = typingTimeoutsRef.current;

    return () => {
      unsubscribeFromGroup(groupId);
      for (const timeout of typingTimeouts.values()) {
        clearTimeout(timeout);
      }
      typingTimeouts.clear();
    };
  }, [selectedGroupId, userId]);

  // Prompt read receipts — keep the viewer's `lastReadAt` fresh so other
  // members' "Seen by N" counts update quickly, instead of waiting for the
  // 30s backup poll's server-side side-effect. Throttled to one request per
  // 5s and skipped entirely when the tab isn't visible.
  const lastReadMarkAtRef = useRef(0);
  const markGroupRead = useCallback((groupId: string) => {
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    if (now - lastReadMarkAtRef.current < 5000) return;
    lastReadMarkAtRef.current = now;
    markGroupAsRead(groupId).catch(() => {
      // non-critical — the poll side-effect will catch up
    });
  }, []);

  // Mark the group read when it's opened…
  useEffect(() => {
    if (selectedGroupId) markGroupRead(selectedGroupId);
  }, [selectedGroupId, markGroupRead]);

  // …and when new messages arrive while it's being viewed.
  useEffect(() => {
    if (selectedGroupId && messages.length > 0) markGroupRead(selectedGroupId);
  }, [messages.length, selectedGroupId, markGroupRead]);

  // …and when the user returns to the tab.
  useEffect(() => {
    if (!selectedGroupId) return;
    const onVisible = () => {
      if (!document.hidden) markGroupRead(selectedGroupId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [selectedGroupId, markGroupRead]);

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

  // Stable callback for replying to a message
  const handleReply = useCallback(
    (msg: Message) => {
      setReplyTo(msg);
    },
    [setReplyTo]
  );

  // The typing input handler also debounces + fires typing broadcasts.
  const handleInputChange = useCallback(
    (value: string) => {
      setMessageInput(value);
      if (value.trim() && selectedGroup) {
        const now = Date.now();
        if (now - typingSentAtRef.current >= TYPING_DEBOUNCE_MS) {
          typingSentAtRef.current = now;
          sendTyping(selectedGroup.id);
        }
      }
    },
    [selectedGroup]
  );

  // Optimistic message sending — append locally, reconcile with server
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !messageInput.trim()) return;

    const content = messageInput.trim();
    const replyToMsg = replyTo;
    const optimisticId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMsg: Message = {
      id: optimisticId,
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

    // Track optimistic message ID
    optimisticMessageIdsRef.current.add(optimisticId);

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
        optimisticMessageIdsRef.current.delete(optimisticId);
        // Track the server ID so subsequent polls don't re-add this message
        optimisticMessageIdsRef.current.add(confirmed.id);
        setMessages((prev) => {
          const withoutPolledCopy = prev.filter((m) => m.id !== confirmed.id);
          return withoutPolledCopy.map((m) =>
            m.id === optimisticId ? confirmed : m
          );
        });
        lastMessageTimeRef.current = confirmed.createdAt;
      } else {
        // Rollback on failure
        optimisticMessageIdsRef.current.delete(optimisticId);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setActionError(result.error || "Failed to send message.");
      }
    } catch {
      // Rollback on error
      optimisticMessageIdsRef.current.delete(optimisticId);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
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
          // Different emoji: replace the user's previous reaction (Messenger-style)
          return {
            ...m,
            reactions: [
              ...m.reactions.filter((r) => r.userId !== userId),
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
          // Refetch only the affected message to rollback to server state
          const res = await fetch(
            `/api/messages?groupId=${groupId}&since=${encodeURIComponent(
              new Date(Date.now() - 1000).toISOString()
            )}&limit=50`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = await res.json();
            const serverMsg = data.find((m: Message) => m.id === messageId);
            if (serverMsg) {
              setMessages((prev) =>
                prev.map((m) => (m.id === messageId ? serverMsg : m))
              );
            }
          }
        }
      } catch {
        setActionError("Failed to add reaction.");
        // Refetch only the affected message to rollback to server state
        const res = await fetch(
          `/api/messages?groupId=${groupId}&since=${encodeURIComponent(
            new Date(Date.now() - 1000).toISOString()
          )}&limit=50`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          const serverMsg = data.find((m: Message) => m.id === messageId);
          if (serverMsg) {
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? serverMsg : m))
            );
          }
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
          // Refetch only the affected message to rollback
          const res = await fetch(
            `/api/messages?groupId=${groupId}&since=${encodeURIComponent(
              new Date(Date.now() - 1000).toISOString()
            )}&limit=50`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const data = await res.json();
            const serverMsg = data.find((m: Message) => m.id === messageId);
            if (serverMsg) {
              setMessages((prev) =>
                prev.map((m) => (m.id === messageId ? serverMsg : m))
              );
            }
          }
        }
      } catch {
        setActionError("Failed to delete message.");
      }
    },
    [selectedGroupId, setActionError]
  );

  // Instant client-side group switching (no full page reload).
  // Shows cached messages immediately, fetches fresh ones in the background,
  // and updates the URL without triggering a server refresh.
  const selectGroup = useCallback(
    (groupId: string) => {
      setReplyTo(null);
      setActionError("");

      // Open the new group at the bottom (fresh view, not the previous
      // group's scroll position)
      isNearBottomRef.current = true;
      setIsNearBottom(true);

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
                lastMessageTimeRef.current = data[data.length - 1].createdAt;
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
    [groups, router, startTransition]
  );

  // Edit a message — updates local state on success so the change is instant
  // for the sender; other members receive it via the `message-edited`
  // realtime event (or the 30s backup poll). Returns any error so the inline
  // editor in the bubble can keep itself open and show it.
  const handleEditMessage = useCallback(
    async (messageId: string, content: string): Promise<{ error?: string }> => {
      const trimmed = content.trim();
      if (!trimmed) return { error: "Message content is required." };
      try {
        const result = await editMessageAction(messageId, trimmed);
        if (result.error) return { error: result.error };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, content: trimmed, editedAt: new Date().toISOString() }
              : m
          )
        );
        return {};
      } catch {
        return { error: "Failed to edit message." };
      }
    },
    []
  );

  // Called by the Dashboard after a confirmed leave/delete: clears the
  // per-group caches and switches to another group (or the empty state) if
  // the removed group was the one being viewed.
  const removeGroupFromState = useCallback(
    (groupId: string) => {
      messageCacheRef.current.delete(groupId);
      groupDetailsCacheRef.current.delete(groupId);
      lastMessageTimeByGroupRef.current.delete(groupId);
      oldestMessageTimeByGroupRef.current.delete(groupId);
      hasMoreByGroupRef.current.delete(groupId);
      loadingOlderByGroupRef.current.delete(groupId);

      if (selectedGroupId !== groupId) return;
      const remaining = groups.filter((g) => g.id !== groupId);
      if (remaining.length > 0) {
        selectGroup(remaining[0].id);
      } else {
        setSelectedGroup(null);
        setSelectedGroupId(null);
        setMessages([]);
        router.replace("/", { scroll: false });
      }
    },
    [selectedGroupId, groups, selectGroup, router]
  );

  return {
    messages,
    selectedGroup,
    selectedGroupId,
    messageInput,
    setMessageInput,
    handleInputChange,
    replyTo,
    setReplyTo,
    actionError,
    setActionError,
    hasMore,
    loadingOlder,
    handleScroll,
    handleReply,
    handleSendMessage,
    handleReact,
    handleDeleteMessage,
    handleEditMessage,
    selectGroup,
    removeGroupFromState,
    typingUsers,
    onlineCount,
    isNearBottom,
    scrollToBottom,
    messagesEndRef,
    scrollContainerRef,
  };
}
