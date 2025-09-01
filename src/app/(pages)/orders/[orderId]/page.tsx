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

function formatDate(input: unknown): string {
  if (!input) return '—';
  if (typeof input === 'object' && input !== null) {
    const rec = input as Record<string, unknown>;
    // Firestore Timestamp-like { seconds }
    if (typeof rec.seconds === 'number') {
      try {
        return new Date(rec.seconds * 1000).toLocaleString();
      } catch {
        /* fall through */
      }
    }
  }
  try {
    const d = new Date(String(input));
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(input);
  } catch {
    return String(input);
  }
}

function safe(field: unknown, fallback = '—'): string {
  if (field === null || field === undefined || field === '') return fallback;
  return String(field);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
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

/**
 * Normalize a saved order document into a consistent shape used by the UI.
 * Handles grouped items [{ itemName, colors: [{ color, sets }] }] and flat rows.
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

  const o = order as Record<string, unknown>;

  const customerObj = (o.customer as Record<string, unknown>) ?? {};
  const agentObj = (o.agent as Record<string, unknown>) ?? {};

  const customerName = toSafeString(
    o.customerName ?? customerObj.name ?? customerObj.label ?? customerObj.Company_Name ?? ''
  );
  const customerEmail = toSafeString(o.customerEmail ?? customerObj.email ?? customerObj.Email ?? '');
  const customerPhone = toSafeString(
    o.customerPhone ?? customerObj.phone ?? customerObj.phoneNumber ?? customerObj.Number ?? ''
  );

  const agentName = toSafeString(o.agentName ?? agentObj.name ?? agentObj.label ?? '');
  const agentEmail = toSafeString(o.agentEmail ?? agentObj.email ?? agentObj.Email ?? '');
  const agentPhone = toSafeString(o.agentPhone ?? agentObj.number ?? agentObj.phone ?? agentObj.Contact_Number ?? '');

  const itemsRawCandidate = o.items ?? o.rows ?? [];
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
        if (!Array.isArray(it.colors)) continue;
        for (const cUn of it.colors as unknown[]) {
          if (cUn === null || cUn === undefined) continue;
          if (typeof cUn === 'object') {
            const c = cUn as Record<string, unknown>;
            const color = toSafeString(c.color ?? c.colorName ?? c.value ?? '');
            const sets = Number(c.sets ?? c.set ?? c.qty ?? c.quantity ?? 0) || 0;
            expanded.push({ itemName, color, quantity: sets });
          } else {
            const color = toSafeString(cUn);
            expanded.push({ itemName, color, quantity: 0 });
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
            (it.item as Record<string, unknown>)?.label ??
            (it.item as Record<string, unknown>)?.Item ??
            it.skuLabel ??
            it.label ??
            it.sku ??
            it.name ??
            (it.item as Record<string, unknown>)?.value ??
            ''
        );
        const color = toSafeString(
          (it.color as Record<string, unknown>)?.label ?? it.color ?? it.colorName ?? it.colorValue ?? ''
        );
        const qty = Number(it.quantity ?? it.qty ?? it.sets ?? it.set ?? 0) || 0;
        mapped.push({ itemName, color, quantity: qty });
      }
      items = mapped;
    }
  }

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    items,
    createdAt: o.createdAt ?? o.created_at ?? null,
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
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const text = await res.text().catch(() => '');
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (parseErr) {
          console.warn('Order details: response not JSON', { status: res.status, text, parseErr });
        }

        if (!res.ok) {
          const maybeObj = (typeof data === 'object' && data !== null) ? (data as Record<string, unknown>) : null;
          const msg = (maybeObj && typeof maybeObj.message === 'string') ? maybeObj.message : text || `HTTP ${res.status}`;
          console.error('Failed to fetch order:', res.status, msg);
          if (!canceled) setOrderRaw(null);
          return;
        }

        let payloadOrder: unknown = null;
        if (data && typeof data === 'object') {
          const dobj = data as Record<string, unknown>;
          if (dobj.ok === true && dobj.order) payloadOrder = dobj.order;
          else if (dobj.ok === false) {
            console.error('Server returned ok:false for order fetch', dobj);
            if (!canceled) setOrderRaw(null);
            return;
          } else payloadOrder = data;
        } else {
          console.warn('Order details: response had no JSON body', { text });
          if (!canceled) setOrderRaw(null);
          return;
        }

        if (!canceled) setOrderRaw(payloadOrder as RawOrder);
      } catch (err) {
        console.error('Error fetching order:', err);
        if (!canceled) setOrderRaw(null);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }

    fetchOrderDetails();
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
  const customerName = safe(
    normalized.customer.name ?? getFirst(normalized.customer, 'label', 'value'),
    '—'
  );
  const customerEmail = safe(
    normalized.customer.email ?? getFirst(normalized.customer, 'Email'),
    '—'
  );
  const customerPhoneRaw = (normalized.customer.phone ?? getFirst(normalized.customer, 'phoneNumber', 'Number')) ?? '';
  const customerPhone = safe(customerPhoneRaw, '—');

  const agentName = safe(normalized.agent.name ?? getFirst(normalized.agent, 'label', 'value'), '—');
  const agentEmail = safe(normalized.agent.email ?? getFirst(normalized.agent, 'Email'), '—');
  const agentPhone = safe(getFirst(normalized.agent, 'number', 'phone', 'Contact_Number') ?? normalized.agent.number ?? '', '—');

  const placedAt = formatDate(normalized.createdAt);

  // Build OrderShape to pass to the share component (use imported OrderShape)
  const orderForShare: OrderShape = {
    id: orderId,
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    agent: { name: agentName, number: agentPhone, email: agentEmail },
    items: aggregatedItems.map((it) => ({ itemName: it.itemName, color: it.color, quantity: it.quantity })),
    // normalize createdAt to a type accepted by OrderShape (no `any` used)
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
