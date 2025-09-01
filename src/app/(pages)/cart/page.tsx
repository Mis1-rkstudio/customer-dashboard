'use client';

import React, { JSX, useState } from 'react';
import Image from 'next/image';
import { Trash2, Plus, Minus } from 'lucide-react';
import { useCart, CartItem } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { ShareOrderButton, OrderShape } from '@/components/ShareOrder';

type OrderItemPayload = {
  itemName?: string;
  sku?: string;
  label?: string;
  qty?: number;
  quantity?: number;
  color?: string;
  sets?: number;
  raw?: unknown;
};

type CustomerPayload = {
  label?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
};

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function googleDriveImage(u?: string | null): boolean {
  return typeof u === 'string' && u.length > 0;
}

function getGoogleDriveImageSrc(googleDriveUrl?: string | null): string {
  if (!googleDriveImage(googleDriveUrl)) return '/placeholder.svg';
  const m = (googleDriveUrl ?? '').match(/\/d\/([^\/]+)/);
  if (m?.[1]) return `https://drive.google.com/thumbnail?id=${m[1]}`;
  return String(googleDriveUrl);
}

/** Safely extract available colors from different legacy shapes */
function getAvailableColors(item: CartItem): string[] {
  if (Array.isArray(item.colors) && item.colors.length > 0) {
    return item.colors.map((c) => String(c ?? '').trim()).filter(Boolean);
  }
  // try raw shape if present
  if (isObject(item.raw)) {
    const raw = item.raw as Record<string, unknown>;
    const ac = raw['available_colors'] ?? raw['availableColors'] ?? raw['colors'];
    if (Array.isArray(ac)) return ac.map((c) => String(c ?? '').trim()).filter(Boolean);
  }
  return [];
}

/** Safely return selected colors (supports legacy single selectedColor) */
function getSelectedColors(item: CartItem): string[] {
  if (Array.isArray(item.selectedColors)) return item.selectedColors.map(String);
  if (isObject(item.raw)) {
    const val = (item.raw as Record<string, unknown>)['selectedColor'] ?? (item.raw as Record<string, unknown>)['selected_colors'];
    if (typeof val === 'string' && val.trim()) return [val.trim()];
    if (Array.isArray(val)) return val.map((c) => String(c ?? '').trim()).filter(Boolean);
  }
  return [];
}

/** safe helper to derive a human-friendly label from item, checking common legacy keys */
function getItemLabel(item: CartItem): string {
  if (item.name && String(item.name).trim()) return String(item.name).trim();
  if (isObject(item.raw)) {
    const raw = item.raw as Record<string, unknown>;
    const candidates = [
      raw['label'],
      raw['skuLabel'],
      raw['Item'],
      raw['itemName'],
      raw['name'],
      raw['value'],
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
  }
  return '';
}

export default function CartPage(): JSX.Element {
  const { cartItems, removeFromCart, updateItem, getTotalSets, clearCart } = useCart() as CartContextType;
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  // Master sets input - default 0
  const [masterQty, setMasterQty] = useState<number>(0);
  const [applying, setApplying] = useState<boolean>(false);

  // New: select all colours toggle
  const [selectAllColors, setSelectAllColors] = useState<boolean>(false);

  // placing state
  const [placing, setPlacing] = useState<boolean>(false);

  // Share modal state shown after successful order
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [placedOrderForShare, setPlacedOrderForShare] = useState<OrderShape | null>(null);

  // helpers
  const itemCount: number = Array.isArray(cartItems) ? cartItems.length : 0;
  const totalSets: number =
    typeof getTotalSets === 'function'
      ? getTotalSets()
      : Array.isArray(cartItems)
      ? cartItems.reduce((s: number, it: CartItem) => s + safeNumber(it.set ?? it.quantity ?? 0), 0)
      : 0;

  const inc = (it: CartItem): void => {
    const cur = safeNumber(it.set ?? it.quantity ?? 0);
    updateItem(it.id, { set: cur + 1 });
  };
  const dec = (it: CartItem): void => {
    const cur = safeNumber(it.set ?? it.quantity ?? 0);
    updateItem(it.id, { set: Math.max(0, cur - 1) });
  };
  const onSetChange = (it: CartItem, v: number | string): void => {
    const n = Math.max(0, Number(v) || 0);
    updateItem(it.id, { set: n });
  };

  // toggle a single color pill for an item (multi-select)
  const onColorToggle = (it: CartItem, color: string): void => {
    const prev = Array.isArray(it.selectedColors) ? [...it.selectedColors] : getSelectedColors(it);
    const idx = prev.findIndex((c) => String(c).toLowerCase() === String(color).toLowerCase());
    if (idx >= 0) {
      prev.splice(idx, 1);
    } else {
      prev.push(color);
    }
    updateItem(it.id, { selectedColors: prev });
  };

  // Apply master qty to all items
  const applyMasterToAll = async (): Promise<void> => {
    const n = Number(masterQty);
    if (Number.isNaN(n) || n < 0) return;
    setApplying(true);
    try {
      for (const it of cartItems) {
        updateItem(it.id, { set: n });
      }
    } finally {
      setApplying(false);
    }
  };

  // When toggling selectAllColors: immediately apply to all items
  const toggleSelectAllColors = (value: boolean): void => {
    setSelectAllColors(value);

    for (const it of cartItems) {
      const colours = getAvailableColors(it);

      if (value) {
        const dedup = Array.from(new Set(colours.map((c) => String(c ?? '').trim()).filter(Boolean)));
        updateItem(it.id, { selectedColors: dedup });
      } else {
        updateItem(it.id, { selectedColors: [] });
      }
    }
  };

  // helper to build OrderShape for the share component from the payload & items
  function buildOrderShapeFromResponse(orderId: string | undefined, customerPayload: CustomerPayload, itemsPayload: OrderItemPayload[]): OrderShape {
    const itemsForShare = (itemsPayload || []).map((r) => {
      return {
        itemName: r.itemName ?? r.sku ?? r.label ?? String(r.itemName ?? ''),
        color: String(r.color ?? ''),
        quantity: Number(r.qty ?? r.quantity ?? r.sets ?? 0) || 0,
      };
    });

    const order: OrderShape = {
      id: orderId,
      customer: {
        name: customerPayload?.label ?? customerPayload?.name ?? '',
        phone: (customerPayload?.phone ?? '') as string,
        email: (customerPayload?.email ?? '') as string,
      },
      agent: { name: '', number: '', email: '' },
      items: itemsForShare,
      createdAt: new Date().toISOString(),
      source: 'web-cart',
    };

    return order;
  }

  // Place Order -> POST to your server API (do NOT use firebase-admin on client)
  const placeOrder = async (): Promise<void> => {
    // wait for Clerk user load
    if (!isLoaded) return;

    if (!isSignedIn || !user) {
      router.push('/signin');
      return;
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      alert('Cart is empty');
      return;
    }

    setPlacing(true);

    try {
      // send one row per selected color (if any), otherwise one row with empty color
      const itemsPayload: OrderItemPayload[] = [];

      for (const it of cartItems) {
        const qty = safeNumber(it.set ?? it.quantity ?? 0);
        const selectedColors: string[] = Array.isArray(it.selectedColors)
          ? it.selectedColors
          : getSelectedColors(it);

        const baseSku = it.id ?? undefined;
        const base: OrderItemPayload = {
          sku: baseSku,
          raw: it.raw ?? null,
          itemName: getItemLabel(it) || undefined,
          qty,
        };

        if (selectedColors.length > 0) {
          for (const c of selectedColors) {
            itemsPayload.push({
              ...base,
              qty,
              color: String(c ?? '').trim(),
            });
          }
        } else {
          itemsPayload.push({
            ...base,
            qty,
            color: '',
          });
        }
      }

      // minimal customer info derived from Clerk user (server will find/create customer)
      const emailAddr = (user?.emailAddresses && user.emailAddresses[0]?.emailAddress) ?? null;
      const userName =
        (user?.fullName as string | undefined) ??
        (user?.firstName as string | undefined) ??
        (user?.username as string | undefined) ??
        (emailAddr as string | undefined) ??
        'Customer';

      const customerPayload: CustomerPayload = {
        label: userName,
        email: (emailAddr as string) ?? null,
        phone: null,
      };

      const payload = {
        customer: customerPayload,
        agent: null,
        items: itemsPayload,
        meta: {
          source: 'web-cart',
          createdBy: (user?.id as string | undefined) ?? null,
        },
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // robust parsing
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = { ok: false, message: 'Invalid response' };
      }

      const asRecord = isObject(json) ? (json as Record<string, unknown>) : {};
      const okFlag = 'ok' in asRecord ? Boolean(asRecord['ok']) : res.ok;
      if (!res.ok || !okFlag) {
        const msg = (isObject(json) && (asRecord['error'] ?? asRecord['message'])) ?? 'Failed to place order';
        throw new Error(String(msg));
      }

      // Build an OrderShape for sharing BEFORE clearing cart
      let createdId: string | undefined = undefined;
      if (isObject(json)) {
        if (asRecord['orderId']) createdId = String(asRecord['orderId']);
        else if (asRecord['id']) createdId = String(asRecord['id']);
        else if (isObject(asRecord['order']) && isObject(asRecord['order'] as unknown)) {
          createdId = String(((asRecord['order'] as Record<string, unknown>)['id']) ?? '');
        }
      }

      const shareOrder = buildOrderShapeFromResponse(createdId, customerPayload, itemsPayload);

      // set the placed order into state and show the share modal
      setPlacedOrderForShare(shareOrder);
      setShowShareModal(true);

      // Clear cart on success (after we captured details)
      if (typeof clearCart === 'function') {
        clearCart();
      } else {
        for (const it of cartItems) removeFromCart(it.id);
      }
    } catch (err: unknown) {
      console.error('Failed to place order:', err);
      const message = isObject(err) && typeof (err as Record<string, unknown>)['message'] === 'string'
        ? String((err as Record<string, unknown>)['message'])
        : String(err);
      alert('Failed to place order: ' + message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06121a] text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Your Cart</h1>
          <p className="text-sm text-slate-300 mt-1">{itemCount} items · {totalSets} total sets</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* left: list (two-thirds) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Master control + select-all-colours */}
            <div className="rounded-xl border border-[#12202a] bg-[#07151a] p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-slate-300 w-28">Master sets</div>
                  <div className="inline-flex items-center gap-2 bg-[#051116] border border-[#12303a] rounded-lg px-2 py-1">
                    <button
                      onClick={() => setMasterQty((v) => Math.max(0, Number(v) - 1))}
                      className="h-9 w-9 rounded-md flex items-center justify-center text-slate-200 hover:bg-[#0b2b33]"
                      aria-label="decrease master qty"
                      type="button"
                    >
                      <Minus className="w-4 h-4" />
                    </button>

                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(masterQty)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const txt = e.target.value.replace(/[^\d]/g, '');
                        setMasterQty(txt === '' ? 0 : Number(txt));
                      }}
                      className="w-20 text-center bg-transparent text-white font-medium outline-none"
                      aria-label="Master sets"
                    />

                    <button
                      onClick={() => setMasterQty((v) => Number(v) + 1)}
                      className="h-9 w-9 rounded-md flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700"
                      aria-label="increase master qty"
                      type="button"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* small checkbox toggle for selecting all colours */}
                  <label className="inline-flex items-center gap-2 ml-3 select-none">
                    <input
                      type="checkbox"
                      checked={selectAllColors}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleSelectAllColors(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-[#07151a] text-blue-500 focus:ring-blue-400"
                      aria-label="Select all colours"
                    />
                    <span className="text-sm text-slate-300">Select all colours</span>
                  </label>
                </div>

                <div className="flex items-center gap-3 md:ml-auto">
                  <button
                    onClick={applyMasterToAll}
                    disabled={applying}
                    className={`px-4 py-2 rounded-md font-semibold ${applying ? 'bg-blue-500/70' : 'bg-blue-600 hover:bg-blue-700'}`}
                    type="button"
                  >
                    {applying ? 'Applying…' : 'Apply to all'}
                  </button>
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-400">
                Set a common number of sets quickly. You can still edit any design individually afterwards.
              </p>
            </div>

            {cartItems.length === 0 ? (
              <div className="rounded-lg bg-[#0b1620] border border-[#12202a] p-8 text-center text-slate-400">
                Your cart is empty.
              </div>
            ) : (
              cartItems.map((item: CartItem) => {
                const qty = safeNumber(item.set ?? item.quantity ?? 0);
                const selectedColors: string[] = Array.isArray(item.selectedColors) ? item.selectedColors : getSelectedColors(item);
                const colors: string[] = getAvailableColors(item);

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
                          src={googleDriveImage(item.image ?? item.image_url ?? null) ? getGoogleDriveImageSrc(item.image ?? item.image_url ?? null) : '/placeholder.svg'}
                          alt={String(item.name ?? '')}
                          width={160}
                          height={160}
                          className="object-cover w-full h-full"
                        />
                      </div>

                      <div>
                        <h2 className="text-lg font-semibold text-white">{item.name}</h2>

                        <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-4">
                          {item.concept && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Concept:</span>{' '}
                              <span className="font-medium text-white">{item.concept}</span>
                            </span>
                          )}
                          {item.fabric && (
                            <span className="text-slate-300">
                              <span className="text-slate-400">Fabric:</span>{' '}
                              <span className="font-medium text-white">{item.fabric}</span>
                            </span>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {colors.length === 0 ? (
                            <div className="text-sm text-slate-400">No colors</div>
                          ) : (
                            colors.map((c: string) => {
                              const isActive = selectedColors.some((sc: string) => String(sc).toLowerCase() === String(c).toLowerCase());
                              return (
                                <button
                                  key={c}
                                  onClick={() => onColorToggle(item, c)}
                                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${isActive
                                    ? 'bg-blue-600 text-white shadow'
                                    : 'bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]'
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
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSetChange(item, Number(e.target.value))}
                            className="w-16 text-center bg-transparent text-white font-medium outline-none"
                            aria-label={`Quantity for ${item.name}`}
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

                        <div className="text-xs text-slate-500 mt-1">&nbsp;</div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* right: order summary */}
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
                  {placing ? 'Placing order…' : 'Place Order'}
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-400">Shipping, taxes and discounts will be calculated at checkout.</p>
            </div>
          </aside>
        </div>
      </div>

      {/* Share modal shown after placing an order */}
      {showShareModal && placedOrderForShare && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Order placed"
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => { setShowShareModal(false); setPlacedOrderForShare(null); }} />
          <div className="relative max-w-lg w-full bg-[#0b1620] border border-[#12202a] rounded-lg p-6 z-10">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Order placed</h3>
                <p className="text-sm text-slate-300 mt-1">
                  Order ID: <span className="font-mono text-slate-200">{placedOrderForShare.id ?? '—'}</span>
                </p>
              </div>

              <button
                onClick={() => { setShowShareModal(false); setPlacedOrderForShare(null); }}
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
              {/* ONLY the green Share button (full) */}
              <ShareOrderButton
                order={placedOrderForShare}
                phone={placedOrderForShare.customer?.phone ?? ''}
                className="!bg-green-600 !hover:bg-green-700"
              />

              <button
                onClick={() => {
                  setShowShareModal(false);
                  setPlacedOrderForShare(null);
                  router.push('/orders');
                }}
                className="ml-auto bg-transparent border border-[#23303a] text-slate-300 px-3 py-2 rounded hover:bg-[#0f1724]"
                type="button"
              >
                View Orders
              </button>
            </div>

            <div className="mt-3 text-xs text-slate-400">
              <em>Tip: The message is also copied to your clipboard on desktop for easy pasting.</em>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
