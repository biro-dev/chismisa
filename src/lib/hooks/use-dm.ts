"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectMessage } from "@/lib/types";
import {
  deleteDirectMessageAction,
  editDirectMessageAction,
  markDmAsRead,
  reactToDirectMessageAction,
  sendDirectMessageAction,
} from "@/lib/actions/direct-messages";
import {
  setDmRealtimeHandlers,
  subscribeToDm,
  unsubscribeFromDm,
} from "@/lib/realtime";

/**
 * All direct-message state for the active conversation: message loading,
 * incremental polling fallback (30s), realtime (Pusher) subscription,
 * optimistic send, edit/delete/react, and read receipts.
 */
export function useDm({
  conversationId,
  userId,
  onConversationActivity,
}: {
  conversationId: string | null;
  userId: string;
  /** Called when a message arrives so the sidebar preview/badge can refresh. */
  onConversationActivity?: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  // Which conversation the stored `messages` belong to. Lets us derive the
  // loading/empty state without touching state inside effects.
  const [messagesFor, setMessagesFor] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [actionError, setActionError] = useState("");
  const lastMessageTimeRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  // Keep the ref in sync with the active conversation. Async callbacks use
  // it to detect switches; it's never read during render.
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Derived: loading while the active conversation's messages haven't loaded
  const loading = conversationId !== null && messagesFor !== conversationId;
  // Derived: stale messages from a previous conversation are never shown
  const visibleMessages =
    conversationId && messagesFor === conversationId ? messages : [];

  // Load messages when the active conversation changes. The response lands in
  // promise callbacks (never synchronously), and `cancelled` guards against
  // applying a stale response after a conversation switch.
  useEffect(() => {
    lastMessageTimeRef.current = null;
    if (!conversationId) return;
    let cancelled = false;
    fetch(
      `/api/dm/messages?conversationId=${encodeURIComponent(conversationId)}`,
      { credentials: "include" }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DirectMessage[] | null) => {
        if (cancelled) return;
        if (!Array.isArray(data)) {
          setMessages([]);
          setMessagesFor(conversationId); // stop the loading state
          return;
        }
        setMessages(data);
        setMessagesFor(conversationId);
        const last = data[data.length - 1];
        if (last) lastMessageTimeRef.current = last.createdAt;
        void markDmAsRead(conversationId);
      })
      .catch(() => {
        // Mark as loaded so the skeleton doesn't spin forever; the polling
        // interval will retry and populate messages.
        if (!cancelled) setMessagesFor(conversationId);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Incremental polling fallback (30s) — only fetches messages since the last
  // known one, so it stays cheap. Realtime is the primary path.
  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      const since = lastMessageTimeRef.current;
      const url = `/api/dm/messages?conversationId=${encodeURIComponent(conversationId)}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
      fetch(url, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : []))
        .then((incoming: DirectMessage[]) => {
          if (conversationIdRef.current !== conversationId) return;
          if (!Array.isArray(incoming) || incoming.length === 0) return;
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !known.has(m.id));
            if (fresh.length === 0) return prev;
            const next = [...prev, ...fresh];
            const last = next[next.length - 1];
            if (last) lastMessageTimeRef.current = last.createdAt;
            return next;
          });
          void markDmAsRead(conversationId);
          onConversationActivity?.();
        })
        .catch(() => {
          // ignore — next poll retries
        });
    }, 30_000);
    return () => clearInterval(interval);
  }, [conversationId, onConversationActivity]);

  // Realtime subscription for the active conversation
  useEffect(() => {
    if (!conversationId) return;
    subscribeToDm(conversationId);
    return () => {
      unsubscribeFromDm(conversationId);
    };
  }, [conversationId]);

  // Merge an incoming realtime message into state (active conversation only —
  // events arrive on the subscribed conversation's channel).
  const applyIncomingMessage = useCallback(
    (message: DirectMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        const next = [...prev, message];
        const last = next[next.length - 1];
        if (last) lastMessageTimeRef.current = last.createdAt;
        return next;
      });
      const active = conversationIdRef.current;
      if (active) void markDmAsRead(active);
      onConversationActivity?.();
    },
    [onConversationActivity]
  );

  // Register realtime handlers (re-registers if callbacks change)
  useEffect(() => {
    setDmRealtimeHandlers({
      onNewDmMessage: applyIncomingMessage,
      onDmMessageDeleted: (messageId) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, deletedAt: new Date().toISOString(), content: "" }
              : m
          )
        );
        onConversationActivity?.();
      },
      onDmMessageEdited: (messageId, content, editedAt) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content,
                  editedAt: editedAt ?? new Date().toISOString(),
                }
              : m
          )
        );
      },
      onDmReactionUpdated: (messageId, reactions) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
        );
      },
    });
  }, [applyIncomingMessage, onConversationActivity]);

  // Send a message — optimistic add, replaced by the confirmed version
  const sendMessageDmCore = async (
    content: string,
    replyToId: string | null,
    media: {
      mediaUrl: string;
      mediaType: "image" | "video" | "voice";
      mediaThumb?: string | null;
      mediaSize?: number | null;
      mediaDuration?: number | null;
    } | null
  ) => {
    const id = conversationIdRef.current;
    if (!id) return;

    const optimistic: DirectMessage = {
      id: `temp-${Date.now()}`,
      content,
      userId,
      username: "",
      createdAt: new Date().toISOString(),
      deletedAt: null,
      editedAt: null,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            username: replyTo.username,
          }
        : null,
      reactions: [],
      ...(media ? {
        mediaUrl: media.mediaUrl,
        mediaType: media.mediaType,
        mediaThumb: media.mediaThumb ?? null,
        mediaSize: media.mediaSize ?? null,
        mediaDuration: media.mediaDuration ?? null,
      } : {}),
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);

    try {
      const result = await sendDirectMessageAction(id, content, replyToId, media ?? undefined);
      if (result.error) {
        setActionError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setMessageInput(content); // restore the draft
        return;
      }
      if (result.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? result.message! : m))
        );
        lastMessageTimeRef.current = result.message.createdAt;
      }
      onConversationActivity?.();
    } catch {
      setActionError("Failed to send message.");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setMessageInput(content);
    }
  };

  // Store pending media (set by composer when a file is selected, cleared after send)
  const [pendingDmMedia, setPendingDmMedia] = useState<{
    mediaUrl: string;
    mediaType: "image" | "video" | "voice";
    mediaThumb?: string | null;
    mediaSize?: number | null;
    mediaDuration?: number | null;
  } | null>(null);

  const handleSendMessage = useCallback(async () => {
    const content = messageInput.trim();
    if (!content && !pendingDmMedia) return;

    const media = pendingDmMedia;
    setMessageInput("");
    setPendingDmMedia(null);

    await sendMessageDmCore(content, replyTo?.id ?? null, media);
  }, [messageInput, userId, replyTo, onConversationActivity, pendingDmMedia, sendMessageDmCore]);

  // Send a media message (called from the composer after upload completes)
  const sendDmMediaMessage = useCallback(
    async (media: {
      mediaUrl: string;
      mediaType: "image" | "video" | "voice";
      mediaThumb?: string | null;
      mediaSize?: number | null;
      mediaDuration?: number | null;
    }, caption?: string) => {
      const content = caption?.trim() || "";
      setPendingDmMedia(null);
      await sendMessageDmCore(content, replyTo?.id ?? null, media);
    },
    [replyTo, sendMessageDmCore]
  );

  // Toggle a reaction (optimistic; server broadcast reconciles others)
  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions.find(
            (r) => r.userId === userId && r.emoji === emoji
          );
          if (existing) {
            return {
              ...m,
              reactions: m.reactions.filter((r) => r !== existing),
            };
          }
          // Different emoji: replace the user's previous reaction (Messenger-style)
          return {
            ...m,
            reactions: [
              ...m.reactions.filter((r) => r.userId !== userId),
              { id: `temp-${Date.now()}`, emoji, userId, username: "" },
            ],
          };
        })
      );
      const result = await reactToDirectMessageAction(messageId, emoji);
      if (result.error) setActionError(result.error);
    },
    [userId]
  );

  // Delete a message (own only) — optimistic, matches the group chat flow
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, deletedAt: new Date().toISOString(), content: "" }
          : m
      )
    );
    const result = await deleteDirectMessageAction(messageId);
    if (result.error) setActionError(result.error);
  }, []);

  // Edit a message (own only) — returns any error so the inline editor
  // in the bubble can keep itself open and show it.
  const handleEditMessage = useCallback(
    async (
      messageId: string,
      content: string
    ): Promise<{ error?: string }> => {
      const trimmed = content.trim();
      if (!trimmed) return { error: "Message content is required." };
      const result = await editDirectMessageAction(messageId, trimmed);
      if (result.error) return { error: result.error };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: trimmed, editedAt: new Date().toISOString() }
            : m
        )
      );
      return {};
    },
    []
  );

  return {
    messages: visibleMessages,
    loading,
    messageInput,
    setMessageInput,
    replyTo,
    setReplyTo,
    actionError,
    setActionError,
    handleSendMessage,
    handleReact,
    handleDeleteMessage,
    handleEditMessage,
    sendDmMediaMessage,
    pendingDmMedia,
    setPendingDmMedia,
  };
}