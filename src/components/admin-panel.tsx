"use client";

import { useState, useEffect, useRef } from "react";
import {
  Shield,
  Users,
  MessageSquare,
  Hash,
  Trash2,
  ArrowLeft,
  RefreshCw,
  Eye,
  UserMinus,
  X,
  Menu,
  CornerUpLeft,
  LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getAdminStats,
  deleteGroupAction,
  getGroupMembersAction,
  removeMemberAction,
  getGroupMessagesAction,
  loginAdminAction,
  logoutAdminAction,
} from "@/lib/actions/admin";

type AdminStats = {
  userCount: number;
  groupCount: number;
  messageCount: number;
  groups: {
    id: string;
    name: string;
    code: string;
    ownerUsername: string;
    memberCount: number;
    messageCount: number;
    createdAt: string;
  }[];
};

type GroupMember = {
  id: string;
  username: string;
  joinedAt: string;
};

type GroupMessages = {
  id: string;
  name: string;
  ownerUsername: string;
  messages: {
    id: string;
    content: string;
    username: string;
    createdAt: string;
    replyTo: {
      id: string;
      content: string;
      username: string;
    } | null;
    reactions: {
      id: string;
      emoji: string;
      userId: string;
      username: string;
    }[];
  }[];
};

type GroupDetails = {
  id: string;
  name: string;
  owner: { id: string; username: string };
  members: GroupMember[];
};

export function AdminPanel() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const secretRef = useRef<string>("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Selected group view
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupMessages, setGroupMessages] = useState<GroupMessages | null>(
    null
  );
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // Track the latest message timestamp for incremental polling
  const lastMessageTimeRef = useRef<string | null>(null);

  // Members modal state
  const [membersModal, setMembersModal] = useState<GroupDetails | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [membersError, setMembersError] = useState("");

  // On mount: read secret from sessionStorage and ensure cookie is set
  useEffect(() => {
    const secret = sessionStorage.getItem("admin_secret") || "";
    secretRef.current = secret;
    if (!secret) {
      router.replace("/chismis-admin");
      return;
    }
    loginAdminAction(secret)
      .then((result) => {
        if (result.error) {
          sessionStorage.removeItem("admin_secret");
          router.replace("/chismis-admin");
        } else {
          setIsReady(true);
        }
      })
      .catch(() => {
        router.replace("/chismis-admin");
      });
  }, [router]);

  const handleLogout = async () => {
    await logoutAdminAction();
    sessionStorage.removeItem("admin_secret");
    router.replace("/chismis-admin");
  };

  const refreshStats = async () => {
    setLoading(true);
    try {
      const data = await getAdminStats(secretRef.current);
      if (data) setStats(data);
    } finally {
      setLoading(false);
    }
  };

  // Load stats once the session is verified
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    getAdminStats(secretRef.current)
      .then((data) => {
        if (data && !cancelled) setStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isReady]);

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group and all its messages?")) return;
    setDeleting(groupId);
    try {
      await deleteGroupAction(secretRef.current, groupId);
      if (selectedGroup === groupId) {
        setSelectedGroup(null);
        setGroupMessages(null);
      }
      await refreshStats();
    } finally {
      setDeleting(null);
    }
  };

  // Track scroll position to avoid yanking the user when they scroll up
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;
  };

  // Load messages for a selected group (incognito)
  const loadGroupMessages = async (groupId: string) => {
    setSelectedGroup(groupId);
    setMessagesLoading(true);
    setMessagesError("");
    lastMessageTimeRef.current = null;
    try {
      const data = await getGroupMessagesAction(secretRef.current, groupId);
      if (data) {
        setGroupMessages(data);
        setMessagesError("");
        // Track the latest message timestamp for incremental polling
        if (data.messages.length > 0) {
          lastMessageTimeRef.current =
            data.messages[data.messages.length - 1].createdAt;
        }
      } else {
        setGroupMessages(null);
        setMessagesError("Failed to load messages.");
      }
    } catch (err) {
      console.error("Load group messages error:", err);
      setGroupMessages(null);
      setMessagesError("Failed to load messages. Please try again.");
    } finally {
      setMessagesLoading(false);
    }
  };

  // Incremental polling — only fetches messages newer than the last known one.
  // Pauses when the tab is hidden.
  useEffect(() => {
    if (!selectedGroup) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const since = lastMessageTimeRef.current || undefined;
        const data = await getGroupMessagesAction(secretRef.current, selectedGroup, since);
        if (data) {
          setGroupMessages((prev) => {
            if (!prev) return data;
            if (data.messages.length === 0) return prev;
            const existingIds = new Set(prev.messages.map((m) => m.id));
            const newMsgs = data.messages.filter(
              (m) => !existingIds.has(m.id)
            );
            if (newMsgs.length === 0) return prev;
            return {
              ...prev,
              messages: [...prev.messages, ...newMsgs],
            };
          });
          // Update the latest timestamp for the next incremental poll
          if (data.messages.length > 0) {
            lastMessageTimeRef.current =
              data.messages[data.messages.length - 1].createdAt;
          }
        }
      } catch (err) {
        console.error("Poll group messages error:", err);
      }
    };

    poll();
    interval = setInterval(poll, 3000);

    // Resume polling immediately when the tab becomes visible again
    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedGroup]);

  // Smart auto-scroll — only scrolls to bottom if the user is already near it
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [groupMessages?.messages.length]);

  const handleViewMembers = async (groupId: string) => {
    setMembersLoading(true);
    setMembersError("");
    try {
      const data = await getGroupMembersAction(secretRef.current, groupId);
      if (data) {
        setMembersModal(data);
      } else {
        setMembersError("Failed to load members.");
      }
    } finally {
      setMembersLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!membersModal) return;
    const member = membersModal.members.find((m) => m.id === userId);
    if (!member) return;
    if (!confirm(`Remove "${member.username}" from this group?`)) return;

    setRemovingMember(userId);
    setMembersError("");
    try {
      const result = await removeMemberAction(secretRef.current, membersModal.id, userId);
      if (result.success) {
        // Refresh member list
        const data = await getGroupMembersAction(secretRef.current, membersModal.id);
        if (data) {
          setMembersModal(data);
        }
        // Also refresh stats to update member count
        await refreshStats();
      } else {
        setMembersError(result.error || "Failed to remove member.");
      }
    } finally {
      setRemovingMember(null);
    }
  };

  // Group reactions by emoji for display
  const groupReactions = (
    reactions: {
      id: string;
      emoji: string;
      userId: string;
      username: string;
    }[]
  ) => {
    const grouped = new Map<string, typeof reactions>();
    for (const r of reactions) {
      const existing = grouped.get(r.emoji) || [];
      existing.push(r);
      grouped.set(r.emoji, existing);
    }
    return Array.from(grouped.entries());
  };

  if (!isReady) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <p className="text-sm text-zinc-500">Verifying access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar - All groups */}
      <aside
        className={`fixed z-50 flex w-72 flex-col border-r border-zinc-800/60 bg-[#0d0818] transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
          title="Close menu"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Admin header */}
        <div className="safe-top flex items-center justify-between border-b border-zinc-800/60 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-purple-600 text-sm font-bold text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Admin</p>
              <p className="text-xs text-zinc-500">Secret monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleLogout}
              title="Log out"
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-yellow-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => router.push("/")}
              title="Back to Chismisa"
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stats mini panel */}
        {stats && (
          <div className="grid grid-cols-3 gap-2 p-3">
            <div className="rounded-lg bg-zinc-900/60 px-2 py-2 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {stats.userCount}
              </p>
              <p className="text-[10px] text-zinc-500">Users</p>
            </div>
            <div className="rounded-lg bg-zinc-900/60 px-2 py-2 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {stats.groupCount}
              </p>
              <p className="text-[10px] text-zinc-500">Groups</p>
            </div>
            <div className="rounded-lg bg-zinc-900/60 px-2 py-2 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {stats.messageCount}
              </p>
              <p className="text-[10px] text-zinc-500">Msgs</p>
            </div>
          </div>
        )}

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            All Groups
          </p>
          {!stats || stats.groups.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
              <p className="text-sm text-zinc-500">No groups yet.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {stats.groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => loadGroupMessages(group.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selectedGroup === group.id
                      ? "bg-red-600/20 text-red-200"
                      : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      selectedGroup === group.id
                        ? "bg-red-600/30"
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
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh button */}
        <div className="border-t border-zinc-800/60 p-3">
          <button
            onClick={refreshStats}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </aside>

      {/* Main panel - Chat view of selected group */}
      <main className="relative flex flex-1 flex-col bg-[#0a0612]">
        {/* Mobile top bar */}
        <div className="safe-top flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-red-600 to-purple-600">
              <Hash className="h-3.5 w-3.5 text-white" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">
              {groupMessages ? groupMessages.name : "Admin Panel"}
            </h2>
          </div>
        </div>

        {selectedGroup ? (
          <>
            {/* Group chat header */}
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-red-600 to-purple-600">
                  <Hash className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    {groupMessages?.name || "Loading..."}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {groupMessages?.ownerUsername
                      ? `Owner: ${groupMessages.ownerUsername} · ${groupMessages.messages.length} messages`
                      : "Loading messages..."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {stats?.groups.find((g) => g.id === selectedGroup) && (
                  <>
                    <button
                      onClick={() => {
                        const g = stats.groups.find(
                          (gr) => gr.id === selectedGroup
                        )!;
                        handleViewMembers(g.id);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-purple-600/40 bg-purple-600/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-600/20"
                      title="View members"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Members</span>
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(selectedGroup)}
                      disabled={deleting === selectedGroup}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      title="Delete group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
            >
              {messagesLoading && !groupMessages ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  Loading messages...
                </div>
              ) : messagesError ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Eye className="mb-3 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-red-400">{messagesError}</p>
                </div>
              ) : !groupMessages || groupMessages.messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Eye className="mb-3 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-zinc-500">
                    No messages in this group. Admin is watching... 👁️
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupMessages.messages.map((msg) => {
                    const groupedReactions = groupReactions(
                      msg.reactions || []
                    );
                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="max-w-[85%] sm:max-w-[70%] items-start">
                          <p className="mb-1 text-xs font-medium text-red-400">
                            {msg.username}
                          </p>
                          <div className="rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100">
                            {/* Reply indicator */}
                            {msg.replyTo && (
                              <div className="mb-2 flex items-start gap-1.5 border-l-2 border-purple-400/60 pl-2 text-xs text-zinc-400">
                                <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-medium text-purple-300">
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
                            <div className="mt-1 flex flex-wrap gap-1">
                              {groupedReactions.map(([emoji, reactions]) => (
                                <span
                                  key={emoji}
                                  className="flex items-center gap-1 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-300"
                                  title={`${reactions
                                    .map((r) => r.username)
                                    .join(", ")}`}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-medium">
                                    {reactions.length}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}

                          <p className="mt-1 text-[10px] text-zinc-600">
                            {new Date(msg.createdAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-red-600 to-purple-600 shadow-xl shadow-red-900/40">
              <Eye className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-200">
              Secret Admin Monitoring
            </h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Select a group from the sidebar to view its chats incognito.
              Users will never know {"you're"} watching. 👁️
            </p>
          </div>
        )}
      </main>

      {/* Members Modal */}
      {membersModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setMembersModal(null)}
        >
          <div
            className="w-full max-w-lg animate-fade-in rounded-2xl border border-zinc-800 bg-[#120a1f] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">
                  Members of {membersModal.name}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {membersModal.members.length + 1} total (including owner)
                </p>
              </div>
              <button
                onClick={() => setMembersModal(null)}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {membersError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {membersError}
              </div>
            )}

            {membersLoading ? (
              <div className="py-8 text-center text-sm text-zinc-500">
                Loading members...
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto space-y-2">
                {/* Owner */}
                <div className="flex items-center justify-between rounded-xl border border-purple-600/30 bg-purple-600/10 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 text-xs font-bold text-white">
                      {membersModal.owner.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">
                        {membersModal.owner.username}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                        Owner
                      </p>
                    </div>
                  </div>
                  <span className="rounded bg-purple-600/20 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                    OWNER
                  </span>
                </div>

                {/* Members */}
                {membersModal.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-800 px-4 py-3 transition-colors hover:bg-zinc-800/30"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                        {member.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-100">
                          {member.username}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          Joined {new Date(member.joinedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      disabled={removingMember === member.id}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      title="Remove member"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      {removingMember === member.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}