'use client';

import React, { JSX, useEffect, useState } from 'react';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';

/* --- Helpers & runtime type-guards (no `any`) --- */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function formatDate(input: unknown): string {
  if (!input) return '—';
  // Firestore Timestamp-like (object with seconds)
  if (isObject(input) && typeof (input as Record<string, unknown>).seconds === 'number') {
    try {
      const rec = input as { seconds: number };
      return new Date(rec.seconds * 1000).toLocaleString();
    } catch {
      // fall through
    }
  }
  // Firestore Timestamp-like with toDate()
  if (isObject(input) && 'toDate' in (input as Record<string, unknown>) && typeof (input as any).toDate === 'function') {
    try {
      const d = (input as any).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toLocaleString();
    } catch {
      // fall through
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

function isSecondsObject(v: unknown): v is { seconds: number } {
  return typeof v === 'object' && v !== null && 'seconds' in v && typeof (v as Record<string, unknown>)['seconds'] === 'number';
}

function hasToDate(v: unknown): v is { toDate: () => Date } {
  return typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as Record<string, unknown>)['toDate'] === 'function';
}

/* --- Types used in component --- */
type FlatItem = { itemName: string; color: string; quantity: number };

type NormalizedOrder = {
  customer: { name: string; email: string; phone: string };
  agent: { name: string; email: string; number: string };
  itemsFlat: FlatItem[];
  createdAt: unknown | null;
  source: string;
  raw?: unknown;
};

/** Normalize an arbitrary order shape into a predictable object */
/* --- Add this helper near the other helpers at top --- */
function extractCreatedAtFromOrder(orderRec: Record<string, unknown>): unknown {
  // Common shapes: ISO string, { value: '2025-..' }, Firestore { seconds: ... }, timestamp object with toDate()
  const v = orderRec['createdAt'] ?? orderRec['created_at'] ?? orderRec['placedAt'] ?? orderRec['Placed'] ?? orderRec['createdDate'] ?? null;
  if (!v) return null;

  if (isObject(v)) {
    // nested value string e.g. { value: "2025-09-03T10:11:32.500Z" }
    if ('value' in v && typeof (v as any).value === 'string') return (v as any).value;
    // Firestore seconds object
    if ('seconds' in v && typeof (v as any).seconds === 'number') return v;
    // timestamp-like with toDate()
    if ('toDate' in v && typeof (v as any).toDate === 'function') {
      try { return (v as any).toDate(); } catch { /* fall through */ }
    }
  }

  return v;
}

/** Normalize an arbitrary order shape into a predictable object (REPLACEMENT) */
function normalizeOrder(order: unknown): NormalizedOrder {
  if (!isObject(order)) {
    return {
      customer: { name: '', email: '', phone: '' },
      agent: { name: '', email: '', number: '' },
      itemsFlat: [],
      createdAt: null,
      source: 'web',
      raw: order,
    };
  }

  // If a wrapper record like { id, payload, ... } and payload is present prefer the payload
  if ('payload' in order) {
    const rec = order as Record<string, unknown>;
    if (typeof rec.payload === 'string' && rec.payload.trim()) {
      try {
        const parsed = JSON.parse(rec.payload);
        if (isObject(parsed)) order = parsed;
      } catch {
        // ignore - we'll fall back to wrapper
      }
    } else if (isObject(rec.payload)) {
      order = rec.payload as Record<string, unknown>;
    }
  }

  const ord = order as Record<string, unknown>;
  const customerField = isObject(ord['customer']) ? (ord['customer'] as Record<string, unknown>) : undefined;
  const agentField = isObject(ord['agent']) ? (ord['agent'] as Record<string, unknown>) : undefined;

  const customerName = safeString(
    ord['customerName'] ?? customerField?.name ?? customerField?.label ?? customerField?.Company_Name ?? ''
  );
  const customerEmail = safeString(ord['customerEmail'] ?? customerField?.email ?? '');
  const customerPhone = safeString(
    ord['customerPhone'] ?? customerField?.phone ?? customerField?.phoneNumber ?? customerField?.Number ?? ''
  );

  const agentName = safeString(ord['agentName'] ?? agentField?.name ?? agentField?.label ?? '');
  const agentEmail = safeString(ord['agentEmail'] ?? agentField?.email ?? '');
  const agentPhone = safeString(
    ord['agentPhone'] ?? agentField?.number ?? agentField?.phone ?? agentField?.Contact_Number ?? ''
  );

  // Accept items, rows or itemsFlat
  const itemsRaw = Array.isArray(ord['items'])
    ? (ord['items'] as unknown[])
    : Array.isArray(ord['rows'])
      ? (ord['rows'] as unknown[])
      : Array.isArray(ord['itemsFlat'])
        ? (ord['itemsFlat'] as unknown[])
        : [];

  const itemsFlat: FlatItem[] = [];

  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const first = itemsRaw[0];

    // Grouped form: item has colors[] (colors may be objects or primitive strings)
    if (isObject(first) && Array.isArray((first as Record<string, unknown>)['colors'])) {
      for (const it of itemsRaw) {
        if (!isObject(it)) continue;
        const itemObj = it as Record<string, unknown>;

        const itemName = safeString(
          itemObj['itemName'] ??
          itemObj['Item'] ??
          itemObj['label'] ??
          itemObj['value'] ??
          itemObj['sku'] ??
          itemObj['name'] ??
          ''
        );

        // top-level sets on the item (applies to each color if colors are primitives)
        const itemLevelSets = safeNumber(itemObj['sets'] ?? itemObj['set'] ?? 0);

        const colors = Array.isArray(itemObj['colors']) ? (itemObj['colors'] as unknown[]) : [];

        for (const c of colors) {
          if (isObject(c)) {
            const cObj = c as Record<string, unknown>;
            const color = safeString(cObj['color'] ?? cObj['colorName'] ?? cObj['value'] ?? cObj['label'] ?? '');
            const sets = safeNumber(cObj['sets'] ?? cObj['set'] ?? cObj['qty'] ?? cObj['quantity'] ?? itemLevelSets);
            itemsFlat.push({ itemName, color, quantity: sets });
          } else {
            // primitive color string; use item-level sets if present
            const color = safeString(c);
            const sets = itemLevelSets; // if 0, will be 0
            itemsFlat.push({ itemName, color, quantity: sets });
          }
        }
      }
    } else {
      // Flat rows: each row has itemName, color, quantity keys
      for (const it of itemsRaw) {
        if (!isObject(it)) continue;
        const itObj = it as Record<string, unknown>;

        const itemName = safeString(
          itObj['itemName'] ??
          (isObject(itObj['item']) ? (itObj['item'] as Record<string, unknown>)['label'] ?? (itObj['item'] as Record<string, unknown>)['Item'] ?? (itObj['item'] as Record<string, unknown>)['value'] : '') ??
          itObj['skuLabel'] ??
          itObj['label'] ??
          itObj['Item'] ??
          itObj['sku'] ??
          itObj['name'] ??
          ''
        );

        const colorPrimitive = isObject(itObj['color']) && safeString((itObj['color'] as Record<string, unknown>)['label'])
          ? (itObj['color'] as Record<string, unknown>)['label']
          : itObj['color'];

        const color =
          safeString(colorPrimitive) ||
          safeString(itObj['colorName']) ||
          safeString(itObj['colorValue']) ||
          '';

        const qty = safeNumber(itObj['quantity'] ?? itObj['qty'] ?? itObj['sets'] ?? itObj['set'] ?? 0);
        itemsFlat.push({ itemName, color, quantity: qty });
      }
    }
  }

  const createdAt = extractCreatedAtFromOrder(ord);

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    itemsFlat,
    createdAt,
    source: safeString(ord['source'] ?? 'web'),
    raw: order,
  };
}


function aggregateItems(items: FlatItem[]): FlatItem[] {
  const map = new Map<string, FlatItem>();
  for (const it of items) {
    const key = `${it.itemName}||${it.color}`;
    const existing = map.get(key);
    if (existing) existing.quantity += Number(it.quantity || 0);
    else map.set(key, { ...it, quantity: Number(it.quantity || 0) });
  }
  return Array.from(map.values());
}

/* --- Component --- */
export default function OrderDetails({ orderId }: { orderId: string }): JSX.Element {
  const [orderRaw, setOrderRaw] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      setOrderRaw(null);
      return;
    }
    let canceled = false;

    async function fetchOrder(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await fetch('/api/orders');
        // parse JSON safely
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          console.error('Failed to fetch orders list:', { status: res.status, data });
          if (!canceled) {
            setOrderRaw(null);
          }
          return;
        }

        // possible shapes:
        // - an array of rows
        // - { rows: [...] }
        // - { orders: [...] }
        // - single order object (rare)
        let rows: unknown[] = [];
        if (Array.isArray(data)) rows = data;
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).rows)) rows = (data as Record<string, unknown>).rows as unknown[];
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).orders)) rows = (data as Record<string, unknown>).orders as unknown[];
        else if (isObject(data) && (data as Record<string, unknown>).order) {
          // single order returned as { order: {...} }
          rows = [(data as Record<string, unknown>).order as unknown];
        } else if (isObject(data)) {
          // Possibly the API returned a single order object directly (or wrapped with ok:true)
          rows = [data];
        } else {
          rows = [];
        }

        // find candidate row by id or payload.id or payload.orderId etc.
        const match = rows.find((r) => {
          if (!isObject(r)) return false;
          const rec = r as Record<string, unknown>;

          // direct top-level id matches
          const candidateIds = [
            safeString(rec['id']),
            safeString(rec['orderId']),
            safeString(rec['order_id']),
            safeString(rec['ID']),
          ].filter(Boolean);

          if (candidateIds.some((cid) => cid === orderId)) return true;

          // check if payload exists (string or object)
          if ('payload' in rec) {
            const p = rec['payload'];
            if (typeof p === 'string') {
              try {
                const parsed = JSON.parse(p);
                if (isObject(parsed)) {
                  const pid = safeString(parsed['id'] ?? parsed['orderId'] ?? parsed['order_id'] ?? parsed['ID'] ?? parsed['OrderID']);
                  if (pid === orderId) return true;
                }
              } catch {
                // ignore
              }
            } else if (isObject(p)) {
              const pid = safeString((p as Record<string, unknown>)['id'] ?? (p as Record<string, unknown>)['orderId'] ?? (p as Record<string, unknown>)['order_id']);
              if (pid === orderId) return true;
            }
          }

          // last resort: check nested payload-like fields
          const nestedId = safeString(rec['payload'] ?? rec['order'] ?? rec['orderPayload'] ?? '');
          if (nestedId === orderId) return true;

          return false;
        });

        if (!match) {
          console.warn('Order not found in /api/orders response for id', orderId);
          if (!canceled) setOrderRaw(null);
          return;
        }

        // If matched record includes payload string, prefer parsed payload object for display
        if (isObject(match)) {
          const rec = match as Record<string, unknown>;
          if (typeof rec.payload === 'string' && rec.payload.trim()) {
            try {
              const parsed = JSON.parse(rec.payload);
              if (isObject(parsed)) {
                if (!canceled) setOrderRaw(parsed);
                return;
              }
            } catch {
              // ignore parse error
            }
          } else if (isObject(rec.payload)) {
            if (!canceled) setOrderRaw(rec.payload);
            return;
          }
        }

        if (!canceled) setOrderRaw(match);
      } catch (err) {
        console.error('Error fetching order:', err);
        if (!canceled) setOrderRaw(null);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }

    void fetchOrder();
    return () => {
      canceled = true;
    };
  }, [orderId]);

  if (isLoading) return <div className="text-center p-8">Loading order details...</div>;
  if (!orderRaw) return <div className="text-center p-8">Order not found.</div>;

  const normalized = normalizeOrder(orderRaw);
  const itemsAgg = aggregateItems(normalized.itemsFlat);
  const totalQty = itemsAgg.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const placedAt = formatDate(normalized.createdAt);

  const customerName = normalized.customer.name || '—';
  const customerEmail = normalized.customer.email || '—';
  const customerPhone = normalized.customer.phone || '—';

  const agentName = normalized.agent.name || '—';
  const agentEmail = normalized.agent.email || '—';
  const agentPhone = normalized.agent.number || '—';

  const createdAtForShare: OrderShape['createdAt'] = (() => {
    const v = normalized.createdAt;
    if (v === null || v === undefined) return undefined;

    if (typeof v === 'string' || typeof v === 'number') return v;
    if (v instanceof Date) return v;
    if (isSecondsObject(v)) return { seconds: Number((v as { seconds: number }).seconds) };
    if (hasToDate(v)) {
      try {
        const d = (v as { toDate: () => Date }).toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
      } catch { /* ignore */ }
    }
    try {
      const parsed = new Date(String(v));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* ignore */ }
    return undefined;
  })();

  const orderForShare: OrderShape = {
    id: orderId,
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    agent: { name: agentName, number: agentPhone, email: agentEmail },
    items: itemsAgg.map((it) => ({ itemName: it.itemName, color: it.color, quantity: it.quantity })),
    createdAt: createdAtForShare,
    source: normalized.source,
  };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Order Details</h2>
          <p className="text-sm text-gray-400">
            Order ID: <span className="font-mono text-gray-300">{orderId}</span>
          </p>
        </div>

        <div>
          <ShareOrderIcon order={orderForShare} phone={String(normalized.customer.phone ?? '')} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold text-lg mb-2">Customer Information</h3>
          <p><strong>Name:</strong> {customerName}</p>
          <p><strong>Email:</strong> {customerEmail}</p>
          <p><strong>Phone:</strong> {customerPhone}</p>
        </div>

        <div>
          <h3 className="font-semibold text-lg mb-2">Agent Information</h3>
          <p><strong>Name:</strong> {agentName}</p>
          <p><strong>Number:</strong> {agentPhone}</p>
          <p><strong>Email:</strong> {agentEmail}</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-lg mb-4">
          Order Items <span className="text-sm text-gray-400">({totalQty} sets)</span>
        </h3>

        <div className="overflow-x-auto relative shadow-md sm:rounded-lg">
          <table className="w-full text-sm text-left text-gray-400">
            <thead className="text-xs text-gray-300 uppercase bg-gray-700">
              <tr>
                <th className="py-3 px-6">Item Name</th>
                <th className="py-3 px-6">Color</th>
                <th className="py-3 px-6">Quantity (in sets)</th>
              </tr>
            </thead>
            <tbody>
              {itemsAgg.map((item) => (
                <tr key={`${item.itemName}::${item.color}`} className="border-b border-gray-700 hover:bg-gray-600">
                  <td className="py-4 px-6">{item.itemName || '—'}</td>
                  <td className="py-4 px-6">{item.color || '—'}</td>
                  <td className="py-4 px-6">{item.quantity}</td>
                </tr>
              ))}
              {itemsAgg.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-sm text-gray-400">
                    No items on this order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-right mt-4 text-sm text-gray-500">
        <p>Order Placed: {placedAt}</p>
      </div>
    </div>
  );
}
