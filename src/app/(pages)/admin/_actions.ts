// app/(pages)/admin/_actions.ts
'use server';

import { clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';

type MinimalEmail = {
  id: string;
  emailAddress: string;
};

type MinimalUserForActions = {
  id: string;
  publicMetadata?: Record<string, unknown> | null;
  emailAddresses?: MinimalEmail[] | null;
  primaryEmailAddressId?: string | null;
};

function normalizeCustomersInput(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((v, i, arr) => arr.indexOf(v) === i); // unique
}

/**
 * Set role on a Clerk user. Expected formData keys: id, role
 * Returns void so it can be used as a <form action={setRole}> server action.
 */
export async function setRole(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();

  if (!id || !role) return;

  try {
    // Await the factory to get the actual client object (keeps your existing pattern)
    const client = await clerkClient();

    // Get current user so we can merge existing publicMetadata safely
    const user = (await client.users.getUser(id)) as MinimalUserForActions;
    const existingMeta = (user.publicMetadata ?? {}) as Record<string, unknown>;

    await client.users.updateUser(id, {
      publicMetadata: { ...existingMeta, role },
    });

    // optional: revalidate admin page so the server-rendered list refreshes
    try {
      revalidatePath('/admin');
    } catch {
      /* ignore if running on older Next versions */
    }
  } catch (err) {
    // Log server-side, don't return structured payload (must return void)
    console.error('setRole failed', err);
  }
}

/**
 * Remove role from a Clerk user. Expected formData keys: id
 */
export async function removeRole(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;

  try {
    const client = await clerkClient();

    const user = (await client.users.getUser(id)) as MinimalUserForActions;
    const existingMeta = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const newMeta = { ...existingMeta };
    delete newMeta.role;

    await client.users.updateUser(id, {
      publicMetadata: newMeta,
    });

    try {
      revalidatePath('/admin');
    } catch {
      /* ignore if not available */
    }
  } catch (err) {
    console.error('removeRole failed', err);
  }
}

/**
 * Assign customers to a Clerk user by saving them into publicMetadata.customers
 *
 * Expected formData keys (either provide id OR email to identify the user):
 *  - id (optional) : Clerk user id
 *  - email (optional) : primary email address (used to query Clerk if id not provided)
 *  - customers : comma-separated list of customer identifiers
 *
 * Behavior:
 *  - If `customers` resolves to an empty array, the `customers` key is removed from publicMetadata.
 *  - Otherwise publicMetadata.customers is set to the string[] of unique, trimmed values.
 */
export async function assignCustomers(formData: FormData): Promise<void> {
  const idFromForm = String(formData.get('id') ?? '').trim();
  const emailFromForm = String(formData.get('email') ?? '').trim();
  const customersRaw = String(formData.get('customers') ?? '').trim();

  // nothing to do
  if (!idFromForm && !emailFromForm) return;

  try {
    const client = await clerkClient();

    let user: MinimalUserForActions | null = null;

    if (idFromForm) {
      try {
        user = (await client.users.getUser(idFromForm)) as MinimalUserForActions;
      } catch {
        user = null;
      }
    }

    // If we don't have user yet and an email was provided, try to find by email
    if (!user && emailFromForm) {
      const rawList = await client.users.getUserList({ query: emailFromForm, limit: 20 });
      const usersArray: MinimalUserForActions[] = Array.isArray(rawList)
        ? (rawList as MinimalUserForActions[])
        : (rawList && typeof rawList === 'object' && 'data' in rawList
            ? ((rawList as { data?: MinimalUserForActions[] }).data ?? [])
            : []);

      // prefer exact email match if possible
      user =
        usersArray.find((u) =>
          (u.emailAddresses ?? []).some((e) => e.emailAddress === emailFromForm)
        ) ?? usersArray[0] ?? null;
    }

    if (!user) {
      // no user found — nothing to update
      return;
    }

    const customers = normalizeCustomersInput(customersRaw);

    const existingMeta = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const newMeta = { ...existingMeta };

    if (customers.length === 0) {
      // remove the key if empty
      delete newMeta.customers;
    } else {
      // store as string array
      newMeta.customers = customers;
    }

    await client.users.updateUser(user.id, {
      publicMetadata: newMeta,
    });

    try {
      revalidatePath('/admin');
    } catch {
      /* ignore if revalidation API not available */
    }
  } catch (err) {
    console.error('assignCustomers failed', err);
  }
}
