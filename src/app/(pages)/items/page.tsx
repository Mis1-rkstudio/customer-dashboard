'use client';

import React, { JSX, useEffect, useMemo, useRef, useState } from 'react';
import Select, { StylesConfig, OnChangeValue } from 'react-select';
import { Tag, Zap } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import Image from 'next/image';

type Option = { value: string; label: string };

type ItemRow = {
  raw?: Record<string, unknown>;
  id: string;
  name: string;
  colors: string[];
  image: string | null;
  concept?: string | null;
  fabric?: string | null;
  closingStock?: number | null;
  in_production?: boolean;
};

type ApiRow = Record<string, unknown>;
type ApiPayload = unknown; // can be array of rows or { rows: [...] }

type CartAddItem = {
  id: string;
  name: string;
  image: string;
  colors: string[];
  raw?: Record<string, unknown>;
};

type CartContextMinimal = {
  addToCart: (item: CartAddItem) => void;
  // expand this type if you need other methods from your actual context
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getRowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload as unknown[];
  if (isObject(payload) && Array.isArray(payload['rows'])) return payload['rows'] as unknown[];
  return [];
}

function getCleanFileUrl(fileUrl?: string): string | null {
  if (!fileUrl) return null;
  try {
    return String(fileUrl).replace(/\/view\?usp=.*$/i, '');
  } catch {
    return null;
  }
}

function classifyStock(qty: number | null | undefined): 'low' | 'medium' | 'high' | 'unknown' {
  if (qty === null || qty === undefined) return 'unknown';
  const n = Number(qty);
  if (Number.isNaN(n)) return 'unknown';
  if (n <= 4) return 'low';
  if (n <= 24) return 'medium';
  return 'high';
}
function stockMeta(qty: number | null | undefined) {
  const cls = classifyStock(qty);
  if (cls === 'low') return { label: 'Low stock', shortLabel: 'Low', colorClass: 'bg-red-600 text-white' };
  if (cls === 'medium') return { label: 'Medium stock', shortLabel: 'Medium', colorClass: 'bg-orange-500 text-white' };
  if (cls === 'high') return { label: 'In stock', shortLabel: 'In stock', colorClass: 'bg-green-600 text-white' };
  return { label: 'Unknown', shortLabel: 'Unknown', colorClass: 'bg-gray-600 text-white' };
}

const selectStyles: StylesConfig<Option, true> = {
  control: (provided) => ({
    ...provided,
    background: '#0f1724',
    borderColor: '#243047',
    minHeight: 40,
    color: '#e5e7eb',
  }),
  menu: (provided) => ({ ...provided, background: '#0f1724', color: '#e5e7eb' }),
  option: (provided, state) => ({
    ...provided,
    background: state.isSelected ? '#153f63' : state.isFocused ? '#132f44' : '#0f1724',
    color: '#e5e7eb',
  }),
  singleValue: (provided) => ({ ...provided, color: '#e5e7eb' }),
  input: (provided) => ({ ...provided, color: '#e5e7eb' }),
  placeholder: (provided) => ({ ...provided, color: '#94a3b8' }),
  multiValue: (provided) => ({ ...provided, background: '#1f2937', color: '#e5e7eb' }),
  multiValueLabel: (provided) => ({ ...provided, color: '#e5e7eb' }),
  multiValueRemove: (provided) => ({ ...provided, color: '#94a3b8', ':hover': { background: '#374151', color: 'white' } }),
};

function toOptions(arr?: string[]): Option[] {
  if (!arr || !Array.isArray(arr)) return [];
  const uniq = Array.from(new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))).sort();
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

export default function ItemsPage(): JSX.Element {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { addToCart } = useCart() as CartContextMinimal;
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});

  // search + filters
  const [searchText, setSearchText] = useState<string>('');
  const debouncedSearch = useDebounced(searchText, 250);
  const [selectedConcepts, setSelectedConcepts] = useState<Option[]>([]);
  const [selectedFabrics, setSelectedFabrics] = useState<Option[]>([]);
  const [selectedColors, setSelectedColors] = useState<Option[]>([]);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all');

  // pagination
  const [pageSize] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // lazy image observer
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const visibleRef = useRef<Record<string, boolean>>({});
  const [, forceRerender] = useState<number>(0);

  // track when initial items have arrived so we can fetch designs_in_production once
  const [itemsLoaded, setItemsLoaded] = useState<boolean>(false);

  // broken images state
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  // timers for add-to-cart ephemeral state
  const addTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let canceled = false;
    async function fetchItems(): Promise<void> {
      setIsLoading(true);
      try {
        const res = await fetch('/api/items');
        const text = await res.text();
        if (!res.ok) {
          console.error('Failed to fetch items', res.status, text);
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
          // fallback: maybe server returned raw JSON already stringified
          payload = text as ApiPayload;
        }

        const rawList: unknown[] = getRowsFromPayload(payload);

        const normalized: ItemRow[] = rawList.map((r: unknown) => {
          const rec = (typeof r === 'object' && r !== null) ? (r as ApiRow) : {};
          const idCandidate = rec['Item'] ?? rec['Product_Code'] ?? rec['product_code'] ?? '';
          const id = String(idCandidate ?? '').trim();
          const name = String(rec['Item'] ?? rec['Product_Code'] ?? id).trim();
          const colors = Array.isArray(rec['Colors']) ? (rec['Colors'] as unknown[]).map((c) => String(c ?? '').trim()).filter(Boolean) : [];
          const thumbnail = (rec['Thumbnail_URL'] ?? rec['thumbnail'] ?? null) as string | null;
          const fileUrl = getCleanFileUrl((rec['File_URL'] ?? rec['FileUrl'] ?? rec['file_url']) as string | undefined);
          const image = (thumbnail || fileUrl) ?? null;
          const concept = (rec['Concept'] ?? rec['Concept_2'] ?? rec['Concept_1'] ?? null) as string | null;
          const fabric = (rec['Fabric'] ?? rec['Concept_3'] ?? null) as string | null;
          const closingStockRaw = rec['Closing_Stock'] ?? rec['ClosingStock'] ?? rec['closing_stock'] ?? null;
          const closingStockNum = closingStockRaw === null ? null : Number(closingStockRaw);
          return {
            raw: rec,
            id,
            name,
            colors,
            image,
            concept,
            fabric,
            closingStock: Number.isNaN(closingStockNum) ? null : closingStockNum,
            in_production: false,
          };
        });

        if (!canceled) {
          setItems(normalized);
          setItemsLoaded(true);
        }
      } catch (err) {
        console.error('Error fetching items:', err);
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

  // fetch designs in production once items are loaded, then mark items
  useEffect(() => {
    if (!itemsLoaded) return;
    let canceled = false;

    async function fetchDesignsInProd(): Promise<void> {
      try {
        const res = await fetch('/api/designs_in_production');
        const text = await res.text();
        if (!res.ok) {
          console.warn('designs_in_production fetch failed', res.status, text);
          return;
        }

        let payload: ApiPayload;
        try {
          payload = JSON.parse(text) as ApiPayload;
        } catch {
          payload = text as ApiPayload;
        }

        const rows: unknown[] = getRowsFromPayload(payload);

        const codes = rows
          .map((r: unknown) => {
            if (!r) return '';
            if (typeof r === 'string') return r;
            const rec = r as ApiRow;
            return String(rec['product_code'] ?? rec['design_name'] ?? rec['Design_Name'] ?? rec['Product_Code'] ?? rec['design'] ?? '').trim();
          })
          .map((s) => String(s || '').trim().toLowerCase())
          .filter(Boolean);

        const codeSet = new Set<string>(codes);

        if (canceled) return;

        setItems((prev) => prev.map((it) => ({ ...it, in_production: codeSet.has(String(it.id || it.name || '').trim().toLowerCase()) })));
      } catch (err) {
        console.error('Error fetching designs_in_production:', err);
      }
    }

    fetchDesignsInProd();
    return () => {
      canceled = true;
    };
  }, [itemsLoaded]);

  // options for selects
  const conceptOptions = useMemo(() => toOptions(items.map((i) => i.concept ?? '').filter(Boolean)), [items]);
  const fabricOptions = useMemo(() => toOptions(items.map((i) => i.fabric ?? '').filter(Boolean)), [items]);
  const colorOptions = useMemo(() => toOptions(items.flatMap((i) => i.colors || [])), [items]);

  // reset page when filters/search change
  useEffect(() => {
    setCurrentPage(1);
    visibleRef.current = {};
    // disconnect existing observers
    observersRef.current.forEach((o) => {
      try {
        o.disconnect();
      } catch {
        // ignore
      }
    });
    observersRef.current.clear();
    forceRerender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedConcepts, selectedFabrics, selectedColors, stockFilter, pageSize]);

  // filtering logic
  const filteredItems = useMemo(() => {
    const s = String(debouncedSearch || '').trim().toLowerCase();
    const selectedConceptVals = selectedConcepts.map((x) => String(x.value ?? x).toLowerCase());
    const selectedFabricVals = selectedFabrics.map((x) => String(x.value ?? x).toLowerCase());
    const selectedColorVals = selectedColors.map((x) => String(x.value ?? x).toLowerCase());

    return items.filter((it) => {
      if (stockFilter !== 'all') {
        const cls = classifyStock(it.closingStock);
        if (cls !== stockFilter) return false;
      }

      if (selectedConceptVals.length > 0) {
        const v = String(it.concept ?? '').toLowerCase();
        if (!selectedConceptVals.includes(v)) return false;
      }

      if (selectedFabricVals.length > 0) {
        const v = String(it.fabric ?? '').toLowerCase();
        if (!selectedFabricVals.includes(v)) return false;
      }

      if (selectedColorVals.length > 0) {
        const itemColors = (it.colors || []).map((c) => String(c || '').toLowerCase());
        const has = selectedColorVals.some((c) => itemColors.includes(c));
        if (!has) return false;
      }

      if (s) {
        const hay = [
          it.name,
          it.id,
          it.concept ?? '',
          it.fabric ?? '',
          ...(it.colors || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [items, debouncedSearch, selectedConcepts, selectedFabrics, selectedColors, stockFilter]);

  // pagination calculations
  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safeCurrentPage, pageSize]);

  // ensures currentPage valid when totalPages changes
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  // cleanup add-to-cart timers on unmount
  useEffect(() => {
    return () => {
      Object.values(addTimersRef.current).forEach((id) => {
        try {
          clearTimeout(id);
        } catch {
          // ignore
        }
      });
      addTimersRef.current = {};
    };
  }, []);

  // lazy observe element
  function observeElement(id: string, el: HTMLElement | null): void {
    if (!el) return;
    if (visibleRef.current[id]) return;
    const existing = observersRef.current.get(id);
    if (existing) {
      try {
        existing.disconnect();
      } catch {
        // ignore
      }
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
              } catch {
                // ignore
              }
              observersRef.current.delete(id);
            }
            forceRerender((s) => s + 1);
          }
        }
      },
      { root: null, rootMargin: '200px', threshold: 0.05 }
    );
    try {
      obs.observe(el);
      observersRef.current.set(id, obs);
    } catch {
      // IntersectionObserver.observe may throw in some environments; ignore
    }
  }

  const handleAddToCart = (item: ItemRow): void => {
    addToCart({
      id: item.id,
      name: item.name,
      image: item.image || '/placeholder.svg',
      colors: item.colors,
      raw: item.raw,
    });

    setAddedMap((m) => ({ ...m, [item.id]: true }));

    // clear existing timer for this item (if any)
    if (addTimersRef.current[item.id]) {
      clearTimeout(addTimersRef.current[item.id]);
    }

    // window.setTimeout returns number in browsers
    const timerId = window.setTimeout(() => {
      setAddedMap((m) => ({ ...m, [item.id]: false }));
      delete addTimersRef.current[item.id];
    }, 2500);

    addTimersRef.current[item.id] = timerId;
  };

  // pagination UI helper: show a compact list with ellipses like [1,2,3,...,20]
  function getPageButtons(current: number, total: number): (number | '...')[] {
    const out: (number | '...')[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) out.push(i);
      return out;
    }
    out.push(1);
    if (current > 4) out.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) out.push(i);
    if (current < total - 3) out.push('...');
    out.push(total);
    return out;
  }

  // typed handlers for react-select
  const onConceptChange = (v: OnChangeValue<Option, true>) => setSelectedConcepts((v ?? []) as Option[]);
  const onFabricChange = (v: OnChangeValue<Option, true>) => setSelectedFabrics((v ?? []) as Option[]);
  const onColorChange = (v: OnChangeValue<Option, true>) => setSelectedColors((v ?? []) as Option[]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
        <div>
          <input
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
            placeholder="Search by design, code, color, concept or fabric..."
            className="w-full bg-gray-900 text-white border border-gray-700 rounded-md py-3 px-4 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search items"
          />
        </div>

        <div className="flex gap-3 items-center justify-end">
          <div className="flex items-center gap-2 text-sm text-gray-300 mr-2">Stock</div>
          {(['all', 'low', 'medium', 'high'] as const).map((s) => {
            const active = stockFilter === s;
            const label = s === 'all' ? 'All' : s === 'low' ? 'Low' : s === 'medium' ? 'Medium' : 'In stock';
            return (
              <button
                key={s}
                onClick={() => setStockFilter(s)}
                className={`px-3 py-2 rounded-md text-sm font-medium focus:outline-none ${active ? 'bg-gray-200 text-gray-900 shadow' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
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
          onChange={onConceptChange}
          placeholder="Filter by concept..."
          styles={selectStyles}
          classNamePrefix="rs"
        />
        <Select
          isMulti
          options={fabricOptions}
          value={selectedFabrics}
          onChange={onFabricChange}
          placeholder="Filter by fabric..."
          styles={selectStyles}
          classNamePrefix="rs"
        />
        <Select
          isMulti
          options={colorOptions}
          value={selectedColors}
          onChange={onColorChange}
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
            const meta = stockMeta(item.closingStock);
            const visible = !!visibleRef.current[item.id];

            return (
              <article key={item.id || `${item.name}-${index}`} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col h-full">
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
                        style={{ objectFit: 'cover' }}
                        onError={() => setBrokenImages((b) => ({ ...b, [item.id]: true }))}
                        quality={72}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-800/60 flex items-center justify-center">
                        <svg className="w-14 h-14 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="4" width="18" height="14" rx="2" />
                          <path d="M3 20h18" />
                          <circle cx="8.5" cy="10.5" r="1.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="text-lg font-semibold text-white mb-2 truncate">{item.name}</h3>

                  {item.concept && (
                    <p className="text-sm text-gray-400 mb-1">
                      <span className="text-gray-300 font-medium">Concept:</span> {item.concept}
                    </p>
                  )}
                  {item.fabric && (
                    <p className="text-sm text-gray-400 mb-2">
                      <span className="text-gray-300 font-medium">Fabric:</span> {item.fabric}
                    </p>
                  )}

                  <p className="text-sm text-gray-300 mb-2">
                    <span className="font-medium text-gray-200">Colors:</span>{' '}
                    {item.colors.length ? item.colors.join(', ') : '—'}
                  </p>

                  {/* small badges placed under details */}
                  <div className="flex items-center gap-2 mb-3">
                    {/* stock badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.colorClass}`}
                      title={`${meta.label} • ${item.closingStock ?? '-'}`}
                    >
                      <Tag className="h-3 w-3" />
                      <span className="leading-none">{meta.shortLabel}{typeof item.closingStock === 'number' ? ` • ${item.closingStock}` : ''}</span>
                    </span>

                    {/* in production badge (blue) */}
                    {item.in_production && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-600 text-white">
                        <Zap className="h-3 w-3" />
                        <span className="leading-none">In production</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-auto">
                    <button
                      onClick={() => handleAddToCart(item)}
                      className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded font-semibold text-white transition-colors ${wasAdded ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      aria-pressed={wasAdded}
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

      {/* bottom pagination (mirror of top) */}
      <div className="mt-6 flex items-center justify-between">
        <div />
        <nav className="inline-flex items-center gap-2" aria-label="Pagination bottom">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className={`px-3 py-2 rounded-md border ${safeCurrentPage === 1 ? 'text-gray-500 border-gray-700' : 'text-gray-200 border-gray-600 hover:bg-gray-700'}`}
            aria-label="Previous page"
            type="button"
          >
            ← Previous
          </button>

          {getPageButtons(safeCurrentPage, totalPages).map((p, i) =>
            p === '...' ? (
              <span key={`dots-b-${i}`} className="px-2 text-gray-400">…</span>
            ) : (
              <button
                key={`b-${p}`}
                onClick={() => setCurrentPage(Number(p))}
                aria-current={safeCurrentPage === p ? 'page' : undefined}
                className={`px-3 py-2 rounded-md border ${safeCurrentPage === p ? 'bg-white text-gray-900 border-gray-300' : 'text-gray-200 border-gray-600 hover:bg-gray-700'}`}
                type="button"
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            className={`px-3 py-2 rounded-md border ${safeCurrentPage === totalPages ? 'text-gray-500 border-gray-700' : 'text-gray-200 border-gray-600 hover:bg-gray-700'}`}
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
