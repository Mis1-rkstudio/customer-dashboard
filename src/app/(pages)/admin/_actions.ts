// app/(pages)/admin/_actions.ts
'use server';

import { clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';

/**
 * Set role on a Clerk user. Expected formData keys: id, role
 * Returns void so it can be used as a <form action={setRole}> server action.
 */
export async function setRole(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();

  if (!id || !role) return;

  try {
    // Await the factory to get the actual client object
    const client = await clerkClient();

    // Get current user so we can merge existing publicMetadata safely
    const user = await client.users.getUser(id);
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

    const user = await client.users.getUser(id);
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
