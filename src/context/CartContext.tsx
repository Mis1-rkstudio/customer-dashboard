'use client';

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, JSX } from 'react';
import { useUser } from '@clerk/nextjs';

export type CartItem = {
  id: string;
  name: string;
  image?: string | null;
  image_url?: string | null; // compatibility
  colors?: string[]; // available colors
  selectedColors?: string[]; // user-selected colors
  set?: number | string; // number of sets (string allowed while typing)
  quantity?: number | string; // legacy compatibility (optional)
  price?: number | null; // optional
  raw?: unknown; // <-- unknown instead of any
  concept?: string | null;
  fabric?: string | null;
};

type CartContextShape = {
  cartItems: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (id: string) => void;
  updateItem: (id: string, patch: Partial<CartItem>) => void;
  clearCart: () => void;
  getTotalSets: () => number;
  getTotalItems: () => number;
};

const CartContext = createContext<CartContextShape | undefined>(undefined);

// base key (versioned)
const BASE_KEY = 'cart_v1';
// legacy localStorage key (if you used plain 'cart')
const LEGACY_LOCAL_KEY = 'cart';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function safeParse<T>(str: string | null): T | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

function storageKeyFor(userId?: string | null): string {
  if (userId) return `${BASE_KEY}:user:${String(userId)}`;
  return `${BASE_KEY}:anon`;
}

/** small helpers */
function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function CartProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { isLoaded, isSignedIn, user } = useUser();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // compute storage key (depends on clerk state)
  const key = useMemo(
    () => storageKeyFor(isLoaded && isSignedIn ? user?.id ?? null : null),
    [isLoaded, isSignedIn, user?.id]
  );

  // 1) One-time migration from legacy localStorage key into sessionStorage (best-effort)
  useEffect(() => {
    if (!isBrowser()) return;
    try {
      const legacy = window.localStorage.getItem(LEGACY_LOCAL_KEY);
      if (legacy) {
        const parsed = safeParse<CartItem[]>(legacy) ?? [];
        // if there is already something in sessionStorage for the current key, don't overwrite
        const existing = sessionStorage.getItem(key);
        if (!existing) {
          sessionStorage.setItem(key, JSON.stringify(parsed));
        }
        // don't remove legacy automatically (safer)
      }
    } catch (err) {
      console.warn('Cart: migration from localStorage failed', err);
    }
    // we intentionally include key so migration targets the right session key for logged-in user
  }, [key]);

  // 2) When clerk availability changes (user signs in/out) load cart from sessionStorage, and
  //    if signing in merge anon cart into the user's cart.
  useEffect(() => {
    if (!isBrowser()) return;

    try {
      const currentRaw = sessionStorage.getItem(key);
      const parsedCurrent = safeParse<CartItem[]>(currentRaw) ?? [];

      // If user is signed in, attempt to merge anon -> user (only once when sign-in happens).
      if (isLoaded && isSignedIn && user?.id) {
        const anonKey = storageKeyFor(null);
        const userKey = storageKeyFor(user.id);

        const anonRaw = sessionStorage.getItem(anonKey);
        const anonItems = safeParse<CartItem[]>(anonRaw) ?? [];

        const userRaw = sessionStorage.getItem(userKey);
        const userItems = safeParse<CartItem[]>(userRaw) ?? [];

        if (anonItems.length > 0) {
          // merge algorithm: for each item id
          const mergedMap = new Map<string, CartItem>();

          const pushToMap = (it: CartItem) => {
            const id = String(it.id);
            const existing = mergedMap.get(id);
            if (!existing) {
              // shallow clone to avoid shared references
              mergedMap.set(id, { ...it });
            } else {
              // sum sets / quantity (use safeNumber to handle strings)
              const existingSets = safeNumber(existing.set ?? existing.quantity ?? 0);
              const incomingSets = safeNumber(it.set ?? it.quantity ?? 0);
              const newSets = existingSets + incomingSets;
              existing.set = newSets;
              existing.quantity = newSets;

              // union selectedColors
              const a = Array.isArray(existing.selectedColors) ? existing.selectedColors.map(String) : [];
              const b = Array.isArray(it.selectedColors) ? it.selectedColors.map(String) : [];
              const union = Array.from(new Set([...a, ...b])).filter(Boolean);
              existing.selectedColors = union;

              // prefer existing fields but fallback raw
              existing.raw = existing.raw ?? it.raw;
              existing.name = existing.name || it.name;
              existing.image = existing.image || it.image;
              existing.image_url = existing.image_url || it.image_url;
            }
          };

          // seed map with userItems first (prefer them)
          for (const ui of userItems) pushToMap(ui);
          // then merge anonItems (they'll increment sets or add)
          for (const ai of anonItems) pushToMap(ai);

          const merged = Array.from(mergedMap.values());
          sessionStorage.setItem(userKey, JSON.stringify(merged));
          try {
            sessionStorage.removeItem(anonKey);
          } catch {
            // ignore
          }
          setCartItems(merged);
          return;
        }

        // if no anon data, but userKey exists, load it
        if (userRaw) {
          setCartItems(userItems);
          return;
        }

        // nothing special, load current parsed
        setCartItems(parsedCurrent);
        return;
      }

      // Not signed in: load anon key
      if (!isLoaded || !isSignedIn) {
        const anonKey = storageKeyFor(null);
        const anonRaw = sessionStorage.getItem(anonKey);
        const anonItems = safeParse<CartItem[]>(anonRaw) ?? parsedCurrent ?? [];
        setCartItems(anonItems);
        return;
      }

      // Fallback
      setCartItems(parsedCurrent);
    } catch (err) {
      console.warn('Cart: failed to load session cart', err);
      setCartItems([]);
    }
  }, [isLoaded, isSignedIn, user?.id, key]);

  // 3) Persist to sessionStorage whenever cartItems or current storage key changes
  useEffect(() => {
    if (!isBrowser()) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(cartItems));
    } catch (err) {
      console.warn('Cart: failed to persist to sessionStorage', err);
    }
  }, [cartItems, key]);

  // API functions (same surface as before) - wrapped in useCallback so identities are stable
  const addToCart = useCallback((item: CartItem) => {
    setCartItems((prev) => {
      const exists = prev.find((p) => p.id === item.id);
      if (exists) {
        // merge fields (keep existing selectedColors union and update fields from item)
        return prev.map((p) => {
          if (p.id !== item.id) return p;
          const unionColors = Array.from(
            new Set([...(p.selectedColors ?? []).map(String), ...(item.selectedColors ?? []).map(String)])
          ).filter(Boolean);
          const newSet = item.set ?? p.set ?? 1;
          const newQuantity = safeNumber(item.set ?? item.quantity ?? p.set ?? p.quantity ?? newSet);
          return { ...p, ...item, selectedColors: unionColors, set: newSet, quantity: newQuantity };
        });
      }
      return [
        ...prev,
        {
          ...item,
          selectedColors: Array.isArray(item.selectedColors) ? item.selectedColors : [],
          set: item.set ?? 1,
          quantity: item.quantity ?? (typeof item.set === 'number' ? item.set : safeNumber(item.set)),
        },
      ];
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCartItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<CartItem>) => {
    setCartItems((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        // special handling: if patch.selectedColors is provided, replace it (not merge)
        const merged = { ...p, ...patch };
        return merged;
      })
    );
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
    if (!isBrowser()) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  const getTotalSets = useCallback(() => {
    return cartItems.reduce((s, it) => s + safeNumber(it.set ?? it.quantity ?? 0), 0);
  }, [cartItems]);

  const getTotalItems = useCallback(() => cartItems.length, [cartItems]);

  const value = useMemo(
    () => ({ cartItems, addToCart, removeFromCart, updateItem, clearCart, getTotalSets, getTotalItems }),
    [cartItems, addToCart, removeFromCart, updateItem, clearCart, getTotalSets, getTotalItems]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextShape {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
