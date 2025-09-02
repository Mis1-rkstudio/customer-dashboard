'use client';

import React, { JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { FaTimes, FaTrash, FaUndo } from 'react-icons/fa';
import Modal from '../../../components/Modal';
import OrderForm from '../../../components/OrderForm';
import OrderDetails from '../../../components/OrderDetails';
import ShareOrderIcon, { OrderShape } from '@/components/ShareOrder';

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

/** small helper to detect Firestore-like { seconds: number } without using `any` */
function isSecondsObject(v: unknown): v is { seconds: number } {
  return typeof v === 'object' && v !== null && 'seconds' in v && typeof (v as Record<string, unknown>).seconds === 'number';
}

/**
 * Normalized order shape used by the UI
 */
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
  orderStatus?: string; // normalized status (e.g. Confirmed / Unconfirmed / Cancelled)
};

function normalizeOrderShape(raw: unknown): NormalizedOrder {
  const r = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

  // id candidates -> coerce to string
  const id =
    String(
      r.id ??
      r.orderId ??
      r.OrderID ??
      r.order_id ??
      r.ID ??
      ''
    );

  const customerField = r.customer;
  const customerName =
    String(
      r.customerName ??
      (customerField && typeof customerField === 'object' ? (customerField as Record<string, unknown>).name : undefined) ??
      (customerField && typeof customerField === 'string' ? (customerField as string) : undefined) ??
      ((r.customer as Record<string, unknown>)?.label) ??
      ((r.customer as Record<string, unknown>)?.Company_Name) ??
      ''
    );

  const agentField = r.agent;
  const agentName =
    String(
      r.agentName ??
      (agentField && typeof agentField === 'object' ? (agentField as Record<string, unknown>).name : undefined) ??
      (agentField && typeof agentField === 'string' ? (agentField as string) : undefined) ??
      ((r.agent as Record<string, unknown>)?.label) ??
      ((r.agent as Record<string, unknown>)?.Company_Name) ??
      ''
    );

  const createdAt = r.createdAt ?? r.created_at ?? r.placedAt ?? r.Placed ?? r.createdDate ?? '';

  const customerPhone =
    String(
      r.customerPhone ??
      (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).phone as unknown) : undefined) ??
      (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).phoneNumber as unknown) : undefined) ??
      (customerField && typeof customerField === 'object' ? ((customerField as Record<string, unknown>).Number as unknown) : undefined) ??
      ''
    );

  const agentPhone =
    String(
      r.agentPhone ??
      (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).number as unknown) : undefined) ??
      (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).phone as unknown) : undefined) ??
      (agentField && typeof agentField === 'object' ? ((agentField as Record<string, unknown>).Contact_Number as unknown) : undefined) ??
      ''
    );

  // items: support multiple legacy shapes
  const itemsCandidate = (r.items ?? r.rows ?? r.itemsFlat) as unknown;
  const items = Array.isArray(itemsCandidate) ? (itemsCandidate as unknown[]) : [];

  // compute totalQty
  let totalQty = 0;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    if (first && typeof first === 'object' && Array.isArray((first as Record<string, unknown>).colors)) {
      // grouped by item with colors array containing sets
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
      // flat rows with quantity/qty/sets
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const rec = it as Record<string, unknown>;
        totalQty += Number(rec.quantity ?? rec.qty ?? rec.sets ?? 0) || 0;
      }
    }
  }

  // normalize order status (support multiple possible field names)
  const rawStatus = (r.orderStatus ?? r.status ?? r.OrderStatus ?? '') as unknown;
  const orderStatus = rawStatus ? String(rawStatus).trim() : '';

  return {
    id,
    customerName,
    customerPhone: customerPhone || undefined,
    agentName,
    agentPhone: agentPhone || undefined,
    createdAt,
    items,
    totalQty,
    raw: r,
    orderStatus: orderStatus || undefined,
  };
}

export default function OrdersPage(): JSX.Element {
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchPills, setSearchPills] = useState<Array<{ field: string; value: string }>>([]);
  const [isCreateModalOpen, setICreateModalOpen] = useState<boolean>(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string>('');
  const [actionId, setActionId] = useState<string | null>(null); // id currently being updated (cancel/restore)
  const [selectedTab, setSelectedTab] = useState<'active' | 'cancelled' | 'all'>('active');

  const fetchOrders = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      // handle potential non-JSON safely
      const data = await res.json().catch(() => null);

      let rawList: unknown[] = [];
      if (Array.isArray(data)) rawList = data;
      else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).rows)) rawList = (data as Record<string, unknown>).rows as unknown[];
      else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).orders)) rawList = (data as Record<string, unknown>).orders as unknown[];
      else rawList = [];

      const normalized = rawList.map((r) => normalizeOrderShape(r));
      setOrders(normalized);
    } catch (err: unknown) {
      // keep console message for debugging
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

  const filteredOrders = useMemo(() => {
    // apply search pills first
    let result = orders.filter((order) =>
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

    // then apply tab filter
    if (selectedTab === 'active') {
      result = result.filter((o) => {
        const s = (o.orderStatus ?? '').toLowerCase();
        return s !== 'cancelled' && s !== 'cancel'; // treat both variants as cancelled
      });
    } else if (selectedTab === 'cancelled') {
      result = result.filter((o) => {
        const s = (o.orderStatus ?? '').toLowerCase();
        return s === 'cancelled' || s === 'cancel';
      });
    }
    return result;
  }, [orders, searchPills, selectedTab]);

  // mark order status via PATCH call
  const markOrderStatus = async (id: string, newStatus: string): Promise<void> => {
    if (!id) return;
    const friendly = String(newStatus);
    // confirm if cancelling (for safety)
    if (friendly.toLowerCase() === 'cancelled' || friendly.toLowerCase() === 'cancel') {
      const ok = window.confirm('Are you sure you want to mark this order as Cancelled?');
      if (!ok) return;
    }
    try {
      setActionId(id);
      const res = await fetch(`/api/orders?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderStatus: friendly }),
      });
      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        let msg = `Failed to update order (${res.status})`;
        if (contentType.includes('application/json')) {
          const json = await res.json().catch(() => ({}));
          msg = (json as Record<string, unknown>).message as string ?? msg;
        } else {
          const txt = await res.text().catch(() => '');
          if (txt) msg = txt;
        }
        throw new Error(msg);
      }
      // refresh orders to show updated status (server is source of truth)
      await fetchOrders();
      // if details modal open for this order, close it to avoid stale view
      if (selectedOrderId === id) {
        handleDetailsClose();
      }
    } catch (err: unknown) {
      console.error('Failed to mark order status:', err);
      const message = err instanceof Error ? err.message : String(err);
      setFetchError(`Failed to mark order: ${message}`);
    } finally {
      setActionId(null);
    }
  };

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
          placeholder='Search: use "customer: name", "agent: name", "id: <id>" or press Enter for quick customer search'
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          className="appearance-none block w-full bg-gray-800 text-gray-300 border border-gray-700 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-gray-700"
        />
        <div className="flex flex-wrap items-center mt-2">
          {searchPills.map((pill, index) => (
            <div
              key={`${pill.field}:${pill.value}:${index}`}
              className="bg-gray-700 text-gray-300 rounded-full px-3 py-1 text-sm font-semibold mr-2 mb-2 flex items-center"
            >
              <span>
                {pill.field}: "{pill.value}"
              </span>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  removePill(index);
                }}
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

      {/* Tabs: Active / Cancelled / All */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setSelectedTab('active')}
          className={`px-3 py-1 rounded ${selectedTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          type="button"
        >
          Active ({orders.filter((o) => !((o.orderStatus ?? '').toLowerCase().includes('cancel'))).length})
        </button>
        <button
          onClick={() => setSelectedTab('cancelled')}
          className={`px-3 py-1 rounded ${selectedTab === 'cancelled' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          type="button"
        >
          Cancelled ({orders.filter((o) => ((o.orderStatus ?? '').toLowerCase().includes('cancel'))).length})
        </button>
        <button
          onClick={() => setSelectedTab('all')}
          className={`px-3 py-1 rounded ${selectedTab === 'all' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          type="button"
        >
          All ({orders.length})
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10">
          <p>Loading orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-10">
          <p>No orders found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredOrders.map((order) => {
            // prepare flat items for ShareOrderIcon (safely)
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
              // fallback: try to parse to ISO string (safe)
              try {
                const parsed = new Date(String(v));
                if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
              } catch {
                /* ignore */
              }
              // final fallback — return undefined so it matches the union
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

            const status = (order.orderStatus ?? '').toLowerCase();
            const isCancelled = status === 'cancelled' || status === 'cancel';

            return (
              <div
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(order.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(order.id); }}
                className={`relative rounded-lg shadow-md transition-shadow duration-300 ease-in-out p-6 pr-14 sm:pr-16 cursor-pointer focus:outline-none focus:ring-2 ${isCancelled ? 'bg-gray-800/80 opacity-70' : 'bg-gray-800 hover:shadow-lg'
                  }`}
              >
                {/* top-right controls: share and cancel/restore */}
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2" onClick={(ev) => ev.stopPropagation()}>
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

                  {selectedTab === 'cancelled' ? (
                    <button
                      type="button"
                      title="Restore order"
                      aria-label={`Restore order ${order.id}`}
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        // restore to Unconfirmed by default (you can change logic to keep previous status)
                        await markOrderStatus(order.id, 'Unconfirmed');
                      }}
                      className="p-2 rounded hover:bg-gray-700 focus:outline-none"
                    >
                      {actionId === order.id ? (
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
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        await markOrderStatus(order.id, 'Cancelled');
                      }}
                      className="p-2 rounded hover:bg-gray-700 focus:outline-none"
                    >
                      {actionId === order.id ? (
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

                <div className="flex items-start">
                  <div className="min-w-0">
                    <h2 className={`text-lg font-bold ${isCancelled ? 'text-gray-300' : 'text-white'} truncate`}>{order.customerName || '—'}</h2>
                    <p className="text-sm text-gray-400 truncate">{order.agentName || '—'}</p>
                  </div>

                  {/* status badge left top (if cancelled show red badge) */}
                  <div className="ml-3">
                    {isCancelled && (
                      <div className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-red-700 text-white">
                        Cancelled
                      </div>
                    )}
                    {!isCancelled && (order.orderStatus ? (
                      <div className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-green-700 text-white">
                        {order.orderStatus}
                      </div>
                    ) : null)}
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

                {/* sets badge bottom-right */}
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

      <Modal isOpen={isCreateModalOpen} onClose={() => setICreateModalOpen(false)}>
        <OrderForm closeModal={() => setICreateModalOpen(false)} refreshOrders={fetchOrders} />
      </Modal>

      <Modal isOpen={isDetailsModalOpen} onClose={handleDetailsClose}>
        {selectedOrderId ? <OrderDetails orderId={selectedOrderId} /> : <div className="p-6">Loading...</div>}
      </Modal>
    </div>
  );
}
