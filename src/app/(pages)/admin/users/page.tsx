// app/admin/users/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AdminUsersPanel from "@/components/AdminUsersPanel";

type SafeUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmail?: string | null;
  publicMetadata?: Record<string, unknown>;
};

type HeaderGetter = {
  get(name: string): string | null;
};

// Cast the imported client component to a component type that accepts the prop we intend to pass.
// This is a local assertion that makes the prop contract explicit to TypeScript.
const AdminUsersPanelClient =
  AdminUsersPanel as unknown as React.ComponentType<{ initialUsers: SafeUser[] }>;

export default async function AdminUsersPage() {
  // Grab incoming request headers (server component)
  const incoming = await headers();

  let cookieHeader = "";
  if (incoming && typeof incoming === "object") {
    const maybeGetter = incoming as unknown as HeaderGetter;
    if (typeof maybeGetter.get === "function") {
      cookieHeader = maybeGetter.get("cookie") ?? "";
    }
  }

  // Build a server-side absolute URL for the internal API endpoint.
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  const url = `${base.replace(/\/$/, "")}/api/admin/users`;

  // Call the protected admin API route on the server.
  // Forward the cookie header so Clerk in the API route can read the session.
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: cookieHeader,
    },
  });

  // If the API route returns 401/403 (unauthenticated/unauthorized), redirect:
  if (res.status === 401 || res.status === 403) {
    redirect("/signin");
  }

  // If call failed for some other reason, redirect or throw.
  if (!res.ok) {
    console.error("Failed to fetch admin users:", res.status, await res.text());
    redirect("/");
  }

  // The API returns { ok: true, users: SafeUser[] }
  const payload = (await res.json()) as { ok?: boolean; users?: SafeUser[] };

  if (!payload.ok || !Array.isArray(payload.users)) {
    redirect("/");
  }

  // Now render the client AdminUsersPanel with the initial users.
  // We used the AdminUsersPanelClient cast to make TypeScript accept the prop.
  return <AdminUsersPanelClient initialUsers={payload.users} />;
}
