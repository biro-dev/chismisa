"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { EMOJI_CATEGORIES, QUICK_EMOJIS } from "@/lib/emoji-data";

/**
 * Composer emoji button + popover. Purely presentational: picking an emoji
 * calls `onInsert` and the parent decides how to add it to the draft (the
 * dashboard appends it to the message input — no send logic involved).
 */
export function EmojiPopover({ onInsert }: { onInsert: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside closes the popover
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Esc closes the popover
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Insert emoji"
        aria-expanded={open}
        title="Emoji"
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          open
            ? "bg-gossip/15 text-gossip"
            : "text-ink-muted hover:bg-surface hover:text-ink-text"
        }`}
      >
        <Smile className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 flex h-80 w-72 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface-raised shadow-xl shadow-black/30">
          {/* Quick emojis */}
          <div className="border-b border-hairline px-3 pb-2 pt-3">
            <div className="flex flex-wrap gap-1">
              {QUICK_EMOJIS.slice(0, 16).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onInsert(emoji)}
                  className="rounded-lg p-1.5 text-lg transition-colors hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-hairline px-3 py-2">
            {EMOJI_CATEGORIES.map((cat, index) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => setCategory(index)}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                  category === index
                    ? "bg-gossip-deep text-white"
                    : "text-ink-muted hover:bg-white/10 hover:text-ink-text"
                }`}
              >
                <span>{cat.icon}</span>
                <span className="hidden sm:inline">{cat.name}</span>
              </button>
            ))}
          </div>

          {/* Emoji grid */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJI_CATEGORIES[category]?.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onInsert(emoji)}
                  className="rounded-lg p-1.5 text-lg transition-colors hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
