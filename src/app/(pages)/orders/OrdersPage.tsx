"use client";

import React, { JSX, useCallback, useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import Modal from "../../../components/Modal";
import OrderDetails from "../../../components/OrderDetails";
import ShareOrderIcon, {
  OrderShape as ShareOrderShape,
} from "@/components/ShareOrder";
import OrderForm from "@/components/OrderForm";
import OrderCard, {
  OrderShape as CardOrderShape,
} from "@/components/OrderCard";
import { useUser } from "@clerk/nextjs";
import { useQueryState } from "nuqs"; // nuqs hook to persist query params
import { useUserStore } from "@/store/useUserStore";

/* ---------------------- small helpers ---------------------- */

function isSecondsObject(v: unknown): v is { seconds: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    "seconds" in v &&
    typeof (v as Record<string, unknown>).seconds === "number"
  );
}

function pluckString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const val = rec[k];
    if (val !== undefined && val !== null) return String(val);
  }
  return undefined;
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/* ---------------------- normalize ---------------------- */

type NormalizedOrder = {
  id: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  agentName: string;
  agentPhone?: string;
  createdAt?: unknown;
  items?: unknown[];
  totalQty: number;
  raw?: unknown;
  orderStatus?: string;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  statusHistory?: Array<{
    status: string;
    changedBy?: string | null;
    changedAt?: unknown;
    reason?: string | null;
    meta?: unknown;
  }>;
};

function normalizeOrderShape(raw: unknown): NormalizedOrder {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const id = String(r.id ?? r.orderId ?? r.OrderID ?? r.order_id ?? r.ID ?? "");

  const customerField = r.customer;
  const customerName = String(
    r.customerName ??
      (customerField && typeof customerField === "object"
        ? (customerField as Record<string, unknown>).name
        : undefined) ??
      (customerField && typeof customerField === "string"
        ? (customerField as string)
        : undefined) ??
      (r.customer as Record<string, unknown>)?.label ??
      (r.customer as Record<string, unknown>)?.Company_Name ??
      ""
  );

  const agentField = r.agent;
  const agentName = String(
    r.agentName ??
      (agentField && typeof agentField === "object"
        ? (agentField as Record<string, unknown>).name
        : undefined) ??
      (agentField && typeof agentField === "string"
        ? (agentField as string)
        : undefined) ??
      (r.agent as Record<string, unknown>)?.label ??
      (r.agent as Record<string, unknown>)?.Company_Name ??
      ""
  );

  const createdAt =
    r.createdAt ??
    r.created_at ??
    r.placedAt ??
    r.Placed ??
    r.createdDate ??
    "";

  const customerPhone = String(
    r.customerPhone ??
      (customerField && typeof customerField === "object"
        ? ((customerField as Record<string, unknown>).phone as unknown)
        : undefined) ??
      (customerField && typeof customerField === "object"
        ? ((customerField as Record<string, unknown>).phoneNumber as unknown)
        : undefined) ??
      (customerField && typeof customerField === "object"
        ? ((customerField as Record<string, unknown>).Number as unknown)
        : undefined) ??
      ""
  );

  const agentPhone = String(
    r.agentPhone ??
      (agentField && typeof agentField === "object"
        ? ((agentField as Record<string, unknown>).number as unknown)
        : undefined) ??
      (agentField && typeof agentField === "object"
        ? ((agentField as Record<string, unknown>).phone as unknown)
        : undefined) ??
      (agentField && typeof agentField === "object"
        ? ((agentField as Record<string, unknown>).Contact_Number as unknown)
        : undefined) ??
      ""
  );

  let customerEmail = "";
  try {
    if (isObject(customerField)) {
      const cf = customerField as Record<string, unknown>;
      customerEmail =
        String(
          cf.email ??
            cf.Email ??
            cf.emailAddress ??
            cf.EmailAddress ??
            cf.contactEmail ??
            ""
        ).trim() || "";
    }
    if (!customerEmail) {
      customerEmail = String(
        r.customerEmail ??
          r.customer_email ??
          (isObject(r.customer)
            ? (r.customer as Record<string, unknown>).email
            : undefined) ??
          r.email ??
          r.Email ??
          ""
      ).trim();
    }
  } catch {
    customerEmail = "";
  }

  const itemsCandidate = (r.items ?? r.rows ?? r.itemsFlat) as unknown;
  const items = Array.isArray(itemsCandidate)
    ? (itemsCandidate as unknown[])
    : [];

  let totalQty = 0;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    if (
      first &&
      typeof first === "object" &&
      Array.isArray((first as Record<string, unknown>).colors)
    ) {
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const colors = (it as Record<string, unknown>).colors as unknown[];
        if (!Array.isArray(colors)) continue;
        for (const c of colors) {
          if (!c || typeof c !== "object") continue;
          const count =
            Number(
              (c as Record<string, unknown>).sets ??
                (c as Record<string, unknown>).set ??
                0
            ) || 0;
          totalQty += count;
        }
      }
    } else {
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const rec = it as Record<string, unknown>;
        totalQty += Number(rec.quantity ?? rec.qty ?? rec.sets ?? 0) || 0;
      }
    }
  }

  const statusCandidate = (
    pluckString(r, "orderStatus", "order_status", "status") ?? ""
  ).trim();

  const cancelledByRaw = (r as Record<string, unknown>).cancelledBy;
  const cancelledBy: string | null | undefined =
    cancelledByRaw === undefined
      ? undefined
      : cancelledByRaw === null
      ? null
      : typeof cancelledByRaw === "string"
      ? cancelledByRaw
      : String(cancelledByRaw);

  const cancelledAtRaw = (r as Record<string, unknown>).cancelledAt;
  let cancelledAt: string | null | undefined = undefined;
  if (cancelledAtRaw === undefined) cancelledAt = undefined;
  else if (cancelledAtRaw === null) cancelledAt = null;
  else if (isSecondsObject(cancelledAtRaw)) {
    cancelledAt = new Date(cancelledAtRaw.seconds * 1000).toISOString();
  } else {
    cancelledAt = String(cancelledAtRaw);
  }

  const statusHistoryRaw = (r as Record<string, unknown>).statusHistory;
  let statusHistory: NormalizedOrder["statusHistory"] | undefined = undefined;

  if (Array.isArray(statusHistoryRaw)) {
    statusHistory = (statusHistoryRaw as unknown[])
      .map((s) => {
        if (!isObject(s)) return null;
        return {
          status: safeString((s as Record<string, unknown>)["status"]) || "",
          changedBy:
            (s as Record<string, unknown>)["changedBy"] === undefined
              ? undefined
              : (s as Record<string, unknown>)["changedBy"] === null
              ? null
              : String((s as Record<string, unknown>)["changedBy"]),
          changedAt: (s as Record<string, unknown>)["changedAt"] ?? undefined,
          reason:
            (s as Record<string, unknown>)["reason"] === undefined
              ? undefined
              : (s as Record<string, unknown>)["reason"] === null
              ? null
              : String((s as Record<string, unknown>)["reason"]),
          meta: (s as Record<string, unknown>)["meta"] ?? null,
        };
      })
      .filter(Boolean) as NormalizedOrder["statusHistory"];
  }

  return {
    id,
    customerName,
    customerEmail: customerEmail || undefined,
    customerPhone: customerPhone || undefined,
    agentName,
    agentPhone: agentPhone || undefined,
    createdAt,
    items,
    totalQty,
    raw: r,
    orderStatus: statusCandidate || undefined,
    cancelledBy,
    cancelledAt,
    statusHistory,
  };
}

/* ---------------------- page component ---------------------- */

export default function OrdersPage(): JSX.Element {
  const { user } = useUser();

  type ClerkUserLite = {
    primaryEmailAddress?: { emailAddress?: string };
    emailAddresses?: Array<{ emailAddress?: string }>;
    publicMetadata?: Record<string, unknown>;
    primaryPhoneNumber?: { phoneNumber?: string };
    phoneNumbers?: Array<{ phoneNumber?: string }>;
    id?: string;
    email?: string;
  };

  const typedUser = user as unknown as ClerkUserLite | undefined;

  const primaryEmailAddress =
    typedUser?.primaryEmailAddress?.emailAddress ??
    typedUser?.emailAddresses?.[0]?.emailAddress ??
    typedUser?.email ??
    undefined;

  // read active user selection from global store (CURRENT change)
  const currentUser = useUserStore((s) => s.currentUser); // active selection (name or email)
  const currentUserId = useUserStore((s) => s.currentUserId);
  const currentUserEmail = useUserStore((s) => s.currentUserEmail);

  const isAdmin = Boolean(
    typedUser?.publicMetadata &&
      String(typedUser.publicMetadata.role ?? "").toLowerCase() === "admin"
  );

  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Local input state (search textbox)
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [qParam, setQParam] = useQueryState("q") as [
    string | null,
    (v: string | null) => void
  ];
  const [pillsParam, setPillsParam] = useQueryState("pills") as [
    string | null,
    (v: string | null) => void
  ];
  const [tabParam, setTabParam] = useQueryState("tab") as [
    string | null,
    (v: string | null) => void
  ];

  const [searchPills, setSearchPills] = useState<
    Array<{ field: string; value: string }>
  >([]);

  const [selectedTab, setSelectedTab] = useState<
    "all" | "active" | "cancelled"
  >(
    ((): "all" | "active" | "cancelled" => {
      const v = String(tabParam ?? "all").toLowerCase();
      if (v === "active" || v === "cancelled") return v;
      return "all";
    })()
  );

  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState<boolean>(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string>("");

  const [isCreateModalOpen, setICreateModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (qParam !== null && typeof qParam === "string") {
      setSearchQuery(qParam);
    } else {
      setSearchQuery("");
    }
  }, []);

  useEffect(() => {
    if (pillsParam && typeof pillsParam === "string") {
      try {
        const parsed = JSON.parse(pillsParam);
        if (Array.isArray(parsed)) {
          const arr = parsed
            .filter(
              (x) =>
                x &&
                typeof x === "object" &&
                typeof (x as Record<string, unknown>).field === "string" &&
                typeof (x as Record<string, unknown>).value === "string"
            )
            .map((x) => ({
              field: String((x as Record<string, unknown>).field),
              value: String((x as Record<string, unknown>).value),
            }));
          setSearchPills(arr);
          return;
        }
      } catch {
        // ignore invalid JSON
      }
    }
    setSearchPills([]);
  }, []);

  useEffect(() => {
    if (tabParam && typeof tabParam === "string") {
      const v = tabParam.toLowerCase();
      if (v === "active" || v === "cancelled")
        setSelectedTab(v as "active" | "cancelled");
      else setSelectedTab("all");
    }
  }, []);

  useEffect(() => {
    if (!searchPills || searchPills.length === 0) {
      setPillsParam(null);
      return;
    }
    try {
      setPillsParam(JSON.stringify(searchPills));
    } catch {
      // fallback: don't update
    }
  }, [searchPills, setPillsParam]);

  useEffect(() => {
    setTabParam(selectedTab);
  }, [selectedTab, setTabParam]);

  useEffect(() => {
    if (!searchQuery) {
      setQParam(null);
    } else {
      setQParam(searchQuery);
    }
  }, [searchQuery, setQParam]);

  /* ---------------------- fetchOrders and filter logic (uses store current user) ---------------------- */

  const fetchOrders = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setFetchError("");
    try {
      // logged-in user's primary email (used as order_placed_by)
      const loggedInEmail = String(primaryEmailAddress ?? "")
        .trim()
        .toLowerCase();

      if (!loggedInEmail) {
        setOrders([]);
        setIsLoading(false);
        return;
      }

      const res = await fetch("/api/orders");
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);

      let rawList: unknown[] = [];
      if (Array.isArray(data)) rawList = data;
      else if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as Record<string, unknown>).rows)
      )
        rawList = (data as Record<string, unknown>).rows as unknown[];
      else if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as Record<string, unknown>).orders)
      )
        rawList = (data as Record<string, unknown>).orders as unknown[];
      else if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as Record<string, unknown>).data)
      )
        rawList = (data as Record<string, unknown>).data as unknown[];
      else rawList = [];

      const normalized = rawList.map((rRaw) => {
        const rec =
          rRaw && typeof rRaw === "object"
            ? (rRaw as Record<string, unknown>)
            : {};
        const baseFrom = isObject(rec.payload)
          ? (rec.payload as Record<string, unknown>)
          : rec;
        const base = normalizeOrderShape(baseFrom);

        if (!base.id && rec && (rec as Record<string, unknown>).id)
          base.id = String((rec as Record<string, unknown>).id);

        if (rec && (rec as Record<string, unknown>).orderStatus !== undefined)
          base.orderStatus = String(
            (rec as Record<string, unknown>).orderStatus
          );

        if (rec && (rec as Record<string, unknown>).cancelledBy !== undefined)
          base.cancelledBy =
            (rec as Record<string, unknown>).cancelledBy === null
              ? null
              : String((rec as Record<string, unknown>).cancelledBy);

        if (
          rec &&
          (rec as Record<string, unknown>).cancelledAt !== undefined &&
          (rec as Record<string, unknown>).cancelledAt !== null
        ) {
          const ca = (rec as Record<string, unknown>).cancelledAt;
          if (isObject(ca) && "value" in ca)
            base.cancelledAt = String((ca as Record<string, unknown>).value);
          else base.cancelledAt = String(ca);
        }

        if (Array.isArray((rec as Record<string, unknown>).statusHistory)) {
          base.statusHistory = (
            (rec as Record<string, unknown>).statusHistory as unknown[]
          )
            .map((s) => {
              if (!isObject(s)) return null;
              return {
                status: safeString((s as Record<string, unknown>)["status"]),
                changedBy:
                  (s as Record<string, unknown>)["changedBy"] === undefined
                    ? undefined
                    : (s as Record<string, unknown>)["changedBy"] === null
                    ? null
                    : String((s as Record<string, unknown>)["changedBy"]),
                changedAt: (s as Record<string, unknown>)["changedAt"] ?? null,
                reason:
                  (s as Record<string, unknown>)["reason"] === undefined
                    ? undefined
                    : (s as Record<string, unknown>)["reason"] === null
                    ? null
                    : String((s as Record<string, unknown>)["reason"]),
                meta: (s as Record<string, unknown>)["meta"] ?? null,
              };
            })
            .filter(Boolean) as NormalizedOrder["statusHistory"];
        }

        base.raw = rec;
        return base;
      });

      const extractOrderPlacedBy = (raw?: unknown): string => {
        if (!raw || typeof raw !== "object") return "";
        const rec = raw as Record<string, unknown>;

        const candidates: unknown[] = [
          rec.order_placed_by,
          rec.orderPlacedBy,
          rec.orderPlaced_by,
          rec.order_placedBy,
          rec.orderPlaced_By,
          rec.orderPlacedBY,
          rec.orderPlacedByEmail,
          rec.order_placed_by_email,
          rec.orderPlacedBy_Email,
          (rec.payload &&
            (rec.payload as Record<string, unknown>).order_placed_by) ??
            undefined,
          (rec.payload &&
            (rec.payload as Record<string, unknown>).orderPlacedBy) ??
            undefined,
        ];

        for (const c of candidates) {
          if (c !== undefined && c !== null) {
            const s = String(c).trim();
            if (s) return s.toLowerCase();
          }
        }

        if (typeof rec.payload === "string" && rec.payload) {
          try {
            const p = JSON.parse(rec.payload);
            if (p && typeof p === "object") {
              const pv =
                (p as Record<string, unknown>).order_placed_by ??
                (p as Record<string, unknown>).orderPlacedBy;
              if (pv) return String(pv).trim().toLowerCase();
            }
          } catch {
            // ignore
          }
        }

        return "";
      };

      // Primary filter: orders placed by the currently-logged-in user
      const placedByNeedle = loggedInEmail;

      // Active selection details from store
      const activeSelectionRaw = currentUser ?? "";
      const activeSelection = String(activeSelectionRaw).trim().toLowerCase(); // customer name OR email-like label
      const activeSelectionEmail = String(currentUserEmail ?? "").trim().toLowerCase();
      const activeSelectionId = String(currentUserId ?? "");

      // First, restrict to orders placed by the logged-in user (order_placed_by)
      let filtered = normalized.filter((o) => {
        const placedBy = extractOrderPlacedBy(o.raw ?? o) || "";
        return placedBy === placedByNeedle;
      });

      // Decide whether the active selection refers to "self" (no extra filtering)
      // boolean check
      const selectedIsSelf =
        activeSelectionId.startsWith("me:") ||
        (activeSelectionEmail.length > 0 && activeSelectionEmail === placedByNeedle) ||
        (activeSelection.length > 0 && activeSelection === placedByNeedle);

      // If the user selected a customer (not "self"), further filter by customer name (case-insensitive)
      if (!selectedIsSelf && activeSelection) {
        const needleName = activeSelection;
        filtered = filtered.filter((o) => {
          const cName = String(o.customerName ?? "").toLowerCase();
          return cName.includes(needleName);
        });
      }

      setOrders(filtered);
    } catch (err: unknown) {
      console.error("Failed to fetch orders:", err);
      setFetchError("Failed to fetch orders. See console for details.");
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, [primaryEmailAddress, currentUser, currentUserId, currentUserEmail]);


  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  /* ---------------------- search UI handlers ---------------------- */

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void =>
    setSearchQuery(e.target.value);

  const handleSearchKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (e.key !== "Enter") return;
    const txt = searchQuery.trim();
    if (!txt) return;
    const parts = txt.split(":");
    if (parts.length === 2) {
      const field = parts[0].trim().toLowerCase();
      const value = parts[1].trim();
      if (value) {
        setSearchPills((prev) => [...prev, { field, value }]);
        setSearchQuery("");
        return;
      }
    } else {
      setSearchPills((prev) => [...prev, { field: "customer", value: txt }]);
      setSearchQuery("");
      return;
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
        const v = String(value || "").toLowerCase();
        if (!v) return true;
        switch (field) {
          case "customer":
            return (order.customerName || "").toLowerCase().includes(v);
          case "agent":
            return (order.agentName || "").toLowerCase().includes(v);
          case "date":
            return String(order.createdAt ?? "")
              .toLowerCase()
              .includes(v);
          case "id":
            return (order.id || "").toLowerCase().includes(v);
          default:
            return ((order.customerName || "") + " " + (order.agentName || ""))
              .toLowerCase()
              .includes(v);
        }
      })
    );
  }, [orders, searchPills]);

  const activeOrders = useMemo(
    () =>
      filteredBySearch.filter((o) => {
        const s = String(o.orderStatus ?? "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      }),
    [filteredBySearch]
  );

  const cancelledOrders = useMemo(
    () =>
      filteredBySearch.filter((o) => {
        const s = String(o.orderStatus ?? "").toLowerCase();
        return s === "cancelled" || s === "canceled";
      }),
    [filteredBySearch]
  );

  const viewOrders = useMemo(() => {
    if (selectedTab === "all") return activeOrders;
    if (selectedTab === "active") return activeOrders;
    return cancelledOrders;
  }, [selectedTab, activeOrders, cancelledOrders]);

  function computeTotalQtyFromItems(items: unknown): number {
    if (!Array.isArray(items) || items.length === 0) return 0;

    const first = items[0];
    if (
      first &&
      typeof first === "object" &&
      Array.isArray((first as Record<string, unknown>).colors)
    ) {
      let sum = 0;
      for (const it of items as unknown[]) {
        if (!it || typeof it !== "object") continue;
        const colors = Array.isArray((it as Record<string, unknown>).colors)
          ? ((it as Record<string, unknown>).colors as unknown[])
          : [];
        for (const c of colors) {
          if (!c) continue;
          if (typeof c === "object") {
            sum +=
              Number(
                (c as Record<string, unknown>).sets ??
                  (c as Record<string, unknown>).set ??
                  (c as Record<string, unknown>).qty ??
                  (c as Record<string, unknown>).quantity ??
                  0
              ) || 0;
          }
        }
      }
      return sum;
    }

    return (items as unknown[]).reduce((acc: number, it) => {
      if (!it || typeof it !== "object") return acc;
      const rec = it as Record<string, unknown>;
      return (
        acc + (Number(rec.quantity ?? rec.qty ?? rec.sets ?? rec.set ?? 0) || 0)
      );
    }, 0);
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="flex justify-between items-center my-6">
        <div>
          <h1 className="text-3xl font-bold">Orders</h1>
          <p className="text-sm text-gray-400 mt-1">Manage and view orders</p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setICreateModalOpen(true)}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              type="button"
            >
              Create New Order
            </button>
          </div>
        )}
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={
            'Search: use "customer: name", "agent: name", "id: <id>" or press Enter for quick customer search'
          }
          value={searchQuery}
          onChange={(e) =>
            handleSearchChange(e as React.ChangeEvent<HTMLInputElement>)
          }
          onKeyDown={(e) =>
            handleSearchKeyDown(e as React.KeyboardEvent<HTMLInputElement>)
          }
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

      <div className="flex gap-3 items-center mb-4">
        <button
          className={`px-3 py-1 rounded ${
            selectedTab === "all"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300"
          }`}
          onClick={() => setSelectedTab("all")}
        >
          All ({activeOrders.length})
        </button>
        <button
          className={`px-3 py-1 rounded ${
            selectedTab === "active"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300"
          }`}
          onClick={() => setSelectedTab("active")}
        >
          Active ({activeOrders.length})
        </button>
        <button
          className={`px-3 py-1 rounded ${
            selectedTab === "cancelled"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300"
          }`}
          onClick={() => setSelectedTab("cancelled")}
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
                const cardOrder: CardOrderShape = {
                  id: order.id,
                  createdAt: (() => {
                    const v = order.createdAt;
                    if (v === null || v === undefined) return undefined;
                    if (typeof v === "string" || typeof v === "number")
                      return v as string;
                    if (v instanceof Date) return v.toISOString();
                    if (isSecondsObject(v))
                      return {
                        seconds: Number(v.seconds),
                      } as unknown as string;
                    try {
                      const parsed = new Date(String(v));
                      if (!Number.isNaN(parsed.getTime()))
                        return parsed.toISOString();
                    } catch {}
                    return undefined;
                  })(),
                  customerName: order.customerName,
                  orderStatus: order.orderStatus ?? undefined,
                  cancelledBy: order.cancelledBy ?? undefined,
                  cancelledAt: order.cancelledAt ?? undefined,
                  statusHistory: (order.statusHistory ??
                    []) as unknown as CardOrderShape["statusHistory"],
                  totalQty:
                    Number(
                      order.totalQty ?? computeTotalQtyFromItems(order.items)
                    ) || 0,
                  items: order.items,
                  payload: order.raw,
                };

                const shareOrder: ShareOrderShape = {
                  id: order.id,
                  customer: {
                    name: order.customerName ?? undefined,
                    phone: order.customerPhone ?? undefined,
                    email: order.customerEmail ?? undefined,
                  },
                  agent: {
                    name: order.agentName ?? undefined,
                    number: order.agentPhone ?? undefined,
                    email: undefined,
                  },
                  items: Array.isArray(order.items)
                    ? (order.items as unknown[]).map((it) => {
                        if (!it || typeof it !== "object") return {};
                        const rec = it as Record<string, unknown>;
                        return {
                          itemName:
                            safeString(
                              rec.itemName ??
                                rec.Item ??
                                rec.label ??
                                rec.name ??
                                rec.sku ??
                                ""
                            ) || undefined,
                          color:
                            safeString(rec.color ?? rec.colorName ?? "") ||
                            undefined,
                          quantity:
                            Number(
                              rec.quantity ??
                                rec.qty ??
                                rec.sets ??
                                rec.set ??
                                0
                            ) || 0,
                        };
                      })
                    : [],
                  createdAt: order.createdAt ?? undefined,
                  source: undefined,
                };

                return (
                  <div
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(order.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        handleCardClick(order.id);
                    }}
                    className="cursor-pointer relative"
                  >
                    <OrderCard order={cardOrder} onRefresh={fetchOrders} />

                    <div
                      className="absolute bottom-3 right-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ShareOrderIcon
                        order={shareOrder}
                        phone={
                          order.agentPhone ?? order.customerPhone ?? undefined
                        }
                        className="!bg-gray-800/90"
                        orderUrl={
                          typeof window !== "undefined"
                            ? `${window.location.origin}/orders/${
                                order.id ?? ""
                              }`
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal isOpen={isDetailsModalOpen} onClose={handleDetailsClose}>
        {selectedOrderId ? (
          <OrderDetails orderId={selectedOrderId} />
        ) : (
          <div className="p-6">Loading...</div>
        )}
      </Modal>

      {isAdmin && (
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => setICreateModalOpen(false)}
        >
          <OrderForm
            closeModal={() => setICreateModalOpen(false)}
            refreshOrders={fetchOrders}
          />
        </Modal>
      )}
    </div>
  );
}
