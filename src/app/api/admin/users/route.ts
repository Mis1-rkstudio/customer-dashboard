// app/api/admin/users/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuth, clerkClient as clerkClientImport } from '@clerk/nextjs/server';

type MinimalEmail = {
  id: string;
  emailAddress: string;
};

export type MinimalUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  profileImageUrl?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: MinimalEmail[] | null;
  publicMetadata?: Record<string, unknown> | null;
};

type ClerkUserLike = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  profileImageUrl?: string | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id: string; emailAddress: string }>;
  publicMetadata?: Record<string, unknown>;
  [k: string]: unknown;
};

type ClerkGetUserListResult = ClerkUserLike[] | { data: ClerkUserLike[] };

/** Try to support both clerkClient() (factory) and clerkClient (object) exports */
async function getClerkClient() {
  // clerkClientImport might be a function in some setups or an object in others.
  if (typeof clerkClientImport === 'function') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - some clerk versions export an async factory
    return await clerkClientImport();
  }
  return clerkClientImport;
}

function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeClerkUsers(raw: unknown): MinimalUser[] {
  if (Array.isArray(raw)) {
    return raw.map((u) => mapOne(u));
  }
  if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data?: unknown }).data)) {
    return normalizeClerkUsers((raw as { data: unknown }).data);
  }
  return [];
}

function mapOne(u: unknown): MinimalUser {
  const user = u as ClerkUserLike;
  const emailAddresses =
    Array.isArray(user.emailAddresses) && user.emailAddresses.length > 0
      ? user.emailAddresses.map((e) => ({ id: String(e.id), emailAddress: String(e.emailAddress) }))
      : null;

  return {
    id: String(user.id),
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    profileImageUrl: (user.profileImageUrl ?? user.imageUrl ?? null) as string | null,
    primaryEmailAddressId: user.primaryEmailAddressId ?? null,
    emailAddresses,
    publicMetadata: user.publicMetadata ?? null,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // auth: ensure caller is signed-in
    const auth = getAuth(req);
    const callerUserId = auth.userId ?? null;
    if (!callerUserId) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    // fetch caller to check role
    const client = await getClerkClient();

    if (!client || !('users' in client) || typeof client.users.getUser !== 'function') {
      console.error('clerkClient.users.getUser is not available in this runtime.');
      return NextResponse.json({ ok: false, error: 'server misconfigured' }, { status: 500 });
    }

    const meRaw = await client.users.getUser(callerUserId);
    const me = meRaw as unknown as ClerkUserLike;
    const role = (me.publicMetadata?.role && typeof me.publicMetadata.role === 'string') ? String(me.publicMetadata.role) : undefined;
    const primaryEmail =
      (Array.isArray(me.emailAddresses) && me.emailAddresses.length > 0
        ? me.emailAddresses.find((e) => e.id === me.primaryEmailAddressId)?.emailAddress ?? me.emailAddresses[0].emailAddress
        : null) ?? '';

    const adminEmails = parseAdminEmails();
    const isAdmin = role === 'admin' || (primaryEmail && adminEmails.includes(primaryEmail.toLowerCase()));

    if (!isAdmin) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    // parse search param
    const url = new URL(req.url);
    const search = String(url.searchParams.get('search') ?? '').trim();

    // ensure getUserList is available
    if (!client.users || typeof client.users.getUserList !== 'function') {
      console.error('clerkClient.users.getUserList is not available in this runtime.');
      return NextResponse.json({ ok: false, error: 'server misconfigured' }, { status: 500 });
    }

    const result = (await client.users.getUserList({ query: search || undefined, limit: 100 })) as unknown as ClerkGetUserListResult;
    const users = normalizeClerkUsers(result);

    return NextResponse.json({ ok: true, users }, { status: 200 });
  } catch (err) {
    console.error('/admin/users GET error', err);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
