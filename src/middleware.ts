// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Route matchers
 */
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);            // pages under /admin
const isAdminApi = createRouteMatcher(["/api/admin(.*)"]);         // admin-only API prefix (adjust as needed)

/**
 * API paths that should NOT be treated as admin-only (they are still protected: must be signed in)
 * Add any other API endpoints you want normal signed-in users to access here.
 */
const API_EXCEPTIONS = ["/api/item", "/api/internal_users"];

export default clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Resolve session once when needed
  const session = await auth(); // returns null-like if no session
  const role = session?.sessionClaims?.metadata?.role ?? "";
  const isAdmin = String(role).toLowerCase() === "admin";

  // 1) Protect admin pages (server-side redirect non-admins)
  if (isAdminRoute(req)) {
    if (!isAdmin) {
      // redirect non-admins to home
      return NextResponse.redirect(new URL("/", req.url));
    }
    // admin allowed
    return;
  }

  // 2) API handling:
  // - All API routes require signed-in user (auth.protect)
  // - Admin-only API prefixes are further restricted to admin role, except those in API_EXCEPTIONS.
  if (pathname.startsWith("/api")) {
    // If this API path is explicitly allowed for normal users, just require signed-in.
    const isException = API_EXCEPTIONS.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );

    if (isException) {
      // allow signed-in users (not admin-only)
      await auth.protect(); // ensure user is signed in
      return;
    }

    // If this is an admin-only API prefix -> verify admin
    if (isAdminApi(req)) {
      // require sign-in first (auth.protect will redirect to sign-in if not signed)
      await auth.protect();
      if (!isAdmin) {
        // signed-in but not admin -> 403 JSON
        return NextResponse.json({ error: "Forbidden - admin only" }, { status: 403 });
      }
      return; // admin allowed
    }

    // Default for other APIs: require signed-in (normal users can call these)
    await auth.protect();
    return;
  }

  // 3) All other page routes: do not restrict by role.
  //    If you want to require sign-in for some pages, add additional matchers here.
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
