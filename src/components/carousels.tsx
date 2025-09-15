"use client";

import React, {
  JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useCart } from "@/context/CartContext"; // keep same hook from your ItemsPage

/* -------------------- types -------------------- */
export type CarouselItem = {
  id: string;
  name: string;
  image: string | null; // guaranteed usable URL by parent wrapper (or null)
  wsp?: number | null;
  raw?: Record<string, unknown>;
  available?: number | null; // optional computed
  inProductionQuantity?: number | null; // canonical production key (new)
  colors?: string[]; // optional (if parent provides)
  sizes?: string[]; // optional (if parent provides)
};

type Props = {
  items?: CarouselItem[] | undefined; // undefined => show placeholders, [] => empty
  autoplay?: boolean;
  autoplayInterval?: number;
  step?: number;
  className?: string;
  placeholderCount?: number;
  visibleCount?: number;
  onItemClick?: (it: CarouselItem) => void; // <--- added typed prop
};

type PlaceholderItem = { __placeholder: true; id: string };
type RealRenderItem = CarouselItem & { __placeholder?: false };
type RenderListItem = PlaceholderItem | RealRenderItem;

/* -------------------- helpers -------------------- */

function formatPrice(p?: number | null): string {
  if (p === null || p === undefined || Number.isNaN(Number(p))) return "—";
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Number(p))}`;
}

/**
 * Safely extract a numeric value from an unknown raw object by trying several keys.
 * Returns undefined if none match.
 */
function getNumberFromRaw(raw: unknown, ...keys: string[]): number | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      if (!Number.isNaN(v)) return v;
    } else if (typeof v === "string") {
      const n = Number(v.trim());
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

/** compute available qty — prefer explicit available, else use common raw fields */
function computeDisplayAvailable(it: CarouselItem | null | undefined): number {
  if (!it) return 0;
  if (typeof it.available === "number") return Math.max(0, Math.floor(it.available));
  const raw = it.raw ?? {};
  const closing =
    (getNumberFromRaw(
      raw,
      "Closing_Stock",
      "closingStock",
      "Closing",
      "closing",
      "Available"
    ) ?? 0) || 0;
  const prod =
    (getNumberFromRaw(
      raw,
      "inProductionQuantity",
      "InProductionQuantity",
      "productionQty",
      "production"
    ) ?? 0) || 0;
  return Math.max(0, Math.floor(closing + prod));
}

/** return canonical color array for an item (tries multiple keys) */
function getColorsFromItem(it: CarouselItem): string[] {
  if (Array.isArray(it.colors) && it.colors.length)
    return it.colors.map((c) => String(c ?? "").trim()).filter(Boolean);

  const raw = it.raw ?? {};
  const cand =
    raw?.Colors ??
    raw?.colors ??
    raw?.Color ??
    raw?.colour ??
    raw?.colours ??
    raw?.Colour ??
    null;
  if (Array.isArray(cand) && cand.length) return cand.map((c) => String(c ?? "").trim()).filter(Boolean);

  const maybeStr =
    typeof raw?.Colors?.toString === "function" ? raw.Colors.toString() :
    typeof raw?.colors?.toString === "function" ? raw.colors.toString() : null;

  if (typeof maybeStr === "string" && maybeStr.includes(",")) {
    return maybeStr.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return [];
}

/** return canonical sizes array for an item (tries multiple keys) */
function getSizesFromItem(it: CarouselItem): string[] {
  if (Array.isArray(it.sizes) && it.sizes.length)
    return it.sizes.map((s) => String(s ?? "").trim()).filter(Boolean);

  const raw = it.raw ?? {};
  const cand = raw?.Sizes ?? raw?.sizes ?? null;
  if (Array.isArray(cand) && cand.length) return cand.map((s) => String(s ?? "").trim()).filter(Boolean);

  const maybeStr = typeof raw?.Sizes?.toString === "function" ? raw.Sizes.toString() :
    typeof raw?.sizes?.toString === "function" ? raw.sizes.toString() : null;

  if (typeof maybeStr === "string" && maybeStr.includes(",")) {
    return maybeStr.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return [];
}

/** stock meta for label colors and text */
function stockMetaClass(available: number | null | undefined) {
  const n = typeof available === "number" ? Math.max(0, available) : 0;
  if (n >= 20) {
    return {
      colorClass: "bg-green-600 text-white",
      shortLabel: "In stock",
      label: "In stock",
    };
  }
  if (n > 1) {
    return {
      colorClass: "bg-yellow-500 text-black",
      shortLabel: "Low",
      label: "Low stock",
    }; // yellow with dark text
  }
  return {
    colorClass: "bg-red-600 text-white",
    shortLabel: "Out of stock",
    label: "Out of stock",
  };
}

/* -------------------- component -------------------- */

export default function DesignCardsCarousel({
  items: itemsProp,
  autoplay = true,
  autoplayInterval = 4500,
  visibleCount = 3,
  step = 1,
  className = "",
  placeholderCount = 6,
  onItemClick, // <--- receive callback
}: Props): JSX.Element {
  // consume visibleCount so linter doesn't warn when it's intentionally unused here
  // (you can wire it into layout logic later if desired)
  void visibleCount;

  // internal state synced to parent-provided items (no fetching here)
  const [internalItems, setInternalItems] = useState<CarouselItem[]>(itemsProp ?? []);
  const [loading, setLoading] = useState<boolean>(itemsProp === undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const autoplayRef = useRef<number | null>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  // Modal state
  const [openItem, setOpenItem] = useState<CarouselItem | null>(null);

  // Modal controls: per-item temporary UI state
  const [modalSelectedColors, setModalSelectedColors] = useState<Record<string, string[]>>({});
  const [modalSets, setModalSets] = useState<Record<string, number>>({});
  const [modalSizesMap, setModalSizesMap] = useState<Record<string, Record<string, number>>>({});

  // cart - CALL HOOK AT TOP LEVEL (fixed)
  const rawCartCtx = useCart(); // <- top-level hook call
  const cartCtx = (rawCartCtx as unknown as { addToCart?: (arg: unknown) => void }) ?? {};
  const addToCart = cartCtx.addToCart;

  // sync with parent items
  useEffect(() => {
    if (Array.isArray(itemsProp)) {
      setInternalItems(itemsProp);
      setLoading(false);
    } else {
      setInternalItems([]);
      setLoading(itemsProp === undefined);
    }
  }, [itemsProp]);

  const filteredItems = useMemo(() => internalItems ?? [], [internalItems]);

  // autoplay
  useEffect(() => {
    if (!autoplay) return;
    if (isHovering) return;
    if (loading) return;
    if (!filteredItems || filteredItems.length <= 1) return;

    function tick() {
      scrollByCard(1);
    }
    autoplayRef.current = window.setInterval(tick, autoplayInterval);
    return () => {
      if (autoplayRef.current) {
        window.clearInterval(autoplayRef.current);
        autoplayRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, autoplayInterval, filteredItems, isHovering, loading]);

  const scrollToIndex = useCallback((idx: number) => {
    const container = containerRef.current;
    const card = cardRefs.current.get(idx);
    if (!container || !card) return;
    const left = card.offsetLeft - container.offsetLeft;
    const paddingLeft = parseFloat(getComputedStyle(container).paddingLeft || "0");
    container.scrollTo({ left: left - paddingLeft, behavior: "smooth" });
    setActiveIndex(idx);
  }, []);

  const leftmostVisibleIndex = useCallback((): number => {
    const container = containerRef.current;
    if (!container) return 0;
    const scrollLeft = container.scrollLeft;
    const listLength = loading ? placeholderCount : filteredItems.length;
    for (let i = 0; i < listLength; i++) {
      const el = cardRefs.current.get(i);
      if (!el) continue;
      const elLeft = el.offsetLeft - (container.offsetLeft || 0);
      if (elLeft + 1 >= scrollLeft - 1) return i;
    }
    return Math.max(0, Math.min(Math.max(0, listLength - 1), activeIndex));
  }, [filteredItems.length, activeIndex, loading, placeholderCount]);

  const scrollByCard = useCallback(
    (direction: number) => {
      const listLength = loading ? placeholderCount : filteredItems.length;
      if (listLength === 0) return;
      const leftmost = leftmostVisibleIndex();
      const target = Math.max(
        0,
        Math.min(listLength - 1, leftmost + Math.sign(direction) * Math.max(1, step))
      );
      scrollToIndex(target);
    },
    [filteredItems, leftmostVisibleIndex, scrollToIndex, step, loading, placeholderCount]
  );

  const handlePrev = useCallback(() => scrollByCard(-1), [scrollByCard]);
  const handleNext = useCallback(() => scrollByCard(1), [scrollByCard]);

  // intersection observer to reveal images and update active index
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const idxAttr = el.getAttribute("data-idx");
          if (!idxAttr) continue;
          const idx = Number(idxAttr);
          if (!loading) {
            if (entry.isIntersecting && entry.intersectionRatio > 0.05) {
              const idKey = String(filteredItems[idx]?.id ?? idx);
              setVisibleMap((m) => ({ ...m, [idKey]: true }));
            }
          }
        }
        const left = leftmostVisibleIndex();
        setActiveIndex((prev) => (left !== prev ? left : prev));
      },
      { root: container, threshold: [0.05, 0.25, 0.5, 0.75, 1] }
    );

    const listLength = loading ? placeholderCount : filteredItems.length;
    for (let i = 0; i < listLength; i++) {
      const el = cardRefs.current.get(i);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, loading, placeholderCount]);

  // keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "Escape" && openItem) setOpenItem(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNext, handlePrev, openItem]);

  const renderList: RenderListItem[] = loading
    ? Array.from({ length: placeholderCount }).map((_, i) => ({ __placeholder: true, id: `ph_${i}` }))
    : filteredItems.map((it) => ({ ...(it as CarouselItem), __placeholder: false }));

  /* -------------------- modal helpers -------------------- */

  function openDetailModal(it: CarouselItem) {
    // prepare canonical colors & sizes from item (raw or provided)
    const colors = getColorsFromItem(it);
    const sizes = getSizesFromItem(it);

    // init modal state for this item if not present
    setModalSelectedColors((s) => ({ ...s, [it.id]: colors.length ? [String(colors[0])] : [] }));
    setModalSets((s) => ({ ...s, [it.id]: Math.max(1, Number(s[it.id] ?? 1)) }));

    // sizes: if sizes available map them to 1 initially
    if (sizes.length > 0) {
      setModalSizesMap((m) => {
        if (m[it.id]) return m;
        const per: Record<string, number> = {};
        for (const sz of sizes) per[sz] = 1;
        return { ...m, [it.id]: per };
      });
    } else {
      // ensure sizes map exists (empty)
      setModalSizesMap((m) => ({ ...m, [it.id]: {} }));
    }

    setOpenItem(it);
  }

  function closeModal() {
    setOpenItem(null);
  }

  const modalColorCount = (id: string) =>
    Math.max(1, modalSelectedColors[id]?.length ?? 1);

  // When sets changes, update all size inputs to the same number (1 set = 1 qty in each size)
  function setSetsForItem(id: string, sets: number) {
    const v = Math.max(0, Math.floor(sets || 0));
    setModalSets((m) => ({ ...m, [id]: v }));
    setModalSizesMap((m) => {
      const sizes = m[id] ?? {};
      const newSizes: Record<string, number> = {};
      for (const k of Object.keys(sizes)) newSizes[k] = v;
      return { ...m, [id]: newSizes };
    });
  }

  function incSets(id: string) {
    const cur = Math.max(0, Number(modalSets[id] ?? 1));
    setSetsForItem(id, cur + 1);
  }
  function decSets(id: string) {
    const cur = Math.max(0, Number(modalSets[id] ?? 1));
    setSetsForItem(id, Math.max(0, cur - 1));
  }

  function onSizeInputChange(itemId: string, sizeLabel: string, rawValue: string) {
    const parsed = Math.max(0, Math.floor(Number(rawValue || 0)));
    setModalSizesMap((m) => {
      const prev = m[itemId] ?? {};
      const next = { ...prev, [sizeLabel]: parsed };
      return { ...m, [itemId]: next };
    });

    // Also update sets control to be the per-size value if all sizes equal
    setModalSets((m) => {
      const prevSizes = modalSizesMap[itemId] ?? {};
      const nextSizes = { ...prevSizes, [sizeLabel]: parsed };
      const vals = Object.values(nextSizes);
      const allEqual = vals.length > 0 && vals.every((v) => v === vals[0]);
      if (allEqual) return { ...m, [itemId]: vals[0] };
      return { ...m, [itemId]: m[itemId] ?? 1 };
    });
  }

  function toggleModalColor(itemId: string, color: string) {
    setModalSelectedColors((m) => {
      const existing = Array.isArray(m[itemId]) ? [...m[itemId]] : [];
      const idx = existing.findIndex((c) => String(c).toLowerCase() === String(color).toLowerCase());
      if (idx >= 0) existing.splice(idx, 1);
      else existing.push(color);
      return { ...m, [itemId]: existing };
    });
  }

  function calculateTotalPiecesForModal(it: CarouselItem): number {
    const id = it.id;
    const sizesObj = modalSizesMap[id] ?? {};
    const sizeKeys = Object.keys(sizesObj);
    const selColors = modalSelectedColors[id] ?? [];
    const colorsCount = Math.max(1, selColors.length || 1);
    if (sizeKeys.length > 0) {
      const sumSizes = Object.values(sizesObj).reduce((a, b) => a + (Number(b) || 0), 0);
      return sumSizes * colorsCount;
    }
    const setsRequested = Math.max(0, Math.floor(Number(modalSets[id] ?? 1)));
    return setsRequested * colorsCount;
  }

  function handleModalAddToCart(it: CarouselItem) {
    const displayAvailable = computeDisplayAvailable(it);
    const totalPieces = calculateTotalPiecesForModal(it);

    if (displayAvailable > 0 && totalPieces > displayAvailable) {
      alert(`Only ${displayAvailable} pieces available. Requested ${totalPieces}. Adjust sets/sizes.`);
      return;
    }
    if (displayAvailable === 0) {
      alert("No available stock for this design.");
      return;
    }

    // build cart payload similar to your ItemsPage
    const inProdFromRaw = getNumberFromRaw(it.raw, "InProductionQuantity", "inProductionQty", "in_ProductionQuantity", "inProductionQuantity") ?? 0;
    const closingFromRaw = getNumberFromRaw(it.raw, "Closing_Stock", "closingStock", "Closing", "closing") ?? undefined;

    const payload = {
      id: it.id,
      name: it.name,
      image: it.image ?? "/placeholder.svg",
      colors: getColorsFromItem(it),
      raw: it.raw,
      set: Math.max(0, Math.floor(Number(modalSets[it.id] ?? 1))),
      selectedColors: modalSelectedColors[it.id] ?? [],
      sizes: Object.keys(modalSizesMap[it.id] ?? {}).length ? modalSizesMap[it.id] : undefined,
      inProductionQuantity: it.inProductionQuantity ?? inProdFromRaw,
      closingStock: closingFromRaw,
    };

    try {
      if (addToCart) addToCart(payload);
      else console.warn("addToCart not available in cart context — payload:", payload);
      // keep modal open so user can add more items
    } catch (err) {
      console.error("Add to cart failed:", err);
      alert("Failed to add to cart.");
    }
  }

  /* -------------------- render -------------------- */

  return (
    <>
      <div
        className={`w-full ${className ?? ""}`}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div className="relative">
          <button
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white shadow"
            type="button"
          >
            ‹
          </button>

          <button
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white shadow"
            type="button"
          >
            ›
          </button>

          <div
            ref={containerRef}
            className="no-scrollbar overflow-x-auto scroll-smooth snap-x snap-mandatory flex gap-6 py-2 px-4"
            role="list"
            style={
              {
                msOverflowStyle: "none",
                scrollbarWidth: "none",
              } as React.CSSProperties
            }
          >
            {renderList.length === 0 ? (
              <div className="py-12 text-center w-full text-gray-400">
                No designs
              </div>
            ) : (
              renderList.map((it, idx) => {
                const isPlaceholder = (it as PlaceholderItem).__placeholder === true;
                const idKey = isPlaceholder ? (it as PlaceholderItem).id : (it as RealRenderItem).id;
                const reveal = !isPlaceholder && !!visibleMap[String(idKey)];
                const realItem = !isPlaceholder ? (it as RealRenderItem) : undefined;

                // compute stock meta for card label
                const avail = realItem ? computeDisplayAvailable(realItem) : 0;
                const meta = stockMetaClass(avail);

                // canonical in-prod quantity (prefer field, then raw variants)
                const inProdQty = realItem
                  ? Math.max(0, Number(realItem.inProductionQuantity ?? getNumberFromRaw(realItem.raw, "InProductionQuantity", "inProductionQuantity", "productionQty") ?? 0))
                  : 0;

                return (
                  <div
                    key={String(idKey ?? `card_${idx}`)}
                    data-idx={idx}
                    ref={(el) => {
                      cardRefs.current.set(idx, el ?? null);
                    }}
                    role="listitem"
                    className="snap-start flex-shrink-0 w-[min(360px,86%)] sm:w-[46%] md:w-[32%] lg:w-[24%] rounded-xl overflow-hidden bg-transparent shadow-lg"
                    aria-current={activeIndex === idx}
                  >
                    {isPlaceholder ? (
                      <div className="relative h-[320px] md:h-[360px] bg-gray-800/40 animate-pulse rounded-xl">
                        <div className="absolute inset-4 rounded-lg border border-gray-700 bg-gradient-to-tr from-gray-800/40 to-gray-900/20 flex flex-col justify-end overflow-hidden">
                          <div className="p-4 flex flex-col gap-2">
                            <div className="h-4 w-3/4 rounded bg-gray-700" />
                            <div className="h-4 w-1/2 rounded bg-gray-700" />
                          </div>
                          <div className="p-4 flex items-center justify-between">
                            <div className="h-5 w-24 rounded bg-gray-700" />
                            <div className="h-6 w-16 rounded bg-gray-700" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="relative h-[320px] md:h-[360px] bg-gray-800 cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!realItem) return;
                          // prefer external handler if provided
                          if (typeof onItemClick === "function") onItemClick(realItem);
                          else openDetailModal(realItem);
                        }}
                        onKeyDown={(e) => {
                          if (!realItem) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (typeof onItemClick === "function") onItemClick(realItem);
                            else openDetailModal(realItem);
                          }
                        }}
                      >
                        {/* TOP-LEFT stock pill (moved here) */}
                        <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${meta.colorClass}`}
                          >
                            {meta.label}
                            {avail > 0 ? ` • ${avail}` : ""}
                          </span>

                          {/* More in Production badge (show only when qty > 0) */}
                          {inProdQty > 0 && (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white">
                              More in Production
                              {inProdQty ? ` • ${inProdQty}` : ""}
                            </span>
                          )}
                        </div>

                        {reveal && realItem?.image ? (
                          <Image
                            src={String(realItem.image)}
                            alt={String(realItem.name)}
                            fill
                            style={{ objectFit: "cover" }}
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            priority={idx < 2}
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-800/60 flex items-center justify-center">
                            <svg
                              className="w-12 h-12 text-gray-600"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <rect x="3" y="4" width="18" height="14" rx="2" />
                              <path d="M3 20h18" />
                              <circle cx="8.5" cy="10.5" r="1.5" />
                            </svg>
                          </div>
                        )}

                        {/* bottom overlay (keep other meta here but remove stock pill) */}
                        <div className="absolute left-0 right-0 bottom-0 p-3 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-sm text-gray-300">
                                  Design
                                </div>
                              </div>

                              <div className="text-lg font-semibold text-white truncate mt-1">
                                {realItem?.name}
                              </div>
                            </div>

                            <div className="ml-3 text-right">
                              <div className="text-xs text-gray-300">Price</div>
                              <div className="text-sm font-semibold text-white">
                                {formatPrice(realItem?.wsp)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* index badge */}
                        <div className="absolute top-3 right-3 w-10 h-10 rounded-md bg-white/6 backdrop-blur-sm border border-white/6 flex items-center justify-center text-xs text-white">
                          {idx + 1}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* --------- Full item modal (only one!) ---------- */}
      {openItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-6 overflow-auto"
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => closeModal()}
            aria-hidden
          />

          {/* modal panel */}
          <div className="relative z-10 w-full max-w-5xl rounded-lg overflow-hidden bg-[#0b1a22] border border-[#20303a] shadow-2xl flex flex-col sm:flex-row max-h-[90vh]">
            {/* LEFT: image */}
            <div className="w-full sm:w-1/2 min-h-[420px] relative bg-gray-800 overflow-hidden">
              <div className="absolute left-4 top-4 z-20 flex flex-col gap-2">
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                    stockMetaClass(computeDisplayAvailable(openItem)).colorClass
                  }`}
                >
                  Available: {computeDisplayAvailable(openItem)}
                </span>

                {/* modal "More in Production" badge */}
                {(() => {
                  const inProdModalQty = Math.max(
                    0,
                    Number(openItem?.inProductionQuantity ?? getNumberFromRaw(openItem?.raw, "InProductionQuantity", "inProductionQuantity") ?? 0)
                  );
                  if (inProdModalQty > 0) {
                    return (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white">
                        More in Production
                        {inProdModalQty ? ` • ${inProdModalQty}` : ""}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>

              {openItem.image ? (
                <div className="w-full h-full relative">
                  <Image
                    src={String(openItem.image)}
                    alt={openItem.name}
                    fill
                    style={{ objectFit: "cover" }}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw"
                  />
                </div>
              ) : (
                <div className="w-full h-full bg-gray-900 flex items-center justify-center text-gray-400">
                  No image
                </div>
              )}
            </div>

            {/* RIGHT: details (mirror ItemsPage card layout) */}
            <div className="w-full sm:w-1/2 p-6 flex flex-col overflow-auto">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    {openItem.name}
                  </h2>
                  <div className="mt-1 text-sm text-gray-300">
                    Concept:{" "}
                    {String(openItem.raw?.Concept ?? openItem.raw?.concept ?? "—")}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-gray-300">Rs.</div>
                  <div className="text-lg font-semibold text-white">
                    {formatPrice(openItem.wsp)}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-sm text-gray-300">
                <div className="mb-2 font-medium text-gray-200">Colors</div>
                <div className="flex gap-2 flex-wrap">
                  {(() => {
                    const colors = getColorsFromItem(openItem);
                    if (colors.length === 0)
                      return <div className="text-gray-400">—</div>;
                    return colors.map((c) => {
                      const isActive = (modalSelectedColors[openItem!.id] || []).some(
                        (sc) => String(sc).toLowerCase() === String(c).toLowerCase()
                      );
                      return (
                        <button
                          key={c}
                          onClick={() => toggleModalColor(openItem!.id, c)}
                          className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                            isActive
                              ? "bg-blue-600 text-white shadow"
                              : "bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]"
                          }`}
                        >
                          {c}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Sizes (if present) */}
              {(() => {
                const sizes = getSizesFromItem(openItem);
                if (sizes.length > 0) {
                  return (
                    <>
                      <div className="mt-4 text-sm text-gray-300 font-medium">
                        Sizes
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {sizes.map((sz) => {
                          const val = modalSizesMap[openItem!.id]?.[sz] ?? modalSets[openItem!.id] ?? 1;
                          return (
                            <div key={sz} className="border border-gray-700 rounded px-3 py-2 flex items-center justify-between">
                              <div className="text-sm text-gray-200">{sz}</div>
                              <input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={String(val)}
                                onChange={(e) => onSizeInputChange(openItem!.id, sz, e.target.value)}
                                className="w-16 text-center bg-transparent text-white font-medium outline-none"
                                aria-label={`Qty for size ${sz}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                }
                return null;
              })()}

              {/* Sets control */}
              <div className="mt-6 flex items-center gap-4">
                <div className="inline-flex items-center gap-2 bg-[#051116] border border-[#12303a] rounded-lg px-2 py-1">
                  {/* disable + when next increment would exceed available */}
                  {(() => {
                    const available = computeDisplayAvailable(openItem as CarouselItem);
                    const colorsCount = modalColorCount(openItem!.id);
                    const sizes = getSizesFromItem(openItem as CarouselItem);
                    const numSizes = sizes.length;
                    const curSets = Math.max(0, Number(modalSets[openItem!.id] ?? 1));
                    const nextSets = curSets + 1;
                    const nextTotal = numSizes > 0 ? nextSets * colorsCount * numSizes : nextSets * colorsCount;
                    const disableInc = available > 0 ? nextTotal > available : false;
                    return (
                      <>
                        <button
                          onClick={() => decSets(openItem!.id)}
                          className="h-10 w-10 rounded-md flex items-center justify-center text-slate-200 hover:bg-[#0b2b33]"
                          aria-label="decrease sets"
                          type="button"
                        >
                          −
                        </button>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(modalSets[openItem!.id] ?? 1)}
                          onChange={(e) => setSetsForItem(openItem!.id, Math.max(0, Number(e.target.value || 0)))}
                          className="w-20 text-center bg-transparent text-white font-medium outline-none"
                          aria-label="Sets to order"
                        />
                        <button
                          onClick={() => incSets(openItem!.id)}
                          className={`h-10 w-10 rounded-md flex items-center justify-center text-white ${disableInc ? "bg-gray-600 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
                          aria-label="increase sets"
                          type="button"
                          disabled={disableInc}
                        >
                          +
                        </button>
                      </>
                    );
                  })()}
                </div>
                <div className="text-sm text-gray-400">Sets to order</div>
              </div>

              {/* bottom meta + actions */}
              <div className="mt-4 text-sm text-gray-300">
                <strong className={stockMetaClass(computeDisplayAvailable(openItem as CarouselItem)).colorClass.replace(" ", " ")}>
                  Available Qty:
                </strong>{" "}
                <span className="ml-2">{computeDisplayAvailable(openItem as CarouselItem)}</span>
                <span className="ml-4 text-sm text-gray-400">
                  Total pieces (selected):{" "}
                  {(() => {
                    const total = openItem ? calculateTotalPiecesForModal(openItem) : 0;
                    return total;
                  })()}
                </span>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={() => handleModalAddToCart(openItem!)}
                  className="flex-1 py-3 px-4 rounded font-semibold text-white bg-blue-600 hover:bg-blue-700"
                >
                  <svg className="h-5 w-5 inline-block mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 6h15l-1.5 9h-13z" />
                    <path d="M6 6L4 2" />
                    <circle cx="10" cy="20" r="1" />
                    <circle cx="18" cy="20" r="1" />
                  </svg>
                  Add to Cart
                </button>

                <button onClick={() => closeModal()} className="px-4 py-3 rounded text-sm bg-transparent border border-gray-700 text-white">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
