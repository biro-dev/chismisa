// Shared client/server types for the chat dashboard.

export type Group = {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  memberCount: number;
  messageCount: number;
  /** Messages the current user hasn't read yet (for the sidebar badge). */
  unreadCount: number;
};

export type GroupDetails = {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  memberCount: number;
  members: { id: string; username: string }[];
};

export type MessageReaction = {
  id: string;
  emoji: string;
  userId: string;
  username: string;
};

export type Message = {
  id: string;
  content: string;
  userId: string;
  username: string;
  deletedAt?: string | null;
  editedAt?: string | null;
  seenCount?: number;
  createdAt: string;
  replyTo: {
    id: string;
    content: string;
    username: string;
  } | null;
  reactions: MessageReaction[];
  // Media attachment (image / video / voice)
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "voice" | null;
  mediaThumb?: string | null;
  mediaSize?: number | null;
  mediaDuration?: number | null;
  // Client-only optimistic upload state (never persisted server-side):
  // "uploading" shows a progress ring on the bubble, "failed" a retry affordance.
  mediaStatus?: "uploading" | "failed" | null;
  mediaProgress?: number | null;
};

export type DashboardProps = {
  username: string;
  userId: string;
  groups: Group[];
  activeGroup: GroupDetails | null;
  messages: Message[];
  /** Error code from redirect (e.g., "invalid-code" from /join/[code]). */
  error?: string;
};

// ─── Direct messages ─────────────────────────────────────────────────────────

/** A 1-on-1 conversation entry for the sidebar list. */
export type Conversation = {
  id: string;
  otherUser: { id: string; username: string };
  /** Last message preview (null if the conversation has no messages yet). */
  lastMessage: { content: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
};

/** Direct message — same shape as group Message so MessageBubble can render it. */
export type DirectMessage = Message;

// ─── Unified sidebar ──────────────────────────────────────────────────────

/** A normalized row in the unified sidebar conversation list. */
export type SidebarConversation =
  | {
      kind: "dm";
      id: string;
      name: string;
      avatar: string; // other user's initial
      lastMessage: string | null;
      lastActivity: string; // ISO timestamp
      unreadCount: number;
      online?: boolean;
    }
  | {
      kind: "group";
      id: string;
      name: string;
      avatar: string; // group initial
      lastMessage: string | null;
      lastActivity: string;
      unreadCount: number;
      memberCount: number;
      isOwner: boolean;
    };

/** A user presence entry for the "Active Now" row. */
export type PresenceUser = {
  userId: string;
  username: string;
  lastSeen: string; // ISO timestamp
};
