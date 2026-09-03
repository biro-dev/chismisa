"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ImageOff, LogOut, Mic, Trash2, Users, X } from "lucide-react";
import { getGroupMedia, type GroupMediaItem } from "@/lib/actions/messages";
import { groupColor } from "@/lib/group-color";
import { showToast } from "@/lib/toast";
import type { GroupDetails } from "@/lib/types";

/**
 * Collapsible right-hand context panel for the group thread (Messenger-style
 * info drawer). Two tabs:
 *  - Media: recent image/video/voice attachments (lazy-loaded on open)
 *  - Details: member list, invite code (owners), leave/delete actions
 *
 * Purely additive UI: leave/delete/invite reuse the same handlers the thread
 * header already used, so no behavior changes.
 */
export function ContextPanel({
  open,
  onClose,
  group,
  onInvite,
  onLeave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetails;
  /** Shown when the current user is the owner (opens the invite modal). */
  onInvite?: () => void;
  /** Shown for non-owners (opens the leave confirmation). */
  onLeave?: () => void;
  /** Shown for owners (opens the delete confirmation). */
  onDelete?: () => void;
}) {
  const [tab, setTab] = useState<"media" | "details">("media");
  const [media, setMedia] = useState<GroupMediaItem[]>([]);
  // Starts true so the skeleton shows while the first fetch resolves; the
  // parent keys this panel by group id, so state never leaks across groups.
  const [mediaLoading, setMediaLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Fetch the media gallery when the panel opens. All setState calls happen
  // in async callbacks — never synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getGroupMedia(group.id)
      .then((items) => {
        if (!cancelled) setMedia(items);
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, group.id]);

  const copyInviteCode = async () => {
    if (!group.code) return;
    try {
      await navigator.clipboard.writeText(group.code);
      setCopied(true);
      showToast("Invite code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        aria-label={`${group.name} details`}
        className={`fixed inset-y-0 right-0 z-40 flex w-80 max-w-full flex-col border-l border-hairline bg-surface transition-transform duration-200 lg:static lg:z-auto ${
          open ? "translate-x-0" : "translate-x-full lg:hidden"
        }`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-text">{group.name}</h3>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-hairline px-3 py-2">
          <button
            onClick={() => setTab("media")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "media"
                ? "bg-gossip-deep text-white"
                : "text-ink-muted hover:bg-surface-raised hover:text-ink-text"
            }`}
          >
            Media
          </button>
          <button
            onClick={() => setTab("details")}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "details"
                ? "bg-gossip-deep text-white"
                : "text-ink-muted hover:bg-surface-raised hover:text-ink-text"
            }`}
          >
            Details
          </button>
        </div>

        {/* Body */}
        {tab === "media" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {mediaLoading ? (
              <div className="grid grid-cols-3 gap-0.5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-md bg-surface-raised"
                  />
                ))}
              </div>
            ) : media.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <ImageOff className="mb-2 h-8 w-8 text-zinc-600" />
                <p className="text-sm text-ink-muted">No media shared yet.</p>
                <p className="text-xs text-zinc-600">
                  Photos, videos and voice notes will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {media.map((item) =>
                  item.type === "image" ? (
                    <button
                      key={item.id}
                      onClick={() => window.open(item.url, "_blank")}
                      title={`Shared by ${item.username}`}
                      className="group relative aspect-square overflow-hidden rounded-md"
                    >
                      <img
                        src={item.url}
                        alt={`Image shared by ${item.username}`}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : item.type === "video" ? (
                    <div
                      key={item.id}
                      className="relative aspect-square overflow-hidden rounded-md bg-black/30"
                      title={`Video shared by ${item.username}`}
                    >
                      <video
                        src={item.url}
                        poster={item.thumb ?? undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open video"
                        className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors hover:bg-black/40"
                      >
                        ▶
                      </a>
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      title={`Voice message from ${item.username}`}
                      className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md bg-surface-raised text-ink-muted"
                    >
                      <Mic className="h-5 w-5" />
                      <span className="text-[10px]">Voice</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/* Group identity */}
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${groupColor(group.name)}`}
              >
                <span className="text-lg font-bold text-white">
                  {group.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-text">
                  {group.name}
                </p>
                <p className="text-xs text-ink-muted">
                  {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {/* Invite code — owners only (the server only exposes it to them) */}
            {group.code && onInvite && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Invite code
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-gossip/40 bg-gossip/10 p-2.5">
                  <code className="min-w-0 flex-1 truncate text-center font-mono text-sm font-bold tracking-widest text-gossip">
                    {group.code}
                  </code>
                  <button
                    onClick={copyInviteCode}
                    title="Copy code"
                    aria-label="Copy invite code"
                    className="shrink-0 rounded-lg bg-gossip/20 p-2 text-gossip transition-colors hover:bg-gossip/30"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={onInvite}
                  className="w-full rounded-xl bg-gossip-deep py-2 text-xs font-semibold text-white transition-colors hover:bg-gossip"
                >
                  Share Invite Link
                </button>
              </div>
            )}

            {/* Members */}
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <Users className="h-3.5 w-3.5" />
                Members
              </p>
              {group.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-bold text-ink-text">
                    {m.username.charAt(0).toUpperCase()}
                  </div>
                  <p className="truncate text-sm text-ink-text">{m.username}</p>
                </div>
              ))}
            </div>

            {/* Danger zone — same confirm modals as before, new location */}
            {onLeave && (
              <button
                onClick={onLeave}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-hairline py-2.5 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-raised"
              >
                <LogOut className="h-4 w-4" />
                Leave Group
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Delete Group
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
