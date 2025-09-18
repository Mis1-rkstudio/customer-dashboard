'use client';

import React, { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { assignCustomers } from './_actions';

type RawCustomerRow = Record<string, unknown>;

type CustomerItem = {
  id: string;
  name: string;
  email: string; // may be empty string
};

type Props = {
  adminId?: string;
  adminEmail: string;
  adminLabel?: string;
  /** optional pre-loaded customers from publicMetadata (string[] of identifiers) */
  currentCustomers?: string[] | undefined;
};

/** Normalize the /api/customers payload into CustomerItem[] */
function normalizeCustomersPayload(payload: unknown): CustomerItem[] {
  const out: CustomerItem[] = [];
  let arr: unknown[] | undefined;

  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.rows)) arr = p.rows as unknown[];
    else if (Array.isArray(p.data)) arr = p.data as unknown[];
    else if (Array.isArray(payload)) arr = payload as unknown[];
  } else if (Array.isArray(payload)) {
    arr = payload;
  }

  if (!arr) return out;

  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] as RawCustomerRow;
    const company = (r['Company_Name'] ?? r['company_name'] ?? r['name'] ?? r['Name']) as
      | string
      | undefined;
    const email = (r['email'] ?? r['Email'] ?? r['contact_email'] ?? r['Contact_Email']) as
      | string
      | undefined;
    const id = (r['row_id'] ?? r['id'] ?? `${company ?? ''}-${i}`) as string | undefined;

    const name = (
      (company?.toString().trim() ||
        (email ? (email as string).split('@')[0] : `Customer ${i + 1}`)) ?? `Customer ${i + 1}`
    ).toString();
    const em = (typeof email === 'string' ? email.trim() : '').toString();

    out.push({
      id: String(id ?? `${i}`),
      name,
      email: em,
    });
  }

  return out;
}

/** Utility: dedupe preserving first-seen, case-insensitive on trimmed value */
function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.trim().toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it.trim());
    }
  }
  return out;
}

/** Try to create a Set of identifiers to pre-select customer items.
 * currentCustomers may contain emails or names; we match against item.email and item.name.
 */
function initialSelectedSetFromCurrent(
  items: CustomerItem[],
  currentCustomers?: string[] | undefined
): { selected: Set<string>; extras: string[] } {
  const selected = new Set<string>();
  const extras: string[] = [];
  if (!currentCustomers || currentCustomers.length === 0) return { selected, extras };

  const look = new Set(currentCustomers.map((s) => s.trim().toLowerCase()).filter(Boolean));

  // mark items that match
  for (const it of items) {
    if (it.email && look.has(it.email.trim().toLowerCase())) selected.add(it.id);
    else if (look.has(it.name.trim().toLowerCase())) selected.add(it.id);
  }

  // any currentCustomers not matched above become extras
  for (const cur of currentCustomers) {
    const key = cur.trim();
    if (!key) continue;
    // find if any item matched this key
    const matched = items.some(
      (it) =>
        (it.email && it.email.trim().toLowerCase() === key.toLowerCase()) ||
        it.name.trim().toLowerCase() === key.toLowerCase()
    );
    if (!matched) extras.push(key);
  }

  return { selected, extras };
}

export default function AssignCustomersButton({
  adminId,
  adminEmail,
  adminLabel,
  currentCustomers,
}: Props): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<string[]>([]); // identifiers present in metadata but not in catalog
  const [extrasSelected, setExtrasSelected] = useState<Set<string>>(new Set()); // control for extras checkboxes
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  // form + hidden input refs for server action submission
  const formRef = useRef<HTMLFormElement | null>(null);
  const customersInputRef = useRef<HTMLInputElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  // fetch customer list when modal opens
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoadingCustomers(true);

    (async () => {
      try {
        const res = await fetch('/api/customers', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) {
          console.error('Failed to fetch /api/customers', await res.text());
          if (!mounted) return;
          setCustomers([]);
          setSelected(new Set());
          setExtras([]);
          setExtrasSelected(new Set());
          return;
        }
        const payload = await res.json();
        if (!mounted) return;
        const normalized = normalizeCustomersPayload(payload);
        setCustomers(normalized);

        // pre-select based on currentCustomers prop (if provided)
        const { selected: preSelected, extras: preExtras } = initialSelectedSetFromCurrent(
          normalized,
          currentCustomers
        );
        if (mounted) {
          setSelected(preSelected);
          setExtras(preExtras);
          setExtrasSelected(new Set(preExtras.map((s) => s.toLowerCase()))); // default extras selected
        }
      } catch (err) {
        console.error('Error fetching customers', err);
        if (mounted) {
          setCustomers([]);
          setSelected(new Set());
          setExtras([]);
          setExtrasSelected(new Set());
        }
      } finally {
        if (mounted) setLoadingCustomers(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open, currentCustomers]);

  // recompute filtered list
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [customers, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExtra(identifier: string) {
    setExtrasSelected((prev) => {
      const next = new Set(prev);
      const key = identifier.trim().toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setExtrasSelected(new Set());
  }

  async function submitSelected(): Promise<void> {
    if (!adminEmail && !adminId) {
      window.alert('Missing target admin identifier (email or id).');
      return;
    }

    // Build selected identifiers from catalog items (prefer email, fallback name)
    const selectedRows = customers.filter((c) => selected.has(c.id));
    const selectedFromCatalog = selectedRows
      .map((c) => (c.email && c.email.length ? c.email : c.name))
      .map((s) => String(s).trim())
      .filter(Boolean);

    // Build selected identifiers from extras (use the original string)
    const selectedExtrasArray: string[] = extras
      .filter((ex) => extrasSelected.has(ex.trim().toLowerCase()))
      .map((s) => String(s).trim())
      .filter(Boolean);

    // Final list = selectedFromCatalog + selectedExtrasArray (deduped, preserving order)
    const finalList = dedupePreserveOrder([...selectedFromCatalog, ...selectedExtrasArray]);

    // Confirm action (mention removal if some previously-assigned extras/items are now unselected)
    const previouslyAssignedCount = Array.isArray(currentCustomers) ? currentCustomers.length : 0;
    const removedCount = Math.max(0, previouslyAssignedCount - finalList.length);
    const confirmMessage =
      removedCount > 0
        ? `You are about to assign ${finalList.length} customer(s) and remove ${removedCount} previously assigned customer(s) from ${adminLabel ?? adminEmail}. Proceed?`
        : `You are about to assign ${finalList.length} customer(s) to ${adminLabel ?? adminEmail}. Proceed?`;

    if (!window.confirm(confirmMessage)) return;

    // Put finalList in hidden input and submit the form to server action
    if (!formRef.current || !customersInputRef.current) {
      window.alert('Internal error: form not ready.');
      return;
    }

    try {
      setSaving(true);

      if (idInputRef.current) idInputRef.current.value = adminId ?? '';
      if (emailInputRef.current) emailInputRef.current.value = adminEmail ?? '';

      // server action normalizes comma-separated string into array
      customersInputRef.current.value = finalList.join(',');

      // submit the hidden form to server action
      formRef.current.requestSubmit();

      // close modal and refresh admin page to pick up changes
      setOpen(false);
      setSelected(new Set());
      setExtras([]);
      setExtrasSelected(new Set());
      router.refresh();

      window.alert('Assign request submitted. The admin page will refresh shortly.');
    } catch (err) {
      console.error('Failed to submit assignCustomers form', err);
      window.alert(`Failed to submit assignment: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium border border-gray-600 text-gray-100 hover:bg-gray-800/40"
        aria-label={`Assign customers to ${adminLabel ?? adminEmail}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xs">Assign</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-[min(720px,96%)] max-h-[80vh] overflow-hidden rounded-lg bg-gray-900 border border-gray-700 shadow-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
              <div>
                <div className="text-sm font-semibold text-gray-100">Assign customers</div>
                <div className="text-xs text-gray-300">to {adminLabel ?? adminEmail}</div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter customers..."
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1 text-sm text-gray-200 hover:bg-gray-800/40"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4">
              {loadingCustomers ? (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Loading customers...
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-sm text-gray-400">No customers found.</div>
              ) : (
                <div className="max-h-[40vh] overflow-auto">
                  <ul className="space-y-2">
                    {filtered.map((c) => {
                      const checked = selected.has(c.id);
                      return (
                        <li
                          key={c.id}
                          className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-gray-800/40"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(c.id)}
                              className="h-4 w-4 accent-indigo-500"
                            />
                            <div className="min-w-0">
                              <div className="text-sm text-gray-100 truncate">{c.name}</div>
                              {c.email ? (
                                <div className="text-xs text-gray-400 truncate">{c.email}</div>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-xs text-gray-400">{c.email ? c.email.split('@')[1] : ''}</div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Extras: show assigned identifiers not present in /api/customers */}
              {extras.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-gray-400 mb-2">Other assigned customers</div>
                  <div className="space-y-2">
                    {extras.map((ex) => {
                      const key = ex.trim().toLowerCase();
                      const checked = extrasSelected.has(key);
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-gray-800/40"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExtra(ex)}
                              className="h-4 w-4 accent-indigo-500"
                            />
                            <div className="min-w-0">
                              <div className="text-sm text-gray-100 truncate">{ex}</div>
                              <div className="text-xs text-gray-400 truncate">not in catalog</div>
                            </div>
                          </div>
                          <div />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3 bg-gray-950">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md px-3 py-1 text-sm text-gray-200 hover:bg-gray-800/40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1 text-sm text-gray-200 hover:bg-gray-800/40"
              >
                Cancel
              </button>

              {/* Hidden form submitted to server action */}
              <form ref={formRef} action={assignCustomers} method="post" className="hidden" aria-hidden>
                {/* prefer id if available */}
                <input ref={idInputRef} name="id" type="hidden" defaultValue={adminId ?? ''} />
                <input ref={emailInputRef} name="email" type="hidden" defaultValue={adminEmail ?? ''} />
                {/* comma-separated customers string */}
                <input ref={customersInputRef} name="customers" type="hidden" defaultValue="" />
              </form>

              <button
                type="button"
                onClick={submitSelected}
                disabled={saving}
                className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {saving ? 'Saving…' : `Save (${selected.size + Array.from(extrasSelected).length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
