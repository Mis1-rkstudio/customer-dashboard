// src/hooks/useSyncUser.tsx
"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useUserStore } from "@/store/useUserStore";

export default function useSyncUser(): void {
  const { isLoaded, isSignedIn, user } = useUser();

  const setUser = useUserStore((s) => s.setUser);
  const setCurrentUser = useUserStore((s) => s.setCurrentUser);
  const setCurrentUserId = useUserStore((s) => s.setCurrentUserId);
  const currentUserEmail = useUserStore((s) => s.currentUserEmail);
  const setCustomers = useUserStore((s) => s.setCustomers);
  const setLoadingCustomers = useUserStore((s) => s.setLoadingCustomers);
  const clearUser = useUserStore((s) => s.clearUser);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // sign out: clear all user state
      clearUser();
      return;
    }

    // Safe email extraction — prefer primaryEmailAddress, then first emailAddresses entry.
    const email: string = (() => {
      // prefer primaryEmailAddress.emailAddress
      if (typeof user?.primaryEmailAddress?.emailAddress === "string" && user.primaryEmailAddress.emailAddress.trim()) {
        return user.primaryEmailAddress.emailAddress.trim();
      }

      // fallback to emailAddresses array if present (UserResource types can vary)
      const maybeEmails = (user as unknown as { emailAddresses?: unknown }).emailAddresses;
      if (Array.isArray(maybeEmails) && (maybeEmails as unknown[]).length > 0) {
        const first = (maybeEmails as Array<{ emailAddress?: unknown }>)[0];
        if (first && typeof first.emailAddress === "string" && first.emailAddress.trim()) {
          return first.emailAddress.trim();
        }
      }

      return "";
    })();

    const name: string | null = (() => {
      if (typeof user?.firstName === "string" && user.firstName.trim()) {
        const last = typeof user?.lastName === "string" && user.lastName.trim() ? ` ${user.lastName.trim()}` : "";
        return `${user.firstName.trim()}${last}`.trim();
      }
      const maybeFull = (user as unknown as { fullName?: unknown }).fullName;
      if (typeof maybeFull === "string" && maybeFull.trim()) return maybeFull.trim();
      return null;
    })();

    // set logged-in user basic info (this will also initialize currentUserEmail if null via store logic)
    setUser({ name: name ?? null, email: email ?? null });

    // initialize currentUserEmail on first login only (conservative: don't overwrite manual switches)
    if (!currentUserEmail && email) {
      setCurrentUser(email);
    }

    // if there's no email, clear customers and return
    if (!email) {
      setCustomers([]);
      setLoadingCustomers(false);
      return;
    }

    // fetch the authoritative internal user row (latest non-deleted) from server
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const res = await fetch(`/api/internal_users?email=${encodeURIComponent(email)}`);
        if (cancelled) return;

        if (!res.ok) {
          setCustomers([]);
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (json?.ok && json?.user) {
          const u = json.user as {
            row_id?: string | null;
            name?: string | null;
            email?: string | null;
            customers?: string[] | null;
          };

          // update store: prefer DB values where present
          setUser({ name: u.name ?? name ?? null, email: u.email ?? email ?? null });

          // set unique id & display email so UI can compare by id
          setCurrentUserId(u.row_id ?? null);
          setCurrentUser(u.email ?? email ?? null);

          setCustomers(Array.isArray(u.customers) ? u.customers : []);
        } else {
          // not found or bad payload -> empty customers
          setCustomers([]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("fetch user by email error", err);
          setCustomers([]);
        }
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, user]);
}
