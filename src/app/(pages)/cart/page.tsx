// src/app/cart/page.tsx
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Trash2, Plus, Minus } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { ShareOrderButton, OrderShape } from '@/components/ShareOrder';


function getGoogleDriveImageSrc(googleDriveUrl?: string | null) {
  if (!googleDriveImage(googleDriveUrl)) return '/placeholder.svg';
  const m = googleDriveUrl!.match(/\/d\/([^\/]+)/);
  if (m?.[1]) return `https://drive.google.com/thumbnail?id=${m[1]}`;
  return googleDriveUrl!;
}
function googleDriveImage(u?: string | null) {
  return typeof u === 'string' && u.length > 0;
}

export default function CartPage() {
  const { cartItems, removeFromCart, updateItem, getTotalSets, clearCart } = useCart() as any;
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();

  // Master sets input - default 0
  const [masterQty, setMasterQty] = useState<number>(0);
  const [applying, setApplying] = useState(false);

  // New: select all colours toggle
  const [selectAllColors, setSelectAllColors] = useState<boolean>(false);

  // placing state
  const [placing, setPlacing] = useState(false);

  // Share modal state shown after successful order
  const [showShareModal, setShowShareModal] = useState(false);
  const [placedOrderForShare, setPlacedOrderForShare] = useState<OrderShape | null>(null);

  // helpers
  const itemCount = cartItems.length;
  const totalSets =
    typeof getTotalSets === 'function'
      ? getTotalSets()
      : cartItems.reduce((s: number, it: any) => s + (Number(it.set ?? it.quantity ?? 0) || 0), 0);

  const inc = (it: any) => {
    const cur = Number(it.set ?? it.quantity ?? 0) || 0;
    updateItem(it.id, { set: cur + 1 });
  };
  const dec = (it: any) => {
    const cur = Number(it.set ?? it.quantity ?? 0) || 0;
    updateItem(it.id, { set: Math.max(0, cur - 1) });
  };
  const onSetChange = (it: any, v: number | string) => {
    const n = Math.max(0, Number(v) || 0);
    updateItem(it.id, { set: n });
  };

  // toggle a single color pill for an item (multi-select)
  const onColorToggle = (it: any, color: string) => {
    const prev = Array.isArray(it.selectedColors) ? [...it.selectedColors] : [];
    const idx = prev.findIndex((c) => String(c).toLowerCase() === String(color).toLowerCase());
    if (idx >= 0) {
      prev.splice(idx, 1);
    } else {
      prev.push(color);
    }
    updateItem(it.id, { selectedColors: prev });
  };

  // Apply master qty to all items
  const applyMasterToAll = async () => {
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
  const toggleSelectAllColors = (value: boolean) => {
    setSelectAllColors(value);
    for (const it of cartItems) {
      const colours = Array.isArray(it.available_colors) && it.available_colors.length > 0
        ? it.available_colors
        : Array.isArray(it.colors) && it.colors.length > 0
          ? it.colors
          : [];
      if (value) {
        const dedup = Array.from(new Set(colours.map((c: any) => String(c).trim()).filter(Boolean)));
        updateItem(it.id, { selectedColors: dedup });
      } else {
        updateItem(it.id, { selectedColors: [] });
      }
    }
  };

  // helper to build OrderShape for the share component from the payload & items
  function buildOrderShapeFromResponse(orderId: string | undefined, customerPayload: any, itemsPayload: any[]) {
    const itemsForShare = (itemsPayload || []).map((r: any) => {
      // r may have itemName, sku, qty, color
      return {
        itemName: r.itemName ?? r.sku ?? r.label ?? String(r.itemName ?? ''),
        color: String(r.color ?? ''), // empty string ok
        quantity: Number(r.qty ?? r.quantity ?? r.sets ?? 0) || 0,
      };
    });

    const order: OrderShape = {
      id: orderId,
      customer: {
        name: customerPayload?.label ?? customerPayload?.name ?? '',
        phone: customerPayload?.phone ?? '',
        email: customerPayload?.email ?? '',
      },
      agent: { name: '', number: '', email: '' },
      items: itemsForShare,
      createdAt: new Date().toISOString(),
      source: 'web-cart',
    };

    return order;
  }

  // Place Order -> POST to your server API (do NOT use firebase-admin on client)
  const placeOrder = async () => {
    // wait for Clerk user load
    if (!isLoaded) return;

    if (!isSignedIn || !user) {
      router.push('/signin');
      return;
    }

    if (!cartItems || cartItems.length === 0) {
      alert('Cart is empty');
      return;
    }

    setPlacing(true);

    try {
      // send one row per selected color (if any), otherwise one row with empty color
      const itemsPayload: any[] = [];

      for (const it of cartItems) {
        const qty = Number(it.set ?? it.quantity ?? 0) || 0;
        const selectedColors = Array.isArray(it.selectedColors)
          ? it.selectedColors
          : it.selectedColor
            ? [it.selectedColor]
            : [];

        const base = {
          sku: it.id ?? it.sku ?? it.itemId ?? String(it.name ?? ''),
          raw: it.raw ?? null,
          itemName: it.name ?? it.label ?? it.skuLabel ?? undefined,
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
      const customerPayload = {
        label: user?.fullName ?? user?.firstName ?? user?.username ?? user?.emailAddresses?.[0]?.emailAddress ?? 'Customer',
        email: user?.emailAddresses?.[0]?.emailAddress ?? null,
        phone: null,
      };

      const payload = {
        customer: customerPayload,
        agent: null,
        items: itemsPayload,
        meta: {
          source: 'web-cart',
          createdBy: user?.id ?? null,
        },
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({ ok: false, message: 'Invalid response' }));

      if (!res.ok || !json.ok) {
        const msg = json?.error ?? json?.message ?? 'Failed to place order';
        throw new Error(msg);
      }

      // Build an OrderShape for sharing BEFORE clearing cart
      const createdId = json.orderId ?? json.id ?? (json.order && json.order.id) ?? undefined;
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

      // (do not auto navigate — let user share or go to orders)
      // router.push('/orders'); <- removed to allow sharing
    } catch (err: any) {
      console.error('Failed to place order:', err);
      alert('Failed to place order: ' + (err?.message ?? String(err)));
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
                    >
                      <Minus className="w-4 h-4" />
                    </button>

                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(masterQty)}
                      onChange={(e) => {
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
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* small checkbox toggle for selecting all colours */}
                  <label className="inline-flex items-center gap-2 ml-3 select-none">
                    <input
                      type="checkbox"
                      checked={selectAllColors}
                      onChange={(e) => toggleSelectAllColors(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-[#07151a] text-blue-500 focus:ring-blue-400"
                      aria-label="Select all colours"
                    />
                    <span className="text-sm text-slate-300">Select all colours</span>
                  </label>
                </div>

                <div className="flex items-center gap-3 md:ml-auto">
                  <button
                    onClick={applyMasterToAll}
                    disabled={applying || masterQty === null}
                    className={`px-4 py-2 rounded-md font-semibold ${applying ? 'bg-blue-500/70' : 'bg-blue-600 hover:bg-blue-700'}`}
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
              cartItems.map((item: any) => {
                const qty = Number(item.set ?? item.quantity ?? 0) || 0;
                const selectedColors = Array.isArray(item.selectedColors) ? item.selectedColors : [];
                const colors = item.available_colors ?? item.colors ?? [];

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
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="grid grid-cols-[88px_1fr_220px] gap-6 items-start p-6">
                      <div className="w-20 h-20 rounded-md overflow-hidden bg-[#0f1724] flex items-center justify-center">
                        <Image
                          src={googleDriveImage(item.image || item.image_url) ? getGoogleDriveImageSrc(item.image || item.image_url) : '/placeholder.svg'}
                          alt={item.name}
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
                              const isActive = selectedColors.some((sc: any) => String(sc).toLowerCase() === String(c).toLowerCase());
                              return (
                                <button
                                  key={c}
                                  onClick={() => onColorToggle(item, c)}
                                  className={`px-3 py-1 rounded-full text-sm font-medium transition ${isActive
                                    ? 'bg-blue-600 text-white shadow'
                                    : 'bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]'
                                    }`}
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
                          >
                            <Minus className="w-4 h-4" />
                          </button>

                          <input
                            type="number"
                            min={0}
                            value={String(qty)}
                            onChange={(e) => onSetChange(item, Number(e.target.value))}
                            className="w-16 text-center bg-transparent text-white font-medium outline-none"
                            aria-label={`Quantity for ${item.name}`}
                          />

                          <button
                            onClick={() => inc(item)}
                            className="h-9 w-9 rounded-md flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700"
                            aria-label="Increase"
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
