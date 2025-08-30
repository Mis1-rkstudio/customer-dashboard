'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';

function onlyDigits(s = '') {
  return String(s || '').replace(/\D/g, '');
}

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

function safe(field: any, fallback = '—') {
  if (field === null || field === undefined || field === '') return fallback;
  return field;
}

/**
 * Normalize a saved order document into a consistent shape used by the UI.
 * Handles:
 *  - wrapped API shape { ok:true, order: {...} } OR raw order object
 *  - grouped items: [{ itemName, colors: [{ color, sets }] }]
 *  - flat rows: [{ itemName, color, quantity }]
 */
function normalizeOrder(order: any) {
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

  // Build safe customer/agent strings (do NOT assign objects)
  const customerName = toSafeString(order.customerName ?? order.customer?.name ?? order.customer?.label ?? order.customer?.Company_Name ?? '');
  const customerEmail = toSafeString(order.customerEmail ?? order.customer?.email ?? order.customer?.Email ?? '');
  const customerPhone = toSafeString(order.customerPhone ?? order.customer?.phone ?? order.customer?.phoneNumber ?? order.customer?.Number ?? '');

  const agentName = toSafeString(order.agentName ?? order.agent?.name ?? order.agent?.label ?? '');
  const agentEmail = toSafeString(order.agentEmail ?? order.agent?.email ?? order.agent?.Email ?? '');
  const agentPhone = toSafeString(order.agentPhone ?? order.agent?.number ?? order.agent?.phone ?? order.agent?.Contact_Number ?? '');

  // Items source
  const itemsRaw = Array.isArray(order.items) ? order.items : Array.isArray(order.rows) ? order.rows : [];

  let items: { itemName: string; color: string; quantity: number }[] = [];

  if (Array.isArray(itemsRaw) && itemsRaw.length > 0) {
    const first = itemsRaw[0];
    // grouped shape
    if (first && Array.isArray(first.colors)) {
      const expanded: any[] = [];
      for (const it of itemsRaw) {
        const itemName = toSafeString(it.itemName ?? it.Item ?? it.label ?? it.value ?? it.sku ?? it.name ?? '');
        if (!Array.isArray(it.colors)) continue;
        for (const c of it.colors) {
          const color = toSafeString(c.color ?? c.colorName ?? c.value ?? c);
          const sets = Number(c.sets ?? c.set ?? c.qty ?? c.quantity ?? 0) || 0;
          expanded.push({ itemName, color, quantity: sets });
        }
      }
      items = expanded;
    } else {
      // flat rows
      items = itemsRaw.map((it: any) => {
        const itemName = toSafeString(it.itemName ?? it.item?.label ?? it.item?.Item ?? it.skuLabel ?? it.label ?? it.sku ?? it.name ?? it.item?.value ?? '');
        const color = toSafeString(it.color?.label ?? it.color ?? it.colorName ?? it.colorValue ?? it);
        const qty = Number(it.quantity ?? it.qty ?? it.sets ?? it.set ?? 0) || 0;
        return { itemName, color, quantity: qty };
      });
    }
  }

  return {
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    agent: { name: agentName, email: agentEmail, number: agentPhone },
    items,
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

export default function OrderDetailsPage() {
  const [orderRaw, setOrderRaw] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const params = useParams();
  const orderId = params?.orderId;

  useEffect(() => {
    if (!orderId) {
      setIsLoading(false);
      setOrderRaw(null);
      return;
    }

    let canceled = false;
    async function fetchOrderDetails() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const text = await res.text().catch(() => '');
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch (parseErr) {
          console.warn('Order details: response not JSON', { status: res.status, text, parseErr });
        }

        if (!res.ok) {
          const msg = data?.message ?? text ?? `HTTP ${res.status}`;
          console.error('Failed to fetch order:', res.status, msg);
          if (!canceled) setOrderRaw(null);
          return;
        }

        // Accept { ok:true, order } or raw order object
        let payloadOrder = null;
        if (data && typeof data === 'object') {
          if (data.ok === true && data.order) payloadOrder = data.order;
          else if (data.ok === false) {
            console.error('Server returned ok:false', data);
            if (!canceled) setOrderRaw(null);
            return;
          } else payloadOrder = data;
        } else {
          console.warn('Order details: response had no JSON body', { text });
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

    fetchOrderDetails();
    return () => { canceled = true; };
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
          <Link href="/orders" className="text-blue-400 hover:underline">
            ← Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const normalized = normalizeOrder(orderRaw);
  const aggregatedItems = aggregateItems(normalized.items);
  const totalQty = aggregatedItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  const customerName = safe(normalized.customer.name ?? normalized.customer.label ?? normalized.customer.value);
  const customerEmail = safe(normalized.customer.email ?? normalized.customer.Email, '—');
  const customerPhoneRaw = normalized.customer.phone ?? normalized.customer.phoneNumber ?? normalized.customer.Number ?? '';
  const customerPhone = safe(customerPhoneRaw, '—');

  const agentName = safe(normalized.agent.name ?? normalized.agent.label ?? normalized.agent.value, '—');
  const agentEmail = safe(normalized.agent.email ?? normalized.agent.Email, '—');
  const agentPhone = safe(normalized.agent.number ?? normalized.agent.phone ?? normalized.agent.Contact_Number, '—');

  const placedAt = formatDate(normalized.createdAt);

  const orderForShare: OrderShape = {
    id: orderId,
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    agent: { name: agentName, number: agentPhone, email: agentEmail },
    items: aggregatedItems.map((it) => ({ itemName: it.itemName, color: it.color, quantity: it.quantity })),
    createdAt: normalized.createdAt,
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
          <Link href="/orders" className="px-3 py-2 bg-transparent border border-gray-700 text-gray-300 rounded hover:bg-gray-800">
            ← Back
          </Link>
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
