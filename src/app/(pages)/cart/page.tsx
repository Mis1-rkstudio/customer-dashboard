// app/(pages)/cart/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { Trash2, Plus, Minus } from "lucide-react";
import { useCart, CartItem } from "@/context/CartContext";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  ShareOrderButton,
  OrderShape as ShareOrderShape,
} from "@/components/ShareOrder";

/* ---------------------------
   Types
   --------------------------- */

type UpdatePayload = Partial<{
  set: number;
  quantity: number;
  selectedColors: string[];
  selectedColor: string;
}>;

type CartContextType = {
  cartItems: CartItem[];
  removeFromCart: (id: string) => void;
  updateItem: (id: string, payload: UpdatePayload) => void;
  getTotalSets?: () => number;
  clearCart?: () => void;
};

/* ---------------------------
   Small safe helpers
   --------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** type guard for drive-like image values */
function googleDriveImage(u: unknown): u is string {
  return typeof u === "string" && u.length > 0;
}

function getGoogleDriveImageSrc(googleDriveUrl: string): string {
  const m = googleDriveUrl.match(/\/d\/([^\/]+)/);
  if (m?.[1]) return `https://drive.google.com/thumbnail?id=${m[1]}`;
  // also check for id= query param
  const q = googleDriveUrl.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (q?.[1]) return `https://drive.google.com/thumbnail?id=${q[1]}`;
  return googleDriveUrl;
}

function getStringField(obj: unknown, key: string): string | undefined {
  if (!isObject(obj)) return undefined;
  const v = obj[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function getNumberField(obj: unknown, key: string): number {
  if (!isObject(obj)) return 0;
  return safeNumber(obj[key]);
}

function getArrayField(obj: unknown, key: string): unknown[] | undefined {
  if (!isObject(obj)) return undefined;
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}

/* ---------------------------
   Color / selected helpers
   --------------------------- */

/** Safely get available colours from a cart item */
function getAvailableColors(item: CartItem): string[] {
  const topArr = getArrayField(item as unknown, "colors");
  if (topArr && topArr.length > 0) {
    return topArr.map((c) => String(c ?? "").trim()).filter(Boolean);
  }
  if (isObject((item as unknown as Record<string, unknown>).raw)) {
    const raw = (item as unknown as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    const ac =
      raw["available_colors"] ??
      raw["availableColors"] ??
      raw["colors"] ??
      raw["Colors"];
    if (Array.isArray(ac))
      return ac.map((c) => String(c ?? "").trim()).filter(Boolean);
  }
  return [];
}

/** Safely get selected colors from cart item (legacy support) */
function getSelectedColors(item: CartItem): string[] {
  const topArr = getArrayField(item as unknown, "selectedColors");
  if (topArr) return topArr.map((c) => String(c ?? "").trim()).filter(Boolean);

  if (isObject((item as unknown as Record<string, unknown>).raw)) {
    const raw = (item as unknown as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    const v = raw["selectedColor"] ?? raw["selected_colors"];
    if (typeof v === "string" && v.trim()) return [v.trim()];
    if (Array.isArray(v))
      return v.map((c) => String(c ?? "").trim()).filter(Boolean);
  }
  return [];
}

/* ---------------------------
   Main component
   --------------------------- */

export default function CartPage(): React.ReactElement {
  const { cartItems, removeFromCart, updateItem, getTotalSets, clearCart } =
    useCart() as CartContextType;
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  const [masterQty, setMasterQty] = useState<number>(0);
  const [applying, setApplying] = useState<boolean>(false);
  const [selectAllColors, setSelectAllColors] = useState<boolean>(false);
  const [placing, setPlacing] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [placedOrderForShare, setPlacedOrderForShare] =
    useState<ShareOrderShape | null>(null);

  const itemCount: number = Array.isArray(cartItems) ? cartItems.length : 0;
  const totalSets: number =
    typeof getTotalSets === "function"
      ? getTotalSets()
      : Array.isArray(cartItems)
      ? cartItems.reduce((s, it) => {
          return (
            s +
            safeNumber(
              (it as unknown as Record<string, unknown>).set ??
                (it as unknown as Record<string, unknown>).quantity ??
                0
            )
          );
        }, 0)
      : 0;

  /* ---- helpers that respect colors when counting pieces ---- */

  const inc = (it: CartItem): void => {
    const cur = safeNumber(
      (it as unknown as Record<string, unknown>).set ??
        (it as unknown as Record<string, unknown>).quantity ??
        0
    );
    const selectedColors =
      Array.isArray(
        (it as unknown as Record<string, unknown>).selectedColors
      ) &&
      ((it as unknown as Record<string, unknown>).selectedColors as unknown[])
        .length > 0
        ? ((it as unknown as Record<string, unknown>)
            .selectedColors as string[])
        : getSelectedColors(it);

    const colorsCount = Math.max(1, selectedColors.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");
    const totalAfter = (cur + 1) * colorsCount;
    if (available && totalAfter > available) {
      alert(
        `Only ${available} pieces available (requested ${totalAfter}). Reduce sets or colours.`
      );
      return;
    }
    updateItem(it.id, { set: cur + 1 });
  };

  const dec = (it: CartItem): void => {
    const cur = safeNumber(
      (it as unknown as Record<string, unknown>).set ??
        (it as unknown as Record<string, unknown>).quantity ??
        0
    );
    updateItem(it.id, { set: Math.max(0, cur - 1) });
  };

  const onSetChange = (it: CartItem, v: number | string): void => {
    const n = Math.max(0, Number(v) || 0);
    const selectedColors =
      Array.isArray(
        (it as unknown as Record<string, unknown>).selectedColors
      ) &&
      ((it as unknown as Record<string, unknown>).selectedColors as unknown[])
        .length > 0
        ? ((it as unknown as Record<string, unknown>)
            .selectedColors as string[])
        : getSelectedColors(it);

    const colorsCount = Math.max(1, selectedColors.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");
    const totalAfter = n * colorsCount;
    if (available && totalAfter > available) {
      alert(`Only ${available} pieces available (requested ${totalAfter}).`);
      const maxSets = Math.floor(available / colorsCount);
      updateItem(it.id, { set: Math.max(0, maxSets) });
      return;
    }
    updateItem(it.id, { set: n });
  };

  const onColorToggle = (it: CartItem, color: string): void => {
    const prev = Array.isArray(
      (it as unknown as Record<string, unknown>).selectedColors
    )
      ? [
          ...((it as unknown as Record<string, unknown>)
            .selectedColors as string[]),
        ]
      : getSelectedColors(it);

    const idx = prev.findIndex(
      (c) => String(c).toLowerCase() === String(color).toLowerCase()
    );
    if (idx >= 0) prev.splice(idx, 1);
    else prev.push(color);

    const sets = safeNumber(
      (it as unknown as Record<string, unknown>).set ??
        (it as unknown as Record<string, unknown>).quantity ??
        0
    );
    const colorsCount = Math.max(1, prev.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");
    if (available && sets * colorsCount > available) {
      const maxSets = Math.floor(available / colorsCount);
      updateItem(it.id, { selectedColors: prev, set: Math.max(0, maxSets) });
    } else {
      updateItem(it.id, { selectedColors: prev });
    }
  };

  const applyMasterToAll = async (): Promise<void> => {
    const n = Number(masterQty);
    if (Number.isNaN(n) || n < 0) return;
    setApplying(true);
    try {
      for (const it of cartItems) {
        const colorsCount = Math.max(
          1,
          Array.isArray(
            (it as unknown as Record<string, unknown>).selectedColors
          ) &&
            (
              (it as unknown as Record<string, unknown>)
                .selectedColors as unknown[]
            ).length > 0
            ? (
                (it as unknown as Record<string, unknown>)
                  .selectedColors as unknown[]
              ).length
            : getAvailableColors(it).length || 1
        );
        const avail =
          getNumberField(it, "closingStock") +
          getNumberField(it, "productionQty");
        if (avail && n * colorsCount > avail) {
          const maxSets = Math.floor(avail / colorsCount);
          updateItem(it.id, { set: Math.max(0, maxSets) });
        } else {
          updateItem(it.id, { set: n });
        }
      }
    } finally {
      setApplying(false);
    }
  };

  const toggleSelectAllColors = (value: boolean): void => {
    setSelectAllColors(value);
    for (const it of cartItems) {
      const colours = getAvailableColors(it);
      if (value) {
        const dedup = Array.from(
          new Set(colours.map((c) => String(c ?? "").trim()).filter(Boolean))
        );
        updateItem(it.id, { selectedColors: dedup });
      } else {
        updateItem(it.id, { selectedColors: [] });
      }
    }
  };

  /* ---------------------------
     Build order & place
     --------------------------- */

  function buildOrderShapeFromResponse(
    orderId: string | undefined,
    customerPayload: Record<string, unknown> | null,
    itemsPayload: Record<string, unknown>[]
  ): ShareOrderShape {
    const itemsForShare = (itemsPayload || []).map((r) => {
      const qty = safeNumber(
        (r as Record<string, unknown>)["qty"] ??
          (r as Record<string, unknown>)["quantity"] ??
          (r as Record<string, unknown>)["sets"] ??
          0
      );
      const colorRaw = (r as Record<string, unknown>)["color"];
      const color = typeof colorRaw === "string" ? colorRaw : "";
      const itemName = String(
        (r as Record<string, unknown>)["itemName"] ??
          (r as Record<string, unknown>)["sku"] ??
          (r as Record<string, unknown>)["label"] ??
          ""
      );
      return { itemName, color, quantity: qty };
    });

    // build customer object always as an object (ShareOrder expects no `null` customer)
    const customer = {
      name:
        (customerPayload &&
          String(customerPayload["label"] ?? customerPayload["name"] ?? "")) ??
        "",
      phone: (customerPayload && String(customerPayload["phone"] ?? "")) ?? "",
      email: (customerPayload && String(customerPayload["email"] ?? "")) ?? "",
    };

    const order: ShareOrderShape = {
      id: orderId,
      customer,
      agent: { name: "", number: "", email: "" },
      items: itemsForShare,
      createdAt: new Date().toISOString(),
      source: "web-cart",
    } as ShareOrderShape;

    return order;
  }

  const placeOrder = async (): Promise<void> => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      router.push("/signin");
      return;
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      alert("Cart is empty");
      return;
    }

    setPlacing(true);
    try {
      const itemsPayload: Record<string, unknown>[] = [];

      for (const it of cartItems) {
        const qty = safeNumber(
          (it as unknown as Record<string, unknown>).set ??
            (it as unknown as Record<string, unknown>).quantity ??
            0
        );
        const selectedColors = Array.isArray(
          (it as unknown as Record<string, unknown>).selectedColors
        )
          ? ((it as unknown as Record<string, unknown>)
              .selectedColors as string[])
          : getSelectedColors(it);

        const base: Record<string, unknown> = {
          sku: it.id ?? undefined,
          raw: (it as unknown as Record<string, unknown>).raw ?? null,
          itemName:
            getStringField(it as unknown, "name") ??
            getStringField(it as unknown, "Item") ??
            undefined,
          qty,
        };

        if (selectedColors.length > 0) {
          for (const c of selectedColors) {
            itemsPayload.push({ ...base, qty, color: String(c ?? "").trim() });
          }
        } else {
          itemsPayload.push({ ...base, qty, color: "" });
        }
      }

      const emailAddr =
        (user?.emailAddresses && user.emailAddresses[0]?.emailAddress) ?? null;
      const userName =
        (user?.fullName as string | undefined) ??
        (user?.firstName as string | undefined) ??
        (user?.username as string | undefined) ??
        (emailAddr as string | undefined) ??
        "Customer";

      const customerPayload: Record<string, unknown> = {
        label: userName,
        email: (emailAddr as string) ?? null,
        phone: null,
      };

      const payload = {
        customer: customerPayload,
        agent: null,
        items: itemsPayload,
        meta: {
          source: "web-cart",
          createdBy: (user?.id as string | undefined) ?? null,
        },
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = { ok: false, message: "Invalid response" };
      }

      const asRecord = isObject(json) ? (json as Record<string, unknown>) : {};
      const okFlag = "ok" in asRecord ? Boolean(asRecord["ok"]) : res.ok;
      if (!res.ok || !okFlag) {
        const msg =
          (isObject(json) && (asRecord["error"] ?? asRecord["message"])) ??
          "Failed to place order";
        throw new Error(String(msg));
      }

      let createdId: string | undefined = undefined;
      if (isObject(json)) {
        if (asRecord["orderId"]) createdId = String(asRecord["orderId"]);
        else if (asRecord["id"]) createdId = String(asRecord["id"]);
        else if (isObject(asRecord["order"]))
          createdId = String(
            (asRecord["order"] as Record<string, unknown>)["id"] ?? ""
          );
      }

      const shareOrder = buildOrderShapeFromResponse(
        createdId,
        customerPayload,
        itemsPayload
      );
      setPlacedOrderForShare(shareOrder);
      setShowShareModal(true);

      if (typeof clearCart === "function") clearCart();
      else cartItems.forEach((it) => removeFromCart(it.id));
    } catch (err: unknown) {
      console.error("Failed to place order:", err);
      const message =
        isObject(err) &&
        typeof (err as Record<string, unknown>)["message"] === "string"
          ? String((err as Record<string, unknown>)["message"])
          : String(err);
      alert("Failed to place order: " + message);
    } finally {
      setPlacing(false);
    }
  };

  /* ---------------------------
     Render
     --------------------------- */

  return (
    <div className="min-h-screen bg-[#06121a] text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Your Cart</h1>
          <p className="text-sm text-slate-300 mt-1">
            {itemCount} items · {totalSets} total sets
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* master controls */}
            <div className="rounded-xl border border-[#12202a] bg-[#07151a] p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-slate-300 w-28">Master sets</div>
                  <div className="inline-flex items-center gap-2 bg-[#051116] border border-[#12303a] rounded-lg px-2 py-1">
                    <button
                      onClick={() =>
                        setMasterQty((v) => Math.max(0, Number(v) - 1))
                      }
                      className="h-9 w-9 rounded-md flex items-center justify-center text-slate-200 hover:bg-[#0b2b33]"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(masterQty)}
                      onChange={(e) => {
                        const txt = e.target.value.replace(/[^\d]/g, "");
                        setMasterQty(txt === "" ? 0 : Number(txt));
                      }}
                      className="w-20 text-center bg-transparent text-white font-medium outline-none"
                    />
                    <button
                      onClick={() => setMasterQty((v) => Number(v) + 1)}
                      className="h-9 w-9 rounded-md flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    <label className="inline-flex items-center gap-2 ml-3 select-none">
                      <input
                        type="checkbox"
                        checked={selectAllColors}
                        onChange={(e) =>
                          toggleSelectAllColors(e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-600 bg-[#07151a] text-blue-500 focus:ring-blue-400"
                      />
                      <span className="text-sm text-slate-300">
                        Select all colours
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3 md:ml-auto">
                  <button
                    onClick={applyMasterToAll}
                    disabled={applying}
                    className={`px-4 py-2 rounded-md font-semibold ${
                      applying
                        ? "bg-blue-500/70"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {applying ? "Applying…" : "Apply to all"}
                  </button>
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-400">
                Set a common number of sets quickly. You can still edit any
                design individually afterwards.
              </p>
            </div>

            {/* items */}
            {cartItems.length === 0 ? (
              <div className="rounded-lg bg-[#0b1620] border border-[#12202a] p-8 text-center text-slate-400">
                Your cart is empty.
              </div>
            ) : (
              cartItems.map((item: CartItem) => {
                const qty = safeNumber(
                  (item as unknown as Record<string, unknown>).set ??
                    (item as unknown as Record<string, unknown>).quantity ??
                    0
                );
                const selectedColors: string[] = Array.isArray(
                  (item as unknown as Record<string, unknown>).selectedColors
                )
                  ? ((item as unknown as Record<string, unknown>)
                      .selectedColors as string[])
                  : getSelectedColors(item);
                const colors: string[] = getAvailableColors(item);
                const available =
                  getNumberField(item, "closingStock") +
                  getNumberField(item, "productionQty");
                const totalPieces = Math.max(
                  0,
                  qty * Math.max(1, selectedColors.length || 1)
                );

                const rawImage =
                  getStringField(item as unknown, "image") ??
                  getStringField(item as unknown, "image_url") ??
                  null;
                const imageSrc =
                  rawImage && googleDriveImage(rawImage)
                    ? getGoogleDriveImageSrc(rawImage)
                    : "/placeholder.svg";

                return (
                  <article
                    key={item.id}
                    className="relative bg-[#0b1620] border border-[#12202a] rounded-xl shadow-sm overflow-hidden"
                  >
                    <button
                      onClick={() => removeFromCart(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="absolute top-4 right-4 h-9 w-9 rounded-full bg-[#0f1724] border border-[#1f2937] flex items-center justify-center text-red-400 hover:bg-[#17202a] z-10"
                      title="Remove"
                      type="button"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="grid grid-cols-[88px_1fr_220px] gap-6 items-start p-6">
                      <div className="w-20 h-20 rounded-md overflow-hidden bg-[#0f1724] flex items-center justify-center">
                        <Image
                          src={imageSrc}
                          alt={String(
                            getStringField(item as unknown, "name") ?? ""
                          )}
                          width={160}
                          height={160}
                          className="object-cover w-full h-full"
                        />
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold text-white">
                          {getStringField(item as unknown, "name") ??
                            item.id ??
                            ""}
                        </h2>

                        <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-4">
                          {getStringField(item as unknown, "concept") && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Concept:</span>{" "}
                              <span className="font-medium text-white">
                                {getStringField(item as unknown, "concept")}
                              </span>
                            </span>
                          )}
                          {getStringField(item as unknown, "fabric") && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Fabric:</span>{" "}
                              <span className="font-medium text-white">
                                {getStringField(item as unknown, "fabric")}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {colors.length === 0 ? (
                            <div className="text-sm text-slate-400">
                              No colors
                            </div>
                          ) : (
                            colors.map((c) => {
                              const isActive = selectedColors.some(
                                (sc) =>
                                  String(sc).toLowerCase() ===
                                  String(c).toLowerCase()
                              );
                              return (
                                <button
                                  key={c}
                                  onClick={() => onColorToggle(item, c)}
                                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                                    isActive
                                      ? "bg-blue-600 text-white shadow"
                                      : "bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]"
                                  }`}
                                  type="button"
                                >
                                  {c}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-4 pr-12 self-start">
                        <div className="inline-flex items-center gap-2 bg-[#051116] border border-[#12303a] rounded-lg px-2 py-1">
                          <button
                            onClick={() => dec(item)}
                            className="h-9 w-9 rounded-md flex items-center justify-center text-slate-200 hover:bg-[#0b2b33]"
                            aria-label="Decrease"
                            type="button"
                          >
                            <Minus className="w-4 h-4" />
                          </button>

                          <input
                            type="number"
                            min={0}
                            value={String(qty)}
                            onChange={(e) =>
                              onSetChange(item, Number(e.target.value))
                            }
                            className="w-16 text-center bg-transparent text-white font-medium outline-none"
                            aria-label={`Quantity for ${
                              getStringField(item as unknown, "name") ?? item.id
                            }`}
                          />

                          <button
                            onClick={() => inc(item)}
                            className="h-9 w-9 rounded-md flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700"
                            aria-label="Increase"
                            type="button"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="text-xs text-slate-500 mt-1">
                          &nbsp;
                        </div>

                        <div className="text-sm text-slate-400 text-right">
                          <div>
                            Available Qty:{" "}
                            <span className="text-white font-medium">
                              {available}
                            </span>
                          </div>
                          <div>
                            Total pieces:{" "}
                            <span className="text-white font-medium">
                              {totalPieces}
                            </span>{" "}
                            {selectedColors.length > 0 ? (
                              <span className="text-slate-400">
                                ({qty} × {selectedColors.length} colours)
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* right: summary */}
          <aside>
            <div className="bg-[#0b1620] border border-[#12202a] rounded-xl p-6 sticky top-8">
              <h3 className="text-lg font-semibold">Order Summary</h3>

              <div className="mt-4 space-y-3">
                <div className="flex justify-between text-slate-300">
                  <span>Items</span>
                  <span className="text-white font-medium">{itemCount}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Total sets</span>
                  <span className="text-white font-medium">{totalSets}</span>
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={placeOrder}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-md font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={placing}
                  type="button"
                >
                  {placing ? "Placing order…" : "Place Order"}
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-400">
                Shipping, taxes and discounts will be calculated at checkout.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* share modal */}
      {showShareModal && placedOrderForShare && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Order placed"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setShowShareModal(false);
              setPlacedOrderForShare(null);
            }}
          />
          <div className="relative max-w-lg w-full bg-[#0b1620] border border-[#12202a] rounded-lg p-6 z-10">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Order placed
                </h3>
                <p className="text-sm text-slate-300 mt-1">
                  Order ID:{" "}
                  <span className="font-mono text-slate-200">
                    {placedOrderForShare.id ?? "—"}
                  </span>
                </p>
              </div>

              <button
                onClick={() => {
                  setShowShareModal(false);
                  setPlacedOrderForShare(null);
                }}
                className="text-slate-400 hover:text-white ml-4"
                aria-label="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 text-sm text-slate-300">
              <p>Share this order quickly via WhatsApp:</p>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <ShareOrderButton
                order={placedOrderForShare}
                phone={placedOrderForShare.customer?.phone ?? ""}
                className="!bg-green-600 !hover:bg-green-700"
              />
            </div>

            <div className="mt-3 text-xs text-slate-400">
              <em>
                Tip: The message is also copied to your clipboard on desktop for
                easy pasting.
              </em>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
