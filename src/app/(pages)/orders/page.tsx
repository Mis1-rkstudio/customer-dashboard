'use client';

import React, { JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { FaTimes, FaTrash, FaUndo } from 'react-icons/fa';
import Modal from '../../../components/Modal';
import OrderDetails from '../../../components/OrderDetails';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';
import OrderForm from '@/components/OrderForm';

/* ---------------------- small helpers ---------------------- */

function formatDateMaybe(raw: unknown): string {
  if (!raw) return '—';
  try {
    if (typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'seconds')) {
      const rec = raw as Record<string, unknown>;
      if (typeof rec.seconds === 'number') return new Date(rec.seconds * 1000).toLocaleString();
    }
    const d = new Date(String(raw));
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(raw);
  } catch {
    return String(raw);
  }
}

function isSecondsObject(v: unknown): v is { seconds: number } {
  return typeof v === 'object' && v !== null && 'seconds' in v && typeof (v as Record<string, unknown>).seconds === 'number';
}

function pluckString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const val = rec[k];
    if (val !== undefined && val !== null) return String(val);
  }
  return undefined;
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Try to extract a message string from an unknown JSON body safely */
function extractMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string' && b.message.trim()) return b.message;
  if (typeof b.error === 'string' && b.error.trim()) return b.error;
  // some APIs return nested error structures: { errors: [{ message: '...' }] }
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const first = b.errors[0];
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).message === 'string') {
      return (first as Record<string, unknown>).message as string;
    }
  }
  return undefined;
}

/* ---------------------- normalize ---------------------- */

type NormalizedOrder = {
  id: string;
  customerName: string;
  customerPhone?: string;
  agentName: string;
  agentPhone?: string;
  createdAt?: unknown;
  items?: unknown[];
  totalQty: number;
  raw?: unknown;
  orderStatus?: string;
};

function normalizeOrderShape(raw: unknown): NormalizedOrder {
  const r = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

  const id = String(
    r.id ??
    r.orderId ??
    r.OrderID ??
    r.order_id ??
    r.ID ??
    ''
  );

  const customerField = r.customer;
  const customerName = String(
    r.customerName ??
    (customerField && typeof customerField === 'object' ? (customerField as Record<string, unknown>).name : undefined) ??
    (customerField && typeof customerField === 'string' ? (customerField as string) : undefined) ??
    ((r.customer as Record<string, unknown>)?.label) ??
    ((r.customer as Record<string, unknown>)?.Company_Name) ??
    ''
  );

  const agentField = r.agent;
  const agentName = String(
    r.agentName ??
    (agentField && typeof agentField === 'object' ? (agentField as Record<string, unknown>).name : undefined) ??
    (agentField && typeof agentField === 'string' ? (agentField as string) : undefined) ??
    ((r.agent as Record<string, unknown>)?.label) ??
    ((r.agent as Record<string, unknown>)?.Company_Name) ??
    ''
  );

  const createdAt = r.createdAt ?? r.created_at ?? r.placedAt ?? r.Placed ?? r.createdDate ?? '';

  const customerPhone = String(
    r.customerPhone ??
    (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).phone as unknown) : undefined) ??
    (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).phoneNumber as unknown) : undefined) ??
    (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).Number as unknown) : undefined) ??
    ''
  );

  const agentPhone = String(
    r.agentPhone ??
    (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).number as unknown) : undefined) ??
    (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).phone as unknown) : undefined) ??
    (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).Contact_Number as unknown) : undefined) ??
    ''
  );

  const itemsCandidate = (r.items ?? r.rows ?? r.itemsFlat) as unknown;
  const items = Array.isArray(itemsCandidate) ? (itemsCandidate as unknown[]) : [];

  let totalQty = 0;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    if (first && typeof first === 'object' && Array.isArray((first as Record<string, unknown>).colors)) {
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const colors = (it as Record<string, unknown>).colors as unknown[];
        if (!Array.isArray(colors)) continue;
        for (const c of colors) {
          if (!c || typeof c !== 'object') continue;
          const count = Number((c as Record<string, unknown>).sets ?? (c as Record<string, unknown>).set ?? 0) || 0;
          totalQty += count;
        }
      }
    } else {
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const rec = it as Record<string, unknown>;
        totalQty += Number(rec.quantity ?? rec.qty ?? rec.sets ?? 0) || 0;
      }
    }
  }

  const statusCandidate = (pluckString(r, 'orderStatus', 'order_status', 'status') ?? '').trim();

  return {
    id,
    customerName,
    customerPhone: customerPhone || undefined,
    agentName,
    agentPhone: agentPhone || undefined,
    createdAt,
    items,
    totalQty,
    raw,
    orderStatus: statusCandidate || undefined,
  };
}

/* ---------------------- page component ---------------------- */

export default function OrdersPage(): JSX.Element {
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchPills, setSearchPills] = useState<Array<{ field: string; value: string }>>([]);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string>('');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'all' | 'active' | 'cancelled'>('all');

  // create modal + create handler
  const [isCreateModalOpen, setICreateModalOpen] = useState<boolean>(false);

  const fetchOrders = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);

      let rawList: unknown[] = [];
      if (Array.isArray(data)) rawList = data;
      else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).rows)) rawList = (data as Record<string, unknown>).rows as unknown[];
      else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).orders)) rawList = (data as Record<string, unknown>).orders as unknown[];
      else rawList = [];

      const normalized = rawList.map((r) => {
        if (r && typeof r === 'object' && 'payload' in r) {
          const rec = r as Record<string, unknown>;
          const payload = rec.payload;
          if (payload && typeof payload === 'object') {
            const base = normalizeOrderShape(payload);
            if (!base.id && rec.id) base.id = String(rec.id);
            base.raw = rec;
            return base;
          }
        }
        const base2 = normalizeOrderShape(r);
        // NormalizedOrder has raw?: unknown so set directly
        base2.raw = r;
        return base2;
      });

      setOrders(normalized);
    } catch (err: unknown) {
      console.error('Failed to fetch orders:', err);
      setFetchError('Failed to fetch orders. See console for details.');
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => setSearchQuery(e.target.value);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    const txt = searchQuery.trim();
    if (!txt) return;
    const parts = txt.split(':');
    if (parts.length === 2) {
      const field = parts[0].trim().toLowerCase();
      const value = parts[1].trim();
      if (value) {
        setSearchPills((prev) => [...prev, { field, value }]);
        setSearchQuery('');
      }
    } else {
      setSearchPills((prev) => [...prev, { field: 'customer', value: txt }]);
      setSearchQuery('');
    }
  };

  const removePill = (index: number): void => {
    setSearchPills((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCardClick = (orderId: string): void => {
    setSelectedOrderId(orderId);
    setIsDetailsModalOpen(true);
  };

  const handleDetailsClose = (): void => {
    setIsDetailsModalOpen(false);
    setSelectedOrderId(null);
  };

  const filteredBySearch = useMemo(() => {
    if (!searchPills || searchPills.length === 0) return orders;
    return orders.filter((order) =>
      searchPills.every((pill) => {
        const { field, value } = pill;
        const v = String(value || '').toLowerCase();
        if (!v) return true;
        switch (field) {
          case 'customer':
            return (order.customerName || '').toLowerCase().includes(v);
          case 'agent':
            return (order.agentName || '').toLowerCase().includes(v);
          case 'date':
            return String(order.createdAt ?? '').toLowerCase().includes(v);
          case 'id':
            return (order.id || '').toLowerCase().includes(v);
          default:
            return ((order.customerName || '') + ' ' + (order.agentName || '')).toLowerCase().includes(v);
        }
      })
    );
  }, [orders, searchPills]);

  const activeOrders = useMemo(() => filteredBySearch.filter((o) => {
    const s = String(o.orderStatus ?? '').toLowerCase();
    return s !== 'cancelled' && s !== 'canceled';
  }), [filteredBySearch]);

  const cancelledOrders = useMemo(() => filteredBySearch.filter((o) => {
    const s = String(o.orderStatus ?? '').toLowerCase();
    return s === 'cancelled' || s === 'canceled';
  }), [filteredBySearch]);

  // viewOrders computed once
  const viewOrders = useMemo(() => {
    if (selectedTab === 'all') return filteredBySearch;
    if (selectedTab === 'active') return activeOrders;
    return cancelledOrders;
  }, [selectedTab, filteredBySearch, activeOrders, cancelledOrders]);


  /* ---------------------- createOrder helper ---------------------- */

  function preparePayloadForApi(orderData: unknown): Record<string, unknown> {
    const rec = (orderData && typeof orderData === 'object') ? (orderData as Record<string, unknown>) : {};

    const customerPayload = (() => {
      const c = rec['customer'];
      if (c && typeof c === 'object') {
        return {
          name: safeString((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).label ?? (c as Record<string, unknown>).Company_Name ?? ''),
          phone: safeString((c as Record<string, unknown>).phone ?? (c as Record<string, unknown>).Number ?? (c as Record<string, unknown>).phoneNumber ?? ''),
          email: safeString((c as Record<string, unknown>).email ?? (c as Record<string, unknown>).Email ?? ''),
        };
      }
      return {
        name: safeString(rec['customerName'] ?? rec['customer'] ?? ''),
        phone: safeString(rec['customerPhone'] ?? rec['customerNumber'] ?? rec['customer_mobile'] ?? ''),
        email: safeString(rec['customerEmail'] ?? rec['customer_email'] ?? ''),
      };
    })();

    const agentPayload = (() => {
      const a = rec['agent'];
      if (a && typeof a === 'object') {
        return {
          name: safeString((a as Record<string, unknown>).name ?? (a as Record<string, unknown>).label ?? ''),
          phone: safeString((a as Record<string, unknown>).phone ?? (a as Record<string, unknown>).number ?? (a as Record<string, unknown>).Contact_Number ?? ''),
        };
      }
      return {
        name: safeString(rec['agentName'] ?? rec['agent'] ?? ''),
        phone: safeString(rec['agentPhone'] ?? rec['agentNumber'] ?? ''),
      };
    })();

    const rawItemsCandidate = rec['items'] ?? rec['rows'] ?? rec['itemsFlat'] ?? [];
    const rawItems = Array.isArray(rawItemsCandidate) ? rawItemsCandidate as unknown[] : [];

    const flatItems: Array<Record<string, unknown>> = [];

    for (const it of rawItems) {
      if (!it) continue;
      if (typeof it === 'string') {
        flatItems.push({ sku: '', itemName: it, color: '', quantity: 0 });
        continue;
      }
      if (typeof it === 'object') {
        const i = it as Record<string, unknown>;
        const itemName = safeString(i['itemName'] ?? i['Item'] ?? i['label'] ?? i['skuLabel'] ?? i['name'] ?? i['labelName'] ?? '');
        const sku = safeString(i['sku'] ?? i['itemId'] ?? i['id'] ?? '');

        if (Array.isArray(i['colors']) && i['colors'].length > 0) {
          for (const c of (i['colors'] as unknown[])) {
            if (!c) continue;
            if (typeof c === 'object') {
              const cRec = c as Record<string, unknown>;
              const colorName = safeString(cRec['color'] ?? cRec['colorName'] ?? cRec['name'] ?? cRec['value'] ?? cRec['label']);
              const qty = Number(cRec['sets'] ?? cRec['set'] ?? cRec['qty'] ?? cRec['quantity'] ?? 0) || 0;
              flatItems.push({ sku, itemName: itemName || sku, color: colorName, quantity: qty });
            } else {
              flatItems.push({ sku, itemName: itemName || sku, color: String(c), quantity: 0 });
            }
          }
          continue;
        }

        const qty = Number(i['quantity'] ?? i['qty'] ?? i['sets'] ?? i['set'] ?? 0) || 0;
        const color = safeString(i['color'] ?? i['colorName'] ?? '');
        if (qty > 0 || color || itemName || sku) {
          flatItems.push({ sku, itemName: itemName || sku, color, quantity: qty });
          continue;
        }

        flatItems.push({ sku, itemName: itemName || sku || JSON.stringify(i), color: safeString(i['color']), quantity: qty });
      }
    }

    const itemsToSend = flatItems.length > 0 ? flatItems : [];
    const orderStatus = safeString(rec['orderStatus'] ?? rec['status'] ?? rec['order_status'] ?? 'Unconfirmed');

    return {
      customer: customerPayload,
      agent: agentPayload,
      items: itemsToSend,
      orderStatus,
    };
  }

  const handleCreateOrder = useCallback(async (orderData: unknown) => {
    try {
      setFetchError('');
      const payload = preparePayloadForApi(orderData);
      const cust = payload.customer as Record<string, unknown>;
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!cust || !cust.name || items.length === 0) {
        throw new Error('Invalid payload: customer name and at least one item are required.');
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get('content-type') ?? '';
      let body: unknown = null;
      if (ct.includes('application/json')) body = await res.json().catch(() => null);
      else body = await res.text().catch(() => null);

      if (!res.ok) {
        const extracted = extractMessageFromBody(body);
        const msg = extracted ?? String(body ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }

      await fetchOrders();
      setICreateModalOpen(false);
      return body;
    } catch (err: unknown) {
      console.error('Failed to create order:', err);
      const message = err instanceof Error ? err.message : String(err);
      setFetchError(`Failed to create order: ${message}`);
      throw err;
    }
  }, [fetchOrders]);

  /* ---------------------- update status ---------------------- */

  const markOrderStatus = async (id: string, status: string): Promise<void> => {
    if (!id) return;
    const confirmMsg = status.toLowerCase() === 'cancelled'
      ? 'Mark this order as Cancelled?'
      : `Mark this order as ${status}?`;

    if (!window.confirm(confirmMsg)) return;

    setActioningId(id);
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, orderStatus: status }),
      });

      const ct = res.headers.get('content-type') ?? '';
      let body: unknown = null;
      if (ct.includes('application/json')) body = await res.json().catch(() => null);
      else body = await res.text().catch(() => null);

      if (!res.ok) {
        const extracted = extractMessageFromBody(body);
        const msg = extracted ?? String(body ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }

      await fetchOrders();
    } catch (err: unknown) {
      console.error(`Failed to mark order as ${status}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      setFetchError(`Failed to mark order as ${status}: ${message}`);
    } finally {
      setActioningId(null);
    }
  };

  /* ---------------------- render ---------------------- */

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="flex justify-between items-center my-6">
        <div>
          <h1 className="text-3xl font-bold">Orders</h1>
          <p className="text-sm text-gray-400 mt-1">Manage and view orders</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setICreateModalOpen(true)}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            type="button"
          >
            Create New Order
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={'Search: use "customer: name", "agent: name", "id: <id>" or press Enter for quick customer search'}
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          className="appearance-none block w-full bg-gray-800 text-gray-300 border border-gray-700 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-gray-700"
          aria-label="Search orders"
        />
        <div className="flex flex-wrap items-center mt-2">
          {searchPills.map((pill, index) => (
            <div
              key={`${pill.field}:${pill.value}:${index}`}
              className="bg-gray-700 text-gray-300 rounded-full px-3 py-1 text-sm font-semibold mr-2 mb-2 flex items-center"
            >
              <span>{`${pill.field}: "${pill.value}"`}</span>
              <button
                onClick={(ev) => { ev.stopPropagation(); removePill(index); }}
                className="ml-2 text-red-500 hover:text-red-700"
                aria-label={`Remove filter ${pill.field}: ${pill.value}`}
                type="button"
              >
                <FaTimes />
              </button>
            </div>
          ))}
        </div>
      </div>

      {fetchError && <div className="text-red-400 mb-4">{fetchError}</div>}

      <div className="flex gap-3 items-center mb-4">
        <button
          className={`px-3 py-1 rounded ${selectedTab === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          onClick={() => setSelectedTab('all')}
        >
          All ({orders.length})
        </button>
        <button
          className={`px-3 py-1 rounded ${selectedTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          onClick={() => setSelectedTab('active')}
        >
          Active ({activeOrders.length})
        </button>
        <button
          className={`px-3 py-1 rounded ${selectedTab === 'cancelled' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          onClick={() => setSelectedTab('cancelled')}
        >
          Cancelled ({cancelledOrders.length})
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10">
          <p>Loading orders...</p>
        </div>
      ) : (
        <>
          {viewOrders.length === 0 ? (
            <div className="text-center py-10">
              <p>No orders found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {viewOrders.map((order) => {
                type ShareItem = { itemName: string; color: string; quantity: number };
                const itemsForShare: ShareItem[] = [];

                if (Array.isArray(order.items) && order.items.length > 0) {
                  const first = order.items[0];
                  if (first && typeof first === 'object' && Array.isArray((first as Record<string, unknown>).colors)) {
                    for (const it of order.items as unknown[]) {
                      if (!it || typeof it !== 'object') continue;
                      const itRec = it as Record<string, unknown>;
                      const itemName = String(itRec.itemName ?? itRec.Item ?? itRec.sku ?? itRec.label ?? '');
                      const colors = Array.isArray(itRec.colors) ? itRec.colors : [];
                      for (const c of colors) {
                        if (!c) continue;
                        if (typeof c === 'object') {
                          const cRec = c as Record<string, unknown>;
                          itemsForShare.push({
                            itemName,
                            color: String(cRec.color ?? cRec.colorName ?? ''),
                            quantity: Number(cRec.sets ?? cRec.set ?? cRec.qty ?? cRec.quantity ?? 0) || 0,
                          });
                        } else {
                          itemsForShare.push({ itemName, color: String(c ?? ''), quantity: 0 });
                        }
                      }
                    }
                  } else {
                    for (const it of order.items as unknown[]) {
                      if (!it || typeof it !== 'object') continue;
                      const itRec = it as Record<string, unknown>;
                      itemsForShare.push({
                        itemName: String(itRec.itemName ?? itRec.sku ?? itRec.label ?? ''),
                        color: String(itRec.color ?? itRec.colorName ?? ''),
                        quantity: Number(itRec.quantity ?? itRec.qty ?? itRec.sets ?? 0) || 0,
                      });
                    }
                  }
                }

                const createdAtForShare: OrderShape['createdAt'] = (() => {
                  const v = order.createdAt;
                  if (v === null || v === undefined) return undefined;

                  if (typeof v === 'string' || typeof v === 'number') return v;
                  if (v instanceof Date) return v;
                  if (isSecondsObject(v)) return { seconds: Number(v.seconds) };
                  try {
                    const parsed = new Date(String(v));
                    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
                  } catch { }
                  return undefined;
                })();

                const orderForShare: OrderShape = {
                  id: order.id,
                  customer: { name: order.customerName || '', phone: order.customerPhone || '', email: '' },
                  agent: { name: order.agentName || '', number: order.agentPhone || '', email: '' },
                  items: itemsForShare,
                  createdAt: createdAtForShare,
                  source:
                    (order.raw && typeof order.raw === 'object' ? ((order.raw as Record<string, unknown>).source as string | undefined) : undefined) ??
                    'web',
                };

                const isCancelled = ((order.orderStatus ?? '').toLowerCase() === 'cancelled' || (order.orderStatus ?? '').toLowerCase() === 'canceled');

                return (
                  <div
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(order.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(order.id); }}
                    className={`relative rounded-lg transition-shadow duration-300 ease-in-out p-6 cursor-pointer focus:outline-none focus:ring-2 ${isCancelled ? 'bg-gray-800/60 opacity-80' : 'bg-gray-800 hover:shadow-lg'
                      }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 pr-3">
                        <h2 className={`text-lg font-bold truncate ${isCancelled ? 'text-gray-300' : 'text-white'}`}>{order.customerName || '—'}</h2>
                        <p className="text-sm text-gray-400 truncate">{order.agentName || '—'}</p>
                      </div>

                      <div className="flex items-start gap-2">
                        {isCancelled ? (
                          <div className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-red-700 text-white mr-2">
                            Cancelled
                          </div>
                        ) : order.orderStatus ? (
                          <div className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-green-700 text-white mr-2">
                            {order.orderStatus}
                          </div>
                        ) : null}

                        <div
                          className="inline-block"
                          onClick={(ev) => ev.stopPropagation()}
                          onKeyDown={(ev) => ev.stopPropagation()}
                          role="button"
                          tabIndex={0}
                          aria-label="Share order"
                        >
                          <ShareOrderIcon order={orderForShare} phone={order.customerPhone ?? ''} />
                        </div>

                        {isCancelled ? (
                          <button
                            type="button"
                            title="Restore order"
                            aria-label={`Restore order ${order.id}`}
                            onClick={(ev) => { ev.stopPropagation(); void markOrderStatus(order.id, 'Unconfirmed'); }}
                            className="p-2 rounded hover:bg-gray-700 focus:outline-none"
                          >
                            {actioningId === order.id ? (
                              <svg className="animate-spin h-4 w-4 text-green-400" viewBox="0 0 24 24" aria-hidden>
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                              </svg>
                            ) : (
                              <FaUndo className="text-green-400" />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Cancel order"
                            aria-label={`Cancel order ${order.id}`}
                            onClick={(ev) => { ev.stopPropagation(); void markOrderStatus(order.id, 'Cancelled'); }}
                            className="p-2 rounded hover:bg-gray-700 focus:outline-none"
                          >
                            {actioningId === order.id ? (
                              <svg className="animate-spin h-4 w-4 text-red-400" viewBox="0 0 24 24" aria-hidden>
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                              </svg>
                            ) : (
                              <FaTrash className="text-red-400" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-sm text-gray-300">
                        <span className="font-semibold">Order ID:</span> {order.id || '—'}
                      </p>
                      <p className="text-sm text-gray-300">
                        <span className="font-semibold">Date:</span> {formatDateMaybe(order.createdAt)}
                      </p>
                    </div>

                    <div className="absolute bottom-3 right-3 z-10">
                      <div className="inline-flex items-center justify-center rounded-md bg-gray-900/70 px-3 py-1 text-sm font-medium text-gray-100">
                        {order.totalQty ?? 0} sets
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Details modal */}
      <Modal isOpen={isDetailsModalOpen} onClose={handleDetailsClose}>
        {selectedOrderId ? <OrderDetails orderId={selectedOrderId} /> : <div className="p-6">Loading...</div>}
      </Modal>

      {/* Create modal: open OrderForm (OrderForm uses closeModal + refreshOrders props) */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setICreateModalOpen(false)}>
        <OrderForm
          closeModal={() => setICreateModalOpen(false)}
          refreshOrders={fetchOrders}
        />
      </Modal>
    </div>
  );
}
