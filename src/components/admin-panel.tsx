"use client";

import { useState } from "react";
import {
  Shield,
  Users,
  MessageSquare,
  Hash,
  Trash2,
  KeyRound,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { getAdminStats, deleteGroupAction } from "@/lib/actions/admin";

type AdminStats = {
  userCount: number;
  groupCount: number;
  messageCount: number;
  groups: {
    id: string;
    name: string;
    code: string;
    ownerUsername: string;
    memberCount: number;
    messageCount: number;
    createdAt: string;
  }[];
};

export function AdminPanel() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await getAdminStats(secret);
      if (!data) {
        setError("Invalid admin secret key.");
      } else {
        setAuthenticated(true);
        setStats(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshStats = async () => {
    setLoading(true);
    try {
      const data = await getAdminStats(secret);
      if (data) setStats(data);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group and all its messages?")) return;
    setDeleting(groupId);
    try {
      await deleteGroupAction(secret, groupId);
      await refreshStats();
    } finally {
      setDeleting(null);
    }
  };

  if (!authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-purple-600 shadow-lg shadow-red-900/50">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Admin Access</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Enter the master secret key to access the Chismisa admin panel.
            </p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div>
              <label
                htmlFor="admin-secret"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                Secret Key
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  id="admin-secret"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                  placeholder="Enter master secret key"
                  className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/20 sm:py-2.5"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-red-600 to-purple-600 py-3.5 text-sm font-semibold text-white transition-colors hover:from-red-500 hover:to-purple-500 disabled:opacity-60 sm:py-3"
            >
              {loading ? "Verifying..." : "Access Admin Panel"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="flex w-full items-center justify-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Chismisa
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-purple-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Chismisa Admin</h1>
            <p className="text-xs text-zinc-500">Secret monitoring panel</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshStats}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>
      </div>

      {stats && (
        <>
          {/* Stats cards */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-2xl border border-zinc-800 bg-[#120a1f] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20">
                  <Users className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">
                    {stats.userCount}
                  </p>
                  <p className="text-xs text-zinc-500">Total Users</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-[#120a1f] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-fuchsia-600/20">
                  <Hash className="h-5 w-5 text-fuchsia-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">
                    {stats.groupCount}
                  </p>
                  <p className="text-xs text-zinc-500">Created Groups</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-[#120a1f] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20">
                  <MessageSquare className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">
                    {stats.messageCount}
                  </p>
                  <p className="text-xs text-zinc-500">Total Messages</p>
                </div>
              </div>
            </div>
          </div>

          {/* Groups table */}
          <div className="flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-[#120a1f]">
            <div className="border-b border-zinc-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-zinc-200">
                All Groups & Invite Codes
              </h2>
            </div>
            {stats.groups.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No groups created yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-5 py-3 font-medium">Group</th>
                      <th className="px-5 py-3 font-medium">Invite Code</th>
                      <th className="px-5 py-3 font-medium">Owner</th>
                      <th className="px-5 py-3 font-medium">Members</th>
                      <th className="px-5 py-3 font-medium">Messages</th>
                      <th className="px-5 py-3 font-medium">Created</th>
                      <th className="px-5 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.groups.map((group) => (
                      <tr
                        key={group.id}
                        className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30"
                      >
                        <td className="px-5 py-3 font-medium text-zinc-200">
                          {group.name}
                        </td>
                        <td className="px-5 py-3">
                          <code className="rounded bg-purple-600/10 px-2 py-1 font-mono text-xs text-purple-300">
                            {group.code}
                          </code>
                        </td>
                        <td className="px-5 py-3 text-zinc-400">
                          {group.ownerUsername}
                        </td>
                        <td className="px-5 py-3 text-zinc-400">
                          {group.memberCount}
                        </td>
                        <td className="px-5 py-3 text-zinc-400">
                          {group.messageCount}
                        </td>
                        <td className="px-5 py-3 text-xs text-zinc-500">
                          {new Date(group.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => handleDeleteGroup(group.id)}
                            disabled={deleting === group.id}
                            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                            title="Delete group"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}