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

type RawRow = Record<string, unknown>;

export type CarouselItem = {
  id: string;
  name: string;
  image: string | null;
  wsp?: number | null;
  raw?: RawRow;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getRowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isObject(payload) && Array.isArray(payload["rows"]))
    return payload["rows"] as unknown[];
  return [];
}

function getCleanFileUrl(fileUrl?: string): string | null {
  if (!fileUrl) return null;
  try {
    const s = String(fileUrl).trim();
    if (!s) return null;
    const driveFileMatch = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i);
    if (driveFileMatch && driveFileMatch[1]) {
      const id = driveFileMatch[1];
      return `https://drive.google.com/uc?export=view&id=${id}`;
    }
    const driveOpenMatch = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i);
    if (driveOpenMatch && driveOpenMatch[1] && s.includes("drive.google.com")) {
      const id = driveOpenMatch[1];
      return `https://drive.google.com/uc?export=view&id=${id}`;
    }
    if (
      s.includes("drive.google.com/uc") ||
      s.includes("googleusercontent.com")
    )
      return s;
    const withoutView = s.replace(/\/view(\?.*)?$/i, "");
    if (withoutView !== s) return withoutView;
    if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return null;
  } catch {
    return null;
  }
}

async function fetchItemsFromApi(): Promise<CarouselItem[]> {
  try {
    const res = await fetch("/api/items");
    const text = await res.text();
    if (!res.ok) return [];
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text as unknown;
    }
    const rawList = getRowsFromPayload(payload);
    const normalized: CarouselItem[] = rawList.map((r: unknown, i: number) => {
      const rec = typeof r === "object" && r !== null ? (r as RawRow) : {};
      const idCandidate =
        rec["Item"] ?? rec["Product_Code"] ?? rec["product_code"] ?? `item_${i}`;
      const id = String(idCandidate ?? "").trim();
      const name = String(rec["Item"] ?? rec["Product_Code"] ?? id).trim();
      const thumbnail = (rec["Thumbnail_URL"] ??
        rec["thumbnail"] ??
        rec["thumbnail_url"] ??
        null) as string | null;
      const rawFileUrl = (rec["File_URL"] ??
        rec["FileUrl"] ??
        rec["file_url"] ??
        rec["FileUrl_raw"]) as string | undefined;
      const fileUrl = getCleanFileUrl(rawFileUrl);
      const image = (fileUrl || thumbnail) ?? null;
      const wspRaw =
        rec["WSP"] ?? rec["wsp"] ?? rec["Price"] ?? rec["price"] ?? null;
      const wspNum = wspRaw === null ? null : Number(wspRaw);
      const wsp = Number.isNaN(wspNum) ? null : wspNum;
      return {
        id,
        name: name || id,
        image,
        wsp,
        raw: rec,
      };
    });
    return normalized;
  } catch {
    return [];
  }
}

/* ----------------------
   Carousel component (one-by-one scrolling)
   ---------------------- */

type Props = {
  items?: CarouselItem[]; // optional override list
  autoplay?: boolean;
  autoplayInterval?: number;
  step?: number;
  className?: string;
  placeholderCount?: number; // how many skeleton cards during loading
  visibleCount?: number; // allow wrapper to pass visible count (optional)
};


type PlaceholderItem = { __placeholder: true; id: string };
type RealRenderItem = CarouselItem & { __placeholder?: false };
type RenderListItem = PlaceholderItem | RealRenderItem;

export default function DesignCardsCarousel({
  items: itemsProp,
  autoplay = true,
  autoplayInterval = 4500,
  visibleCount = 3, // <-- default value; you can adjust
  step = 1,
  className = "",
  placeholderCount = 6,
}: Props): JSX.Element {
  const [items, setItems] = useState<CarouselItem[]>(itemsProp ?? []);
  const [loading, setLoading] = useState<boolean>(!Boolean(itemsProp));
  const containerRef = useRef<HTMLDivElement | null>(null);
  // map index -> element ref
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const autoplayRef = useRef<number | null>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (itemsProp && Array.isArray(itemsProp)) {
      setItems(itemsProp);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const fetched = await fetchItemsFromApi();
      if (cancelled) return;
      setItems(fetched);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemsProp]);

  const filteredItems = useMemo(
    () => items.filter((it) => Boolean(it.image)),
    [items]
  );

  useEffect(() => {
    if (!autoplay) return;
    if (isHovering) return;
    if (loading) return; // don't autoplay while loading placeholders
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
  }, [autoplay, autoplayInterval, filteredItems, isHovering, step, loading]);

  const scrollToIndex = useCallback((idx: number) => {
    const container = containerRef.current;
    const card = cardRefs.current.get(idx);
    if (!container || !card) return;
    const left = card.offsetLeft - container.offsetLeft;
    const paddingLeft = parseFloat(
      getComputedStyle(container).paddingLeft || "0"
    );
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

  const scrollByCard = useCallback((direction: number) => {
    const listLength = loading ? placeholderCount : filteredItems.length;
    if (listLength === 0) return;
    const leftmost = leftmostVisibleIndex();
    const target = Math.max(
      0,
      Math.min(
        listLength - 1,
        leftmost + Math.sign(direction) * Math.max(1, step)
      )
    );
    scrollToIndex(target);
  }, [filteredItems, leftmostVisibleIndex, scrollToIndex, step, loading, placeholderCount]);

  const handlePrev = useCallback(() => scrollByCard(-1), [scrollByCard]);
  const handleNext = useCallback(() => scrollByCard(1), [scrollByCard]);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNext, handlePrev]);

  const formatPrice = useCallback((p?: number | null): string => {
    if (p === null || p === undefined || Number.isNaN(Number(p))) return "—";
    return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(p))}`;
  }, []);

  const renderList: RenderListItem[] = loading
    ? Array.from({ length: placeholderCount }).map((_, i) => ({ __placeholder: true, id: `ph_${i}` }))
    : filteredItems.map((it) => ({ ...(it as CarouselItem), __placeholder: false }));

  return (
    <div
      className={`w-full ${className}`}
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
        >
          ›
        </button>

        <div
          ref={containerRef}
          className="no-scrollbar overflow-x-auto scroll-smooth snap-x snap-mandatory flex gap-6 py-2 px-4"
          role="list"
          style={{ msOverflowStyle: "none", scrollbarWidth: "none" } as React.CSSProperties}
        >
          {renderList.length === 0 ? (
            <div className="py-12 text-center w-full text-gray-400">No designs with images</div>
          ) : (
            renderList.map((it, idx) => {
              const isPlaceholder = it.__placeholder === true;
              const idKey = isPlaceholder ? it.id : (it as RealRenderItem).id;
              const reveal = !isPlaceholder && !!visibleMap[String(idKey)];
              return (
                <div
                  key={String(idKey ?? `card_${idx}`)}
                  data-idx={idx}
                  ref={(el) => {
                    // IMPORTANT: use a block body so the function returns void
                    cardRefs.current.set(idx, el ?? null);
                  }}
                  role="listitem"
                  className="snap-start flex-shrink-0 w-[min(360px,86%)] sm:w-[46%] md:w-[32%] lg:w-[24%] rounded-xl overflow-hidden bg-transparent shadow-lg"
                  aria-current={activeIndex === idx}
                >
                  {/* simplified placeholder: remove top-left tiny blocks */}
                  {isPlaceholder ? (
                    <div className="relative h-[320px] md:h-[360px] bg-gray-800/40 animate-pulse rounded-xl">
                      {/* large image area skeleton */}
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
                    <div className="relative h-[320px] md:h-[360px] bg-gray-800">
                      {(reveal && (it as RealRenderItem).image) ? (
                        <Image
                          src={String((it as RealRenderItem).image)}
                          alt={String((it as RealRenderItem).name)}
                          fill
                          style={{ objectFit: "cover" }}
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          priority={idx < 2}
                        />
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
                            <div className="text-sm text-gray-300">Design</div>
                            <div className="text-lg font-semibold text-white truncate">{(it as RealRenderItem).name}</div>
                          </div>

                          <div className="ml-3 text-right">
                            <div className="text-xs text-gray-300">Price</div>
                            <div className="text-sm font-semibold text-white">{formatPrice((it as RealRenderItem).wsp)}</div>
                          </div>
                        </div>
                      </div>

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
  );
}
