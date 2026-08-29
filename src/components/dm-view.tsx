"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, Send, X } from "lucide-react";
import { MessageBubble } from "@/components/message-bubble";
import type { useDm } from "@/lib/hooks/use-dm";
import type { Conversation } from "@/lib/types";
import { groupColor } from "@/lib/group-color";

/**
 * Direct-message chat view. Mirrors the group chat layout but is driven by
 * the useDm hook; reuses MessageBubble for rendering (reactions, replies,
 * editing, deletion, read receipts all work identically).
 */
export function DmView({
  conversation,
  userId,
  dm,
  onBack,
}: {
  conversation: Conversation | null;
  userId: string;
  dm: ReturnType<typeof useDm>;
  onBack: () => void;
}) {
  const {
    messages,
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
  } = dm;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Keep the textarea height reasonable — mirrors the group chat input
  const handleInputChange = (value: string) => {
    setMessageInput(value);
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  };

  if (!conversation) return null;

  return (
    <div className="flex h-full flex-col">
      {/* DM header */}
      <div className="flex items-center gap-3 border-b border-zinc-800/60 px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
          title="Back to groups"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${groupColor(
            conversation.otherUser.username
          )}`}
        >
          <span className="text-base font-bold text-white">
            {conversation.otherUser.username.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            {conversation.otherUser.username}
          </h2>
          <p className="text-xs text-zinc-500">Direct message</p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div
              className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${groupColor(
                conversation.otherUser.username
              )}`}
            >
              <span className="text-xl font-bold text-white">
                {conversation.otherUser.username.charAt(0).toUpperCase()}
              </span>
            </div>
            <p className="text-sm font-semibold text-zinc-300">
              {conversation.otherUser.username}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Say hi — this is the start of your conversation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isOwn={msg.userId === userId}
                userId={userId}
                onReply={(m) => setReplyTo(m)}
                onReact={handleReact}
                onDelete={handleDeleteMessage}
                onEdit={handleEditMessage}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800/60 bg-zinc-900/40 px-4 py-2">
          <div className="min-w-0 text-xs">
            <p className="font-medium text-purple-400">
              Replying to {replyTo.username}
            </p>
            <p className="truncate text-zinc-500">{replyTo.content}</p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="rounded-lg p-1 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Error banner */}
      {actionError && (
        <div className="flex items-center justify-between border-t border-red-500/30 bg-red-500/10 px-4 py-2">
          <p className="text-xs text-red-300">{actionError}</p>
          <button
            onClick={() => setActionError("")}
            className="text-xs text-red-300 hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Input */}
      <div className="safe-bottom flex items-end gap-2 border-t border-zinc-800/60 p-3">
        <textarea
          ref={inputRef}
          value={messageInput}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSendMessage();
            }
          }}
          placeholder={`Message ${conversation.otherUser.username}…`}
          maxLength={2000}
          rows={1}
          className="max-h-[120px] flex-1 resize-none rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
        />
        <button
          onClick={() => void handleSendMessage()}
          disabled={!messageInput.trim()}
          className="rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 p-2.5 text-white transition-colors hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-40"
          title="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
