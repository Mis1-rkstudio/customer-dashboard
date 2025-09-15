"use client";

import React, { JSX, useEffect, useMemo, useState } from "react";
import DesignCardsCarousel, { CarouselItem } from "./carousels";
import QuickOrderModal from "./QuickOrderModal";
import FilterDropdown from "./FilterDropdown";

/* Helpers */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function safeString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function resolveImageSrc(raw?: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const fileMatch = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i);
  if (fileMatch?.[1]) return `https://drive.google.com/uc?export=view&id=${fileMatch[1]}`;

  const qId = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i);
  if (qId?.[1] && s.includes("drive.google.com")) return `https://drive.google.com/uc?export=view&id=${qId[1]}`;

  if (s.includes("docs.google.com") && s.includes("uc?export")) return s;
  if (s.includes("googleusercontent.com") || s.includes("lh3.googleusercontent.com")) return s;

  if (/^https?:\/\//i.test(s)) return s;

  if (s.startsWith("/")) {
    try {
      return `${window.location.origin}${s}`;
    } catch {
      return s;
    }
  }

  if (/^[a-z0-9_\-./]+(?:\.(jpe?g|png|gif|webp|avif|svg))(?:\?.*)?$/i.test(s)) {
    try {
      return `${window.location.origin}/${s}`;
    } catch {
      return s;
    }
  }

  return null;
}

function extractStringArrayFromRaw(raw: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) {
      return (v as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean);
    }
    if (typeof v === "string" && v.trim()) {
      return v
        .split(/[,;/|]/)
        .map((x) => String(x ?? "").trim())
        .filter(Boolean);
    }
  }
  return [];
}

function getNumberFromRecord(raw: unknown, keys: string[]): number | undefined {
  if (!isObject(raw)) return undefined;
  for (const k of keys) {
    const v = raw[k];
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

function computeAvailableFromRaw(raw: Record<string, unknown>): number {
  // prefer explicit available candidates
  const availCandidates = [
    raw["Available"],
    raw["available"],
    raw["Avail"],
    raw["Available_Qty"],
    raw["AvailableQty"],
  ];
  for (const cand of availCandidates) {
    if (cand !== undefined && cand !== null && !Number.isNaN(Number(cand))) {
      return Math.max(0, Number(cand));
    }
  }

  const closingCandidates = [
    raw["Closing_Stock"],
    raw["ClosingStock"],
    raw["closingStock"],
    raw["Closing"],
    raw["closing"],
    raw["Stock_In"],
    raw["Stock"],
  ];
  const reservedCandidates = [
    raw["Reserved"],
    raw["reserved"],
    raw["Reserved_Stock"],
    raw["ReservedStock"],
  ];
  const productionCandidates = [
    raw["inProductionQuantity"],
    raw["InProductionQuantity"],
    raw["In_ProductionQuantity"],
    raw["productionQty"],
    raw["production"],
  ];

  const closing = (() => {
    for (const c of closingCandidates) {
      if (c !== undefined && c !== null && !Number.isNaN(Number(c))) return Number(c);
    }
    return 0;
  })();

  const reserved = (() => {
    for (const r of reservedCandidates) {
      if (r !== undefined && r !== null && !Number.isNaN(Number(r))) return Number(r);
    }
    return 0;
  })();

  const production = (() => {
    for (const p of productionCandidates) {
      if (p !== undefined && p !== null && !Number.isNaN(Number(p))) return Number(p);
    }
    return 0;
  })();

  return Math.max(0, closing - reserved + production);
}

/* Component */
export default function ClientCarouselWrapper({
  items: itemsProp,
  autoplay = true,
  autoplayInterval = 4500,
  visibleCount = 3,
  className = "",
}: {
  items?: CarouselItem[] | undefined;
  autoplay?: boolean;
  autoplayInterval?: number;
  visibleCount?: number;
  className?: string;
}): JSX.Element {
  const [items, setItems] = useState<CarouselItem[]>(itemsProp ?? []);
  const [loading, setLoading] = useState<boolean>(!Boolean(itemsProp));
  // avoid unused-var eslint warning for 'loading' (we intentionally keep it for future UI improvements)
  void loading;

  const [error, setError] = useState<string>("");

  // filters state
  const [selConcepts, setSelConcepts] = useState<string[]>([]);
  const [selFabrics, setSelFabrics] = useState<string[]>([]);
  const [selColors, setSelColors] = useState<string[]>([]);

  const [quickOrderItem, setQuickOrderItem] = useState<CarouselItem | null>(null);

  useEffect(() => {
    if (itemsProp && Array.isArray(itemsProp)) {
      const normalized = itemsProp.map((it) => {
        const raw = isObject(it.raw) ? (it.raw as Record<string, unknown>) : {};
        const colors = Array.isArray(it.colors) && it.colors.length
          ? it.colors
          : extractStringArrayFromRaw(raw, ["Colors", "colors", "colors_string", "Color", "color"]);
        const sizes = Array.isArray(it.sizes) && it.sizes.length
          ? it.sizes
          : extractStringArrayFromRaw(raw, ["Sizes", "sizes", "Sizes_string", "Size", "size"]);

        // canonical inProductionQuantity (coerce variants and default 0)
        const inProdQtyFromRaw = getNumberFromRecord(raw, ["InProductionQuantity", "In_ProductionQuantity", "inProductionQuantity", "InProductionQty"]) ?? 0;
        const inProductionQuantity = Math.max(0, Math.floor(Number(inProdQtyFromRaw)));

        const available = typeof it.available === "number" ? it.available : computeAvailableFromRaw(raw);
        const image = resolveImageSrc(it.image ?? raw["image"] ?? raw["File_URL"] ?? raw["FileUrl"] ?? "");

        return {
          ...it,
          image,
          colors,
          sizes,
          available,
          inProductionQuantity,
          raw,
        } as CarouselItem;
      });
      setItems(normalized);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/items");
        if (!res.ok) {
          setError(`Failed to load items: HTTP ${res.status}`);
          setItems([]);
          setLoading(false);
          return;
        }
        const text = await res.text();
        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }

        let rows: unknown[] = [];
        if (Array.isArray(payload)) rows = payload;
        else if (isObject(payload) && Array.isArray((payload as Record<string, unknown>).rows)) rows = (payload as Record<string, unknown>).rows as unknown[];
        else if (isObject(payload) && Array.isArray((payload as Record<string, unknown>).items)) rows = (payload as Record<string, unknown>).items as unknown[];
        else if (isObject(payload) && Array.isArray((payload as Record<string, unknown>).data)) rows = (payload as Record<string, unknown>).data as unknown[];
        else if (isObject(payload)) {
          const vals = Object.values(payload);
          if (Array.isArray(vals) && vals.length > 0 && typeof vals[0] === "object") rows = vals as unknown[];
        }

        const normalized: CarouselItem[] = rows.map((r: unknown, i: number) => {
          const rec = isObject(r) ? (r as Record<string, unknown>) : {};

          const idCandidate =
            rec["id"] ??
            rec["ID"] ??
            rec["sku"] ??
            rec["SKU"] ??
            rec["Item"] ??
            rec["Product_Code"] ??
            rec["product_code"] ??
            rec["label"] ??
            `item_${i}`;
          const id = String(idCandidate ?? "").trim() || `item_${i}`;

          const nameCandidate = rec["Item"] ?? rec["name"] ?? rec["label"] ?? rec["sku"] ?? rec["ItemName"] ?? id;
          const name = String(nameCandidate ?? "").trim() || id;

          const possibleImg =
            rec["Thumbnail_URL"] ??
            rec["thumbnail"] ??
            rec["thumbnail_url"] ??
            rec["Image"] ??
            rec["image"] ??
            rec["image_url"] ??
            rec["File_URL"] ??
            rec["FileUrl"] ??
            rec["file_url"] ??
            rec["imagePath"] ??
            rec["img"] ??
            rec["photo"] ??
            null;
          const image = resolveImageSrc(possibleImg ?? "");

          const wspRaw = rec["WSP"] ?? rec["wsp"] ?? rec["Price"] ?? rec["price"] ?? rec["mrp"] ?? null;
          const wspNum = wspRaw == null ? null : Number(wspRaw);
          const wsp = Number.isNaN(wspNum) ? null : wspNum;

          const colors = extractStringArrayFromRaw(rec, [
            "Colors",
            "colors",
            "colors_string",
            "Color",
            "color",
            "Colour",
            "Colours",
          ]);
          const sizes = extractStringArrayFromRaw(rec, ["Sizes", "sizes", "Sizes_string", "Size", "size"]);

          // canonical inProductionQuantity from the row (coerce to number; default 0)
          const inProdQtyRaw = getNumberFromRecord(rec, ["InProductionQuantity", "In_ProductionQuantity", "inProductionQuantity", "InProductionQty"]) ?? 0;
          const inProductionQuantity = Math.max(0, Math.floor(Number(inProdQtyRaw)));

          const available = computeAvailableFromRaw(rec);

          return {
            id,
            name,
            image,
            wsp,
            raw: rec,
            available,
            inProductionQuantity,
            colors,
            sizes,
          } as CarouselItem;
        });

        if (!cancelled) setItems(normalized);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to fetch items", err);
        if (!cancelled) {
          setError("Failed to load items");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemsProp]);

  const conceptOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      const raw = isObject(it.raw) ? it.raw : {};
      const c = safeString(raw["concept"] ?? raw["Concept"] ?? raw["design_concept"] ?? raw["Concepts"] ?? raw["category"] ?? "");
      if (c) s.add(c);
    }
    return Array.from(s).sort();
  }, [items]);

  const fabricOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      const raw = isObject(it.raw) ? it.raw : {};
      const f = safeString(raw["fabric"] ?? raw["Fabric"] ?? raw["fabric_type"] ?? raw["Material"] ?? raw["material"] ?? "");
      if (f) s.add(f);
    }
    return Array.from(s).sort();
  }, [items]);

  const colorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      for (const c of it.colors ?? []) {
        const v = safeString(c);
        if (v) s.add(v);
      }
      const raw = isObject(it.raw) ? it.raw : {};
      if (!(it.colors && it.colors.length)) {
        const colorsFromRaw = extractStringArrayFromRaw(raw as Record<string, unknown>, ["Colors", "colors", "colors_string", "Color", "color"]);
        for (const c of colorsFromRaw) {
          const v = safeString(c);
          if (v) s.add(v);
        }
      }
    }
    return Array.from(s).sort();
  }, [items]);

  // Apply filters and keep only items with available > 1
  const filteredItems = useMemo(() => {
    return items
      .filter((it) => {
        const avail = typeof it.available === "number" ? it.available : computeAvailableFromRaw(isObject(it.raw) ? it.raw : {});
        return avail > 1;
      })
      .filter((it) => Boolean(it.image))
      .filter((it) => {
        if (!selFabrics || selFabrics.length === 0) return true;
        const raw = isObject(it.raw) ? it.raw : {};
        const f = safeString(raw["fabric"] ?? raw["Fabric"] ?? raw["fabric_type"] ?? "");
        return selFabrics.includes(f);
      })
      .filter((it) => {
        if (!selConcepts || selConcepts.length === 0) return true;
        const raw = isObject(it.raw) ? it.raw : {};
        const c = safeString(raw["concept"] ?? raw["Concept"] ?? raw["design_concept"] ?? "");
        return selConcepts.includes(c);
      })
      .filter((it) => {
        if (!selColors || selColors.length === 0) return true;
        const cleaned = (it.colors ?? []).map((c) => safeString(c)).filter(Boolean);
        return selColors.some((sel) => cleaned.some((c) => c.toLowerCase() === sel.toLowerCase()));
      });
  }, [items, selFabrics, selConcepts, selColors]);

  const clearAll = () => {
    setSelConcepts([]);
    setSelFabrics([]);
    setSelColors([]);
  };

  return (
    <>
      <div className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FilterDropdown
            label={undefined}
            placeholder="Filter by concept..."
            options={conceptOptions}
            value={selConcepts}
            onChange={setSelConcepts}
            multi
          />
          <FilterDropdown
            label={undefined}
            placeholder="Filter by fabric..."
            options={fabricOptions}
            value={selFabrics}
            onChange={setSelFabrics}
            multi
          />
          <FilterDropdown
            label={undefined}
            placeholder="Filter by colour..."
            options={colorOptions}
            value={selColors}
            onChange={setSelColors}
            multi
          />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-300">{filteredItems.length} designs</div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={clearAll} type="button" className="text-xs px-3 py-1 rounded bg-[#0f1724] border border-[#1f2937] hover:bg-[#13242f]">
              Clear filters
            </button>
          </div>
        </div>
      </div>

      <DesignCardsCarousel
        items={filteredItems}
        autoplay={autoplay}
        autoplayInterval={autoplayInterval}
        visibleCount={visibleCount}
        className={className ?? ""}
        onItemClick={(it) => setQuickOrderItem(it)}
      />

      {quickOrderItem && (
        <QuickOrderModal
          item={quickOrderItem}
          onClose={() => setQuickOrderItem(null)}
          onAdded={() => setQuickOrderItem(null)}
        />
      )}

      {error ? <div className="mt-4 text-red-400">{error}</div> : null}
    </>
  );
}
