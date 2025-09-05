"use client";
import React, { useEffect, useState } from "react";
import OrderCard, { OrderShape } from "./OrderCard";

export default function OrdersList() {
  const [orders, setOrders] = useState<OrderShape[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchOrders() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const data = (await res.json()) as OrderShape[];
      setOrders(data || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded"
          onClick={fetchOrders}
        >
          Refresh
        </button>
      </div>

      {error && <div className="text-red-500">{error}</div>}
      {loading && <div>Loading…</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {orders.map((o) => (
          <OrderCard key={String(o.id)} order={o} onRefresh={fetchOrders} />
        ))}
      </div>
    </div>
  );
}
