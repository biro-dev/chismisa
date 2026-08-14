"use client";

import { useState } from "react";
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
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { createGroupAction, joinGroupAction } from "@/lib/actions/groups";
import { sendMessageAction } from "@/lib/actions/messages";
import { useActionState, useEffect, useRef } from "react";

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

type Message = {
  id: string;
  content: string;
  userId: string;
  username: string;
  createdAt: string;
};

type DashboardProps = {
  username: string;
  userId: string;
  groups: Group[];
  activeGroup: GroupDetails | null;
  messages: Message[];
};

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
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [createState, createAction, createPending] = useActionState(
    createGroupAction,
    undefined
  );
  const [joinState, joinAction, joinPending] = useActionState(
    joinGroupAction,
    undefined
  );

  // Poll for new messages every 2 seconds for real-time updates
  useEffect(() => {
    const groupId = activeGroup?.id;
    if (!groupId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/messages?groupId=${groupId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeGroup?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !messageInput.trim() || sending) return;

    setSending(true);
    const formData = new FormData();
    formData.append("groupId", activeGroup.id);
    formData.append("content", messageInput.trim());

    try {
      const result = await sendMessageAction(formData);
      if (result.success) {
        setMessageInput("");
        // Immediately refetch messages
        const res = await fetch(`/api/messages?groupId=${activeGroup.id}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data);
        }
      }
    } finally {
      setSending(false);
    }
  };

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
    router.push(`/?group=${groupId}`);
    router.refresh();
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <aside className="flex w-72 flex-col border-r border-zinc-800/60 bg-[#0d0818]">
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
            onClick={() => setShowCreateModal(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 py-2 text-xs font-semibold text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
          <button
            onClick={() => setShowJoinModal(true)}
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
      <main className="flex flex-1 flex-col bg-[#0a0612]">
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
                  Invite Code
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-zinc-500">
                    No messages yet. Start the chismis! 🫢
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const isOwn = msg.userId === userId;
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}
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
                            <p className="whitespace-pre-wrap break-words">
                              {msg.content}
                            </p>
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
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Message input */}
            <form
              onSubmit={handleSendMessage}
              className="border-t border-zinc-800/60 p-4"
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
                  disabled={!messageInput.trim() || sending}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white transition-all hover:from-purple-500 hover:to-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
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
            <div className="mt-6 flex gap-3">
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