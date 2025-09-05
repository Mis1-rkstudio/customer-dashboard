"use client";
import React, { JSX, useMemo, useState } from "react";

export type StatusHistoryItem = {
  status: string;
  changedBy?: string | null;
  changedAt?: string | null;
  reason?: string | null;
  meta?: string | null;
};

export type OrderShape = {
  id: string;
  createdAt?: string | null;
  customerName?: string | null;
  orderStatus?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  statusHistory?: StatusHistoryItem[] | null;
  totalQty?: number;
  items?: unknown;
  payload?: unknown;
};

type Props = {
  order: OrderShape;
  onRefresh?: () => void | Promise<void>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function formatDateMaybe(raw?: unknown): string {
  if (!raw) return "—";
  try {
    if (isObject(raw)) {
      const rec = raw as Record<string, unknown>;
      const seconds = rec["seconds"];
      if (typeof seconds === "number") {
        return new Date(seconds * 1000).toLocaleString();
      }
    }
    const d = new Date(String(raw));
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(raw);
  } catch {
    return String(raw);
  }
}

export default function OrderCard({ order, onRefresh }: Props): JSX.Element {
  const [openHistory, setOpenHistory] = useState(false);
  const [actioning, setActioning] = useState<boolean>(false);

  const statusRaw = String(order.orderStatus ?? "");
  const status = statusRaw.trim();
  const lc = status.toLowerCase();

  // badge classes: cancelled (red), confirmed (green), unconfirmed (yellow), fallback (slate)
  const badgeClass = useMemo(() => {
    if (lc === "cancelled" || lc === "canceled") return "bg-red-600 text-white";
    if (lc === "confirmed") return "bg-emerald-600 text-white";
    if (lc === "unconfirmed") return "bg-yellow-400 text-black";
    return "bg-slate-600 text-white";
  }, [lc]);

  const effectiveStatusLabel =
    status || (order.cancelledAt ? "Cancelled" : "Unconfirmed");

  async function doMarkStatus(newStatus: string) {
    if (!order.id) return;
    const proceed = window.confirm(
      newStatus.toLowerCase() === "cancelled"
        ? "Mark this order as Cancelled?"
        : `Mark this order as ${newStatus}?`
    );
    if (!proceed) return;

    setActioning(true);
    try {
      if (
        newStatus.toLowerCase() === "cancelled" ||
        newStatus.toLowerCase() === "canceled"
      ) {
        const qs = new URLSearchParams({ id: order.id, cancelledBy: "web" });
        const res = await fetch(`/api/orders?${qs.toString()}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          // parse JSON safely
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            body = {};
          }
          const message =
            isObject(body) &&
            typeof (body as Record<string, unknown>).message === "string"
              ? String((body as Record<string, unknown>).message)
              : `HTTP ${res.status}`;
          throw new Error(message);
        }
      } else {
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: order.id, orderStatus: newStatus }),
        });
        if (!res.ok) {
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            body = {};
          }
          const message =
            isObject(body) &&
            typeof (body as Record<string, unknown>).message === "string"
              ? String((body as Record<string, unknown>).message)
              : `HTTP ${res.status}`;
          throw new Error(message);
        }
      }

      // allow refresh to be async
      await onRefresh?.();
    } catch (e) {
      alert(
        "Failed to update status: " +
          (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setActioning(false);
    }
  }

  return (
    <div className="bg-slate-800 p-4 rounded-md shadow hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0 pr-3">
          <div className="text-lg font-semibold truncate">
            {order.customerName ?? "—"}
          </div>
          <div className="text-sm text-slate-400 truncate">
            Order ID: <span className="font-mono">{order.id}</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span
            className={`px-2 py-1 rounded text-sm font-semibold ${badgeClass}`}
          >
            {effectiveStatusLabel}
          </span>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenHistory(true);
            }}
            title="Status history"
            className="px-2 py-1 rounded border border-slate-600 text-sm hover:bg-slate-700"
          >
            History
          </button>

          {lc === "cancelled" || lc === "canceled" ? (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await doMarkStatus("Unconfirmed");
              }}
              title="Restore order"
              className="p-2 rounded hover:bg-slate-700"
            >
              {actioning ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-green-400"
                >
                  <path
                    d="M12 2v4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19.4 6.6A9 9 0 1 0 6.6 19.4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ) : (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await doMarkStatus("Cancelled");
              }}
              title="Cancel order"
              className="p-2 rounded hover:bg-slate-700"
            >
              {actioning ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-red-400"
                >
                  <path
                    d="M3 6h18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 text-sm text-slate-300">
        <div>
          <span className="font-semibold">Date:</span>{" "}
          {formatDateMaybe(order.createdAt)}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-slate-300">
          Items: {order.totalQty ?? 0} sets
        </div>
      </div>

      {/* History modal */}
      {openHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl bg-slate-900 rounded shadow-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                Status History — {order.id}
              </h3>
              <button
                onClick={() => setOpenHistory(false)}
                className="px-2 py-1 rounded bg-slate-700"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-auto">
              <div className="p-3 bg-slate-800 rounded">
                <div className="text-sm text-slate-400">Effective status</div>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{effectiveStatusLabel}</div>
                  <div className="text-xs text-slate-400">
                    {order.cancelledAt
                      ? formatDateMaybe(order.cancelledAt)
                      : ""}
                  </div>
                </div>
                {order.cancelledBy && (
                  <div className="text-xs text-slate-400">
                    By: {order.cancelledBy}
                  </div>
                )}
              </div>

              {(order.statusHistory ?? []).length > 0 ? (
                (order.statusHistory ?? []).map((h, idx) => (
                  <div key={idx} className="p-3 bg-slate-800 rounded">
                    <div className="flex items-baseline justify-between">
                      <div className="font-medium">{h.status}</div>
                      <div className="text-xs text-slate-400">
                        {h.changedAt ? formatDateMaybe(h.changedAt) : ""}
                      </div>
                    </div>
                    {h.changedBy && (
                      <div className="text-xs text-slate-400">
                        By: {h.changedBy}
                      </div>
                    )}
                    {h.reason && (
                      <div className="text-xs text-slate-400">
                        Reason: {h.reason}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-400">
                  No status updates yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
