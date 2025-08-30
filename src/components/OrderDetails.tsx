'use client';

import { useState, useEffect } from 'react';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';

function isMissing(v: any) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s === 'undefined') return true;
  return false;
}

function toSafeString(v: any) {
  if (isMissing(v)) return '';
  return String(v).trim();
}

function formatDate(input: any) {
  if (!input) return '—';
  // Firestore Timestamp
  if (typeof input === 'object' && typeof input.seconds === 'number') return new Date(input.seconds * 1000).toLocaleString();
  try {
    const d = new Date(input);
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(input);
  } catch {
    return String(input);
  }
}

/** Normalize order into consistent shape */
function normalizeOrder(order: any) {
  if (!order || typeof order !== 'object') return {
    customer: { name: '', email: '', phone: '' },
    agent: { name: '', email: '', number: '' },
    itemsFlat: [],
    createdAt: null,
    source: 'web',
    raw: order,
  };

  // prioritize top-level string fields; avoid returning the entire object as a "name"
  const customerName = toSafeString(order.customerName ?? order.customer?.name ?? order.customer?.label ?? order.customer?.Company_Name ?? '');
  const customerEmail = toSafeString(order.customerEmail ?? order.customer?.email ?? order.customer?.Email ?? '');
  const customerPhone = toSafeString(order.customerPhone ?? order.customer?.phone ?? order.customer?.phoneNumber ?? order.customer?.Number ?? '');

  const agentName = toSafeString(order.agentName ?? order.agent?.name ?? order.agent?.label ?? '');
  const agentEmail = toSafeString(order.agentEmail ?? order.agent?.email ?? order.agent?.Email ?? '');
  const agentPhone = toSafeString(order.agentPhone ?? order.agent?.number ?? order.agent?.phone ?? order.agent?.Contact_Number ?? '');

  // items: support grouped (itemName + colors[]) and flat rows
  const itemsRaw = Array.isArray(order.items) ? order.items : Array.isArray(order.rows) ? order.rows : [];

  const itemsFlat: { itemName: string; color: string; quantity: number }[] = [];

  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const first = itemsRaw[0];
    if (first && Array.isArray(first.colors)) {
      // grouped form
      for (const it of itemsRaw) {
        const itemName = toSafeString(it.itemName ?? it.Item ?? it.label ?? it.value ?? it.sku ?? '');
        if (!Array.isArray(it.colors)) continue;
        for (const c of it.colors) {
          const color = toSafeString(c.color ?? c.colorName ?? c.value ?? c);
          const sets = Number(c.sets ?? c.set ?? c.qty ?? c.quantity ?? 0) || 0;
          itemsFlat.push({ itemName, color, quantity: sets });
        }
      }
    } else {
      // flat rows
      for (const it of itemsRaw) {
        const itemName = toSafeString(it.itemName ?? it.item?.label ?? it.item?.Item ?? it.skuLabel ?? it.label ?? it.Item ?? it.sku ?? it.item?.value ?? '');
        const color = toSafeString(it.color?.label ?? it.color ?? it.colorName ?? it.colorValue ?? it);
        const qty = Number(it.quantity ?? it.qty ?? it.sets ?? it.set ?? 0) || 0;
        itemsFlat.push({ itemName, color, quantity: qty });
      }
    }
  }

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    itemsFlat,
    createdAt: order.createdAt ?? order.created_at ?? null,
    source: order.source ?? 'web',
    raw: order,
  };
}

function aggregateItems(items: { itemName: string; color: string; quantity: number }[]) {
  const map = new Map<string, { itemName: string; color: string; quantity: number }>();
  for (const it of items) {
    const key = `${it.itemName}||${it.color}`;
    const existing = map.get(key);
    if (existing) existing.quantity += Number(it.quantity || 0);
    else map.set(key, { ...it, quantity: Number(it.quantity || 0) });
  }
  return Array.from(map.values());
}

export default function OrderDetails({ orderId }: { orderId: string }) {
  const [orderRaw, setOrderRaw] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      setOrderRaw(null);
      return;
    }
    let canceled = false;

    async function fetchOrder() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const text = await res.text().catch(() => '');
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {
          console.warn('Order fetch: invalid JSON', { text, e });
        }

        if (!res.ok) {
          const msg = (data && data.message) || text || `HTTP ${res.status}`;
          console.error('Failed to fetch order:', msg);
          if (!canceled) setOrderRaw(null);
          return;
        }

        // accept wrapped { ok:true, order } or raw order object
        let payloadOrder = null;
        if (data && typeof data === 'object') {
          if (data.ok === true && data.order) payloadOrder = data.order;
          else if (data.ok === false) {
            console.error('Server returned ok:false', data);
            if (!canceled) setOrderRaw(null);
            return;
          } else payloadOrder = data;
        } else {
          console.warn('Order fetch: no JSON body', { text });
          if (!canceled) setOrderRaw(null);
          return;
        }

        if (process.env.NODE_ENV === 'development') console.debug('Order raw payload:', payloadOrder);
        if (!canceled) setOrderRaw(payloadOrder);
      } catch (err) {
        console.error('Error fetching order:', err);
        if (!canceled) setOrderRaw(null);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }

    fetchOrder();
    return () => { canceled = true; };
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

  const orderForShare: OrderShape = {
    id: orderId,
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    agent: { name: agentName, number: agentPhone, email: agentEmail },
    items: itemsAgg.map((it) => ({ itemName: it.itemName, color: it.color, quantity: it.quantity })),
    createdAt: normalized.createdAt,
    source: normalized.source,
  };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Order Details</h2>
          <p className="text-sm text-gray-400">Order ID: <span className="font-mono text-gray-300">{orderId}</span></p>
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
        <h3 className="font-semibold text-lg mb-4">Order Items <span className="text-sm text-gray-400">({totalQty} sets)</span></h3>

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
              {itemsAgg.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-700 hover:bg-gray-600">
                  <td className="py-4 px-6">{item.itemName || '—'}</td>
                  <td className="py-4 px-6">{item.color || '—'}</td>
                  <td className="py-4 px-6">{item.quantity}</td>
                </tr>
              ))}
              {itemsAgg.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-sm text-gray-400">No items on this order.</td></tr>
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
