"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectMessage } from "@/lib/types";
import { startMediaUpload, type MediaDraft } from "@/lib/media-upload";
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
 * Everything needed to re-send a media message whose upload failed — keyed by
 * optimistic message id and powering the "Tap to retry" bubble affordance.
 */
type DmMediaRetryEntry = {
  file: File;
  mediaType: "image" | "video" | "voice";
  mediaSize: number;
  mediaDuration: number | null;
  localUrl: string;
  /** Set when the upload succeeded but the server send failed (skip re-upload). */
  uploadedUrl?: string;
  content: string;
  replyToId: string | null;
};

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

  // Media messages whose upload failed, keyed by optimistic message id —
  // powers "Tap to retry" on the bubble.
  const mediaRetriesRef = useRef<Map<string, DmMediaRetryEntry>>(new Map());

  // Send a message — optimistic add, replaced by the confirmed version.
  // With a media draft the bubble appears instantly (local blob URL) with a
  // progress ring while the background upload finishes; the server send only
  // happens once the final download URL is available.
  const sendMessageDmCore = useCallback(async (
    content: string,
    replyToId: string | null,
    draft: MediaDraft | null
  ) => {
    const id = conversationIdRef.current;
    if (!id) return;

    const uploading = draft !== null && !draft.handle.isSettled();
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
      ...(draft ? {
        mediaUrl: draft.localUrl,
        mediaType: draft.mediaType,
        mediaThumb: null,
        mediaSize: draft.mediaSize,
        mediaDuration: draft.mediaDuration,
        ...(uploading ? { mediaStatus: "uploading" as const, mediaProgress: draft.handle.getProgress() } : {}),
      } : {}),
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);

    // "upload" until we hold the final URL, then "send" for the server call —
    // failures in the upload stage keep the bubble alive with a retry.
    let stage: "upload" | "send" = draft ? "upload" : "send";

    try {
      let mediaPayload:
        | {
            mediaUrl: string;
            mediaType: "image" | "video" | "voice";
            mediaThumb: string | null;
            mediaSize: number | null;
            mediaDuration: number | null;
          }
        | undefined;

      if (draft) {
        // Await the background upload (usually already finished by now)
        const unsubscribe = draft.handle.onProgress((p) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimistic.id ? { ...m, mediaProgress: p } : m))
          );
        });
        let url: string;
        try {
          url = await draft.handle.promise;
        } finally {
          unsubscribe();
        }
        stage = "send";
        URL.revokeObjectURL(draft.localUrl);
        mediaPayload = {
          mediaUrl: url,
          mediaType: draft.mediaType,
          mediaThumb: null,
          mediaSize: draft.mediaSize,
          mediaDuration: draft.mediaDuration,
        };
        // Swap the bubble from the local blob URL to the final download URL
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id
              ? { ...m, mediaUrl: url, mediaStatus: null, mediaProgress: null }
              : m
          )
        );
      }

      const result = await sendDirectMessageAction(id, content, replyToId, mediaPayload);
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
      if (stage === "upload") {
        // Upload failed — keep the bubble (it still previews via the local
        // blob URL) and offer a retry instead of dropping the message.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimistic.id ? { ...m, mediaStatus: "failed", mediaProgress: null } : m
          )
        );
        mediaRetriesRef.current.set(optimistic.id, {
          file: draft!.file,
          mediaType: draft!.mediaType,
          mediaSize: draft!.mediaSize,
          mediaDuration: draft!.mediaDuration,
          localUrl: draft!.localUrl,
          content,
          replyToId,
        });
      } else {
        setActionError("Failed to send message.");
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setMessageInput(content);
      }
    }
  }, [userId, replyTo, onConversationActivity]);

  // Pending media draft — set by the composer as soon as a file is picked
  // (its upload runs in the background) and cleared on send or discard.
  const [pendingDmMedia, setPendingDmMedia] = useState<MediaDraft | null>(null);

  const handleSendMessage = useCallback(async () => {
    const content = messageInput.trim();
    if (!content && !pendingDmMedia) return;

    const media = pendingDmMedia;
    setMessageInput("");
    setPendingDmMedia(null);

    await sendMessageDmCore(content, replyTo?.id ?? null, media);
  }, [messageInput, replyTo, pendingDmMedia, sendMessageDmCore]);

  // Send a media message — the composer hands over the draft; the send path
  // awaits its background upload and then persists the message.
  const sendDmMediaMessage = useCallback(
    async (draft: MediaDraft, caption?: string) => {
      const content = caption?.trim() || "";
      setPendingDmMedia(null);
      await sendMessageDmCore(content, replyTo?.id ?? null, draft);
    },
    [replyTo, sendMessageDmCore]
  );

  // Retry a media message whose upload failed ("Tap to retry" on the bubble).
  const handleMediaRetry = useCallback(
    async (messageId: string) => {
      const entry = mediaRetriesRef.current.get(messageId);
      const id = conversationIdRef.current;
      if (!entry || !id) return;
      mediaRetriesRef.current.delete(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, mediaStatus: "uploading" as const, mediaProgress: 0 } : m
        )
      );
      try {
        let url: string;
        if (entry.uploadedUrl) {
          // Upload already succeeded previously — go straight to the server send.
          url = entry.uploadedUrl;
        } else {
          const handle = startMediaUpload(entry.file, userId);
          const unsubscribe = handle.onProgress((p) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, mediaProgress: p } : m))
            );
          });
          try {
            url = await handle.promise;
          } finally {
            unsubscribe();
          }
          URL.revokeObjectURL(entry.localUrl);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, mediaUrl: url, mediaStatus: null, mediaProgress: null } : m
          )
        );

        const result = await sendDirectMessageAction(id, entry.content, entry.replyToId, {
          mediaUrl: url,
          mediaType: entry.mediaType,
          mediaThumb: null,
          mediaSize: entry.mediaSize,
          mediaDuration: entry.mediaDuration,
        });
        if (result.error) {
          // Upload succeeded but the server refused — remember the URL so a
          // retry doesn't re-upload the file.
          mediaRetriesRef.current.set(messageId, { ...entry, uploadedUrl: url });
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, mediaStatus: "failed" as const } : m))
          );
          setActionError(result.error);
          return;
        }
        if (result.message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? result.message! : m))
          );
          lastMessageTimeRef.current = result.message.createdAt;
        }
        onConversationActivity?.();
      } catch {
        mediaRetriesRef.current.set(messageId, entry);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, mediaStatus: "failed" as const, mediaProgress: null } : m
          )
        );
      }
    },
    [userId, onConversationActivity]
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
    handleMediaRetry,
    pendingDmMedia,
    setPendingDmMedia,
  };
}