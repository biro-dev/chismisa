"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  CornerUpLeft,
  Hash,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { MessageBubble } from "@/components/message-bubble";
import { TimeDivider, chatDividerLabel } from "@/components/time-divider";
import { Modal } from "@/components/modal";
import { SearchModal } from "@/components/search-modal";
import { DmView } from "@/components/dm-view";
import { MediaPicker } from "@/components/media-picker";
import { UnifiedSidebar } from "@/components/unified-sidebar";
import { useDm } from "@/lib/hooks/use-dm";
import {
  findUserByUsername,
  startConversationAction,
} from "@/lib/actions/direct-messages";
import {
  setBadgeHandler,
  watchGroups,
  disconnectRealtime,
} from "@/lib/realtime";
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeToTheme,
  toggleThemeInStore,
} from "@/lib/theme";
import type { Conversation, DashboardProps, Group, SidebarConversation } from "@/lib/types";
import { groupColor } from "@/lib/group-color";
import {
  createGroupAction,
  deleteGroupAction,
  getUnifiedConversations,
  joinGroupAction,
  leaveGroupAction,
} from "@/lib/actions/groups";
import { formatTypingIndicator, useChat } from "@/lib/hooks/use-chat";
import { showToast } from "@/lib/toast";

export function Dashboard({
  username,
  userId,
  groups,
  activeGroup,
  messages: initialMessages,
  error,
}: DashboardProps) {
  const router = useRouter();
  // The sidebar group list is server-sourced via the RSC prop, but it's also
  // kept in local state so unread badges refresh every ~30s without a full
  // page reload (see the polling effect below).
  const [groupsState, setGroupsState] = useState<Group[]>(groups);
  // All messaging state (messages, group selection, polling, realtime,
  // optimistic send/react/delete, pagination, typing, read receipts) lives
  // in useChat — this component stays a mostly-presentational shell.
  const chat = useChat({
    groups: groupsState,
    activeGroup,
    initialMessages,
    userId,
    username,
  });
  const {
    messages,
    selectedGroup,
    selectedGroupId,
    messageInput,
    handleInputChange,
    setMessageInput,
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
    sendMediaMessage,
    handleMediaRetry,
    pendingMedia,
    setPendingMedia,
    selectGroup,
    removeGroupFromState,
    typingUsers,
    onlineCount,
    isNearBottom,
    scrollToBottom,
    messagesEndRef,
    scrollContainerRef,
  } = chat;

  // ─── Direct messages ──────────────────────────────────────────────────────
  const [dms, setDms] = useState<Conversation[]>([]);
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDmId, setActiveDmId] = useState<string | null>(null);
  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [newDmUsername, setNewDmUsername] = useState("");
  const [newDmError, setNewDmError] = useState("");
  const [newDmPending, setNewDmPending] = useState(false);
  const activeDm = dms.find((d) => d.id === activeDmId) ?? null;

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );
  }, [conversations, searchQuery]);

  // Refresh the sidebar conversation list (previews + unread badges)
  const refreshConversations = useCallback(() => {
    void getUnifiedConversations().then((list) => {
      setConversations(list);
      // Also update the old dms state for backward compatibility
      const dmList: Conversation[] = list
        .filter((c) => c.kind === "dm")
        .map((c) => ({
          id: c.id,
          otherUser: { id: "", username: c.name },
          lastMessage: c.lastMessage ? { content: c.lastMessage, createdAt: c.lastActivity, senderId: "" } : null,
          unreadCount: c.unreadCount,
        }));
      setDms(dmList);
    });
  }, []);

  // Load conversations on mount and poll every 30s for previews/badges
  useEffect(() => {
    refreshConversations();
    const interval = setInterval(refreshConversations, 30_000);
    return () => clearInterval(interval);
  }, [refreshConversations]);

  // Presence heartbeat — updates lastActiveAt so the analytics panel can
  // show "Online Now" (active in the last minute). Pings on mount, every 30s
  // while the tab is visible, and when the tab returns to the foreground.
  useEffect(() => {
    const ping = () => {
      if (document.hidden) return;
      fetch("/api/presence/ping", { method: "POST", credentials: "include" }).catch(
        () => {}
      );
    };
    ping();
    const interval = setInterval(ping, 30_000);
    const onVisible = () => {
      if (!document.hidden) ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // All DM messaging state (messages, polling, realtime, optimistic send,
  // edit/delete/react) lives in useDm — mirrors how groups use useChat.
  const dm = useDm({
    conversationId: activeDmId,
    userId,
    onConversationActivity: refreshConversations,
  });

  // Start (or open) a conversation with the given username
  const handleStartDm = async () => {
    setNewDmError("");
    setNewDmPending(true);
    try {
      const user = await findUserByUsername(newDmUsername);
      if (!user) {
        setNewDmError("No user found with that username.");
        return;
      }
      const result = await startConversationAction(user.id);
      if (result.error || !result.conversationId) {
        setNewDmError(result.error || "Failed to start conversation.");
        return;
      }
      setActiveDmId(result.conversationId);
      setShowNewDmModal(false);
      setNewDmUsername("");
      setSidebarOpen(false);
      refreshConversations();
    } catch {
      setNewDmError("Something went wrong. Please try again.");
    } finally {
      setNewDmPending(false);
    }
  };
  // ──────────────────────────────────────────────────────────────────────────


  // UI-only state (modals, sidebar, clipboard).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Unified selection handler for both DMs and groups
  const handleSelectConversation = (id: string, kind: "dm" | "group") => {
    if (kind === "dm") {
      setActiveDmId(id);
    } else {
      setActiveDmId(null);
      // Clear unread badge immediately (before server poll)
      setGroupsState((prev) =>
        prev.map((g) => (g.id === id ? { ...g, unreadCount: 0 } : g))
      );
      selectGroup(id);
    }
    setSidebarOpen(false);
  };
  // Confirmation modal for leaving/deleting a group
  const [confirmModal, setConfirmModal] = useState<{
    type: "leave" | "delete";
    groupId: string;
    name: string;
  } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createState, createAction, createPending] = useActionState(
    createGroupAction,
    undefined
  );
  const [joinState, joinAction, joinPending] = useActionState(
    joinGroupAction,
    undefined
  );

  // Theme: "dark" (default) or "light", persisted in localStorage.
  // useSyncExternalStore resolves the saved theme on the client without
  // a post-hydration setState cascade.
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  // Apply the theme whenever the snapshot changes (DOM-only sync - never
  // setState in an effect). SSR markup has no data-theme attribute, so the
  // dark theme is the default until this runs.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Show error toast for redirect-based errors (e.g., invalid invite code)
  useEffect(() => {
    if (error === "invalid-code") {
      showToast("This invite link is invalid or has expired.", "error");
    }
  }, [error]);

  const toggleTheme = useCallback(() => {
    toggleThemeInStore(theme);
  }, [theme]);

  // Refresh unread badges from the server every ~30s (and when the tab
  // becomes visible again). The selected group is being viewed, so it's
  // force-zeroed to avoid a stale badge after switching.
  useEffect(() => {
    let cancelled = false;
    const refreshGroups = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/groups", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Group[];
        setGroupsState(
          data.map((g) =>
            g.id === selectedGroupId ? { ...g, unreadCount: 0 } : g
          )
        );
      } catch {
        // ignore — the next poll will retry
      }
    };

    refreshGroups();
    const interval = setInterval(refreshGroups, 30000);
    const onVisible = () => {
      if (!document.hidden) refreshGroups();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selectedGroupId]);

  // Real-time unread badges: subscribe to every group's channel and bump the
  // sidebar badge the moment a message lands, instead of waiting for the 30s
  // poll. The active group stays at zero since the user is viewing it.
  useEffect(() => {
    setBadgeHandler((groupId) => {
      setGroupsState((prev) =>
        prev.map((g) =>
          g.id === groupId && g.id !== selectedGroupId
            ? { ...g, unreadCount: (g.unreadCount ?? 0) + 1 }
            : g
        )
      );
    });
  }, [selectedGroupId]);

  useEffect(() => {
    watchGroups(groups.map((g) => g.id));
  }, [groups]);

  // Tear down the Pusher connection on hard navigation / page unload so we
  // don't leak sockets. (Soft SPA navigation is handled group-by-group by
  // useChat's realtime effect.)
  useEffect(() => {
    const onUnload = () => disconnectRealtime();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

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

  const copyInviteCode = async () => {
    if (!selectedGroup) return;
    try {
      await navigator.clipboard.writeText(selectedGroup.code);
      setCopied(true);
      showToast("Invite code copied to clipboard");
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
      showToast("Invite link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  // Jump the chat view to a specific message (from search results): scrolls
  // it into view inside the message container and flashes a highlight.
  const jumpToMessage = (messageId: string) => {
    setShowSearchModal(false);
    // Let the modal unmount before scrolling so layout is settled
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const target = container?.querySelector(
        `[data-message-id="${messageId}"]`
      );
      if (!container || !target) {
        // Message may not be loaded (older than the loaded pages) — inform the
        // user instead of silently doing nothing.
        showToast("Message is outside the loaded history", "error");
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("search-highlight");
      // Force a reflow so re-triggering the animation works on repeat jumps
      void (target as HTMLElement).offsetWidth;
      target.classList.add("search-highlight");
      setTimeout(() => target.classList.remove("search-highlight"), 2200);
    });
  };

  // Handle leave/delete group confirmation — the actual removal from local
  // state (per-group caches + switching to another group if needed) is done
  // by the chat hook via removeGroupFromState.
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
        removeGroupFromState(confirmModal.groupId);
        setConfirmModal(null);
        showToast(
          confirmModal.type === "leave"
            ? "You left the group."
            : "Group deleted."
        );
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
  return (
    <div className="app-h flex overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar - responsive: hidden on mobile, show as overlay; visible on md+ */}
      <UnifiedSidebar
        username={username}
        theme={theme}
        conversations={filteredConversations}
        selectedId={activeDmId ?? selectedGroupId}
        selectedKind={activeDmId ? "dm" : selectedGroupId ? "group" : null}
        onSelectConversation={handleSelectConversation}
        sidebarOpen={sidebarOpen}
        onToggleTheme={toggleTheme}
        onShowCreate={() => setShowCreateModal(true)}
        onShowJoin={() => setShowJoinModal(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

      {/* Right Panel - Chat */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ink">
        {/* Mobile top bar with hamburger menu */}
        <div className="safe-top flex items-center gap-3 border-b border-hairline px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text"
            title="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-raised">
              <Hash className="h-3.5 w-3.5 text-gossip" />
            </div>
            <h2 className="text-sm font-semibold text-ink-text">
              {activeDm
                ? activeDm.otherUser.username
                : selectedGroup
                ? selectedGroup.name
                : "Chismisa"}
            </h2>
          </div>
        </div>

        {activeDm ? (
          <DmView
            conversation={activeDm}
            userId={userId}
            dm={dm}
            onBack={() => setActiveDmId(null)}
          />
        ) : selectedGroup ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
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
                  <h2 className="text-sm font-semibold text-ink-text">
                    {selectedGroup.name}
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {selectedGroup.memberCount} members
                    {onlineCount > 0 && (
                      <span className="ml-1.5">
                        ·{" "}
                        <span className="text-emerald-400">
                          🟢 {onlineCount} online
                        </span>
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSearchModal(true)}
                  aria-label="Search messages"
                  className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text"
                  title="Search messages"
                >
                  <Search className="h-4 w-4" />
                </button>
                {selectedGroup.isOwner ? (
                  <>
                    <button
                      onClick={() => setShowInviteModal(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-gossip/40 bg-gossip/10 px-3 py-1.5 text-xs font-semibold text-gossip transition-colors hover:bg-gossip/20"
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
                    className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-ink-text transition-colors hover:bg-surface-raised"
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
              onContextMenu={(e) => {
                // Stop the native long-press "select to copy" UI on phones —
                // it hijacks the long-press reaction gesture.
                if (window.matchMedia("(hover: none)").matches) {
                  e.preventDefault();
                }
              }}
              role="log"
              aria-live="polite"
              aria-label={`Messages in ${selectedGroup.name}`}
              className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
            >
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-ink-muted">
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
                    <p className="py-2 text-center text-xs text-ink-muted">
                      You&apos;re all caught up
                    </p>
                  )}
                  {messages.map((msg, i) => {
                    const divider = chatDividerLabel(
                      i > 0 ? messages[i - 1] : null,
                      msg
                    );
                    return (
                      <div key={msg.id}>
                        {divider && <TimeDivider label={divider} />}
                        <MessageBubble
                          msg={msg}
                          isOwn={msg.userId === userId}
                          userId={userId}
                          onReply={handleReply}
                          onReact={handleReact}
                          onDelete={handleDeleteMessage}
                          onEdit={handleEditMessage}
                          onMediaRetry={handleMediaRetry}
                        />
                      </div>
                    );
                  })}
                  {/* Typing indicator — shows who is typing */}
                  {typingUsers.size > 0 && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-2 px-1 py-2 text-xs text-ink-muted"
                    >
                      <span
                        aria-hidden
                        className="tea-pulse h-2 w-2 shrink-0 rounded-full bg-tea shadow-[0_0_10px_2px_rgba(246,185,59,0.4)]"
                      />
                      {formatTypingIndicator([...typingUsers.values()])}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Jump to bottom — shown when the user has scrolled up */}
            {!isNearBottom && messages.length > 0 && (
              <button
                onClick={() => scrollToBottom()}
                aria-label="Jump to latest messages"
                className="absolute bottom-28 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-hairline bg-surface-raised text-ink-muted shadow-xl transition-colors hover:text-gossip"
                title="Jump to latest messages"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            )}

            {/* Action error banner */}
            {actionError && (
              <div
                role="alert"
                aria-live="assertive"
                className="border-t border-red-500/30 bg-red-500/10 px-4 py-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-red-400">{actionError}</p>
                  <button
                    onClick={() => setActionError("")}
                    aria-label="Dismiss error"
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
              <div className="border-t border-hairline bg-surface-raised px-4 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <CornerUpLeft className="h-3 w-3 text-gossip" />
                    <span>
                      Replying to{" "}
                      <span className="font-semibold text-gossip">
                        {replyTo.username}
                      </span>
                      : <span className="truncate">{replyTo.content}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="rounded p-0.5 text-ink-muted transition-colors hover:text-ink-text"
                    title="Cancel reply"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Message input */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                // If there's pending media, send it with optional caption
                if (pendingMedia) {
                  const caption = messageInput.trim();
                  const media = pendingMedia;
                  setMessageInput("");
                  setPendingMedia(null);
                  await sendMediaMessage(media, caption || undefined);
                } else {
                  handleSendMessage(e);
                }
              }}
              className="safe-bottom shrink-0 border-t border-hairline p-3 sm:p-4"
            >
              <div className="flex items-center gap-2">
                <MediaPicker
                  userId={userId}
                  draft={pendingMedia}
                  onDraftChange={setPendingMedia}
                />
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => handleInputChange(e.target.value)}
                  placeholder={pendingMedia ? "Add a caption…" : `Message #${selectedGroup.name}…`}
                  maxLength={2000}
                  aria-label="Message input"
                  className="min-w-0 flex-1 rounded-xl border border-hairline bg-surface-raised px-4 py-2.5 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20"
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim() && !pendingMedia}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gossip-deep text-white transition-all hover:bg-gossip disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-raised shadow-lg shadow-black/30">
              <MessageSquare className="h-10 w-10 text-gossip" />
            </div>
            <h2 className="text-xl font-semibold text-ink-text">
              Welcome to Chismisa!
            </h2>
            <p className="mt-2 max-w-sm text-sm text-ink-muted">
              Create a group to start chatting, or join an existing one with an
              invite code.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-xl bg-gossip-deep px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gossip"
              >
                Create Group
              </button>
              <button
                onClick={() => setShowJoinModal(true)}
                className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-raised"
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
                className="mb-1.5 block text-sm font-medium text-ink-text"
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
                className="w-full rounded-xl border border-hairline bg-surface-raised px-4 py-2.5 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20"
              />
            </div>
            <button
              type="submit"
              disabled={createPending}
              className="w-full rounded-xl bg-gossip-deep py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gossip disabled:opacity-60"
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
                className="mb-1.5 block text-sm font-medium text-ink-text"
              >
                Invite Code
              </label>
              <input
                id="invite-code"
                name="code"
                type="text"
                required
                placeholder="CHISMIS-XXXXXX"
                className="w-full rounded-xl border border-hairline bg-surface-raised px-4 py-2.5 text-sm uppercase tracking-wider text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20"
              />
            </div>
            <button
              type="submit"
              disabled={joinPending}
              className="w-full rounded-xl bg-gossip-deep py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gossip disabled:opacity-60"
            >
              {joinPending ? "Joining…" : "Join Group"}
            </button>
          </form>
        </Modal>
      )}

      {/* Search Messages Modal */}
      {showSearchModal && selectedGroup && (
        <SearchModal
          groupId={selectedGroup.id}
          onClose={() => setShowSearchModal(false)}
          onJumpToMessage={jumpToMessage}
        />
      )}

      {/* New Direct Message Modal */}
      {showNewDmModal && (
        <Modal
          onClose={() => {
            setShowNewDmModal(false);
            setNewDmError("");
            setNewDmUsername("");
          }}
          title="New Direct Message"
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Enter a username to start a private conversation.
            </p>
            {newDmError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {newDmError}
              </div>
            )}
            <input
              type="text"
              value={newDmUsername}
              onChange={(e) => setNewDmUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !newDmPending) {
                  e.preventDefault();
                  void handleStartDm();
                }
              }}
              placeholder="Username…"
              maxLength={20}
              autoFocus
              className="w-full rounded-xl border border-hairline bg-surface-raised px-4 py-2.5 text-sm text-ink-text placeholder:text-ink-muted outline-none transition-colors focus:border-gossip focus:ring-2 focus:ring-gossip/20"
            />
            <button
              onClick={() => void handleStartDm()}
              disabled={newDmPending || newDmUsername.trim().length < 3}
              className="w-full rounded-xl bg-gossip-deep py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gossip disabled:opacity-60"
            >
              {newDmPending ? "Looking up…" : "Start Conversation"}
            </button>
          </div>
        </Modal>
      )}

      {/* Invite Code Modal (owner only) */}
      {showInviteModal && selectedGroup?.isOwner && (
        <Modal onClose={() => setShowInviteModal(false)} title="Invite Code">
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Share this code with friends to let them join{" "}
              <span className="font-semibold text-ink-text">
                {selectedGroup.name}
              </span>
              :
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-gossip/40 bg-gossip/10 p-4">
              <code className="flex-1 text-center font-mono text-lg font-bold tracking-widest text-gossip">
                {selectedGroup.code}
              </code>
              <button
                onClick={copyInviteCode}
                className="rounded-lg bg-gossip/20 p-2 text-gossip transition-colors hover:bg-gossip/30"
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
              className="w-full rounded-xl border border-hairline py-2.5 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-raised"
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
            <p className="text-sm text-ink-muted">
              {confirmModal.type === "leave" ? (
                <>
                  Are you sure you want to leave{" "}
                  <span className="font-semibold text-ink-text">
                    {confirmModal.name}
                  </span>
                  ? You can rejoin later with the invite code.
                </>
              ) : (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-ink-text">
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
                className="flex-1 rounded-xl border border-hairline py-2.5 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-raised disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGroupAction}
                disabled={confirmPending}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
                  confirmModal.type === "leave"
                    ? "bg-surface-raised text-ink-text hover:bg-gossip/20"
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
