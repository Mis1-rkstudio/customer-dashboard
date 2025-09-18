// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, NextRequest } from "next/server";

/**
 * Route matchers
 */
const isAdminRoute = createRouteMatcher(["/admin(.*)"]); // pages under /admin
const isAdminApi = createRouteMatcher(["/api/admin(.*)"]); // admin-only API prefix

/**
 * Public API paths (no auth required)
 */
const PUBLIC_API: string[] = ["/api/items"];

/**
 * API paths that require a signed-in user (but are NOT admin-only)
 */
const SIGNED_IN_ONLY_API: string[] = ["/api/internal_users"];

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Resolve session once when needed
  const session = await auth(); // Clerk provides a typed helper; no explicit `any` here
  const role = session?.sessionClaims?.metadata?.role ?? "";
  const isAdmin = String(role).toLowerCase() === "admin";

  // 1) Protect admin pages (server-side redirect non-admins)
  if (isAdminRoute(req)) {
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    // admin allowed
    return;
  }

  // 2) API handling
  if (pathname.startsWith("/api")) {
    // 2a) Public APIs: allow everybody (no auth)
    const isPublic = PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (isPublic) {
      return; // no auth required
    }

    // 2b) Signed-in-only APIs: require user to be signed in
    const isSignedInOnly = SIGNED_IN_ONLY_API.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );
    if (isSignedInOnly) {
      await auth.protect();
      return;
    }

    // 2c) Admin-only API prefixes
    if (isAdminApi(req)) {
      await auth.protect();
      if (!isAdmin) {
        return NextResponse.json({ error: "Forbidden - admin only" }, { status: 403 });
      }
      return; // admin allowed
    }

    // 2d) Default for other APIs: require signed-in user
    await auth.protect();
    return;
  }

  // 3) All other page routes: do not restrict by role.
  return;
});

/**
 * Run middleware for pages (excluding static/_next) and for API routes
 */
export const config = {
  matcher: [
    // Skip next internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
