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

/* runtime guards for timestamp-like shapes */
function isSecondsObject(v: unknown): v is { seconds: number } {
  return isObject(v) && typeof (v as { seconds?: unknown }).seconds === 'number';
}
function hasToDate(v: unknown): v is { toDate: () => Date } {
  return isObject(v) && typeof (v as { toDate?: unknown }).toDate === 'function';
}

/** Format many timestamp-like shapes to a human string */
function formatDate(input: unknown): string {
  if (!input) return '—';

  // Firestore seconds object
  if (isSecondsObject(input)) {
    try {
      return new Date(input.seconds * 1000).toLocaleString();
    } catch {
      // fall through
    }
  }

  // Firestore Timestamp-like with toDate()
  if (hasToDate(input)) {
    try {
      const d = input.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toLocaleString();
    } catch {
      // fall through
    }
  }

  // wrapper object with { value: 'ISO...' }
  if (isObject(input) && 'value' in input && typeof (input as Record<string, unknown>).value === 'string') {
    try {
      const d = new Date(String((input as Record<string, unknown>).value));
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

/* --- Helpers to extract createdAt from common nested shapes --- */
function extractCreatedAtFromOrder(orderRec: Record<string, unknown>): unknown {
  const v = orderRec['createdAt'] ?? orderRec['created_at'] ?? orderRec['placedAt'] ?? orderRec['Placed'] ?? orderRec['createdDate'] ?? null;
  if (!v) return null;

  // nested { value: 'ISO...' }
  if (isObject(v) && 'value' in v && typeof (v as Record<string, unknown>).value === 'string') {
    return (v as Record<string, unknown>).value;
  }

  // Firestore seconds object { seconds: number }
  if (isSecondsObject(v)) return v;

  // Firestore Timestamp-like with toDate()
  if (hasToDate(v)) {
    try {
      return v.toDate();
    } catch {
      /* ignore */
    }
  }

  // fallback to primitive or string
  return v;
}

/** Normalize an arbitrary order shape into a predictable object */
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

  // Support wrapper records { id, payload, ... } where payload may be string or object
  if ('payload' in order) {
    const rec = order as Record<string, unknown>;
    const p = rec.payload;
    if (typeof p === 'string' && p.trim()) {
      try {
        const parsed = JSON.parse(p);
        if (isObject(parsed)) order = parsed;
      } catch {
        // ignore parse error and continue with wrapper
      }
    } else if (isObject(p)) {
      order = p;
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

        const itemLevelSets = safeNumber(itemObj['sets'] ?? itemObj['set'] ?? 0);
        const colors = Array.isArray(itemObj['colors']) ? (itemObj['colors'] as unknown[]) : [];

        for (const c of colors) {
          if (isObject(c)) {
            const cObj = c as Record<string, unknown>;
            const color = safeString(cObj['color'] ?? cObj['colorName'] ?? cObj['value'] ?? cObj['label'] ?? '');
            const sets = safeNumber(cObj['sets'] ?? cObj['set'] ?? cObj['qty'] ?? cObj['quantity'] ?? itemLevelSets);
            itemsFlat.push({ itemName, color, quantity: sets });
          } else {
            const color = safeString(c);
            const sets = itemLevelSets;
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

        // possible shapes returned by /api/orders: array, { rows: [] }, { orders: [] }, single order or { order: {...} }
        let rows: unknown[] = [];
        if (Array.isArray(data)) rows = data;
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).rows)) rows = (data as Record<string, unknown>).rows as unknown[];
        else if (isObject(data) && Array.isArray((data as Record<string, unknown>).orders)) rows = (data as Record<string, unknown>).orders as unknown[];
        else if (isObject(data) && (data as Record<string, unknown>).order) rows = [(data as Record<string, unknown>).order as unknown];
        else if (isObject(data)) rows = [data];
        else rows = [];

        // find candidate row by id or payload.id/orderId/order_id
        const match = rows.find((r) => {
          if (!isObject(r)) return false;
          const rec = r as Record<string, unknown>;

          const candidateIds = [
            safeString(rec['id']),
            safeString(rec['orderId']),
            safeString(rec['order_id']),
            safeString(rec['ID']),
          ].filter(Boolean);

          if (candidateIds.some((cid) => cid === orderId)) return true;

          if ('payload' in rec) {
            const p = rec['payload'];
            if (typeof p === 'string') {
              try {
                const parsed = JSON.parse(p);
                if (isObject(parsed)) {
                  const pid = safeString(parsed['id'] ?? parsed['orderId'] ?? parsed['order_id'] ?? parsed['ID'] ?? parsed['OrderID']);
                  if (pid === orderId) return true;
                }
              } catch { /* ignore */ }
            } else if (isObject(p)) {
              const pid = safeString((p as Record<string, unknown>)['id'] ?? (p as Record<string, unknown>)['orderId'] ?? (p as Record<string, unknown>)['order_id']);
              if (pid === orderId) return true;
            }
          }

          const nestedId = safeString(rec['payload'] ?? rec['order'] ?? rec['orderPayload'] ?? '');
          if (nestedId === orderId) return true;

          return false;
        });

        if (!match) {
          console.warn('Order not found in /api/orders response for id', orderId);
          if (!canceled) setOrderRaw(null);
          return;
        }

        // prefer parsed payload if present
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
              // ignore
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
    if (isSecondsObject(v)) return { seconds: Number(v.seconds) };
    if (hasToDate(v)) {
      try {
        const d = v.toDate();
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
