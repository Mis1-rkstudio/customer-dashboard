"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Select, { StylesConfig } from "react-select";
import { Tag, Zap } from "lucide-react";
import { useCart } from "@/context/CartContext";
import Image from "next/image";
import { useQueryState } from "nuqs";

/* ---------------------- types & helpers ---------------------- */

type Option = { value: string; label: string };

type ItemRow = {
  raw?: Record<string, unknown>;
  id: string;
  name: string;
  colors: string[];
  sizes?: string[];
  image: string | null;
  concept?: string | null;
  fabric?: string | null;
  closingStock?: number | null;
  reserved?: number | null;
  available?: number | null;
  in_production?: boolean;
  productionQty?: number | null;
  wsp?: number | null;
};

type ApiRow = Record<string, unknown>;
type ApiPayload = unknown;

type CartAddItem = {
  id: string;
  name: string;
  image: string;
  colors: string[];
  raw?: Record<string, unknown>;
  set?: number;
  selectedColors?: string[];
  sizes?: Record<string, number> | undefined;
  productionQty?: number | null;
  closingStock?: number | null;
};

type CartContextMinimal = {
  addToCart: (item: CartAddItem) => void;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getRowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload as unknown[];
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

function classifyStock(
  qty: number | null | undefined
): "low" | "medium" | "high" | "unknown" {
  if (qty === null || qty === undefined) return "unknown";
  const n = Number(qty);
  if (Number.isNaN(n)) return "unknown";
  if (n <= 4) return "low";
  if (n <= 24) return "medium";
  return "high";
}
function stockMeta(qty: number | null | undefined) {
  const cls = classifyStock(qty);
  if (cls === "low")
    return {
      label: "Low stock",
      shortLabel: "Low",
      colorClass: "bg-red-600 text-white",
    };
  if (cls === "medium")
    return {
      label: "Medium stock",
      shortLabel: "Medium",
      colorClass: "bg-orange-500 text-white",
    };
  if (cls === "high")
    return {
      label: "In stock",
      shortLabel: "In stock",
      colorClass: "bg-green-600 text-white",
    };
  return {
    label: "Unknown",
    shortLabel: "Unknown",
    colorClass: "bg-gray-600 text-white",
  };
}

const selectStyles: StylesConfig<Option, true> = {
  control: (provided) => ({
    ...provided,
    background: "#0f1724",
    borderColor: "#243047",
    minHeight: 40,
    color: "#e5e7eb",
  }),
  menu: (provided) => ({
    ...provided,
    background: "#0f1724",
    color: "#e5e7eb",
  }),
  option: (provided, state) => ({
    ...provided,
    background: state.isSelected
      ? "#153f63"
      : state.isFocused
      ? "#132f44"
      : "#0f1724",
    color: "#e5e7eb",
  }),
  singleValue: (provided) => ({ ...provided, color: "#e5e7eb" }),
  input: (provided) => ({ ...provided, color: "#e5e7eb" }),
  placeholder: (provided) => ({ ...provided, color: "#94a3b8" }),
  multiValue: (provided) => ({
    ...provided,
    background: "#1f2937",
    color: "#e5e7eb",
  }),
  multiValueLabel: (provided) => ({ ...provided, color: "#e5e7eb" }),
  multiValueRemove: (provided) => ({
    ...provided,
    color: "#94a3b8",
    ":hover": { background: "#374151", color: "white" },
  }),
};

function toOptions(arr?: string[]): Option[] {
  if (!arr || !Array.isArray(arr)) return [];
  const uniq = Array.from(
    new Set(arr.map((s) => String(s || "").trim()).filter(Boolean))
  ).sort();
  return uniq.map((v) => ({ value: v, label: v }));
}

function useDebounced(value: string, delay = 250): string {
  const [v, setV] = useState<string>(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ---------------------- component ---------------------- */

export default function ItemsPage(): React.ReactElement {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { addToCart } = useCart() as CartContextMinimal;
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});

  const [setsMap, setSetsMap] = useState<Record<string, number>>({});
  const [cardSelectedColors, setCardSelectedColors] = useState<
    Record<string, string[]>
  >({});
  const [sizesMap, setSizesMap] = useState<Record<string, Record<string, number>>>(
    {}
  );

  // ------------------------
  // URL state using nuqs
  // ------------------------
  // Persist the global search to ?q=
  const [qParam, setQParam] = useQueryState("q");

  // search + filters
  const [searchText, setSearchText] = useState<string>("");
  const debouncedSearch = useDebounced(searchText, 250);
  const [selectedConcepts, setSelectedConcepts] = useState<Option[]>([]);
  const [selectedFabrics, setSelectedFabrics] = useState<Option[]>([]);
  const [selectedColors, setSelectedColors] = useState<Option[]>([]);
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "medium" | "high">(
    "all"
  );

  // pagination
  const [pageSize] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // lazy image observer
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const visibleRef = useRef<Record<string, boolean>>({});
  const [, forceRerender] = useState<number>(0);

  const [itemsLoaded, setItemsLoaded] = useState<boolean>(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const addTimersRef = useRef<Record<string, number>>({});

  // Restore qParam into searchText on mount or when qParam changes
  useEffect(() => {
    try {
      if (typeof qParam === "string" && qParam !== searchText) {
        setSearchText(qParam);
      } else if (qParam === null && searchText !== "") {
        setSearchText("");
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  // Push debouncedSearch into the URL (qParam)
  useEffect(() => {
    try {
      if (debouncedSearch && debouncedSearch.trim() !== "") {
        setQParam(debouncedSearch.trim());
      } else {
        setQParam(null);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    let canceled = false;
    async function fetchItems(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await fetch("/api/items");
        const text = await res.text();
        if (!res.ok) {
          console.error("Failed to fetch items", res.status, text);
          if (!canceled) {
            setItems([]);
            setItemsLoaded(true);
          }
          return;
        }

        let payload: ApiPayload;
        try {
          payload = JSON.parse(text) as ApiPayload;
        } catch {
          payload = text as ApiPayload;
        }

        const rawList: unknown[] = getRowsFromPayload(payload);
        const normalized: ItemRow[] = rawList.map((r: unknown) => {
          const rec = typeof r === "object" && r !== null ? (r as ApiRow) : {};
          const idCandidate =
            rec["Item"] ?? rec["Product_Code"] ?? rec["product_code"] ?? "";
          const id = String(idCandidate ?? "").trim();
          const name = String(rec["Item"] ?? rec["Product_Code"] ?? id).trim();
          const colors = Array.isArray(rec["Colors"])
            ? (rec["Colors"] as unknown[])
                .map((c) => String(c ?? "").trim())
                .filter(Boolean)
            : [];
          const sizes =
            Array.isArray(rec["Sizes"]) || Array.isArray(rec["sizes"])
              ? ((rec["Sizes"] ?? rec["sizes"]) as unknown[]).map((s) =>
                  String(s ?? "").trim()
                )
              : undefined;
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
          const concept = (rec["Concept"] ?? rec["Concept_2"] ?? null) as
            | string
            | null;
          const fabric = (rec["Fabric"] ?? rec["Concept_3"] ?? null) as
            | string
            | null;

          const closingStockRaw =
            rec["Closing_Stock"] ?? rec["ClosingStock"] ?? rec["closing_stock"] ?? rec["Closing"] ?? null;
          const closingStockNum = closingStockRaw === null ? null : Number(closingStockRaw);
          const closingStock = Number.isNaN(closingStockNum) ? null : closingStockNum;

          const reservedRaw = rec["Reserved"] ?? rec["reserved"] ?? rec["Reserved_Stock"] ?? null;
          const reservedNum = reservedRaw === null ? null : Number(reservedRaw);
          const reserved = Number.isNaN(reservedNum) ? null : reservedNum;

          const availableRaw = rec["Available"] ?? rec["available"] ?? rec["Avail"] ?? null;
          const availableNum = availableRaw === null || availableRaw === undefined ? null : Number(availableRaw);
          let available = Number.isNaN(availableNum) ? null : availableNum;
          if (available === null) {
            if (typeof closingStock === "number") {
              const rsv = typeof reserved === "number" ? reserved : 0;
              available = Math.max(0, closingStock - rsv);
            } else {
              available = null;
            }
          }

          const productionQtyRaw =
            rec["ProductionQty"] ?? rec["productionQty"] ?? rec["Production_Qty"] ?? rec["Quantity"] ?? null;
          const productionQtyNum = productionQtyRaw === null ? null : Number(productionQtyRaw);
          const productionQty = Number.isNaN(productionQtyNum) ? null : productionQtyNum;

          const wspRaw = rec["WSP"] ?? rec["wsp"] ?? rec["Price"] ?? rec["price"] ?? rec["WSP_Rs"] ?? rec["wsp_rs"] ?? null;
          let wsp: number | null = null;
          try {
            if (wspRaw !== null && wspRaw !== undefined) {
              const s = String(wspRaw).trim();
              const match = s.match(/-?[\d,]+(?:\.\d+)?/);
              if (match && match[0]) {
                const cleaned = match[0].replace(/,/g, "");
                const n = Number(cleaned);
                wsp = Number.isNaN(n) ? null : n;
              } else {
                const n = Number(s.replace(/[^\d.]/g, ""));
                wsp = Number.isNaN(n) ? null : n;
              }
            } else {
              wsp = null;
            }
          } catch {
            wsp = null;
          }

          return {
            raw: rec,
            id,
            name,
            colors,
            sizes,
            image,
            concept,
            fabric,
            closingStock: closingStock,
            reserved: reserved,
            available,
            in_production: Boolean(productionQty && productionQty > 0),
            productionQty: productionQty,
            wsp,
          };
        });

        if (!canceled) {
          setItems(normalized);
          setItemsLoaded(true);
        }
      } catch (err) {
        console.error("Error fetching items:", err);
        if (!canceled) setItems([]);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }
    fetchItems();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!itemsLoaded) return;
    let canceled = false;
    async function fetchDesignsInProd(): Promise<void> {
      try {
        const res = await fetch("/api/designs_in_production");
        const text = await res.text();
        if (!res.ok) {
          console.warn("designs_in_production fetch failed", res.status, text);
          return;
        }
        let payload: ApiPayload;
        try {
          payload = JSON.parse(text) as ApiPayload;
        } catch {
          payload = text as ApiPayload;
        }
        const rows: unknown[] = getRowsFromPayload(payload);

        const qtyMap = new Map<string, number>();
        for (const r of rows) {
          if (!r) continue;
          const rec = typeof r === "object" ? (r as ApiRow) : {};
          const rawCode =
            rec["Product_Code"] ?? rec["product_code"] ?? rec["Design_no"] ?? rec["design_name"] ?? "";
          const code = String(rawCode ?? "").trim();
          if (!code) continue;
          const qtyRaw = rec["Quantity"] ?? rec["quantity"] ?? 0;
          const qty = Number(qtyRaw === null || qtyRaw === undefined ? 0 : qtyRaw) || 0;
          const key = code.toLowerCase();
          qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
        }

        if (canceled) return;
        setItems((prev) =>
          prev.map((it) => {
            const key = String(it.id || it.name || "").trim().toLowerCase();
            const productionQty = qtyMap.get(key) ?? 0;
            return {
              ...it,
              productionQty: productionQty || (it.productionQty ?? null),
              in_production: (productionQty || (it.productionQty ?? 0)) > 0,
            };
          })
        );
      } catch (err) {
        console.error("Error fetching designs_in_production:", err);
      }
    }
    fetchDesignsInProd();
    return () => {
      canceled = true;
    };
  }, [itemsLoaded]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    setSetsMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const it of items) {
        if (!(it.id in next)) {
          next[it.id] = 1;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setSizesMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) {
        if (!(it.id in next)) {
          const sizesObj: Record<string, number> = {};
          if (Array.isArray(it.sizes) && it.sizes.length > 0) {
            for (const s of it.sizes) sizesObj[String(s)] = 1;
          }
          next[it.id] = sizesObj;
          changed = true;
        } else {
          const existing = next[it.id] ?? {};
          if (Array.isArray(it.sizes) && it.sizes.length > 0) {
            for (const s of it.sizes) {
              if (!(String(s) in existing)) {
                existing[String(s)] = setsMap[it.id] ?? 1;
                changed = true;
              }
            }
            next[it.id] = { ...existing };
          }
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const conceptOptions = useMemo(
    () => toOptions(items.map((i) => i.concept ?? "").filter(Boolean)),
    [items]
  );
  const fabricOptions = useMemo(
    () => toOptions(items.map((i) => i.fabric ?? "").filter(Boolean)),
    [items]
  );
  const colorOptions = useMemo(
    () => toOptions(items.flatMap((i) => i.colors || [])),
    [items]
  );

  useEffect(() => {
    setCurrentPage(1);
    visibleRef.current = {};
    observersRef.current.forEach((o) => {
      try {
        o.disconnect();
      } catch {}
    });
    observersRef.current.clear();
    forceRerender((n) => n + 1);
  }, [
    debouncedSearch,
    selectedConcepts,
    selectedFabrics,
    selectedColors,
    stockFilter,
    pageSize,
  ]);

  const filteredItems = useMemo(() => {
    const s = String(debouncedSearch || "").trim().toLowerCase();
    const selectedConceptVals = selectedConcepts.map((x) =>
      String(x.value ?? x).toLowerCase()
    );
    const selectedFabricVals = selectedFabrics.map((x) =>
      String(x.value ?? x).toLowerCase()
    );
    const selectedColorVals = selectedColors.map((x) =>
      String(x.value ?? x).toLowerCase()
    );

    return items.filter((it) => {
      if (stockFilter !== "all") {
        const stockVal =
          typeof it.available === "number"
            ? it.available
            : (typeof it.closingStock === "number" ? it.closingStock : 0) +
              (typeof it.productionQty === "number" ? it.productionQty : 0);
        const cls = classifyStock(stockVal);
        if (cls !== stockFilter) return false;
      }

      if (selectedConceptVals.length > 0) {
        const v = String(it.concept ?? "").toLowerCase();
        if (!selectedConceptVals.includes(v)) return false;
      }

      if (selectedFabricVals.length > 0) {
        const v = String(it.fabric ?? "").toLowerCase();
        if (!selectedFabricVals.includes(v)) return false;
      }

      if (selectedColorVals.length > 0) {
        const itemColors = (it.colors || []).map((c) =>
          String(c || "").toLowerCase()
        );
        const has = selectedColorVals.some((c) => itemColors.includes(c));
        if (!has) return false;
      }

      if (s) {
        const hay = [
          it.name,
          it.id,
          it.concept ?? "",
          it.fabric ?? "",
          ...(it.colors || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [
    items,
    debouncedSearch,
    selectedConcepts,
    selectedFabrics,
    selectedColors,
    stockFilter,
  ]);

  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safeCurrentPage, pageSize]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  function observeElement(id: string, el: HTMLElement | null): void {
    if (!el) return;
    if (visibleRef.current[id]) return;
    const existing = observersRef.current.get(id);
    if (existing) {
      try {
        existing.disconnect();
      } catch {}
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleRef.current[id] = true;
            const o = observersRef.current.get(id);
            if (o) {
              try {
                o.disconnect();
              } catch {}
              observersRef.current.delete(id);
            }
            forceRerender((s) => s + 1);
          }
        }
      },
      { root: null, rootMargin: "200px", threshold: 0.05 }
    );
    try {
      obs.observe(el);
      observersRef.current.set(id, obs);
    } catch {
      // ignore
    }
  }

  const incSet = (id: string) =>
    setSetsMap((m) => {
      const cur = Math.max(0, Number(m[id] ?? 1));
      const item = items.find((it) => it.id === id);
      if (!item) return m;

      const sizesForItem = sizesMap[id] ?? {};
      const numSizes = Object.keys(sizesForItem).length;
      const sel = Array.isArray(cardSelectedColors[id]) ? cardSelectedColors[id] : [];
      const colorsCount = Math.max(1, sel.length || 1);
      const displayAvailable = typeof item.closingStock === "number" ? item.closingStock : 0;
      const prod = typeof item.productionQty === "number" ? item.productionQty : 0;
      const available = Math.max(0, displayAvailable + prod);

      if (numSizes > 0) {
        const nextPerSize = cur + 1;
        const totalAfter = nextPerSize * numSizes * colorsCount;
        if (available > 0 && totalAfter > available) return m;
        setSizesMap((smap) => {
          const newSizes: Record<string, number> = {};
          const keys = Object.keys(sizesForItem);
          for (const key of keys) newSizes[key] = nextPerSize;
          return { ...smap, [id]: newSizes };
        });
        return { ...m, [id]: nextPerSize };
      }

      if (available > 0 && (cur + 1) * colorsCount > available) return m;
      return { ...m, [id]: cur + 1 };
    });

  const decSet = (id: string) =>
    setSetsMap((m) => {
      const cur = Math.max(0, Number(m[id] ?? 1));
      const next = Math.max(0, cur - 1);
      const item = items.find((it) => it.id === id);
      if (!item) return m;

      const sizesForItem = sizesMap[id] ?? {};
      const numSizes = Object.keys(sizesForItem).length;

      if (numSizes > 0) {
        setSizesMap((smap) => {
          const prevSizes = smap[id] ?? {};
          const newSizes: Record<string, number> = {};
          for (const k of Object.keys(prevSizes)) newSizes[k] = Math.max(0, (Number(prevSizes[k]) || 0) - 1);
          return { ...smap, [id]: newSizes };
        });
        return { ...m, [id]: next };
      }

      return { ...m, [id]: next };
    });

  const setSet = (id: string, v: number, maxPerSize: number | null) =>
    setSetsMap((m) => {
      const setsRequested = Math.max(0, Math.floor(Number(v || 0)));
      const item = items.find((it) => it.id === id);
      if (!item) return m;

      const sizesForItem = sizesMap[id] ?? {};
      const numSizes = Object.keys(sizesForItem).length;

      if (numSizes > 0) {
        let perSize = setsRequested;
        if (typeof maxPerSize === "number" && !Number.isNaN(maxPerSize)) {
          perSize = Math.min(perSize, Math.max(0, Math.floor(maxPerSize)));
        }
        setSizesMap((smap) => {
          const newSizes: Record<string, number> = {};
          for (const key of Object.keys(sizesForItem)) newSizes[key] = perSize;
          return { ...smap, [id]: newSizes };
        });
        return { ...m, [id]: perSize };
      }

      let n = Math.max(0, Math.floor(Number(v || 0)));
      if (typeof maxPerSize === "number" && !Number.isNaN(maxPerSize)) n = Math.min(n, maxPerSize);
      return { ...m, [id]: n };
    });

  const toggleCardColor = (id: string, color: string) => {
    setCardSelectedColors((prev) => {
      const existing = Array.isArray(prev[id]) ? [...prev[id]] : [];
      const idx = existing.findIndex((c) => String(c).toLowerCase() === String(color).toLowerCase());
      if (idx >= 0) existing.splice(idx, 1);
      else existing.push(color);

      const next = { ...prev, [id]: existing };
      const item = items.find((it) => it.id === id);
      if (item) {
        const closing = typeof item.closingStock === "number" ? item.closingStock : 0;
        const prod = typeof item.productionQty === "number" ? item.productionQty : 0;
        const displayAvailable = Math.max(0, closing + prod);
        const cc = Math.max(1, existing.length || 1);
        const sizesForItem = sizesMap[id] ?? {};
        const sizeKeys = Object.keys(sizesForItem);
        const sumSizes = Object.values(sizesForItem).reduce((a, b) => a + (Number(b) || 0), 0);

        if (displayAvailable > 0 && sumSizes * cc > displayAvailable) {
          const allowedTotalPerColor = Math.floor(displayAvailable / cc);
          const allowedPerSize = sizeKeys.length > 0 ? Math.floor(allowedTotalPerColor / Math.max(1, sizeKeys.length)) : 0;
          setSizesMap((s) => {
            const copy = { ...s };
            const newSizes: Record<string, number> = {};
            for (const k of sizeKeys) newSizes[k] = allowedPerSize;
            copy[id] = newSizes;
            return copy;
          });
          setSetsMap((m) => ({ ...m, [id]: allowedPerSize }));
        }
      }

      return next;
    });
  };

  const onSizeInputChange = useCallback(
    (id: string, sizeLabel: string, rawValue: string) => {
      const parsed = Math.max(0, Math.floor(Number(rawValue || 0)));
      setSizesMap((smap) => {
        const prev = smap[id] ?? {};
        const nextSizes = { ...prev, [sizeLabel]: parsed };

        const item = items.find((it) => it.id === id);
        const sel = Array.isArray(cardSelectedColors[id]) ? cardSelectedColors[id] : [];
        const colorsCount = Math.max(1, sel.length || 1);
        const displayAvailable = Math.max(0, (typeof item?.closingStock === "number" ? item!.closingStock : 0) + (typeof item?.productionQty === "number" ? item!.productionQty : 0));

        const sumSizes = Object.values(nextSizes).reduce((a, b) => a + (Number(b) || 0), 0);

        if (displayAvailable > 0 && sumSizes * colorsCount > displayAvailable) {
          const otherSum = Object.entries(nextSizes).reduce((acc, [k, v]) => {
            return acc + (k === sizeLabel ? 0 : Number(v || 0));
          }, 0);
          const maxForThisSize = Math.max(0, Math.floor(displayAvailable / colorsCount) - otherSum);
          nextSizes[sizeLabel] = Math.max(0, maxForThisSize);
          alert(`Only ${displayAvailable} pieces available. Adjusted "${sizeLabel}" to ${nextSizes[sizeLabel]}.`);
        }

        return { ...smap, [id]: nextSizes };
      });
    },
    [cardSelectedColors, items]
  );

  function computeDisplayAvailable(item: ItemRow): number {
    const closing = typeof item.closingStock === "number" ? item.closingStock : 0;
    const prod = typeof item.productionQty === "number" ? item.productionQty : 0;
    return Math.max(0, closing + prod);
  }

  const handleAddToCart = useCallback(
    (item: ItemRow) => {
      const displayAvailable = computeDisplayAvailable(item);

      const sel = Array.isArray(cardSelectedColors[item.id]) ? cardSelectedColors[item.id] : [];
      const colorsCount = Math.max(1, sel.length || 1);

      const sizeKeys = Array.isArray(item.sizes) ? item.sizes : [];
      const setCountFromSetsControl = Math.max(0, Math.floor(Number(setsMap[item.id] ?? 1)));

      let totalPieces = 0;
      let sizesPayload: Record<string, number> | undefined = undefined;

      if (sizeKeys.length > 0) {
        const perSize = sizesMap[item.id] ?? Object.fromEntries(sizeKeys.map((s) => [s, Math.max(0, setCountFromSetsControl)]));
        sizesPayload = perSize;
        const sumSizes = Object.values(perSize).reduce((a, b) => a + (Number(b) || 0), 0);
        totalPieces = sumSizes * colorsCount;
      } else {
        totalPieces = setCountFromSetsControl * colorsCount;
      }

      if (displayAvailable > 0 && totalPieces > displayAvailable) {
        if (sizeKeys.length > 0) {
          const allowedPerSize = Math.floor(displayAvailable / (colorsCount * Math.max(1, sizeKeys.length)));
          setSizesMap((smap) => {
            const newSizes: Record<string, number> = {};
            for (const k of sizeKeys) newSizes[k] = allowedPerSize;
            return { ...smap, [item.id]: newSizes };
          });
          setSetsMap((m) => ({ ...m, [item.id]: allowedPerSize }));
          alert(`Only ${displayAvailable} pieces available. Adjusted sizes to ${allowedPerSize} each.`);
        } else {
          const maxSetsIfNoSizes = Math.floor(displayAvailable / colorsCount);
          setSetsMap((m) => ({ ...m, [item.id]: maxSetsIfNoSizes }));
          alert(`Only ${displayAvailable} pieces available. Adjusted sets to ${maxSetsIfNoSizes}.`);
        }
        return;
      }

      if (displayAvailable === 0) {
        alert("No available stock for this design.");
        return;
      }

      addToCart({
        id: item.id,
        name: item.name,
        image: item.image || "/placeholder.svg",
        colors: item.colors,
        raw: item.raw,
        set: setCountFromSetsControl,
        selectedColors: cardSelectedColors[item.id] ?? [],
        sizes: sizesPayload,
        productionQty: item.productionQty ?? null,
        closingStock: item.closingStock ?? null,
      });

      setAddedMap((m) => ({ ...m, [item.id]: true }));
      if (addTimersRef.current[item.id]) clearTimeout(addTimersRef.current[item.id]);
      const timerId = window.setTimeout(() => {
        setAddedMap((m) => ({ ...m, [item.id]: false }));
        delete addTimersRef.current[item.id];
      }, 2500);
      addTimersRef.current[item.id] = timerId;
    },
    [addToCart, cardSelectedColors, sizesMap, setsMap]
  );

  const formatPrice = (p: number | null | undefined): string => {
    if (p === null || p === undefined || Number.isNaN(Number(p))) return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(p));
  };

  function buildPageList(total: number, current: number, delta = 2): (number | "ellipsis")[] {
    if (total <= 1) return [1];
    const pages: (number | "ellipsis")[] = [];
    const left = Math.max(2, current - delta);
    const right = Math.min(total - 1, current + delta);
    pages.push(1);
    if (left > 2) pages.push("ellipsis");
    for (let p = left; p <= right; p++) pages.push(p);
    if (right < total - 1) pages.push("ellipsis");
    if (total > 1) pages.push(total);
    return pages;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
        <div>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search by design, code, color, concept or fabric..."
            className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-3 px-4 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search items"
          />
        </div>

        <div className="flex gap-3 items-center justify-end">
          <div className="flex items-center gap-2 text-sm text-gray-300 mr-2">
            Stock
          </div>
          {(["all", "low", "medium", "high"] as const).map((s) => {
            const active = stockFilter === s;
            const label = s === "all" ? "All" : s === "low" ? "Low" : s === "medium" ? "Medium" : "In stock";
            return (
              <button
                key={s}
                onClick={() => setStockFilter(s)}
                className={`px-3 py-2 rounded-md text-sm font-medium focus:outline-none ${active ? "bg-gray-200 text-gray-900 shadow" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
                type="button"
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select
          isMulti
          options={conceptOptions}
          value={selectedConcepts}
          onChange={(v) => setSelectedConcepts((v ?? []) as Option[])}
          placeholder="Filter by concept..."
          styles={selectStyles}
          classNamePrefix="rs"
        />
        <Select
          isMulti
          options={fabricOptions}
          value={selectedFabrics}
          onChange={(v) => setSelectedFabrics((v ?? []) as Option[])}
          placeholder="Filter by fabric..."
          styles={selectStyles}
          classNamePrefix="rs"
        />
        <Select
          isMulti
          options={colorOptions}
          value={selectedColors}
          onChange={(v) => setSelectedColors((v ?? []) as Option[])}
          placeholder="Filter by colour..."
          styles={selectStyles}
          classNamePrefix="rs"
        />
      </div>

      {isLoading ? (
        <div className="text-center p-8">Loading items...</div>
      ) : paginatedItems.length === 0 ? (
        <div className="text-center p-8">No items found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          {paginatedItems.map((item, index) => {
            const wasAdded = Boolean(addedMap[item.id]);
            const displayAvailable = computeDisplayAvailable(item);
            const stockNumber = displayAvailable;
            const meta = stockMeta(stockNumber);
            const visible = !!visibleRef.current[item.id];

            const thisSet = setsMap[item.id] ?? 1;
            const selectedColorsForCard = cardSelectedColors[item.id] ?? [];

            const sizesForItem = sizesMap[item.id] ?? {};
            const sizeKeys = Array.isArray(item.sizes) ? item.sizes : Object.keys(sizesForItem);
            const numSizes = sizeKeys.length;
            const sumSizes = Object.values(sizesForItem).reduce((a, b) => a + (Number(b) || 0), 0);

            let displayQty: number;
            if (numSizes > 0) {
              displayQty = setsMap[item.id] ?? 1;
            } else {
              displayQty = thisSet;
            }

            const colorsCount = Math.max(1, (selectedColorsForCard || []).length || 1);
            const totalRequestedPieces = (numSizes > 0 ? sumSizes : thisSet) * colorsCount;

            const maxPerSize =
              typeof displayAvailable === "number" && displayAvailable >= 0
                ? numSizes > 0
                  ? Math.floor(displayAvailable / (colorsCount * Math.max(1, numSizes)))
                  : Math.floor(displayAvailable / colorsCount)
                : null;
            const maxTotalForCard = maxPerSize !== null ? maxPerSize * Math.max(1, numSizes) : null;

            const priceDisplay = formatPrice(item.wsp ?? null);

            return (
              <article
                key={item.id || `${item.name}-${index}`}
                className="bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col h-full"
              >
                <div className="relative h-64 bg-gray-700 flex items-center justify-center overflow-hidden">
                  <div
                    ref={(el) => {
                      if (el) observeElement(item.id, el);
                    }}
                    className="w-full h-full"
                    aria-hidden
                  >
                    {visible && item.image && !brokenImages[item.id] ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        style={{ objectFit: "cover" }}
                        onError={() => setBrokenImages((b) => ({ ...b, [item.id]: true }))}
                        quality={72}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-800/60 flex items-center justify-center">
                        <svg
                          className="w-14 h-14 text-gray-600"
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
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-lg font-semibold text-white mb-0 truncate">
                      {item.name}
                    </h3>

                    <div className="text-right ml-3 flex gap-1 items-baseline">
                      <div className="text-xs text-gray-400">Rs.</div>
                      <div className="text-lg font-semibold text-white">
                        {priceDisplay}
                      </div>
                    </div>
                  </div>

                  {item.concept && (
                    <p className="text-sm text-gray-400 mb-1">
                      <span className="text-gray-300 font-medium">Concept:</span>{" "}
                      {item.concept}
                    </p>
                  )}
                  {item.fabric && (
                    <p className="text-sm text-gray-400 mb-2">
                      <span className="text-gray-300 font-medium">Fabric:</span>{" "}
                      {item.fabric}
                    </p>
                  )}

                  <p className="text-sm text-gray-300 mb-2">
                    <span className="font-medium text-gray-200">Colors:</span>{" "}
                    {item.colors.length ? item.colors.join(", ") : "—"}
                  </p>

                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.colorClass}`}
                      title={`${meta.label} • ${stockNumber ?? "-"}`}
                    >
                      <Tag className="h-3 w-3" />
                      <span className="leading-none">
                        {meta.shortLabel}
                        {typeof stockNumber === "number" ? ` • ${stockNumber}` : ""}
                      </span>
                    </span>

                    {item.in_production && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-600 text-white"
                        title={`In production • ${item.productionQty ?? "-"}`}
                      >
                        <Zap className="h-3 w-3" />
                        <span className="leading-none">{`In production${typeof item.productionQty === "number" ? ` • ${item.productionQty}` : ""}`}</span>
                      </span>
                    )}
                  </div>

                  <div className="mb-3">
                    <div className="flex flex-wrap gap-2">
                      {item.colors.length === 0 ? (
                        <span className="text-sm text-gray-400">No colors</span>
                      ) : (
                        item.colors.map((c) => {
                          const isActive = (cardSelectedColors[item.id] || []).some(
                            (sc) => String(sc).toLowerCase() === String(c).toLowerCase()
                          );
                          return (
                            <button
                              key={c}
                              onClick={() => toggleCardColor(item.id, c)}
                              type="button"
                              className={`px-3 py-1 rounded-full text-sm font-medium transition ${isActive ? "bg-blue-600 text-white shadow" : "bg-[#0f1724] text-slate-200 border border-[#1f2937] hover:bg-[#13242f]"}`}
                            >
                              {c}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {sizeKeys && sizeKeys.length > 0 && (
                    <>
                      <div className="text-sm text-gray-300 mb-2">Sizes</div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {sizeKeys.map((sz) => {
                          const val = sizesForItem[sz] ?? setsMap[item.id] ?? 1;
                          return (
                            <div key={sz} className="border border-gray-700 rounded px-3 py-2 flex items-center justify-between">
                              <div className="text-sm text-gray-200">{sz}</div>
                              <input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={String(val)}
                                onChange={(e) => onSizeInputChange(item.id, sz, e.target.value)}
                                className="w-14 text-center bg-transparent text-white font-medium outline-none"
                                aria-label={`Qty for size ${sz}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="mb-3 flex items-center gap-3">
                    <div className="inline-flex items-center gap-2 bg-[#051116] border border-[#12303a] rounded-lg px-2 py-1">
                      <button onClick={() => decSet(item.id)} className="h-8 w-8 rounded-md flex items-center justify-center text-slate-200 hover:bg-[#0b2b33]" aria-label="decrease sets" type="button">
                        −
                      </button>

                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={String(displayQty)}
                        onChange={(e) => setSet(item.id, Number(e.target.value || 0), maxPerSize)}
                        className="w-12 text-center bg-transparent text-white font-medium outline-none"
                        aria-label="Sets to order"
                      />

                      <button
                        onClick={() => incSet(item.id)}
                        className={`h-8 w-8 rounded-md flex items-center justify-center text-white ${displayQty >= (maxPerSize ?? Infinity) ? "bg-gray-700 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
                        aria-label="increase sets"
                        type="button"
                        disabled={typeof maxPerSize === "number" ? displayQty >= maxPerSize : false}
                      >
                        +
                      </button>
                    </div>
                    <div className="text-sm text-gray-400">Sets to order</div>
                  </div>

                  <div className="text-xs text-gray-300 mb-3">
                    <strong>Available Qty:</strong> {displayAvailable}
                    {(cardSelectedColors[item.id] || []).length > 0 && (
                      <span className="ml-3 text-sm text-gray-400">
                        Selected colours: {(cardSelectedColors[item.id] || []).length}
                      </span>
                    )}
                    {numSizes > 0 && (
                      <span className="ml-3 text-sm text-gray-400">
                        Total pieces (selected): {sumSizes * Math.max(1, (cardSelectedColors[item.id] || []).length || 1)}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto">
                    <button
                      onClick={() => {
                        const sel = Array.isArray(cardSelectedColors[item.id]) ? cardSelectedColors[item.id] : [];
                        const cc = Math.max(1, sel.length || 1);
                        const setsRequested = Math.max(0, Math.floor(Number(setsMap[item.id] ?? 1)));
                        const sizesSum = Object.values(sizesMap[item.id] ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
                        const requested = (numSizes > 0 ? sizesSum : setsRequested) * cc;
                        if (typeof displayAvailable === "number" && displayAvailable > 0 && requested > displayAvailable) {
                          alert(`Only ${displayAvailable} pieces available (requested ${requested}). Reduce sets or colours.`);
                          const maxSets = numSizes > 0 ? Math.floor(displayAvailable / (cc * Math.max(1, numSizes))) : Math.floor(displayAvailable / cc);
                          setSetsMap((m) => ({ ...m, [item.id]: maxSets }));
                          if (sizeKeys.length > 0) {
                            const perSizeAllowed = Math.max(0, Math.floor(displayAvailable / (cc * Math.max(1, numSizes))));
                            setSizesMap((s) => ({ ...s, [item.id]: Object.fromEntries(sizeKeys.map((k) => [k, perSizeAllowed])) }));
                          }
                          return;
                        }
                        handleAddToCart(item);
                      }}
                      className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded font-semibold text-white transition-colors ${wasAdded ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}`}
                      aria-pressed={wasAdded}
                      disabled={
                        displayAvailable === 0 ||
                        (numSizes > 0 ? sumSizes === 0 : (setsMap[item.id] ?? 1) === 0) ||
                        (typeof displayAvailable === "number" && displayAvailable > 0 && totalRequestedPieces > displayAvailable)
                      }
                    >
                      {wasAdded ? (
                        <>
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                          <span>Added</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M6 6h15l-1.5 9h-13z" />
                            <path d="M6 6L4 2" />
                            <circle cx="10" cy="20" r="1" />
                            <circle cx="18" cy="20" r="1" />
                          </svg>
                          <span>Add to Cart</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <div />

        <nav className="inline-flex items-center gap-2" aria-label="Pagination bottom">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className={`px-3 py-2 rounded-md border ${safeCurrentPage === 1 ? "text-gray-500 border-gray-700" : "text-gray-200 border-gray-600 hover:bg-gray-700"}`}
            aria-label="Previous page"
            type="button"
          >
            ← Previous
          </button>

          {buildPageList(totalPages, safeCurrentPage, 2).map((p, idx) => {
            if (p === "ellipsis") {
              return (
                <span key={`ell-${idx}`} className="px-3 py-2 rounded-md text-gray-400 border border-gray-700">
                  …
                </span>
              );
            }
            const pageNum = p as number;
            const isActive = safeCurrentPage === pageNum;
            return (
              <button
                key={`pg-${pageNum}`}
                onClick={() => setCurrentPage(pageNum)}
                aria-current={isActive ? "page" : undefined}
                className={`px-3 py-2 rounded-md border ${isActive ? "bg-white text-gray-900 border-gray-300" : "text-gray-200 border-gray-600 hover:bg-gray-700"}`}
                type="button"
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            className={`px-3 py-2 rounded-md border ${safeCurrentPage === totalPages ? "text-gray-500 border-gray-700" : "text-gray-200 border-gray-600 hover:bg-gray-700"}`}
            aria-label="Next page"
            type="button"
          >
            Next →
          </button>
        </nav>
      </div>
    </div>
  );
}
