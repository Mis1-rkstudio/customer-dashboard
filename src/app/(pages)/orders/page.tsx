// app/(your-path)/orders/page.tsx   <-- adjust path if needed
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FaTimes } from 'react-icons/fa';
import Modal from '../../../components/Modal';
import OrderForm from '../../../components/OrderForm';
import OrderDetails from '../../../components/OrderDetails';
import ShareOrderIcon from '@/components/ShareOrder';

function formatDateMaybe(raw: any) {
  if (!raw) return '—';
  try {
    if (typeof raw === 'object' && raw.seconds) return new Date(raw.seconds * 1000).toLocaleString();
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(raw);
  } catch {
    return String(raw);
  }
}

/**
 * Normalize the raw order document returned by /api/orders (or older shapes).
 * Ensures the UI always receives { id, customerName, customerPhone, agentName, agentPhone, createdAt, items, totalQty, raw }.
 */
function normalizeOrderShape(raw: any) {
  const id = raw?.id ?? raw?.orderId ?? raw?.OrderID ?? raw?.order_id ?? raw?.ID ?? '';
  const customerName =
    raw?.customerName ??
    raw?.customer?.name ??
    raw?.customer?.label ??
    raw?.customer?.Company_Name ??
    (typeof raw?.customer === 'string' ? raw.customer : '') ??
    '';
  const agentName =
    raw?.agentName ??
    raw?.agent?.name ??
    raw?.agent?.label ??
    raw?.agent?.Company_Name ??
    (typeof raw?.agent === 'string' ? raw.agent : '') ??
    '';
  const createdAt = raw?.createdAt ?? raw?.created_at ?? raw?.placedAt ?? raw?.Placed ?? raw?.createdDate ?? '';

  const customerPhone =
    raw?.customerPhone ?? raw?.customer?.phone ?? raw?.customer?.phoneNumber ?? raw?.customer?.Number ?? '';
  const agentPhone = raw?.agentPhone ?? raw?.agent?.number ?? raw?.agent?.phone ?? raw?.agent?.Contact_Number ?? '';

  // items: new shape is an array of { itemName, colors: [{ color, sets }] }
  const items =
    Array.isArray(raw?.items) && raw.items.length > 0
      ? raw.items
      : Array.isArray(raw?.rows)
        ? raw.rows
        : Array.isArray(raw?.itemsFlat)
          ? raw.itemsFlat
          : [];

  // compute a totalQty if the new grouped shape exists
  let totalQty = 0;
  if (Array.isArray(items)) {
    if (items.length > 0 && items[0].colors && Array.isArray(items[0].colors)) {
      for (const it of items) {
        for (const c of it.colors) {
          totalQty += Number(c.sets ?? 0);
        }
      }
    } else {
      for (const it of items) {
        totalQty += Number(it.quantity ?? it.qty ?? it.sets ?? 0);
      }
    }
  }

  return {
    id: String(id || ''),
    customerName: String(customerName || ''),
    customerPhone: String(customerPhone || ''),
    agentName: String(agentName || ''),
    agentPhone: String(agentPhone || ''),
    createdAt,
    items,
    totalQty,
    raw,
  };
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPills, setSearchPills] = useState<{ field: string; value: string }[]>([]);
  const [isCreateModalOpen, setICreateModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json();

      let rawList: any[] = [];
      if (Array.isArray(data)) rawList = data;
      else if (Array.isArray(data.rows)) rawList = data.rows;
      else if (Array.isArray(data.orders)) rawList = data.orders;
      else rawList = [];

      const normalized = rawList.map(normalizeOrderShape);
      setOrders(normalized);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      setFetchError('Failed to fetch orders. See console for details.');
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const removePill = (index: number) => {
    setSearchPills((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCardClick = (orderId: string) => {
    setSelectedOrderId(orderId);
    setIsDetailsModalOpen(true);
  };

  const handleDetailsClose = () => {
    setIsDetailsModalOpen(false);
    setSelectedOrderId(null);
  };

  const filteredOrders = useMemo(() => {
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
            return String(order.createdAt || '').toLowerCase().includes(v);
          case 'id':
            return (order.id || '').toLowerCase().includes(v);
          default:
            return ((order.customerName || '') + ' ' + (order.agentName || '')).toLowerCase().includes(v);
        }
      })
    );
  }, [orders, searchPills]);

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
              key={index}
              className="bg-gray-700 text-gray-300 rounded-full px-3 py-1 text-sm font-semibold mr-2 mb-2 flex items-center"
            >
              <span>{pill.field}: "{pill.value}"</span>
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
            // prepare flat items for ShareOrderIcon
            const itemsForShare: any[] = [];
            if (Array.isArray(order.items) && order.items.length > 0) {
              if (order.items[0] && Array.isArray(order.items[0].colors)) {
                for (const it of order.items) {
                  const itemName = it.itemName ?? it.Item ?? it.sku ?? it.label ?? '';
                  for (const c of it.colors || []) {
                    itemsForShare.push({
                      itemName: String(itemName),
                      color: String(c.color ?? c.colorName ?? ''),
                      quantity: Number(c.sets ?? c.set ?? c.qty ?? c.quantity ?? 0) || 0,
                    });
                  }
                }
              } else {
                for (const it of order.items) {
                  itemsForShare.push({
                    itemName: it.itemName ?? it.sku ?? it.label ?? '',
                    color: it.color ?? it.colorName ?? '',
                    quantity: Number(it.quantity ?? it.qty ?? it.sets ?? 0) || 0,
                  });
                }
              }
            }

            const orderForShare = {
              id: order.id,
              customer: { name: order.customerName || '', phone: order.customerPhone || '', email: '' },
              agent: { name: order.agentName || '', number: order.agentPhone || '', email: '' },
              items: itemsForShare,
              createdAt: order.createdAt,
              source: order.raw?.source ?? order.source ?? 'web',
            };

            return (
              <div
                key={order.id || Math.random()}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(order.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleCardClick(order.id);
                }}
                className="relative bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 ease-in-out p-6 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {/* share icon top-right (stopPropagation so card doesn't open) */}
                <div
                  className="absolute top-3 right-3 z-20"
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.stopPropagation()}
                  role="button"
                  tabIndex={0}
                >
                  <ShareOrderIcon order={orderForShare} phone={order.customerPhone} />
                </div>

                <div className="flex items-start">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white truncate">{order.customerName || '—'}</h2>
                    <p className="text-sm text-gray-400 truncate">{order.agentName || '—'}</p>
                  </div>
                  {/* sets moved to bottom-right badge */}
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
