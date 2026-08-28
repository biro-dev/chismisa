// Shared client/server types for the chat dashboard.

export type Group = {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  memberCount: number;
  messageCount: number;
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
  seenCount?: number;
  createdAt: string;
  replyTo: {
    id: string;
    content: string;
    username: string;
  } | null;
  reactions: MessageReaction[];
};

export type DashboardProps = {
  username: string;
  userId: string;
  groups: Group[];
  activeGroup: GroupDetails | null;
  messages: Message[];
};
