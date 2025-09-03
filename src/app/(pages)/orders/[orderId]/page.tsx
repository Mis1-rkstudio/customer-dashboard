'use client';

import React, { JSX, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';

type RowItem = { itemName: string; color: string; quantity: number };

function onlyDigits(s = ''): string {
  return String(s || '').replace(/\D/g, '');
}

function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s === 'undefined') return true;
  return false;
}

function toSafeString(v: unknown): string {
  if (isMissing(v)) return '';
  return String(v).trim();
}

function safe(field: unknown, fallback = '—'): string {
  if (field === null || field === undefined || field === '') return fallback;
  return String(field);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** type-guards for avoiding `any` */
function hasToDate(v: unknown): v is { toDate: () => Date } {
  return typeof v === 'object' && v !== null && typeof (v as { toDate?: unknown }).toDate === 'function';
}
function hasValueString(v: unknown): v is { value: string } {
  return typeof v === 'object' && v !== null && typeof (v as { value?: unknown }).value === 'string';
}
function isSecondsObject(v: unknown): v is { seconds: number } {
  return typeof v === 'object' && v !== null && typeof (v as { seconds?: unknown }).seconds === 'number';
}

/** Format a variety of timestamp shapes into a readable string */
function formatDate(input: unknown): string {
  if (!input) return '—';
  if (isSecondsObject(input)) {
    try { return new Date(input.seconds * 1000).toLocaleString(); } catch { /* fall through */ }
  }
  if (hasToDate(input)) {
    try {
      const d = input.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toLocaleString();
    } catch { /* fall through */ }
  }
  if (hasValueString(input)) {
    try {
      const d = new Date(input.value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    } catch { /* ignore */ }
  }
  try {
    const d = new Date(String(input));
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(input);
  } catch {
    return String(input);
  }
}

/** return first existing key value from object (or undefined) */
function getFirst(obj: unknown, ...keys: string[]): unknown {
  if (!isObject(obj)) return undefined;
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

type RawOrder = Record<string, unknown> | null;

type NormalizedOrder = {
  customer: { name: string; email: string; phone: string };
  agent: { name: string; email: string; number: string };
  items: RowItem[];
  createdAt: unknown | null;
  source: string;
  raw?: unknown;
};

/** Extract createdAt from common nested shapes */
function extractCreatedAtFromOrder(o: Record<string, unknown>): unknown {
  const v = o['createdAt'] ?? o['created_at'] ?? o['placedAt'] ?? o['Placed'] ?? o['createdDate'] ?? null;
  if (!v) return null;
  if (hasValueString(v)) return v.value;
  if (isSecondsObject(v)) return v;
  if (hasToDate(v)) {
    try { return v.toDate(); } catch { /* ignore */ }
  }
  return v;
}

/**
 * Normalize a saved order document into a consistent shape used by the UI.
 * Handles grouped items [{ itemName, colors: [{ color, sets }] }] (or colors: ["GREY", ...] with item-level sets)
 * and flat rows.
 */
function normalizeOrder(order: RawOrder): NormalizedOrder {
  if (!order || typeof order !== 'object') {
    return {
      customer: { name: '', email: '', phone: '' },
      agent: { name: '', email: '', number: '' },
      items: [],
      createdAt: null,
      source: 'web',
      raw: order,
    };
  }

  let o = order as Record<string, unknown>;

  // If wrapper with payload (string or object), prefer payload
  if ('payload' in o) {
    const p = o.payload;
    if (typeof p === 'string' && p.trim()) {
      try {
        const parsed = JSON.parse(p);
        if (isObject(parsed)) o = parsed;
      } catch {
        // ignore parse error
      }
    } else if (isObject(p)) {
      o = p as Record<string, unknown>;
    }
  }

  const customerObj = (o.customer as Record<string, unknown>) ?? {};
  const agentObj = (o.agent as Record<string, unknown>) ?? {};

  const customerName = toSafeString(o.customerName ?? customerObj.name ?? customerObj.label ?? customerObj.Company_Name ?? '');
  const customerEmail = toSafeString(o.customerEmail ?? customerObj.email ?? customerObj.Email ?? '');
  const customerPhone = toSafeString(o.customerPhone ?? customerObj.phone ?? customerObj.phoneNumber ?? customerObj.Number ?? '');

  const agentName = toSafeString(o.agentName ?? agentObj.name ?? agentObj.label ?? '');
  const agentEmail = toSafeString(o.agentEmail ?? agentObj.email ?? agentObj.Email ?? '');
  const agentPhone = toSafeString(o.agentPhone ?? agentObj.number ?? agentObj.phone ?? agentObj.Contact_Number ?? '');

  const itemsRawCandidate = o.items ?? o.rows ?? o.itemsFlat ?? [];
  const itemsRaw = Array.isArray(itemsRawCandidate) ? (itemsRawCandidate as unknown[]) : [];

  let items: RowItem[] = [];

  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const first = itemsRaw[0];

    // grouped shape: first.colors is an array
    if (first && typeof first === 'object' && Array.isArray((first as Record<string, unknown>).colors)) {
      const expanded: RowItem[] = [];
      for (const itUn of itemsRaw) {
        if (!itUn || typeof itUn !== 'object') continue;
        const it = itUn as Record<string, unknown>;
        const itemName = toSafeString(it.itemName ?? it.Item ?? it.label ?? it.value ?? it.sku ?? it.name ?? '');
        const colors = Array.isArray(it.colors) ? (it.colors as unknown[]) : [];
        // item-level sets (applies when colors are primitive strings)
        const itemLevelSets = Number(it.sets ?? it.set ?? 0) || 0;

        for (const cUn of colors) {
          if (cUn === null || cUn === undefined) continue;
          if (typeof cUn === 'object') {
            const c = cUn as Record<string, unknown>;
            const color = toSafeString(c.color ?? c.colorName ?? c.value ?? c.label ?? '');
            const sets = Number(c.sets ?? c.set ?? c.qty ?? c.quantity ?? itemLevelSets) || 0;
            expanded.push({ itemName, color, quantity: sets });
          } else {
            // primitive color string — assign item-level sets (if provided)
            const color = toSafeString(cUn);
            const sets = itemLevelSets;
            expanded.push({ itemName, color, quantity: sets });
          }
        }
      }
      items = expanded;
    } else {
      // flat rows: map to RowItem
      const mapped: RowItem[] = [];
      for (const itUn of itemsRaw) {
        if (!itUn || typeof itUn !== 'object') continue;
        const it = itUn as Record<string, unknown>;
        const itemName = toSafeString(
          it.itemName ??
          (isObject(it.item) ? ((it.item as Record<string, unknown>).label ?? (it.item as Record<string, unknown>).Item ?? (it.item as Record<string, unknown>).value) : '') ??
          it.skuLabel ??
          it.label ??
          it.sku ??
          it.name ??
          ''
        );
        const color = toSafeString(
          (isObject(it.color) ? ((it.color as Record<string, unknown>).label ?? (it.color as Record<string, unknown>).value) : it.color) ??
          it.colorName ??
          it.colorValue ??
          ''
        );
        const qty = Number(it.quantity ?? it.qty ?? it.sets ?? it.set ?? 0) || 0;
        mapped.push({ itemName, color, quantity: qty });
      }
      items = mapped;
    }
  }

  const createdAt = extractCreatedAtFromOrder(o);

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    items,
    createdAt,
    source: (o.source as string) ?? 'web',
    raw: order,
  };
}

function aggregateItems(items: RowItem[]): RowItem[] {
  const map = new Map<string, RowItem>();
  for (const it of items) {
    const key = `${it.itemName}||${it.color}`;
    const existing = map.get(key);
    if (existing) existing.quantity = existing.quantity + Number(it.quantity || 0);
    else map.set(key, { ...it, quantity: Number(it.quantity || 0) });
  }
  return Array.from(map.values());
}

export default function OrderDetailsPage(): JSX.Element {
  const [orderRaw, setOrderRaw] = useState<RawOrder>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string>('');

  // narrow useParams typing so we don't use `any`
  const params = useParams() as Partial<Record<string, string | undefined>>;
  const orderId = params?.orderId;

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      setOrderRaw(null);
      return;
    }

    let canceled = false;

    async function fetchOrderDetails(): Promise<void> {
      setIsLoading(true);
      setFetchError('');
      try {
        // server returns a list — fetch the list and find matching row by id or payload.id
        const res = await fetch('/api/orders');
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          const txt = (isObject(data) && (data as Record<string, unknown>).message) ? (data as Record<string, unknown>).message : `HTTP ${res.status}`;
          throw new Error(String(txt));
        }

        // normalize list shapes
        let rows: unknown[] = [];
        if (Array.isArray(data)) rows = data;
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).rows)) rows = (data as Record<string, unknown>).rows as unknown[];
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).orders)) rows = (data as Record<string, unknown>).orders as unknown[];
        else rows = [];

        // find the matching record by id or payload.id/orderId/order_id
        const match = rows.find((r) => {
          if (!isObject(r)) return false;
          const rec = r as Record<string, unknown>;

          // check top-level ids
          const topIds = [
            toSafeString(rec['id']),
            toSafeString(rec['orderId']),
            toSafeString(rec['order_id']),
            toSafeString(rec['ID']),
          ].filter(Boolean);
          if (topIds.some((tid) => tid === orderId)) return true;

          // inspect payload (string or object)
          if ('payload' in rec) {
            const p = rec.payload;
            if (typeof p === 'string' && p.trim()) {
              try {
                const parsed = JSON.parse(p);
                if (isObject(parsed)) {
                  const pid = toSafeString((parsed as Record<string, unknown>)['id'] ?? (parsed as Record<string, unknown>)['orderId'] ?? (parsed as Record<string, unknown>)['order_id']);
                  if (pid === orderId) return true;
                }
              } catch { /* ignore */ }
            } else if (isObject(p)) {
              const pid = toSafeString((p as Record<string, unknown>)['id'] ?? (p as Record<string, unknown>)['orderId'] ?? (p as Record<string, unknown>)['order_id']);
              if (pid === orderId) return true;
            }
          }

          // other nested fields to check
          const nestedId = toSafeString(rec['orderId'] ?? rec['payload'] ?? rec['order'] ?? '');
          if (nestedId === orderId) return true;

          return false;
        });

        if (!match) {
          // not found
          if (!canceled) {
            setOrderRaw(null);
            setFetchError('Order not found in server response.');
          }
          return;
        }

        // prefer parsed payload if present
        if (isObject(match)) {
          const rec = match as Record<string, unknown>;
          if (typeof rec.payload === 'string' && rec.payload.trim()) {
            try {
              const parsed = JSON.parse(rec.payload);
              if (isObject(parsed)) {
                if (!canceled) setOrderRaw(parsed as RawOrder);
                return;
              }
            } catch { /* ignore */ }
          } else if (isObject(rec.payload)) {
            if (!canceled) setOrderRaw(rec.payload as RawOrder);
            return;
          }
        }

        if (!canceled) setOrderRaw(match as RawOrder);
      } catch (err) {
        console.error('Error fetching order:', err);
        if (!canceled) {
          setOrderRaw(null);
          setFetchError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }

    void fetchOrderDetails();
    return () => {
      canceled = true;
    };
  }, [orderId]);

  if (isLoading) {
    return (
      <div className="w-full max-w-4xl mx-auto text-center py-20">
        <svg className="animate-spin mx-auto h-8 w-8 text-gray-300" viewBox="0 0 24 24" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="mt-3 text-gray-400">Loading order details…</p>
      </div>
    );
  }

  if (!orderRaw) {
    return (
      <div className="w-full max-w-4xl mx-auto text-center py-20">
        <p className="text-gray-300">Order not found or there was an error fetching it.</p>
        {fetchError ? <p className="text-red-400 mt-2">{fetchError}</p> : null}
        <div className="mt-4">
          <Link href="/orders" className="text-blue-400 hover:underline">← Back to Orders</Link>
        </div>
      </div>
    );
  }

  const normalized = normalizeOrder(orderRaw);
  const aggregatedItems = aggregateItems(normalized.items);
  const totalQty = aggregatedItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  // use safe helpers instead of `any` casts
  const customerName = safe(normalized.customer.name ?? getFirst(normalized.customer, 'label', 'value'), '—');
  const customerEmail = safe(normalized.customer.email ?? getFirst(normalized.customer, 'Email'), '—');
  const customerPhoneRaw = (normalized.customer.phone ?? getFirst(normalized.customer, 'phoneNumber', 'Number')) ?? '';
  const customerPhone = safe(customerPhoneRaw, '—');

  const agentName = safe(normalized.agent.name ?? getFirst(normalized.agent, 'label', 'value'), '—');
  const agentEmail = safe(normalized.agent.email ?? getFirst(normalized.agent, 'Email'), '—');
  const agentPhone = safe(getFirst(normalized.agent, 'number', 'phone', 'Contact_Number') ?? normalized.agent.number ?? '', '—');

  const placedAt = formatDate(normalized.createdAt);

  // Build OrderShape to pass to the share component (use imported OrderShape)
  const orderForShare: OrderShape = {
    id: orderId ?? '',
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    agent: { name: agentName, number: agentPhone, email: agentEmail },
    items: aggregatedItems.map((it) => ({ itemName: it.itemName, color: it.color, quantity: it.quantity })),
    createdAt: normalized.createdAt as OrderShape['createdAt'],
    source: normalized.source,
  };

  const sharePhone = onlyDigits(String(customerPhoneRaw || ''));

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-white">Order Details</h1>
          <p className="text-sm text-gray-400 mt-1">
            Order ID: <span className="text-gray-300 font-medium">{orderId}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/orders" className="px-3 py-2 bg-transparent border border-gray-700 text-gray-300 rounded hover:bg-gray-800">← Back</Link>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-700 relative">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Customer</h2>
                  <p className="text-sm text-gray-300 mt-1">{customerName || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-400">Placed</p>
                  <p className="text-sm text-gray-300 font-medium">{placedAt}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Email</p>
                  <p className="text-sm text-gray-200">{customerEmail}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Phone</p>
                  <p className="text-sm text-gray-200">{customerPhone}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Total Qty</p>
                  <p className="text-sm text-gray-200">{totalQty}</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Agent</h2>
                  <p className="text-sm text-gray-300 mt-1">{agentName || '—'}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Email</p>
                <p className="text-sm text-gray-200">{agentEmail}</p>
                <p className="text-xs text-gray-400 uppercase mt-3">Phone</p>
                <p className="text-sm text-gray-200">{agentPhone}</p>
              </div>

              <div className="absolute top-0 right-0 mt-2 mr-2">
                <ShareOrderIcon order={orderForShare} phone={sharePhone} />
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Order Items</h3>

          {aggregatedItems.length === 0 ? (
            <p className="text-gray-400">No items in this order.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-gray-300">
                <thead className="text-xs text-gray-400 uppercase bg-gray-900/30">
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Color</th>
                    <th className="px-4 py-3 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregatedItems.map((it, i) => (
                    <tr key={i} className={`${i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'} border-b border-gray-700`}>
                      <td className="px-4 py-4 align-middle text-gray-100">{it.itemName || '—'}</td>
                      <td className="px-4 py-4 text-gray-200">{it.color || '—'}</td>
                      <td className="px-4 py-4 text-right text-gray-200 font-medium">{it.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 bg-gray-900/20 flex items-center justify-between text-sm text-gray-400">
          <div className="text-sm text-gray-400">
            Order source: <span className="text-gray-300 font-medium">{normalized.source ?? 'web'}</span>
          </div>
          <div className="text-sm text-gray-400">
            Order ID: <span className="text-gray-300 font-mono">{orderId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
