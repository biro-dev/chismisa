"use client";

import { LogOut, MessageSquare, Plus, Search, Shield, Sun, Moon, Users, X } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { groupColor } from "@/lib/group-color";
import type { Theme } from "@/lib/theme";
import type { SidebarConversation } from "@/lib/types";

export function UnifiedSidebar({
  username,
  theme,
  onToggleTheme,
  conversations,
  selectedId,
  selectedKind,
  onSelectConversation,
  sidebarOpen,
  onCloseSidebar,
  onShowCreate,
  onShowJoin,
  searchQuery,
  onSearchChange,
}: {
  username: string;
  theme: Theme;
  onToggleTheme: () => void;
  conversations: SidebarConversation[];
  selectedId: string | null;
  selectedKind: "dm" | "group" | null;
  onSelectConversation: (id: string, kind: "dm" | "group") => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onShowCreate: () => void;
  onShowJoin: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
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
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-amber-400"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <form action={logoutAction}>
            <button type="submit" title="Log out" className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"><LogOut className="h-4 w-4" /></button>
          </form>
        </div>
      </div>

      {/* Create / Join / New DM buttons */}
      <div className="flex gap-2 p-3">
        <button onClick={() => { onShowCreate(); onCloseSidebar(); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gossip-deep py-2 text-xs font-semibold text-white transition-colors hover:bg-gossip"><Plus className="h-3.5 w-3.5" />Create</button>
        <button onClick={() => { onShowJoin(); onCloseSidebar(); }} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline py-2 text-xs font-semibold text-ink-text transition-colors hover:bg-surface-raised"><Users className="h-3.5 w-3.5" />Join</button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search conversations..." className="min-w-0 flex-1 bg-transparent text-sm text-ink-text outline-none placeholder:text-ink-muted" />
        </div>
      </div>
      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-500">No conversations yet.</p>
            <p className="text-xs text-zinc-600">Create a group or message someone!</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => {
              const isSelected = selectedId === conv.id && selectedKind === conv.kind;
              const hasUnread = conv.unreadCount > 0 && !isSelected;
              return (
                <button
                  key={`${conv.kind}-${conv.id}`}
                  onClick={() => onSelectConversation(conv.id, conv.kind)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isSelected ? "bg-surface-raised text-ink-text" : "text-ink-text hover:bg-surface/70"
                  }`}
                >
                  {hasUnread && (
                    <span aria-hidden className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gossip" />
                  )}
                  {conv.kind === "dm" ? (
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${groupColor(conv.name)}`}>
                      <span className="text-sm font-bold text-white">{conv.avatar}</span>
                    </div>
                  ) : (
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${groupColor(conv.name)}`}>
                      <span className="text-sm font-bold text-white">{conv.avatar}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium">{conv.name}</p>
                      {conv.kind === "group" && conv.isOwner && (
                        <span className="ml-1 shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">Owner</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {conv.kind === "dm" ? (conv.lastMessage || "Tap to start chatting") : `${conv.memberCount} members`}
                    </p>
                  </div>
                  {hasUnread && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gossip px-1.5 text-[10px] font-bold text-white">
                      {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin link */}
      <div className="border-t border-zinc-800/60 p-3">
        <a href="/admin" className="flex items-center gap-2 text-xs text-zinc-600 transition-colors hover:text-zinc-400"><Shield className="h-3.5 w-3.5" />Admin</a>
      </div>
    </aside>
  );
}

