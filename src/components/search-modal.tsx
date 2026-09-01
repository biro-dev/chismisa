"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { Message } from "@/lib/types";

type SearchResult = Message;

function formatTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Search-in-group modal. Debounces the query (~300ms), fetches
 * /api/search, and shows results with the matched substring highlighted.
 * Clicking a result jumps the chat to that message.
 */
export function SearchModal({
  groupId,
  onClose,
  onJumpToMessage,
}: {
  groupId: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bump on every new request; stale responses are discarded.
  const requestSeqRef = useRef(0);

  // Focus the input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/search?groupId=${encodeURIComponent(groupId)}&q=${encodeURIComponent(q)}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (seq !== requestSeqRef.current) return; // stale response
        if (!res.ok) {
          setError(data.error || "Search failed. Please try again.");
          setResults(null);
        } else {
          setResults(data as SearchResult[]);
        }
      } catch {
        if (seq === requestSeqRef.current) {
          setError("Something went wrong. Please try again.");
          setResults(null);
        }
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [groupId]
  );

  // Debounced search as the user types. Short queries just skip the fetch —
  // the view derives its "type at least 2 characters" hint from the query
  // length, so there's no need to reset state here.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) return;
    debounceRef.current = setTimeout(() => void runSearch(q), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const highlighted = (content: string) => {
    const q = query.trim();
    if (!q) return content;
    const idx = content.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return content;
    return (
      <>
        {content.slice(0, idx)}
        <mark className="rounded bg-purple-500/40 px-0.5 text-gossip">
          {content.slice(idx, idx + q.length)}
        </mark>
        {content.slice(idx + q.length)}
      </>
    );
  };

  return <SearchModalView
    query={query}
    setQuery={setQuery}
    inputRef={inputRef}
    loading={loading}
    error={error}
    results={results}
    highlighted={highlighted}
    onClose={onClose}
    onJumpToMessage={onJumpToMessage}
  />;
}

/**
 * Presentational part of the search modal.
 */
function SearchModalView({
  query,
  setQuery,
  inputRef,
  loading,
  error,
  results,
  highlighted,
  onClose,
  onJumpToMessage,
}: {
  query: string;
  setQuery: (q: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  loading: boolean;
  error: string;
  results: SearchResult[] | null;
  highlighted: (content: string) => React.ReactNode;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const q = query.trim();

  let body: React.ReactNode;
  if (error) {
    body = <p className="px-4 py-6 text-center text-sm text-red-400">{error}</p>;
  } else if (q.length < 2) {
    body = (
      <p className="px-4 py-6 text-center text-sm text-ink-muted">
        Type at least 2 characters to search.
      </p>
    );
  } else if (results === null) {
    body = (
      <p className="px-4 py-6 text-center text-sm text-ink-muted">
        {loading ? "Searching…" : ""}
      </p>
    );
  } else if (results.length === 0) {
    body = (
      <p className="px-4 py-6 text-center text-sm text-ink-muted">
        No messages found for &quot;{q}&quot;.
      </p>
    );
  } else {
    body = (
      <ul className="space-y-0.5">
        {results.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => onJumpToMessage(m.id)}
              className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-raised/70"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-semibold text-gossip">
                  {m.username}
                </span>
                <span className="shrink-0 text-[10px] text-ink-muted">
                  {formatTime(m.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-text">
                {highlighted(m.content)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg animate-fade-in rounded-2xl border border-hairline bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Search in this group…"
            maxLength={100}
            className="flex-1 bg-transparent text-sm text-ink-text placeholder:text-ink-muted outline-none"
          />
          {loading && q.length >= 2 && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-muted" />
          )}
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text"
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-y-auto p-2">{body}</div>
      </div>
    </div>
  );
}

