"use client";

import Pusher from "pusher-js";
import type { Channel, PresenceChannel } from "pusher-js";
import type { Message } from "@/lib/types";

// --- Payload types for realtime events ---

export type NewMessagePayload = {
  message: Message;
};

export type MessageDeletedPayload = {
  messageId: string;
};

export type MessageEditedPayload = {
  messageId: string;
  content: string;
  editedAt: string | null;
};

export type ReactionUpdatedPayload = {
  messageId: string;
  reactions: {
    id: string;
    emoji: string;
    userId: string;
    username: string;
  }[];
};

export type TypingPayload = {
  userId: string;
  username: string;
  timestamp: number;
};

// Callbacks the Dashboard wires up
export type RealtimeHandlers = {
  onNewMessage?: (message: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  onMessageEdited?: (
    messageId: string,
    content: string,
    editedAt: string | null
  ) => void;
  onReactionUpdated?: (
    messageId: string,
    reactions: ReactionUpdatedPayload["reactions"]
  ) => void;
  onTyping?: (userId: string, username: string) => void;
  onPresenceChange?: (count: number) => void;
};

const handlers: RealtimeHandlers = {};

let pusher: Pusher | null = null;
const channels = new Map<string, Channel>();

/**
 * Initialize the Pusher client. Only runs in the browser.
 * Safe to call multiple times — returns the singleton.
 */
function getPusher(): Pusher | null {
  if (typeof window === "undefined") return null;
  if (pusher) return pusher;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!key || !cluster) {
    return null; // Pusher not configured — app uses polling fallback
  }

  pusher = new Pusher(key, {
    cluster,
    authEndpoint: "/api/pusher/auth",
    authTransport: "ajax",
  });

  return pusher;
}

/** Register handlers (called once from the Dashboard). */
export function setRealtimeHandlers(h: RealtimeHandlers): void {
  Object.assign(handlers, h);
}

/**
 * Subscribe to a group's private channel.
 * Binds event handlers for messages, reactions, deletions, and typing.
 */
export function subscribeToGroup(groupId: string): Channel | null {
  const instance = getPusher();
  if (!instance) return null;

  const channelName = `private-group-${groupId}`;
  const existing = channels.get(channelName);

  // Reuse an existing channel (e.g. one the badge watcher already opened)
  // instead of subscribing twice, but rebind the handlers so a freshly
  // switched-into group gets the current handler closures. unbind() first
  // to avoid stacking duplicate listeners.
  const channel = existing ?? instance.subscribe(channelName);
  if (!existing) {
    channels.set(channelName, channel);
  } else {
    channel.unbind();
  }

  channel.bind("new-message", (payload: NewMessagePayload) => {
    handlers.onNewMessage?.(payload.message);
  });

  channel.bind("reaction-updated", (payload: ReactionUpdatedPayload) => {
    handlers.onReactionUpdated?.(payload.messageId, payload.reactions);
  });

  channel.bind("message-deleted", (payload: MessageDeletedPayload) => {
    handlers.onMessageDeleted?.(payload.messageId);
  });

  channel.bind("message-edited", (payload: MessageEditedPayload) => {
    handlers.onMessageEdited?.(
      payload.messageId,
      payload.content,
      payload.editedAt
    );
  });

  channel.bind("user-typing", (payload: TypingPayload) => {
    handlers.onTyping?.(payload.userId, payload.username);
  });

  return channel;
}

/**
 * Subscribe to a group's presence channel for online status.
 * Calls onPresenceChange with the current member count.
 */
export function subscribeToPresence(groupId: string): PresenceChannel | null {
  const instance = getPusher();
  if (!instance) return null;

  const channelName = `presence-group-${groupId}`;
  const existing = channels.get(channelName);
  if (existing) return existing as PresenceChannel;

  const presence = instance.subscribe(channelName) as PresenceChannel;
  channels.set(channelName, presence);

  const updateCount = () => {
    handlers.onPresenceChange?.(presence.members.count);
  };

  presence.bind("pusher:subscription_succeeded", updateCount);
  presence.bind("pusher:member_added", updateCount);
  presence.bind("pusher:member_removed", updateCount);

  return presence;
}

/** Unsubscribe from both private and presence channels for a group. */
export function unsubscribeFromGroup(groupId: string): void {
  if (!pusher) return;

  const name = `private-group-${groupId}`;
  // If the channel is also watched for unread badges, keep it alive — just
  // drop the active-group handlers and rebind the badge listener.
  if (badgeWatchedChannels.has(name)) {
    const channel = channels.get(name);
    if (channel) {
      channel.unbind();
      channel.bind("new-message", () => badgeHandler?.(groupId));
    }
    return;
  }
  if (channels.has(name)) {
    pusher.unsubscribe(name);
    channels.delete(name);
  }
}

// --- Unread badge watching ---
// Subscribes to every group the user belongs to (not just the active one) so
// the sidebar's unread badges update instantly via real-time instead of only
// on the 30s /api/groups poll. Channels created here are kept alive when the
// user switches groups — only the active-group handlers are rebound.

const badgeWatchedChannels = new Set<string>();
let badgeHandler: ((groupId: string) => void) | null = null;

/** Register the callback that fires when a watched group receives a message. */
export function setBadgeHandler(fn: (groupId: string) => void): void {
  badgeHandler = fn;
}

/**
 * Subscribe to all the given groups' private channels for badge updates.
 * Idempotent — already-subscribed channels (e.g. the active group's) are
 * reused and only get the badge binding added.
 */
export function watchGroups(groupIds: string[]): void {
  const instance = getPusher();
  if (!instance) return;

  for (const groupId of groupIds) {
    const name = `private-group-${groupId}`;
    if (badgeWatchedChannels.has(name)) continue;

    let channel = channels.get(name);
    if (!channel) {
      channel = instance.subscribe(name);
      channels.set(name, channel);
    }
    badgeWatchedChannels.add(name);
    channel.bind("new-message", () => badgeHandler?.(groupId));
  }
}

/** Clean up all channels and disconnect (call on logout / page unload). */
export function disconnectRealtime(): void {
  if (pusher) {
    pusher.disconnect();
    pusher = null;
  }
  channels.clear();
  badgeWatchedChannels.clear();
  badgeHandler = null;
}

/** Send a typing event via the REST API (debounced by the caller). */
export async function sendTyping(groupId: string): Promise<void> {
  if (!groupId) return;
  try {
    await fetch("/api/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ groupId }),
    });
  } catch {
    // non-critical — typing is best-effort
  }
}
