"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CarouselItem } from "./carousels";
import { useCart } from "@/context/CartContext";
import type { CartItem } from "@/context/CartContext";

type Props = {
  item: CarouselItem;
  onClose: () => void;
  onAdded?: (added: CartItem) => void;
};

function safeString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function extractColorsFromRaw(raw?: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const candidates: string[] = [];
  if (Array.isArray(raw["Colors"])) candidates.push(...(raw["Colors"] as unknown[]).map(String));
  if (Array.isArray(raw["colors"])) candidates.push(...(raw["colors"] as unknown[]).map(String));
  if (typeof raw["colors_string"] === "string") candidates.push(...String(raw["colors_string"]).split(",").map((s) => s.trim()));
  if (raw["Color"]) candidates.push(String(raw["Color"]));
  if (typeof raw["color"] === "string") candidates.push(String(raw["color"]));
  return Array.from(new Set(candidates.map((c) => safeString(c)).filter(Boolean)));
}

/**
 * Minimal shape for cart context functions we may call from here.
 * Adjust signatures if your actual CartContext exposes different params/returns.
 */
type CartContextShape = {
  addToCart?: (item: CartItem) => Promise<void> | void;
  addItem?: (item: CartItem) => Promise<void> | void;
  add?: (item: CartItem) => Promise<void> | void;
  updateItem?: (id: string, patch: Partial<CartItem>) => Promise<void> | void;
} | null;

export default function QuickOrderModal({ item, onClose, onAdded }: Props): React.JSX.Element {
  const cartContext = useCart() as unknown as CartContextShape;
  const inferredColors = useMemo(() => extractColorsFromRaw(item.raw ?? null), [item]);
  const [selectedColors, setSelectedColors] = useState<string[]>(inferredColors.length > 0 ? [inferredColors[0]] : []);
  const [qty, setQty] = useState<number>(1);
  const [adding, setAdding] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // if item changes while open, reset choices
    setSelectedColors(inferredColors.length > 0 ? [inferredColors[0]] : []);
    setQty(1);
  }, [item, inferredColors]);

  const toggleColor = (c: string): void => {
    setSelectedColors((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const buildCartItem = (): CartItem => {
    // Build an item compatible with your CartItem type. If your CartItem has other required fields,
    // add them here or update the type import.
    const cartItem = {
      id: String(item.id ?? `tmp_${Date.now().toString(36)}`),
      name: item.name ?? "",
      image: item.image ?? null,
      wsp: item.wsp ?? null,
      raw: item.raw ?? {},
      selectedColors: selectedColors.length ? selectedColors : undefined,
      set: qty,
    } as unknown as CartItem;
    return cartItem;
  };

  const handleAddToCart = async (): Promise<void> => {
    setAdding(true);
    try {
      const cartItem = buildCartItem();

      if (cartContext) {
        if (typeof cartContext.addToCart === "function") {
          await cartContext.addToCart(cartItem);
        } else if (typeof cartContext.addItem === "function") {
          await cartContext.addItem(cartItem);
        } else if (typeof cartContext.add === "function") {
          await cartContext.add(cartItem);
        } else if (typeof cartContext.updateItem === "function") {
          // best-effort fallback — update existing id if your impl supports it
          await cartContext.updateItem(cartItem.id, {
            set: cartItem.set,
            selectedColors: cartItem.selectedColors,
            raw: cartItem.raw,
          });
        } else {
          window.alert(
            "Your CartContext does not expose addToCart/addItem/add/updateItem. Please implement one of these to allow adding items from the carousel."
          );
          // eslint-disable-next-line no-console
          console.warn("Missing addToCart in cart context:", Object.keys(cartContext));
        }
      } else {
        window.alert("Cart context not available. Item not added.");
      }

      if (onAdded) onAdded(cartItem);
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to add to cart:", err);
      window.alert("Failed to add item to cart. See console for details.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`Add ${item.name} to cart`}>
      <div className="absolute inset-0 bg-black/60" onClick={() => onClose()} />
      <div className="relative z-10 max-w-2xl w-full bg-[#0b1620] border border-[#12202a] rounded-lg p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="w-36 h-36 rounded-md overflow-hidden bg-[#0f1724] flex items-center justify-center">
            {item.image ? (
              <Image src={String(item.image)} alt={String(item.name)} width={320} height={320} className="object-cover w-full h-full" />
            ) : (
              <div className="text-gray-500">No image</div>
            )}
          </div>

          <div className="flex-1">
            <h3 className="text-xl font-semibold text-white">{item.name}</h3>
            <div className="text-sm text-slate-400 mt-1">Price: <span className="font-semibold text-white">{item.wsp ? `Rs. ${Number(item.wsp)}` : "—"}</span></div>

            <div className="mt-4">
              <div className="text-sm text-slate-300 mb-2">Colors</div>
              <div className="flex flex-wrap gap-2">
                {inferredColors.length === 0 ? (
                  <div className="text-gray-500 text-sm">No colors available for this design</div>
                ) : (
                  inferredColors.map((c) => {
                    const sel = selectedColors.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleColor(c)}
                        className={`px-3 py-1 rounded-full text-sm font-medium ${sel ? "bg-blue-600 text-white" : "bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]"}`}
                      >
                        {c}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm text-slate-300 mb-1">Quantity (sets)</label>
                <input
                  type="number"
                  min={1}
                  value={String(qty)}
                  onChange={(e) => {
                    const v = Number(e.target.value || 1);
                    setQty(Math.max(1, Number.isNaN(v) ? 1 : Math.floor(v)));
                  }}
                  className="w-32 bg-[#07151a] border border-[#12303a] rounded px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>

          <div className="ml-4 flex flex-col gap-2 items-end">
            <button type="button" onClick={() => onClose()} className="text-slate-400 hover:text-white" aria-label="Close">✕</button>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={adding || qty <= 0 || (inferredColors.length > 0 && selectedColors.length === 0)}
              className={`mt-2 px-4 py-2 rounded-md font-semibold ${adding ? "bg-blue-500/70" : "bg-blue-600 hover:bg-blue-700"} text-white`}
            >
              {adding ? "Adding…" : "Add to cart"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
