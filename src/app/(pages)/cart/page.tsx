// use client
"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Trash2, Plus, Minus } from "lucide-react";
import { useCart, CartItem } from "@/context/CartContext";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  ShareOrderButton,
  OrderShape as ShareOrderShape,
} from "@/components/ShareOrder";
import { useUserStore } from "@/store/useUserStore";

/* ---------------------------
   Types
   --------------------------- */

type UpdatePayload = Partial<{
  set: number;
  quantity: number;
  selectedColors: string[];
  selectedColor: string;
  sizes: Record<string, number>;
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

/* Helpers that operate on item with safe fallbacks */

/** Safely read a string-like field from the item or its raw payload */
function getStringField(
  item: CartItem | Record<string, unknown> | unknown,
  key: string
): string | undefined {
  if (isObject(item) && typeof item[key] === "string" && item[key].trim())
    return (item[key] as string).trim();

  if (isObject(item) && isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Safely read a numeric field (top-level or raw) */
function getNumberField(
  item: CartItem | Record<string, unknown> | unknown,
  key: string
): number {
  if (isObject(item) && item[key] !== undefined) return safeNumber(item[key]);
  if (isObject(item) && isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    if (raw[key] !== undefined) return safeNumber(raw[key]);
  }
  return 0;
}

/** Safely read an array field (top-level or raw) */
function getArrayField(
  item: CartItem | Record<string, unknown> | unknown,
  key: string
): unknown[] | undefined {
  if (!isObject(item)) return undefined;
  const v = item[key];
  if (Array.isArray(v)) return v;
  if (isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<string, unknown>;
    const rv = raw[key];
    if (Array.isArray(rv)) return rv;
  }
  return undefined;
}

/* ---------------------------
   Color / selected helpers
   --------------------------- */

/** Safely get available colours from a cart item */
function getAvailableColors(item: CartItem): string[] {
  const topArr = getArrayField(item, "colors");
  if (topArr && topArr.length > 0) {
    return topArr.map((c) => String(c ?? "").trim()).filter(Boolean);
  }
  if (isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<
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
  const topArr = getArrayField(item, "selectedColors");
  if (topArr)
    return topArr.map((c) => String(c ?? "").trim()).filter(Boolean);

  if (isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    const v = raw["selectedColor"] ?? raw["selected_colors"];
    if (typeof v === "string" && v.trim()) return [v.trim()];
    if (Array.isArray(v)) return v.map((c) => String(c ?? "").trim()).filter(Boolean);
  }
  return [];
}

/* ---------------------------
   Sizes helpers
   --------------------------- */

/** Get sizes map from cart item. Prefer explicit `sizes` field (object), else try `raw.Sizes` or `raw.sizes` arrays. */
function getSizesMapFromItem(item: CartItem): Record<string, number> {
  // if item has a sizes object (from addToCart) use it
  if (isObject(item) && isObject((item as Record<string, unknown>).sizes)) {
    const asSizes = (item as Record<string, unknown>).sizes as Record<
      string,
      unknown
    >;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(asSizes)) out[String(k)] = safeNumber(v);
    return out;
  }

  // fallback to raw payload's Sizes array (if present) — initialize to 1 set each
  if (isObject((item as Record<string, unknown>).raw)) {
    const raw = (item as Record<string, unknown>).raw as Record<string, unknown>;
    const arr = (raw["Sizes"] ?? raw["sizes"]) as unknown;
    if (Array.isArray(arr) && arr.length > 0) {
      const out: Record<string, number> = {};
      for (const s of arr) out[String(s)] = 1;
      return out;
    }
  }

  return {};
}

/* ---------------------------
   Main component
   --------------------------- */

export default function CartPage(): React.ReactElement {
  // get context safely and provide typed no-op fallbacks
  const cartCtx = useCart() as Partial<CartContextType> | undefined;
  const cartItems = Array.isArray(cartCtx?.cartItems) ? cartCtx!.cartItems : [];

  const noopRemove = (_id: string): void => {};
  const noopUpdate = (_id: string, _payload?: UpdatePayload): void => {};

  const removeFromCart = cartCtx?.removeFromCart ?? noopRemove;
  const updateItem = cartCtx?.updateItem ?? noopUpdate;
  const getTotalSets = cartCtx?.getTotalSets;
  const clearCart = cartCtx?.clearCart;

  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  // --- selection from switcher store (to enforce customer selection for admins) ---
  const currentUserStore = useUserStore((s) => s.currentUser);
  const currentUserId = useUserStore((s) => s.currentUserId);
  const currentUserEmail = useUserStore((s) => s.currentUserEmail);

  const [masterQty, setMasterQty] = useState<number>(0);
  const [applying, setApplying] = useState<boolean>(false);
  const [selectAllColors, setSelectAllColors] = useState<boolean>(false);
  const [placing, setPlacing] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [placedOrderForShare, setPlacedOrderForShare] =
    useState<ShareOrderShape | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<boolean>(false);

  const itemCount: number = Array.isArray(cartItems) ? cartItems.length : 0;

  // compute total sets more accurately: if sizes present, count sum(sizes) per item, else use set/quantity
  const totalSets: number =
    typeof getTotalSets === "function"
      ? getTotalSets()
      : Array.isArray(cartItems)
      ? cartItems.reduce((s, it) => {
          const sizesMap = getSizesMapFromItem(it);
          if (Object.keys(sizesMap).length > 0) {
            const sumSizes = Object.values(sizesMap).reduce(
              (a, b) => a + (safeNumber(b) || 0),
              0
            );
            return s + sumSizes;
          }
          return (
            s +
            safeNumber(
              getNumberField(it, "set") || getNumberField(it, "quantity")
            )
          );
        }, 0)
      : 0;

  /* ---- helpers that respect colors when counting pieces ---- */

  const inc = (it: CartItem): void => {
    // increment per-size if sizes exist, else increment sets
    const selectedColors = getSelectedColors(it);
    const colorsCount = Math.max(1, selectedColors.length || 1);
    const sizesMap = getSizesMapFromItem(it);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");

    if (Object.keys(sizesMap).length > 0) {
      // increment each size by +1 (one set)
      const sumCurrent = Object.values(sizesMap).reduce(
        (a, b) => a + (safeNumber(b) || 0),
        0
      );
      const sumAfter = sumCurrent + Object.keys(sizesMap).length;
      const totalAfter = sumAfter * colorsCount;
      if (available && totalAfter > available) {
        alert(
          `Only ${available} pieces available (requested ${totalAfter}). Reduce sets or colours.`
        );
        return;
      }
      const newSizes: Record<string, number> = {};
      for (const k of Object.keys(sizesMap))
        newSizes[k] = (safeNumber(sizesMap[k]) || 0) + 1;
      const representativePerSize = safeNumber(Object.values(newSizes)[0]);
      updateItem(it.id, { sizes: newSizes, set: representativePerSize });
      return;
    }

    // no sizes: operate on sets count
    const cur = safeNumber(getNumberField(it, "set") || getNumberField(it, "quantity"));
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
    const sizesMap = getSizesMapFromItem(it);
    if (Object.keys(sizesMap).length > 0) {
      const newSizes: Record<string, number> = {};
      for (const k of Object.keys(sizesMap))
        newSizes[k] = Math.max(0, (safeNumber(sizesMap[k]) || 0) - 1);
      const representativePerSize = safeNumber(Object.values(newSizes)[0] ?? 0);
      updateItem(it.id, { sizes: newSizes, set: representativePerSize });
      return;
    }

    const cur = safeNumber(getNumberField(it, "set") || getNumberField(it, "quantity"));
    updateItem(it.id, { set: Math.max(0, cur - 1) });
  };

  const onSetChange = (it: CartItem, v: number | string): void => {
    const n = Math.max(0, Number(v) || 0);
    const selectedColors =
      (Array.isArray(getArrayField(it, "selectedColors")) &&
        (getArrayField(it, "selectedColors") as unknown[]).length > 0)
        ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
        : getSelectedColors(it);

    const colorsCount = Math.max(1, selectedColors.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");

    const sizesMap = getSizesMapFromItem(it);
    if (Object.keys(sizesMap).length > 0) {
      const numSizes = Object.keys(sizesMap).length;
      const sumAfter = n * numSizes;
      const totalAfter = sumAfter * colorsCount;
      if (available && totalAfter > available) {
        alert(`Only ${available} pieces available (requested ${totalAfter}).`);
        const allowedPerColor = Math.floor(available / colorsCount);
        const allowedPerSize = Math.floor(
          allowedPerColor / Math.max(1, numSizes)
        );
        const newSizes: Record<string, number> = {};
        for (const k of Object.keys(sizesMap)) newSizes[k] = allowedPerSize;
        updateItem(it.id, { sizes: newSizes, set: allowedPerSize });
        return;
      }
      const newSizes: Record<string, number> = {};
      for (const k of Object.keys(sizesMap)) newSizes[k] = n;
      updateItem(it.id, { sizes: newSizes, set: n });
      return;
    }

    // no sizes
    const totalAfter = n * colorsCount;
    if (available && totalAfter > available) {
      alert(`Only ${available} pieces available (requested ${totalAfter}).`);
      const maxSets = Math.floor(available / colorsCount);
      updateItem(it.id, { set: Math.max(0, maxSets) });
      return;
    }
    updateItem(it.id, { set: n });
  };

  const onSizeInputChange = (
    it: CartItem,
    sizeLabel: string,
    rawValue: string
  ) => {
    const parsed = Math.max(0, Math.floor(Number(rawValue || 0)));
    const sizesMap = getSizesMapFromItem(it);
    const prev = { ...sizesMap };
    prev[sizeLabel] = parsed;

    const selectedColors =
      (Array.isArray(getArrayField(it, "selectedColors")) &&
        (getArrayField(it, "selectedColors") as unknown[]).length > 0)
        ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
        : getSelectedColors(it);

    const colorsCount = Math.max(1, selectedColors.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");
    const sumSizes = Object.values(prev).reduce(
      (a, b) => a + (safeNumber(b) || 0),
      0
    );

    if (available && sumSizes * colorsCount > available) {
      // clamp only the edited size to fit
      const otherSum = Object.entries(prev).reduce(
        (acc, [k, v]) => acc + (k === sizeLabel ? 0 : safeNumber(v) || 0),
        0
      );
      const maxForThisSize = Math.max(
        0,
        Math.floor(available / colorsCount) - otherSum
      );
      prev[sizeLabel] = Math.max(0, Math.min(prev[sizeLabel], maxForThisSize));
      alert(
        `Only ${available} pieces available. Adjusted "${sizeLabel}" to ${prev[sizeLabel]}.`
      );
    }

    const sumAfter = Object.values(prev).reduce(
      (a, b) => a + (safeNumber(b) || 0),
      0
    );
    // store `set` as representative per-size if sizes are uniform, else store sum as fallback
    const values = Object.values(prev).map((v) => safeNumber(v));
    const allEqual = values.every((x) => x === values[0]);
    const representative = allEqual ? values[0] : sumAfter;
    updateItem(it.id, { sizes: prev, set: representative });
  };

  const onColorToggle = (it: CartItem, color: string): void => {
    const prevTop = Array.isArray(getArrayField(it, "selectedColors"))
      ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
      : getSelectedColors(it);

    const idx = prevTop.findIndex(
      (c) => String(c).toLowerCase() === String(color).toLowerCase()
    );
    if (idx >= 0) prevTop.splice(idx, 1);
    else prevTop.push(color);

    const sizesMap = getSizesMapFromItem(it);
    const sets = safeNumber(getNumberField(it, "set") || getNumberField(it, "quantity"));
    const colorsCount = Math.max(1, prevTop.length || 1);
    const available =
      getNumberField(it, "closingStock") + getNumberField(it, "productionQty");

    if (Object.keys(sizesMap).length > 0) {
      const sumSizes = Object.values(sizesMap).reduce(
        (a, b) => a + (safeNumber(b) || 0),
        0
      );
      if (available && sumSizes * colorsCount > available) {
        // clamp evenly across sizes
        const allowedTotalPerColor = Math.floor(available / colorsCount);
        const sizeKeys = Object.keys(sizesMap);
        const allowedPerSize =
          sizeKeys.length > 0
            ? Math.floor(allowedTotalPerColor / Math.max(1, sizeKeys.length))
            : 0;
        const newSizes: Record<string, number> = {};
        for (const k of sizeKeys) newSizes[k] = allowedPerSize;
        updateItem(it.id, {
          selectedColors: prevTop,
          sizes: newSizes,
          set: allowedPerSize,
        });
        return;
      }
      updateItem(it.id, { selectedColors: prevTop });
      return;
    }

    // no sizes
    if (available && sets * colorsCount > available) {
      const maxSets = Math.floor(available / colorsCount);
      updateItem(it.id, { selectedColors: prevTop, set: Math.max(0, maxSets) });
    } else {
      updateItem(it.id, { selectedColors: prevTop });
    }
  };

  const applyMasterToAll = async (): Promise<void> => {
    const n = Number(masterQty);
    if (Number.isNaN(n) || n < 0) return;
    setApplying(true);
    try {
      for (const it of cartItems) {
        const selectedColorsArr =
          (Array.isArray(getArrayField(it, "selectedColors")) &&
            (getArrayField(it, "selectedColors") as unknown[]).length > 0)
            ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
            : getSelectedColors(it);

        const colorsCount = Math.max(1, selectedColorsArr.length || 1);
        const avail =
          getNumberField(it, "closingStock") +
          getNumberField(it, "productionQty");

        const sizesMap = getSizesMapFromItem(it);
        if (Object.keys(sizesMap).length > 0) {
          const numSizes = Object.keys(sizesMap).length;
          // `n` is per-size value. total pieces would be n * numSizes * colorsCount
          if (avail && n * numSizes * colorsCount > avail) {
            // clamp: compute per-size allowed value
            const allowedPerColor = Math.floor(avail / colorsCount);
            const allowedPerSize = Math.floor(
              allowedPerColor / Math.max(1, numSizes)
            );
            const newSizes: Record<string, number> = {};
            for (const k of Object.keys(sizesMap)) newSizes[k] = allowedPerSize;
            updateItem(it.id, {
              sizes: newSizes,
              set: Math.max(0, allowedPerSize),
            });
          } else {
            const newSizes: Record<string, number> = {};
            for (const k of Object.keys(sizesMap)) newSizes[k] = n;
            updateItem(it.id, { sizes: newSizes, set: n });
          }
        } else {
          if (avail && n * colorsCount > avail) {
            const maxSets = Math.floor(avail / colorsCount);
            updateItem(it.id, { set: Math.max(0, maxSets) });
          } else {
            updateItem(it.id, { set: n });
          }
        }
      }
    } finally {
      setApplying(false);
    }
  };

  const toggleSelectAllColors = (value: boolean): void => {
    setSelectAllColors(value);
    for (const it of cartItems) {
      const dedup = Array.from(
        new Set(
          getAvailableColors(it)
            .map((c) => String(c ?? "").trim())
            .filter(Boolean)
        )
      );
      if (value) updateItem(it.id, { selectedColors: dedup });
      else updateItem(it.id, { selectedColors: [] });
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

    // --- NEW: determine admin status of logged-in user ---
    const typedUser = user as unknown as { publicMetadata?: Record<string, unknown> } | undefined;
    const userRole = String(typedUser?.publicMetadata?.role ?? "").toLowerCase();
    const isAdmin = userRole === "admin";

    // --- NEW: validate switcher selection isn't "self" BUT only enforce for admins ---
    const loggedInEmail =
      (user?.emailAddresses && user.emailAddresses[0]?.emailAddress?.trim()) ??
      (user?.primaryEmailAddress?.emailAddress ?? null) ??
      null;

    const loggedInLabel =
      (user?.fullName as string | undefined) ??
      (user?.firstName as string | undefined) ??
      (user?.username as string | undefined) ??
      (loggedInEmail as string | undefined) ??
      "";

    const loggedInLabelNormalized = String(loggedInLabel).trim().toLowerCase();
    const loggedInEmailNormalized = String(loggedInEmail ?? "").trim().toLowerCase();

    const activeSelection = String(currentUserStore ?? "").trim();
    const activeSelectionNormalized = activeSelection.toLowerCase();

    const activeSelectionId = String(currentUserId ?? "").trim();
    const activeSelectionEmailNormalized = String(currentUserEmail ?? "").trim().toLowerCase();

    const selectionIsSelf =
      activeSelectionId.startsWith("me:") ||
      (activeSelectionEmailNormalized && activeSelectionEmailNormalized === loggedInEmailNormalized) ||
      (activeSelectionNormalized && activeSelectionNormalized === loggedInLabelNormalized);

    // If user is admin -> require them to explicitly pick a customer (not self)
    if (isAdmin) {
      if (!activeSelection || selectionIsSelf) {
        alert("Select a customer before placing order");
        return;
      }
    } else {
      // non-admin users: allow placing without selecting a customer (we'll default to logged-in user below)
      // no-op
    }

    // --- NEW: validate each item has at least one color selected if item has available colors (always enforced) ---
    for (const it of cartItems) {
      const availableColors = getAvailableColors(it);
      if (availableColors.length > 0) {
        const selectedColors =
          (Array.isArray(getArrayField(it, "selectedColors")) &&
            (getArrayField(it, "selectedColors") as unknown[]).length > 0)
            ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
            : getSelectedColors(it);

        if (!selectedColors || selectedColors.length === 0) {
          const label =
            getStringField(it as unknown, "name") ??
            getStringField(it as unknown, "Item") ??
            it.id ??
            "this item";
          alert(`Please select at least one colour for "${label}" before placing the order.`);
          return;
        }
      }
    }

    setPlacing(true);
    try {
      const itemsPayload: Record<string, unknown>[] = [];

      for (const it of cartItems) {
        // If sizes exist, we will expand per-color per-size (respecting selectedColors)
        const sizesMap = getSizesMapFromItem(it);
        const qty = safeNumber(getNumberField(it, "set") || getNumberField(it, "quantity"));
        const selectedColors = Array.isArray(getArrayField(it, "selectedColors"))
          ? (getArrayField(it, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
          : getSelectedColors(it);

        const base: Record<string, unknown> = {
          sku: it.id ?? undefined,
          raw: isObject((it as Record<string, unknown>).raw) ? (it as Record<string, unknown>).raw : null,
          itemName:
            getStringField(it as unknown, "name") ??
            getStringField(it as unknown, "Item") ??
            undefined,
        };

        if (Object.keys(sizesMap).length > 0) {
          // push one payload per selected color per size with qty = size-qty
          if (selectedColors.length > 0) {
            for (const c of selectedColors) {
              for (const [sizeLabel, sizeQty] of Object.entries(sizesMap)) {
                itemsPayload.push({
                  ...base,
                  qty: safeNumber(sizeQty),
                  color: String(c ?? "").trim(),
                  size: sizeLabel,
                });
              }
            }
          } else {
            // if no selected colors (but earlier validation ensures this should not happen for items with colors)
            for (const [sizeLabel, sizeQty] of Object.entries(sizesMap)) {
              itemsPayload.push({
                ...base,
                qty: safeNumber(sizeQty),
                color: "",
                size: sizeLabel,
              });
            }
          }
        } else {
          // legacy: one payload per selected color (qty = sets), or one payload without color
          if (selectedColors.length > 0) {
            for (const c of selectedColors) {
              itemsPayload.push({
                ...base,
                qty,
                color: String(c ?? "").trim(),
              });
            }
          } else {
            itemsPayload.push({ ...base, qty, color: "" });
          }
        }
      }

      // Build customer payload:
      // - If admin: we already required a selected customer -> use currentUserStore/currentUserEmail
      // - If non-admin and no selection -> default to logged-in user's name/email
      const useCustomerLabel =
        activeSelection && !selectionIsSelf
          ? activeSelection
          : (String(loggedInLabel).trim() || "Customer");

      const useCustomerEmail =
        activeSelection && !selectionIsSelf
          ? currentUserEmail ?? null
          : (String(loggedInEmail ?? "").trim() || null);

      const customerPayload: Record<string, unknown> = {
        label: useCustomerLabel,
        email: useCustomerEmail,
        phone: null,
      };

      // build the final payload — include order_placed_by at top-level (logged-in user's email)
      const payload: Record<string, unknown> = {
        customer: customerPayload,
        agent: null,
        items: itemsPayload,
        meta: {
          source: "web-cart",
          createdBy: (user?.id as string | undefined) ?? null,
          confirmed: confirmedOrder,
        },
        order_placed_by: loggedInEmail ?? null,
      };

      // If the customer toggled "Confirmed order" set orderStatus to 'Confirmed'
      if (confirmedOrder) {
        payload["orderStatus"] = "Confirmed";
      }

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
      // preserve previous error handling behavior
      // eslint-disable-next-line no-console
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
              cartItems.map((item) => {
                const sizesMap = getSizesMapFromItem(item);
                const numSizes = Object.keys(sizesMap).length;
                const sumSizes = Object.values(sizesMap).reduce(
                  (a, b) => a + (safeNumber(b) || 0),
                  0
                );

                const qtyFromSets = safeNumber(
                  getNumberField(item, "set") || getNumberField(item, "quantity")
                );

                let displayQty: number;
                if (numSizes > 0) {
                  const vals = Object.values(sizesMap).map((v) =>
                    safeNumber(v)
                  );
                  const allEqual = vals.every((x) => x === vals[0]);
                  displayQty = allEqual ? vals[0] : sumSizes;
                } else {
                  displayQty = qtyFromSets;
                }

                const selectedColors = Array.isArray(getArrayField(item, "selectedColors"))
                  ? (getArrayField(item, "selectedColors") as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean)
                  : getSelectedColors(item);
                const colors = getAvailableColors(item);
                const available =
                  getNumberField(item, "closingStock") +
                  getNumberField(item, "productionQty");

                const totalPieces =
                  numSizes > 0
                    ? sumSizes * Math.max(1, selectedColors.length || 1)
                    : Math.max(
                        0,
                        displayQty * Math.max(1, selectedColors.length || 1)
                      );

                const rawImage =
                  getStringField(item, "image") ??
                  getStringField(item, "image_url") ??
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

                    <div className="grid grid-cols-[88px_1fr_260px] gap-6 items-start p-6">
                      <div className="w-20 h-20 rounded-md overflow-hidden bg-[#0f1724] flex items-center justify-center">
                        <Image
                          src={imageSrc}
                          alt={String(getStringField(item, "name") ?? "")}
                          width={160}
                          height={160}
                          className="object-cover w-full h-full"
                        />
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold text-white">
                          {getStringField(item, "name") ?? item.id ?? ""}
                        </h2>

                        <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-4">
                          {getStringField(item, "concept") && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Concept:</span>{" "}
                              <span className="font-medium text-white">
                                {getStringField(item, "concept")}
                              </span>
                            </span>
                          )}
                          {getStringField(item, "fabric") && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Fabric:</span>{" "}
                              <span className="font-medium text-white">
                                {getStringField(item, "fabric")}
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

                        {numSizes > 0 && (
                          <div className="mt-4">
                            <div className="text-sm text-slate-300 mb-2">
                              Sizes
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {Object.keys(sizesMap).map((sz) => (
                                <div key={sz} className="flex items-center gap-2">
                                  <div className="text-sm text-gray-200 w-20">
                                    {sz}
                                  </div>
                                  <input
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={String(sizesMap[sz] ?? 0)}
                                    onChange={(e) =>
                                      onSizeInputChange(item, sz, e.target.value)
                                    }
                                    className="w-20 text-center bg-transparent text-white font-medium outline-none border border-[#12202a] rounded px-2 py-1"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-4 pr-6 self-start">
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
                            value={String(displayQty)}
                            onChange={(e) =>
                              onSetChange(item, Number(e.target.value))
                            }
                            className="w-16 text-center bg-transparent text-white font-medium outline-none"
                            aria-label={`Quantity for ${getStringField(item, "name") ?? item.id}`}
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
                                {numSizes > 0
                                  ? `(${sumSizes} × ${selectedColors.length} colours)`
                                  : `(${displayQty} × ${selectedColors.length} colours)`}
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

              {/* --- Confirmed order toggle moved here --- */}
              <div className="mt-4">
                <label className="inline-flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmedOrder}
                    onChange={(e) => setConfirmedOrder(e.target.checked)}
                    aria-label="Confirmed order"
                    className="h-5 w-5 rounded border border-[#12303a] bg-[#07151a] text-blue-600 focus:ring-blue-400"
                  />
                  <span className="ml-2 text-sm text-slate-300 font-medium">
                    Confirmed order
                  </span>
                </label>
                <div className="text-xs text-slate-400 mt-2">
                  Toggle when you have reviewed and confirmed this order.
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

              {/* View Orders button (closes modal and navigates to /orders) */}
              <button
                type="button"
                className="ml-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium"
                onClick={() => {
                  setShowShareModal(false);
                  setPlacedOrderForShare(null);
                  router.push("/orders");
                }}
              >
                View Orders
              </button>
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
