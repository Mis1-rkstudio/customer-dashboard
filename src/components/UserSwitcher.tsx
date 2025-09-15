// src/components/UserSwitcher.tsx
"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/store/useUserStore";

type InternalUser = {
  row_id?: string | null;
  name?: string | null;
  email?: string | null;
  customers?: string[] | { name: string; email: string }[] | null;
};

type CustomerObj = { name: string; email: string };

/* --- helpers --- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeTrimString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Safely read a stringy property from unknown object */
function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const val = obj[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  return undefined;
}

export default function UserSwitcher(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const currentUserId = useUserStore((s) => s.currentUserId);
  const currentUserEmail = useUserStore((s) => s.currentUserEmail);
  const customersFromStore = useUserStore((s) => s.customers ?? []);
  const setCurrentUser = useUserStore((s) => s.setCurrentUser);
  const setCurrentUserId = useUserStore((s) => s.setCurrentUserId);
  const setCustomers = useUserStore((s) => s.setCustomers);
  const setLoadingCustomers = useUserStore((s) => s.setLoadingCustomers);

  const [users, setUsers] = React.useState<InternalUser[]>([]);
  const [loadingUsers, setLoadingUsers] = React.useState(false);

  // track whether we've already fetched customers at least once for the currently-signed-in user
  const fetchedOnceRef = React.useRef(false);

  React.useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      try {
        const res = await fetch("/api/internal_users");
        if (!res.ok) {
          setUsers([]);
          return;
        }
        const json = await res.json();
        if (json?.ok && Array.isArray(json.data)) {
          setUsers(json.data as InternalUser[]);
        } else {
          setUsers([]);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("fetch internal users", err);
        setUsers([]);
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, []);

  // Build stable items array with unique ids (prefer row_id)
  const items = React.useMemo(() => {
    return users.map((u, idx) => {
      const id = u.row_id ?? `internal_user_fallback_${idx}`;
      const label = u.name ?? u.email ?? "Unnamed";
      return { id, label, email: u.email ?? null };
    });
  }, [users]);

  const visible = React.useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.email ?? "").toLowerCase().includes(q)
    );
  }, [items, query]);

  // Fetch customers only once when a currentUserEmail becomes available (e.g. at login).
  // Do not re-fetch on dropdown selection changes.
  React.useEffect(() => {
    const email = currentUserEmail?.trim() ?? "";
    if (!email) return;

    // If we've already fetched once and store already has customers, do nothing.
    if (
      fetchedOnceRef.current &&
      customersFromStore &&
      customersFromStore.length > 0
    ) {
      return;
    }

    // fetch customers for this email
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const res = await fetch(
          `/api/internal_users?email=${encodeURIComponent(email)}`
        );
        if (!res.ok) {
          if (!cancelled) setCustomers([]);
          return;
        }
        const json = await res.json();
        if (json?.ok && json?.user) {
          // server may return customers as array of strings or array of objects
          const raw = json.user.customers ?? [];
          const normalized: CustomerObj[] = [];

          if (Array.isArray(raw)) {
            for (const entry of raw) {
              if (!entry) continue;

              if (typeof entry === "string") {
                const e = String(entry).trim();
                normalized.push({ name: e, email: e });
                continue;
              }

              if (isRecord(entry)) {
                // prefer email/name fields if present
                const em = getStringProp(entry, "email") ?? getStringProp(entry, "Email") ?? "";
                const nm = getStringProp(entry, "name") ?? getStringProp(entry, "Name") ?? em ?? "";
                normalized.push({
                  name: (nm ?? "").trim(),
                  email: (em ?? "").trim(),
                });
                continue;
              }

              // fallback: coerce to string
              const s = String(entry).trim();
              normalized.push({ name: s, email: s });
            }
          }

          if (!cancelled) {
            // ---------- IMPORTANT: store expects string[]; convert objects to string identifiers ----------
            // prefer email when present, otherwise fallback to name; filter out empties
            const normalizedStrings = normalized
              .map((c) => (c.email && String(c.email).trim() ? String(c.email).trim() : String(c.name ?? "").trim()))
              .filter(Boolean);

            setCustomers(normalizedStrings);
            fetchedOnceRef.current = true;
          }
        } else {
          if (!cancelled) setCustomers([]);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("fetch user customers (initial)", err);
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();

    return () => {
      // mark cancellation to ignore late results
      cancelled = true;
    };
    // We intentionally depend on currentUserEmail only. fetchedOnceRef prevents repeated fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  // onSelect: only update the store (do NOT re-fetch customers)
  const onSelectById = React.useCallback(
    (id: string | null) => {
      const selected = id ? items.find((x) => x.id === id) ?? null : null;
      const email = selected?.email ?? null;

      setCurrentUserId(id ?? null);
      setCurrentUser(email);

      // DO NOT fetch customers here — customers were loaded once at login / initial user load.
      // Keep existing customers in the store unchanged.
    },
    [items, setCurrentUser, setCurrentUserId]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          className="w-[320px] justify-between"
          disabled={loadingUsers}
        >
          {/* display email from store (keeps UI same) */}
          {useUserStore.getState().currentUserEmail ?? "Switch user"}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-0 !z-50 bg-white dark:bg-slate-900/95 backdrop-blur-sm border border-slate-800 dark:border-slate-700 shadow-lg rounded-md">
        <Command>
          <CommandInput
            placeholder="Search user by name or email..."
            className="h-9"
            value={query}
            onValueChange={(v: string) => setQuery(v)}
          />
          <CommandList className="min-h-[120px] max-h-[360px] overflow-auto">
            <CommandEmpty>No user found.</CommandEmpty>
            <CommandGroup>
              {visible.map((it) => (
                <CommandItem
                  key={it.id}
                  value={it.id}
                  onSelect={(val: string) => {
                    onSelectById(val);
                    setOpen(false);
                  }}
                  className="group"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-900 dark:text-slate-100">
                      {it.label}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {it.email}
                    </span>
                  </div>

                  <Check
                    className={cn(
                      "ml-auto",
                      currentUserId === it.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
