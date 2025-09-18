// components/AdminUsersPanel.tsx
"use client";

import React, { JSX, useEffect, useState } from "react";

type SafeUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmail?: string | null;
  publicMetadata?: Record<string, unknown>;
};

export type AdminUsersPanelProps = { initialUsers: SafeUser[] };

export default function AdminUsersPanel(): JSX.Element {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [bulkKey, setBulkKey] = useState<string>("role");
  const [bulkValue, setBulkValue] = useState<string>("customer");
  const [busy, setBusy] = useState<boolean>(false);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setUsers(json.users ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function updateUserMetadata(userId: string, newMetadata: Record<string, unknown>) {
    try {
      setBusy(true);
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicMetadata: newMetadata }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      // optimistic reload or patch state
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, publicMetadata: json.publicMetadata } : u)));
    } catch (err) {
      alert("Failed to update user: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSetAll() {
    if (!bulkKey) {
      alert("Enter a key");
      return;
    }
    if (!confirm(`Set publicMetadata["${bulkKey}"] = "${bulkValue}" for all ${users.length} users?`)) return;

    try {
      setBusy(true);
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: bulkKey, value: bulkValue }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      await loadUsers();
      alert(`Updated ${json.updatedCount} users`);
    } catch (err) {
      alert("Bulk update failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-6">Loading users…</div>;
  if (error) return <div className="p-6 text-red-400">Error: {error}</div>;

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Admin: Users</h2>

      <div className="mb-6 flex gap-3 items-center">
        <input
          value={bulkKey}
          onChange={(e) => setBulkKey(e.target.value)}
          placeholder="metadata key (e.g. role)"
          className="border px-2 py-1 rounded"
        />
        <input
          value={bulkValue}
          onChange={(e) => setBulkValue(e.target.value)}
          placeholder="value (string)"
          className="border px-2 py-1 rounded"
        />
        <button onClick={onSetAll} disabled={busy} className="bg-blue-600 text-white px-3 py-1 rounded">
          {busy ? "Working…" : "Set for all users"}
        </button>
        <button onClick={loadUsers} className="bg-gray-700 text-white px-3 py-1 rounded">Reload</button>
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <div key={u.id} className="p-3 border rounded flex items-center justify-between">
            <div>
              <div className="font-medium">
                {u.firstName ?? ""} {u.lastName ?? ""}{" "}
                <span className="text-sm text-slate-400">({u.id})</span>
              </div>
              <div className="text-sm text-slate-500">{u.primaryEmail ?? "—"}</div>
              <div className="text-xs mt-1">
                Metadata: <pre className="inline bg-[#0b1220] px-2 py-1 rounded">{JSON.stringify(u.publicMetadata ?? {}, null, 0)}</pre>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const currentRole = String((u.publicMetadata ?? {})[bulkKey] ?? "");
                  const newVal = currentRole === bulkValue ? "" : bulkValue;
                  updateUserMetadata(u.id, { ...(u.publicMetadata ?? {}), [bulkKey]: newVal });
                }}
                className="bg-green-600 text-white px-3 py-1 rounded"
                disabled={busy}
              >
                Toggle {bulkKey}
              </button>

              <button
                onClick={() => {
                  // quick inline change: prompt admin for a new JSON object for publicMetadata (simple)
                  const input = prompt("Enter JSON object to merge into publicMetadata for this user:", JSON.stringify(u.publicMetadata ?? {}));
                  if (!input) return;
                  try {
                    const parsed = JSON.parse(input);
                    if (typeof parsed !== "object" || Array.isArray(parsed)) {
                      alert("Please enter a JSON object");
                      return;
                    }
                    updateUserMetadata(u.id, { ...(u.publicMetadata ?? {}), ...parsed });
                  } catch (err) {
                    alert("Invalid JSON: " + (err as Error).message);
                  }
                }}
                className="bg-blue-600 text-white px-3 py-1 rounded"
                disabled={busy}
              >
                Edit metadata
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
