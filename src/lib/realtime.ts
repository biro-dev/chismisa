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

// Channel subscription tracking with reference counting
interface ChannelState {
  channel: Channel;
  refCount: number;
  badgeHandlerBound: boolean;
  activeHandlersBound: boolean;
}

const channelStates = new Map<string, ChannelState>();

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
 * Bind active group handlers to a channel.
 */
function bindActiveHandlers(channel: Channel): void {
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
}

/**
 * Unbind active group handlers from a channel.
 */
function unbindActiveHandlers(channel: Channel): void {
  channel.unbind("new-message");
  channel.unbind("reaction-updated");
  channel.unbind("message-deleted");
  channel.unbind("message-edited");
  channel.unbind("user-typing");
}

/**
 * Unbind badge handler from a channel.
 */
function unbindBadgeHandler(channel: Channel): void {
  channel.unbind("new-message");
}

/**
 * Subscribe to a group's private channel for active group events.
 * Uses reference counting to share the channel with badge watcher.
 */
export function subscribeToGroup(groupId: string): Channel | null {
  const instance = getPusher();
  if (!instance) return null;

  const channelName = `private-group-${groupId}`;
  let state = channelStates.get(channelName);

  if (!state) {
    const channel = instance.subscribe(channelName);
    state = {
      channel,
      refCount: 0,
      badgeHandlerBound: false,
      activeHandlersBound: false,
    };
    channelStates.set(channelName, state);
  }

  state.refCount += 1;

  // Bind active handlers if not already bound
  if (!state.activeHandlersBound) {
    bindActiveHandlers(state.channel);
    state.activeHandlersBound = true;
  }

  return state.channel;
}

/**
 * Subscribe to a group's presence channel for online status.
 */
export function subscribeToPresence(groupId: string): PresenceChannel | null {
  const instance = getPusher();
  if (!instance) return null;

  const channelName = `presence-group-${groupId}`;
  let state = channelStates.get(channelName);

  if (!state) {
    const presence = instance.subscribe(channelName) as PresenceChannel;
    state = {
      channel: presence,
      refCount: 0,
      badgeHandlerBound: false,
      activeHandlersBound: false,
    };
    channelStates.set(channelName, state);
  }

  state.refCount += 1;

  const presence = state.channel as PresenceChannel;

  const updateCount = () => {
    handlers.onPresenceChange?.(presence.members.count);
  };

  presence.bind("pusher:subscription_succeeded", updateCount);
  presence.bind("pusher:member_added", updateCount);
  presence.bind("pusher:member_removed", updateCount);

  return presence;
}

/**
 * Unsubscribe from a group's private channel.
 * Decrements ref count; only actually unsubscribes when count reaches 0.
 */
export function unsubscribeFromGroup(groupId: string): void {
  if (!pusher) return;

  const name = `private-group-${groupId}`;
  const state = channelStates.get(name);
  if (!state) return;

  state.refCount -= 1;

  if (state.refCount <= 0) {
    // No more references, clean up
    unbindActiveHandlers(state.channel);
    if (state.badgeHandlerBound) {
      unbindBadgeHandler(state.channel);
    }
    pusher.unsubscribe(name);
    channelStates.delete(name);
  } else {
    // Still have badge watcher, just unbind active handlers
    if (state.activeHandlersBound) {
      unbindActiveHandlers(state.channel);
      state.activeHandlersBound = false;
    }
  }
}

/**
 * Subscribe to all the given groups' private channels for badge updates.
 * Uses reference counting to share channels with active group subscription.
 */
export function watchGroups(groupIds: string[]): void {
  const instance = getPusher();
  if (!instance) return;

  for (const groupId of groupIds) {
    const name = `private-group-${groupId}`;
    let state = channelStates.get(name);

    if (!state) {
      const channel = instance.subscribe(name);
      state = {
        channel,
        refCount: 0,
        badgeHandlerBound: false,
        activeHandlersBound: false,
      };
      channelStates.set(name, state);
    }

    state.refCount += 1;

    // Bind badge handler if not already bound
    if (!state.badgeHandlerBound) {
      // Use a wrapper that calls the external badgeHandler
      const handler = () => {
        (window as unknown as { __badgeHandler?: ((groupId: string) => void) | null }).__badgeHandler?.(groupId);
      };
      state.channel.bind("new-message", handler);
      state.badgeHandlerBound = true;
    }
  }
}

/** Register the callback that fires when a watched group receives a message. */
export function setBadgeHandler(fn: (groupId: string) => void): void {
  (window as unknown as { __badgeHandler?: ((groupId: string) => void) | null }).__badgeHandler = fn;
}

/** Clean up all channels and disconnect (call on logout / page unload). */
export function disconnectRealtime(): void {
  if (pusher) {
    for (const [name, state] of channelStates) {
      if (state.activeHandlersBound) {
        unbindActiveHandlers(state.channel);
      }
      if (state.badgeHandlerBound) {
        unbindBadgeHandler(state.channel);
      }
      pusher.unsubscribe(name);
    }
    pusher.disconnect();
    pusher = null;
  }
  channelStates.clear();
  (window as unknown as { __badgeHandler?: ((groupId: string) => void) | null }).__badgeHandler = null;
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