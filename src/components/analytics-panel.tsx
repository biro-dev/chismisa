"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  LogOut,
  RefreshCw,
  Users,
  UserCheck,
  Users2,
  Zap,
  MessageSquare,
  TrendingUp,
  Clock,
} from "lucide-react";
import {
  getAnalyticsStats,
  loginAnalyticsAction,
  logoutAnalyticsAction,
} from "@/lib/actions/analytics";

type AnalyticsData = {
  userCount: number;
  onlineNow: { id: string; username: string; lastActiveAt: string | null }[];
  groupCount: number;
  totalActivity: number;
  messageCount: number;
  dmCount: number;
  periods: {
    today: { newUsers: number; messages: number; groups: number };
    week: { newUsers: number; messages: number; groups: number };
    month: { newUsers: number; messages: number; groups: number };
  };
  topGroups: {
    id: string;
    name: string;
    memberCount: number;
    messageCount: number;
  }[];
  recentSignups: { id: string; username: string; createdAt: string }[];
};

export function AnalyticsPanel() {
  const router = useRouter();
  const secretRef = useRef<string>("");
  const [isReady, setIsReady] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  // On mount: read secret from sessionStorage and ensure the cookie is set
  useEffect(() => {
    const secret = sessionStorage.getItem("analytics_secret") || "";
    secretRef.current = secret;
    if (!secret) {
      sessionStorage.removeItem("analytics_secret");
      logoutAnalyticsAction()
        .catch(() => {})
        .finally(() => router.replace("/admin"));
      return;
    }
    loginAnalyticsAction(secret)
      .then((result) => {
        if (result.error) {
          sessionStorage.removeItem("analytics_secret");
          router.replace("/admin");
        } else {
          setIsReady(true);
        }
      })
      .catch(() => router.replace("/admin"));
  }, [router]);

  const refresh = useCallback(async () => {
    if (!secretRef.current) return;
    setLoading(true);
    try {
      const stats = await getAnalyticsStats(secretRef.current);
      if (stats) setData(stats as AnalyticsData);
    } catch {
      // transient - keep the last good data
    } finally {
      setLoading(false);
    }
  }, []);

  // Load stats once verified, then poll every 30s
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    getAnalyticsStats(secretRef.current)
      .then((stats) => {
        if (stats && !cancelled) setData(stats as AnalyticsData);
      })
      .catch(() => {});
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isReady, refresh]);

  const handleLogout = async () => {
    await logoutAnalyticsAction().catch(() => {});
    sessionStorage.removeItem("analytics_secret");
    router.replace("/admin");
  };

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink">
        <p className="text-sm text-ink-muted">Verifying access...</p>
      </div>
    );
  }

  const formatPeriod = (
    label: string,
    p: AnalyticsData["periods"]["today"]
  ) => (
    <div className="rounded-xl border border-hairline bg-surface-raised p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-ink-text">{p.newUsers}</p>
          <p className="text-[10px] text-ink-muted">New users</p>
        </div>
        <div>
          <p className="text-lg font-bold text-ink-text">{p.messages}</p>
          <p className="text-[10px] text-ink-muted">Messages</p>
        </div>
        <div>
          <p className="text-lg font-bold text-ink-text">{p.groups}</p>
          <p className="text-[10px] text-ink-muted">Groups</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink text-ink-text">
      {/* Header */}
      <header className="border-b border-hairline px-5 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gossip-deep">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold">Chismisa Analytics</h1>
              <p className="text-xs text-ink-muted">Read-only platform overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => void handleLogout()}
              className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-ink-text transition-colors hover:bg-surface-raised"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-5 py-6">
        {!data ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-ink-muted">Loading analytics...</p>
          </div>
        ) : (
          <>
            <a
              href="/admin"
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-gossip"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </a>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <Users className="mb-2 h-5 w-5 text-gossip" />
                <p className="text-2xl font-bold">{data.userCount}</p>
                <p className="text-xs text-ink-muted">Total users</p>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <UserCheck className="mb-2 h-5 w-5 text-emerald-400" />
                <p className="text-2xl font-bold">{data.onlineNow.length}</p>
                <p className="text-xs text-ink-muted">Online now (1 min)</p>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <Users2 className="mb-2 h-5 w-5 text-tea" />
                <p className="text-2xl font-bold">{data.groupCount}</p>
                <p className="text-xs text-ink-muted">Groups created</p>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <Zap className="mb-2 h-5 w-5 text-gossip" />
                <p className="text-2xl font-bold">{data.totalActivity.toLocaleString()}</p>
                <p className="text-xs text-ink-muted">Total activity</p>
              </div>
            </div>

            {/* Message / DM breakdown */}
            <div className="flex items-center gap-4 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm">
              <MessageSquare className="h-4 w-4 text-gossip" />
              <span className="text-ink-muted">Group messages:</span>
              <span className="font-semibold">{data.messageCount.toLocaleString()}</span>
              <span className="ml-auto text-ink-muted">Direct messages:</span>
              <span className="font-semibold">{data.dmCount.toLocaleString()}</span>
            </div>

            {/* Period breakdowns */}
            <div className="grid gap-3 sm:grid-cols-3">
              {formatPeriod("Today", data.periods.today)}
              {formatPeriod("Last 7 days", data.periods.week)}
              {formatPeriod("Last 30 days", data.periods.month)}
            </div>

            {/* Top groups + Online now */}
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-gossip" />
                  <h2 className="text-sm font-semibold">Top active groups</h2>
                </div>
                {data.topGroups.length === 0 ? (
                  <p className="text-xs text-ink-muted">No groups yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.topGroups.map((g, i) => (
                      <li key={g.id} className="flex items-center gap-3 text-sm">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface text-xs font-bold text-ink-muted">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                        <span className="text-xs text-ink-muted">{g.memberCount} members</span>
                        <span className="rounded-full bg-gossip/15 px-2 py-0.5 text-xs font-semibold text-gossip">
                          {g.messageCount} msgs
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-hairline bg-surface-raised p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold">Online now</h2>
                </div>
                {data.onlineNow.length === 0 ? (
                  <p className="text-xs text-ink-muted">No one is active right now.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {data.onlineNow.map((u) => (
                      <li
                        key={u.id}
                        className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-xs"
                      >
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        {u.username}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Recent signups */}
            <div className="rounded-xl border border-hairline bg-surface-raised p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-gossip" />
                <h2 className="text-sm font-semibold">Recent signups</h2>
              </div>
              {data.recentSignups.length === 0 ? (
                <p className="text-xs text-ink-muted">No users yet.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.recentSignups.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-medium">{u.username}</span>
                      <span className="text-xs text-ink-muted">
                        {new Date(u.createdAt).toLocaleDateString()}{" "}
                        {new Date(u.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
