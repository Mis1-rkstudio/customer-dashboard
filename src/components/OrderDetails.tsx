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

  const customerField = isObject(order['customer']) ? (order['customer'] as Record<string, unknown>) : undefined;
  const agentField = isObject(order['agent']) ? (order['agent'] as Record<string, unknown>) : undefined;

  const customerName = safeString(
    order['customerName'] ??
    customerField?.name ??
    customerField?.label ??
    customerField?.Company_Name ??
    ''
  );
  const customerEmail = safeString(order['customerEmail'] ?? customerField?.email ?? '');
  const customerPhone = safeString(
    order['customerPhone'] ??
    customerField?.phone ??
    customerField?.phoneNumber ??
    customerField?.Number ??
    ''
  );

  const agentName = safeString(order['agentName'] ?? agentField?.name ?? agentField?.label ?? '');
  const agentEmail = safeString(order['agentEmail'] ?? agentField?.email ?? '');
  const agentPhone = safeString(
    order['agentPhone'] ??
    agentField?.number ??
    agentField?.phone ??
    agentField?.Contact_Number ??
    ''
  );

  // itemsRaw could be grouped ({ itemName, colors: [{ color, sets }] }) or flat rows
  const itemsRaw = Array.isArray(order['items'])
    ? (order['items'] as unknown[])
    : Array.isArray(order['rows'])
      ? (order['rows'] as unknown[])
      : [];

  const itemsFlat: FlatItem[] = [];

  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const first = itemsRaw[0];
    // grouped form
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
        const colors = Array.isArray(itemObj['colors']) ? (itemObj['colors'] as unknown[]) : [];
        for (const c of colors) {
          if (isObject(c)) {
            const cObj = c as Record<string, unknown>;
            const color = safeString(cObj['color'] ?? cObj['colorName'] ?? cObj['value'] ?? '');
            const sets = safeNumber(cObj['sets'] ?? cObj['set'] ?? cObj['qty'] ?? cObj['quantity'] ?? 0);
            itemsFlat.push({ itemName, color, quantity: sets });
          } else {
            // c may be primitive color string
            const color = safeString(c);
            itemsFlat.push({ itemName, color, quantity: 0 });
          }
        }
      }
    } else {
      // flat rows
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
        const color =
          safeString(
            isObject(itObj['color']) && safeString((itObj['color'] as Record<string, unknown>)['label'])
              ? (itObj['color'] as Record<string, unknown>)['label']
              : itObj['color']
          ) ??
          safeString(itObj['colorName']) ??
          safeString(itObj['colorValue']) ??
          '';

        const qty = safeNumber(itObj['quantity'] ?? itObj['qty'] ?? itObj['sets'] ?? itObj['set'] ?? 0);
        itemsFlat.push({ itemName, color, quantity: qty });
      }
    }
  }

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    itemsFlat,
    createdAt: order['createdAt'] ?? order['created_at'] ?? null,
    source: safeString(order['source'] ?? 'web'),
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
        const res = await fetch(`/api/orders/${orderId}`);
        const text = await res.text().catch(() => '');
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          // invalid JSON: we'll log and bail
          console.warn('Order fetch: invalid JSON', { text, e });
        }

        if (!res.ok) {
          const msg =
            (isObject(data) && (data as Record<string, unknown>)['message']) ??
            text ??
            `HTTP ${res.status}`;
          console.error('Failed to fetch order:', msg);
          if (!canceled) setOrderRaw(null);
          return;
        }

        // Accept { ok:true, order } or raw order object
        let payloadOrder: unknown = null;
        if (isObject(data)) {
          const dobj = data as Record<string, unknown>;
          if (dobj['ok'] === true && dobj['order']) {
            payloadOrder = dobj['order'];
          } else if (dobj['ok'] === false) {
            console.error('Server returned ok:false', dobj);
            if (!canceled) setOrderRaw(null);
            return;
          } else {
            payloadOrder = data;
          }
        } else {
          console.warn('Order fetch: no JSON body', { text });
          if (!canceled) setOrderRaw(null);
          return;
        }

        if (!canceled) setOrderRaw(payloadOrder);
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

  /* --- add this helper near the other helpers at the top of the file --- */
  function isSecondsObject(v: unknown): v is { seconds: number } {
    return typeof v === 'object' && v !== null && 'seconds' in v && typeof (v as Record<string, unknown>)['seconds'] === 'number';
  }

  function hasToDate(v: unknown): v is { toDate: () => Date } {
    return typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as Record<string, unknown>)['toDate'] === 'function';
  }

  /* --- later, where you build orderForShare --- */
  const createdAtForShare: OrderShape['createdAt'] = (() => {
    const v = normalized.createdAt;
    if (v === null || v === undefined) return undefined;

    // already acceptable primitives / Date
    if (typeof v === 'string' || typeof v === 'number') return v;
    if (v instanceof Date) return v;

    // Firestore-style seconds object
    if (isSecondsObject(v)) return { seconds: Number((v as { seconds: number }).seconds) };

    // Firestore Timestamp-like with toDate()
    if (hasToDate(v)) {
      try {
        const d = (v as { toDate: () => Date }).toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
      } catch {
        /* ignore */
      }
    }

    // final attempt: try parseable date -> return ISO string
    try {
      const parsed = new Date(String(v));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    } catch {
      /* ignore */
    }

    // fallback: undefined (matches union because createdAt is optional / can be undefined)
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
          <p>
            <strong>Name:</strong> {customerName}
          </p>
          <p>
            <strong>Email:</strong> {customerEmail}
          </p>
          <p>
            <strong>Phone:</strong> {customerPhone}
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-lg mb-2">Agent Information</h3>
          <p>
            <strong>Name:</strong> {agentName}
          </p>
          <p>
            <strong>Number:</strong> {agentPhone}
          </p>
          <p>
            <strong>Email:</strong> {agentEmail}
          </p>
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
