// app/api/admin/users/[userId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuth } from "@clerk/nextjs/server";

/**
 * Ensure the current request is made by an admin.
 * Throws on unauthenticated / unauthorized.
 */
async function checkAdminOrThrow(req: NextRequest) {
  // read auth from the request
  const auth = getAuth(req);
  const userId = auth.userId ?? null;
  if (!userId) throw new Error("Not authenticated");

  // clerkClient in your environment is an async factory; await it to get the real client
  const client = await clerkClient();
  const me = await client.users.getUser(userId);

  const adminEmailsEnv = process.env.ADMIN_EMAILS ?? "";
  const adminEmails = adminEmailsEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isAdmin =
    (me.publicMetadata &&
      (me.publicMetadata as Record<string, unknown>).role === "admin") ||
    (me.emailAddresses ?? []).some((e) =>
      adminEmails.includes(String(e.emailAddress ?? ""))
    );

  if (!isAdmin) throw new Error("Unauthorized");
}

/**
 * PATCH /api/admin/users/[userId]
 *
 * NOTE: context.params is a Promise<{ userId: string }>
 * (this is the shape Next's generated validators expect).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    // validate admin from request
    await checkAdminOrThrow(request);

    // await params promise to get userId
    const { userId } = await context.params;
    const body = await request.json();
    const { publicMetadata } = body as {
      publicMetadata: Record<string, unknown> | undefined;
    };

    if (!publicMetadata || typeof publicMetadata !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid publicMetadata" },
        { status: 400 }
      );
    }

    // clerkClient again: await to obtain client
    const client = await clerkClient();

    // merge with existing user metadata
    const user = await client.users.getUser(userId);
    const merged = { ...(user.publicMetadata ?? {}), ...publicMetadata };

    await client.users.updateUser(userId, { publicMetadata: merged });

    return NextResponse.json({ ok: true, userId, publicMetadata: merged });
  } catch (err) {
    console.error("PATCH /api/admin/users/[userId] error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "error" },
      { status: 403 }
    );
  }
}
