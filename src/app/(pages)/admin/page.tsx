// app/(pages)/admin/page.tsx
export const runtime = 'nodejs';

import React from 'react';
import { redirect } from 'next/navigation';
import { checkRole } from '@/lib/roles';
import SearchUsers from './SearchUsers';
import { clerkClient } from '@clerk/nextjs/server';
import { removeRole, setRole } from './_actions';
import AssignCustomersButton from './AssignCustomersButton';

type MinimalEmail = {
  id: string;
  emailAddress: string;
};

type MinimalUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  profileImageUrl?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: MinimalEmail[] | null;
  publicMetadata?: Record<string, unknown> | null;
};

/** small helpers */
function getRoleFromMeta(meta?: Record<string, unknown> | null): string {
  if (!meta) return 'user';
  const r = (meta as { role?: unknown }).role;
  return typeof r === 'string' && r.length > 0 ? r : 'user';
}

function initials(u: MinimalUser): string {
  const a = (u.firstName?.[0] ?? '').toUpperCase();
  const b = (u.lastName?.[0] ?? '').toUpperCase();
  return (a || b) ? `${a}${b}` : 'U';
}

function primaryEmail(u: MinimalUser): string {
  const emails = u.emailAddresses ?? [];
  if (!emails.length) return '—';
  const primary = emails.find((e) => e.id === u.primaryEmailAddressId) ?? emails[0];
  return primary?.emailAddress ?? '—';
}

/** Extract customers saved in publicMetadata. Accepts string[] or comma-separated string. */
function customersFromMeta(meta?: Record<string, unknown> | null): string[] | undefined {
  if (!meta) return undefined;
  const raw = meta.customers;
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

/** Dark-theme badge classes (tailwind) */
const ROLE_BADGE = {
  admin: 'bg-emerald-700 text-emerald-100',
  moderator: 'bg-yellow-400 text-black',
  user: 'bg-gray-700 text-gray-100',
} as const;

export default async function AdminDashboard(params: {
  searchParams: Promise<{ search?: string }>;
}) {
  if (!checkRole('admin')) {
    redirect('/');
  }

  const query = (await params.searchParams).search?.trim();

  const client = await clerkClient();

  let usersRaw: unknown = [];
  try {
    if (typeof query === 'string' && query.length > 0) {
      usersRaw = await client.users.getUserList({ query, limit: 200 });
    } else {
      usersRaw = await client.users.getUserList({ limit: 200 });
    }
  } catch (err) {
    // keep behaviour consistent with your original file
    console.error('Failed to fetch users from clerkClient', err);
    usersRaw = [];
  }

  const usersArray: MinimalUser[] = Array.isArray(usersRaw)
    ? (usersRaw as MinimalUser[])
    : (usersRaw && typeof usersRaw === 'object' && 'data' in usersRaw
        ? (usersRaw as { data?: MinimalUser[] }).data ?? []
        : []);

  return (
    <main className="max-w-7xl mx-auto p-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Admin Dashboard</h1>
          <p className="text-sm text-gray-300 mt-1">
            Protected area — only users with the{' '}
            <code className="rounded bg-gray-800 px-1 text-gray-100">admin</code> role can access.
          </p>
        </div>

        <div className="w-full sm:w-72">
          <SearchUsers />
        </div>
      </header>

      <section>
        <h2 className="text-lg font-medium text-gray-100 mb-4">Users</h2>

        {usersArray.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-700 p-6 text-center bg-gray-900">
            <p className="mb-2 text-gray-200">No users found.</p>
            <p className="text-sm text-gray-400">Try searching or check that Clerk is configured correctly.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {usersArray.map((user) => {
              const role = getRoleFromMeta(user.publicMetadata);
              const badgeClass = ROLE_BADGE[role as keyof typeof ROLE_BADGE] ?? ROLE_BADGE.user;
              const adminEmail = primaryEmail(user);
              const label = `${(user.firstName ?? '').trim()} ${(user.lastName ?? '').trim()}`.trim();
              const customers = customersFromMeta(user.publicMetadata);

              return (
                <li
                  key={user.id}
                  className="flex flex-col justify-between rounded-lg border border-gray-700 p-4 shadow-sm bg-gray-900"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
                      {user.profileImageUrl || user.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(user.profileImageUrl ?? user.imageUrl) as string}
                          alt={`${user.firstName ?? ''} ${user.lastName ?? ''}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-200">{initials(user)}</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate text-gray-100">{user.firstName ?? ''} {user.lastName ?? ''}</div>

                        <div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                            aria-label={`Role: ${role}`}
                          >
                            {role}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1 text-sm text-gray-300 truncate">{adminEmail}</div>

                      {/* show small customers summary when present */}
                      {customers && customers.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-400">Customers:</span>
                          <div className="flex flex-wrap gap-1">
                            {customers.slice(0, 4).map((c) => (
                              <span
                                key={c}
                                className="inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs text-gray-200 bg-gray-800"
                                title={c}
                              >
                                {c.length > 18 ? `${c.slice(0, 15)}…` : c}
                              </span>
                            ))}
                            {customers.length > 4 && (
                              <span className="inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs text-gray-400 bg-gray-800">
                                +{customers.length - 4}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <form action={setRole} className="flex items-center gap-2 w-full" >
                      <input type="hidden" name="id" value={user.id} />
                      <label htmlFor={`role-${user.id}`} className="sr-only">Set role</label>

                      <select
                        id={`role-${user.id}`}
                        name="role"
                        defaultValue={role}
                        className="rounded-md border border-gray-700 bg-gray-800 text-gray-100 px-3 py-1 text-sm w-full"
                      >
                        <option value="user">user</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>

                      <button
                        type="submit"
                        className="ml-2 rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
                      >
                        Update
                      </button>
                    </form>

                    <form action={removeRole}>
                      <input type="hidden" name="id" value={user.id} />
                      <button
                        type="submit"
                        className="ml-2 rounded-md border border-red-500 px-3 py-1 text-sm text-red-400 hover:bg-red-600/20"
                        aria-label={`Remove role for ${user.firstName ?? user.id}`}
                      >
                        Remove
                      </button>
                    </form>

                    {/* Assign customers (open modal to pick existing customers) — admins/moderators only */}
                    {(role === 'admin' || role === 'moderator') && (
                      <AssignCustomersButton
                        adminId={user.id}
                        adminEmail={adminEmail}
                        adminLabel={label || undefined}
                        currentCustomers={customers}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
