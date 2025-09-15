// components/DesignCardsCarousel.tsx
"use client";

import React, { JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Select, { StylesConfig } from "react-select";

/* -------------------------
   Types (compatible with ClientCarouselWrapper)
   ------------------------- */
export type CarouselItem = {
  id: string;
  name: string;
  image: string; // resolved (placeholder if missing)
  wsp?: number | null;
  raw?: Record<string, unknown>;
  available?: number | null;
  productionQty?: number | null;
};

/* -------------------------
   Helpers copied from ItemsPage for consistent UX
   ------------------------- */
type Option = { value: string; label: string };

function classifyStock(qty: number | null | undefined): "low" | "medium" | "high" | "unknown" {
  if (qty === null || qty === undefined) return "unknown";
  const n = Number(qty);
  if (Number.isNaN(n)) return "unknown";
  if (n <= 4) return "low";
  if (n <= 24) return "medium";
  return "high";
}
function stockMeta(qty: number | null | undefined) {
  const cls = classifyStock(qty);
  if (cls === "low") return { label: "Low stock", shortLabel: "Low", colorClass: "bg-red-600 text-white" };
  if (cls === "medium") return { label: "Medium stock", shortLabel: "Medium", colorClass: "bg-orange-500 text-white" };
  if (cls === "high") return { label: "In stock", shortLabel: "In stock", colorClass: "bg-green-600 text-white" };
  return { label: "Unknown", shortLabel: "Unknown", colorClass: "bg-gray-600 text-white" };
}
function toOptions(arr?: string[]): Option[] {
  if (!arr || !Array.isArray(arr)) return [];
  const uniq = Array.from(new Set(arr.map((s) => String(s || "").trim()).filter(Boolean))).sort();
  return uniq.map((v) => ({ value: v, label: v }));
}

/* reuse your items page select styling for consistent look */
const selectStyles: StylesConfig<Option, true> = {
  control: (provided) => ({ ...provided, background: "#0f1724", borderColor: "#243047", minHeight: 40, color: "#e5e7eb" }),
  menu: (provided) => ({ ...provided, background: "#0f1724", color: "#e5e7eb" }),
  option: (provided, state) => ({ ...provided, background: state.isSelected ? "#153f63" : state.isFocused ? "#132f44" : "#0f1724", color: "#e5e7eb" }),
  singleValue: (provided) => ({ ...provided, color: "#e5e7eb" }),
  input: (provided) => ({ ...provided, color: "#e5e7eb" }),
  placeholder: (provided) => ({ ...provided, color: "#94a3b8" }),
  multiValue: (provided) => ({ ...provided, background: "#1f2937", color: "#e5e7eb" }),
  multiValueLabel: (provided) => ({ ...provided, color: "#e5e7eb" }),
  multiValueRemove: (provided) => ({ ...provided, color: "#94a3b8", ":hover": { background: "#374151", color: "white" } }),
};

/* -------------------------
   Component
   ------------------------- */
export default function DesignCardsCarousel({
  items = [],
  onItemClick,
  autoplay = true,
  autoplayInterval = 4500,
  className = "",
  placeholderCount = 6,
}: {
  items?: CarouselItem[] | undefined;
  onItemClick?: (item: CarouselItem) => void;
  autoplay?: boolean;
  autoplayInterval?: number;
  className?: string;
  placeholderCount?: number;
}): JSX.Element {
  // filters
  const [selectedConcepts, setSelectedConcepts] = useState<Option[]>([]);
  const [selectedFabrics, setSelectedFabrics] = useState<Option[]>([]);
  const [selectedColors, setSelectedColors] = useState<Option[]>([]);

  // carousel state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map<number, HTMLDivElement | null>());
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const autoplayRef = useRef<number | null>(null);

  // lazy reveal map and broken image map
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  // derive filter options
  const conceptOptions = useMemo(() => toOptions(items.map((i) => String(i.raw?.["Concept"] ?? i.raw?.["concept"] ?? i.raw?.["Concept_2"] ?? i.name)).filter(Boolean)), [items]);
  const fabricOptions = useMemo(() => toOptions(items.map((i) => String(i.raw?.["Fabric"] ?? i.raw?.["fabric"] ?? i.name)).filter(Boolean)), [items]);
  const colorOptions = useMemo(() => toOptions(items.flatMap((i) => (Array.isArray(i.raw?.["Colors"]) ? (i.raw?.["Colors"] as unknown[]) : []) as string[])), [items]);

  const computeAvailable = useCallback((it: CarouselItem): number => {
    // prefer item.available if provided; else fall back to raw closing/prod fields.
    if (typeof it.available === "number") return Math.max(0, it.available);
    const rec = it.raw ?? {};
    const closing = Number(rec["closingStock"] ?? rec["ClosingStock"] ?? rec["closing_stock"] ?? rec["closing"] ?? 0) || 0;
    const prod = Number(rec["productionQty"] ?? rec["production_qty"] ?? rec["production"] ?? 0) || 0;
    return Math.max(0, closing + prod);
  }, []);

  // filter rule: hide items with available <= 1 and not in production
  const filteredItems = useMemo(() => {
    const conc = selectedConcepts.map((c) => c.value.toLowerCase());
    const fab = selectedFabrics.map((c) => c.value.toLowerCase());
    const cols = selectedColors.map((c) => c.value.toLowerCase());

    return (items || []).filter((it) => {
      if (!it.image) return false; // require image (caller should provide placeholder)
      const available = computeAvailable(it);
      const inProd = Boolean(it.productionQty && it.productionQty > 0);
      if (available <= 1 && !inProd) return false;

      if (conc.length > 0) {
        const v = String(it.raw?.["Concept"] ?? it.raw?.["concept"] ?? it.raw?.["Concept_2"] ?? it.name).toLowerCase();
        if (!conc.includes(v)) return false;
      }
      if (fab.length > 0) {
        const v = String(it.raw?.["Fabric"] ?? it.raw?.["fabric"] ?? "").toLowerCase();
        if (!fab.includes(v)) return false;
      }
      if (cols.length > 0) {
        const itemCols = Array.isArray(it.raw?.["Colors"]) ? (it.raw?.["Colors"] as unknown[]).map(String).map((s) => s.toLowerCase()) : [];
        if (!cols.some((c) => itemCols.includes(c))) return false;
      }
      return true;
    });
  }, [items, selectedConcepts, selectedFabrics, selectedColors, computeAvailable]);

  /* Autoplay */
  useEffect(() => {
    if (!autoplay) return;
    if (isHovering) return;
    if (!filteredItems || filteredItems.length <= 1) return;

    function tick() {
      setActiveIndex((prev) => {
        const next = prev + 1 >= filteredItems.length ? 0 : prev + 1;
        const el = cardRefs.current.get(next);
        if (el && containerRef.current) {
          containerRef.current.scrollTo({ left: el.offsetLeft - containerRef.current.offsetLeft, behavior: "smooth" });
        }
        return next;
      });
    }
    autoplayRef.current = window.setInterval(tick, autoplayInterval);
    return () => {
      if (autoplayRef.current) {
        window.clearInterval(autoplayRef.current);
        autoplayRef.current = null;
      }
    };
  }, [autoplay, autoplayInterval, filteredItems, isHovering]);

  /* IntersectionObserver for reveal & active index */
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
          if (entry.isIntersecting && entry.intersectionRatio > 0.05) {
            const it = filteredItems[idx];
            if (it) setVisibleMap((m) => ({ ...m, [String(it.id)]: true }));
            setActiveIndex((prev) => (prev === idx ? prev : idx));
          }
        }
      },
      { root: container, threshold: [0.05, 0.25, 0.5] }
    );

    for (let i = 0; i < filteredItems.length; i++) {
      const el = cardRefs.current.get(i);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [filteredItems]);

  /* keyboard nav */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        const prev = Math.max(0, activeIndex - 1);
        const el = cardRefs.current.get(prev);
        if (el && containerRef.current) containerRef.current.scrollTo({ left: el.offsetLeft - containerRef.current.offsetLeft, behavior: "smooth" });
        setActiveIndex(prev);
      }
      if (e.key === "ArrowRight") {
        const next = Math.min(filteredItems.length - 1, activeIndex + 1);
        const el = cardRefs.current.get(next);
        if (el && containerRef.current) containerRef.current.scrollTo({ left: el.offsetLeft - containerRef.current.offsetLeft, behavior: "smooth" });
        setActiveIndex(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, filteredItems.length]);

  const handlePrev = useCallback(() => {
    const prev = Math.max(0, activeIndex - 1);
    const el = cardRefs.current.get(prev);
    if (el && containerRef.current) containerRef.current.scrollTo({ left: el.offsetLeft - containerRef.current.offsetLeft, behavior: "smooth" });
    setActiveIndex(prev);
  }, [activeIndex]);

  const handleNext = useCallback(() => {
    const next = Math.min(filteredItems.length - 1, activeIndex + 1);
    const el = cardRefs.current.get(next);
    if (el && containerRef.current) containerRef.current.scrollTo({ left: el.offsetLeft - containerRef.current.offsetLeft, behavior: "smooth" });
    setActiveIndex(next);
  }, [activeIndex, filteredItems.length]);

  const markBroken = useCallback((id: string) => setBrokenImages((b) => ({ ...b, [id]: true })), []);

  const clearFilters = useCallback(() => {
    setSelectedConcepts([]);
    setSelectedFabrics([]);
    setSelectedColors([]);
  }, []);

  const formatPrice = (p?: number | null) => {
    if (p === null || p === undefined || Number.isNaN(Number(p))) return "—";
    return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(p))}`;
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Filters row (styled like ItemsPage) */}
      <div className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select isMulti options={conceptOptions} value={selectedConcepts} onChange={(v) => setSelectedConcepts((v ?? []) as Option[])} placeholder="Filter by concept..." styles={selectStyles} />
          <Select isMulti options={fabricOptions} value={selectedFabrics} onChange={(v) => setSelectedFabrics((v ?? []) as Option[])} placeholder="Filter by fabric..." styles={selectStyles} />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Select isMulti options={colorOptions} value={selectedColors} onChange={(v) => setSelectedColors((v ?? []) as Option[])} placeholder="Filter by colour..." styles={selectStyles} />
            </div>
            <div>
              <button type="button" onClick={clearFilters} className="px-3 py-2 rounded-md bg-[#0f1724] border border-[#243047] text-sm text-slate-200">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm text-slate-300">{filteredItems.length} designs</div>
      </div>

      {/* Carousel */}
      <div className="relative">
        <button aria-label="Previous" onClick={handlePrev} className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white shadow">
          ‹
        </button>

        <button aria-label="Next" onClick={handleNext} className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white shadow">
          ›
        </button>

        <div
          ref={containerRef}
          className="no-scrollbar overflow-x-auto scroll-smooth snap-x snap-mandatory flex gap-6 py-2 px-4"
          role="list"
          style={{ msOverflowStyle: "none", scrollbarWidth: "none" } as React.CSSProperties}
        >
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center w-full text-gray-400">No designs</div>
          ) : (
            filteredItems.map((it, idx) => {
              const reveal = !!visibleMap[it.id];
              const available = computeAvailable(it);
              const meta = stockMeta(available);
              const inProd = Boolean(it.productionQty && it.productionQty > 0);

              return (
                <div
                  key={it.id}
                  data-idx={idx}
                  /* <- FIX: make sure the ref callback returns void (don't return Map.set result) and clean up when el === null */
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(idx, el);
                    } else {
                      cardRefs.current.delete(idx);
                    }
                  }}
                  role="listitem"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onItemClick?.(it);
                    }
                  }}
                  onClick={() => onItemClick?.(it)}
                  className="snap-start flex-shrink-0 w-[min(360px,86%)] sm:w-[46%] md:w-[32%] lg:w-[24%] rounded-xl overflow-hidden bg-transparent shadow-lg cursor-pointer"
                >
                  <div className="relative h-[320px] md:h-[360px] bg-gray-800">
                    {reveal && it.image ? (
                      <div className="absolute inset-0">
                        <Image
                          src={brokenImages[it.id] ? "/placeholder.svg" : String(it.image)}
                          alt={it.name}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          style={{ objectFit: "cover" }}
                          onError={() => markBroken(it.id)}
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="w-full h-full bg-gray-800/60 flex items-center justify-center">
                        <svg className="w-12 h-12 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="4" width="18" height="14" rx="2" />
                          <path d="M3 20h18" />
                          <circle cx="8.5" cy="10.5" r="1.5" />
                        </svg>
                      </div>
                    )}

                    <div className="absolute left-0 right-0 bottom-0 p-3 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-gray-300">Design</div>
                            <div className="flex items-center gap-2 ml-2">
                              {available > 0 ? (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${meta.colorClass}`}>{meta.shortLabel}{available ? ` • ${available}` : ""}</span>
                              ) : null}
                              {inProd ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">In production</span> : null}
                              {available <= 0 && !inProd ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600 text-white">Out of stock</span> : null}
                            </div>
                          </div>

                          <div className="text-lg font-semibold text-white truncate mt-1">{it.name}</div>
                        </div>

                        <div className="ml-3 text-right">
                          <div className="text-xs text-gray-300">Price</div>
                          <div className="text-sm font-semibold text-white">{formatPrice(it.wsp)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="absolute top-3 right-3 w-10 h-10 rounded-md bg-white/6 backdrop-blur-sm border border-white/6 flex items-center justify-center text-xs text-white">
                      {idx + 1}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

