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
import { useUser } from "@clerk/nextjs";

type CustomerItem = {
  id: string;
  name: string;
  email?: string;
};

const LOCAL_KEY = "user_switcher_selection";

/* --- helpers --- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const val = obj[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  return undefined;
}

/** Normalize customers stored in publicMetadata into CustomerItem[]. */
function normalizeCustomersFromMeta(raw: unknown): CustomerItem[] {
  const out: CustomerItem[] = [];
  if (!raw) return out;

  if (typeof raw === "string") {
    const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < arr.length; i++) out.push({ id: `customer:${arr[i]}:${i}`, name: arr[i] });
    return out;
  }

  if (Array.isArray(raw)) {
    let index = 0;
    for (const entry of raw) {
      if (!entry) {
        index++;
        continue;
      }
      if (typeof entry === "string") {
        const s = entry.trim();
        const name = s || `Customer ${index + 1}`;
        out.push({ id: `customer:${name}:${index}`, name });
        index++;
        continue;
      }
      if (isRecord(entry)) {
        const name =
          getStringProp(entry, "name") ??
          getStringProp(entry, "Name") ??
          getStringProp(entry, "Company_Name") ??
          getStringProp(entry, "company_name") ??
          getStringProp(entry, "email") ??
          getStringProp(entry, "Email") ??
          `Customer ${index + 1}`;
        const email = getStringProp(entry, "email") ?? getStringProp(entry, "Email") ?? undefined;
        out.push({ id: `customer:${name}:${index}`, name: (name ?? "").trim(), email });
        index++;
        continue;
      }
      const s = String(entry).trim();
      out.push({ id: `customer:${s || index}`, name: s || `Customer ${index + 1}` });
      index++;
    }
    return out;
  }

  try {
    const s = String(raw);
    if (s) {
      const arr = s.split(",").map((t) => t.trim()).filter(Boolean);
      arr.forEach((a, i) => out.push({ id: `customer:${a}:${i}`, name: a }));
    }
  } catch {
    // noop
  }

  return out;
}

export default function UserSwitcher(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  // store selectors
  const currentUserId = useUserStore((s) => s.currentUserId);
  const currentUser = useUserStore((s) => s.currentUser);
  const setCurrentUser = useUserStore((s) => s.setCurrentUser);
  const setCustomers = useUserStore((s) => s.setCustomers);
  const setLoadingCustomers = useUserStore((s) => s.setLoadingCustomers);

  const { isLoaded, isSignedIn, user } = useUser();

  const [customers, setLocalCustomers] = React.useState<CustomerItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Derive logged-in user's primary email safely
  const loggedInEmail = React.useMemo(() => {
    if (!user) return undefined;
    const maybePrimary = (user as unknown) as Record<string, unknown>;
    const primaryEmailObj = maybePrimary.primaryEmailAddress;
    if (isRecord(primaryEmailObj) && typeof primaryEmailObj.emailAddress === "string") {
      return primaryEmailObj.emailAddress.trim();
    }
    const emails = (maybePrimary.emailAddresses as unknown) as unknown[] | undefined;
    if (Array.isArray(emails) && emails.length > 0) {
      const first = emails[0] as Record<string, unknown> | undefined;
      if (first && typeof first.emailAddress === "string") return first.emailAddress.trim();
    }
    if (typeof maybePrimary.email === "string") return maybePrimary.email.trim();
    return undefined;
  }, [user]);

  // Build a stable "me" id for the logged-in user
  const meId = React.useMemo(() => {
    const maybe = (user as unknown) as Record<string, unknown> | undefined;
    const uid = (maybe && typeof maybe.id === "string" && maybe.id) ?? "me";
    return `me:${uid}`;
  }, [user]);

  // populate customers from Clerk user's publicMetadata when popover opens or user changes
  React.useEffect(() => {
    if (!open) return;

    if (!isLoaded) {
      setLoading(true);
      setLoadingCustomers(true);
      return;
    }

    if (!isSignedIn || !user) {
      setLocalCustomers([]);
      setCustomers([]);
      setLoading(false);
      setLoadingCustomers(false);
      return;
    }

    setLoading(true);
    setLoadingCustomers(true);

    try {
      const meta = ((user as unknown) as Record<string, unknown>)?.publicMetadata ?? {};
      const raw = meta.customers ?? meta.assigned_customers ?? meta.assignedCustomers ?? [];
      const normalized = normalizeCustomersFromMeta(raw);
      const namesOnly = normalized.map((c) => c.name).filter(Boolean);
      setLocalCustomers(normalized);
      setCustomers(namesOnly);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to read customers from publicMetadata", err);
      setLocalCustomers([]);
      setCustomers([]);
    } finally {
      setLoading(false);
      setLoadingCustomers(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoaded, isSignedIn, user]);

  // restore selection from localStorage or preselect "You"
  React.useEffect(() => {
    if (!isLoaded) return;

    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_KEY) : null;

      if (stored) {
        if (stored.startsWith("me:")) {
          if (stored === meId && loggedInEmail) {
            // use two-arg API so store has both display and id
            setCurrentUser(loggedInEmail, stored);
            return;
          }
        } else {
          // stored is customer id; set display to stripped name and pass id
          const display = stored.replace(/^customer:/, "").split(":")[0] ?? stored;
          setCurrentUser(display, stored);
          return;
        }
      }

      // No stored selection => preselect "You" if signed in
      if (isSignedIn && loggedInEmail) {
        setCurrentUser(loggedInEmail, meId);
        try {
          window.localStorage.setItem(LOCAL_KEY, meId);
        } catch {
          /* ignore storage failures */
        }
      }
    } catch {
      // ignore localStorage errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, loggedInEmail, meId, setCurrentUser]);

  // filtered/visible customers for the Command list (search by name only)
  const visibleCustomers = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  // selection handler — use setCurrentUser(display, id) everywhere
  const onSelect = React.useCallback(
    (id: string | null) => {
      if (!id) {
        setCurrentUser(null, null);
        if (typeof window !== "undefined") window.localStorage.removeItem(LOCAL_KEY);
        setOpen(false);
        return;
      }

      if (id.startsWith("me:")) {
        const label = loggedInEmail ?? "You";
        setCurrentUser(label, id);
        try {
          if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_KEY, id);
        } catch {
          /* ignore */
        }
        setOpen(false);
        return;
      }

      const selected = customers.find((c) => c.id === id) ?? null;
      const emailOrName = selected ? (selected.email && selected.email.length ? selected.email : selected.name) : null;

      if (emailOrName) {
        setCurrentUser(emailOrName, id);
        try {
          if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_KEY, id);
        } catch {
          /* ignore */
        }
      } else {
        // fallback: set id and null display (store will reflect id)
        setCurrentUser(null, id);
        try {
          if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_KEY, id);
        } catch {
          /* ignore */
        }
      }
      setOpen(false);
    },
    [customers, loggedInEmail, setCurrentUser]
  );

  // button label prefers the strong store value
  const buttonLabel = (currentUser && String(currentUser).trim()) || loggedInEmail || "Switch customer";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          className="w-[320px] justify-between truncate"
          disabled={loading}
          aria-label="Open customer switcher"
          title={buttonLabel}
        >
          <span className="truncate text-sm">{buttonLabel}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-0 !z-50 bg-white dark:bg-slate-900/95 backdrop-blur-sm border border-slate-800 dark:border-slate-700 shadow-lg rounded-md">
        <Command>
          <CommandInput
            placeholder={loading ? "Loading customers..." : "Search customers by name..."}
            className="h-9"
            value={query}
            onValueChange={(v: string) => setQuery(v)}
          />
          <CommandList className="min-h-[120px] max-h-[360px] overflow-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-400">Loading customers…</div>
            ) : (
              <>
                {/* "You" entry */}
                <CommandGroup>
                  <CommandItem
                    key={meId}
                    value={meId}
                    onSelect={(val: string) => onSelect(val)}
                    className="group"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div className="min-w-0">
                        <div className="text-sm text-slate-900 dark:text-slate-100">
                          {loggedInEmail ? `You — ${loggedInEmail}` : "You"}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          View your own orders
                        </div>
                      </div>

                      <Check
                        className={cn(
                          "ml-auto",
                          currentUserId === meId ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </div>
                  </CommandItem>
                </CommandGroup>

                <div className="border-t border-slate-200 dark:border-slate-700 my-2 mx-3" />

                {/* Customer list (or empty state) */}
                {customers.length === 0 ? (
                  <CommandEmpty>No customers found for this user.</CommandEmpty>
                ) : (
                  <CommandGroup>
                    {visibleCustomers.map((it) => (
                      <CommandItem
                        key={it.id}
                        value={it.id}
                        onSelect={(val: string) => onSelect(val)}
                        className="group"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <div className="min-w-0">
                            <div className="text-sm text-slate-900 dark:text-slate-100">
                              {it.name}
                            </div>
                          </div>

                          <Check
                            className={cn(
                              "ml-auto",
                              currentUserId === it.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
