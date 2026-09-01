"use client";

import { LogOut, MessageSquare, Plus, Shield, Sun, Moon, Users, X } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { groupColor } from "@/lib/group-color";
import type { Theme } from "@/lib/theme";
import type { Conversation, Group } from "@/lib/types";

export function GroupSidebar({
  username,
  theme,
  onToggleTheme,
  groups,
  selectedGroupId,
  onSelectGroup,
  dms,
  selectedDmId,
  onSelectDm,
  onShowNewDm,
  sidebarOpen,
  onCloseSidebar,
  onShowCreate,
  onShowJoin,
}: {
  username: string;
  theme: Theme;
  onToggleTheme: () => void;
  groups: Group[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  dms: Conversation[];
  selectedDmId: string | null;
  onSelectDm: (conversationId: string) => void;
  onShowNewDm: () => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onShowCreate: () => void;
  onShowJoin: () => void;
}) {
  return (
    <aside
      className={`fixed z-50 flex w-72 flex-col border-r border-hairline bg-ink transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Mobile close button */}
      <button
        onClick={onCloseSidebar}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
        title="Close menu"
      >
        <X className="h-4 w-4" />
      </button>

      {/* User profile header */}
      <div className="safe-top flex items-center justify-between border-b border-zinc-800/60 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gossip-deep text-sm font-bold text-white">
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-text">{username}</p>
            <p className="text-xs text-ink-muted">Anonymous user</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleTheme}
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
            onShowCreate();
            onCloseSidebar();
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gossip-deep py-2 text-xs font-semibold text-white transition-colors hover:bg-gossip"
        >
          <Plus className="h-3.5 w-3.5" />
          Create
        </button>
        <button
          onClick={() => {
            onShowJoin();
            onCloseSidebar();
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline py-2 text-xs font-semibold text-ink-text transition-colors hover:bg-surface-raised"
        >
          <Users className="h-3.5 w-3.5" />
          Join
        </button>
      </div>

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-2 text-xs font-medium text-ink-muted">
          Your groups
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
                onClick={() => {
                  onSelectGroup(group.id);
                  onCloseSidebar();
                }}
                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedGroupId === group.id
                    ? "bg-surface-raised text-ink-text"
                    : "text-ink-text hover:bg-surface/70"
                }`}
              >
                {group.unreadCount > 0 && group.id !== selectedGroupId && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gossip"
                  />
                )}
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
                  <p className="text-xs text-ink-muted">
                    {group.memberCount} members
                  </p>
                </div>
                {group.isOwner && (
                  <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                    Owner
                  </span>
                )}
                {group.unreadCount > 0 && group.id !== selectedGroupId && (
                  <span
                    className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gossip px-1.5 text-[10px] font-bold text-white"
                    title={`${group.unreadCount} unread message${
                      group.unreadCount === 1 ? "" : "s"
                    }`}
                  >
                    {group.unreadCount > 99 ? "99+" : group.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Direct messages list */}
      <div className="border-t border-zinc-800/60 px-2 py-2">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-medium text-ink-muted">
            Direct messages
          </p>
          <button
            onClick={() => {
              onShowNewDm();
              onCloseSidebar();
            }}
            className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-surface-raised hover:text-gossip"
            title="New direct message"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {dms.length === 0 ? (
          <p className="px-2 py-3 text-xs text-zinc-600">
            No conversations yet. Tap + to message someone.
          </p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {dms.map((dm) => (
              <button
                key={dm.id}
                onClick={() => {
                  onSelectDm(dm.id);
                  onCloseSidebar();
                }}
                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selectedDmId === dm.id
                    ? "bg-surface-raised text-ink-text"
                    : "text-ink-text hover:bg-surface/70"
                }`}
              >
                {dm.unreadCount > 0 && dm.id !== selectedDmId && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gossip"
                  />
                )}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${groupColor(
                    dm.otherUser.username
                  )}`}
                >
                  <span className="text-xs font-bold text-white">
                    {dm.otherUser.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {dm.otherUser.username}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {dm.lastMessage
                      ? dm.lastMessage.content || "Message deleted"
                      : "No messages yet"}
                  </p>
                </div>
                {dm.unreadCount > 0 && dm.id !== selectedDmId && (
                  <span
                    className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gossip px-1.5 text-[10px] font-bold text-white"
                    title={`${dm.unreadCount} unread message${
                      dm.unreadCount === 1 ? "" : "s"
                    }`}
                  >
                    {dm.unreadCount > 99 ? "99+" : dm.unreadCount}
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
  );
}
