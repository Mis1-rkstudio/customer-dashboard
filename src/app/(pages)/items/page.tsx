'use client';

import AuthGuard from '@/components/AuthGuard';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Select, { StylesConfig } from 'react-select';
import { Tag, Zap } from 'lucide-react';
import { useCart } from '@/context/CartContext';

type ItemRow = {
  raw?: any;
  id: string;
  name: string;
  colors: string[];
  image: string | null;
  concept?: string | null;
  fabric?: string | null;
  closingStock?: number | null;
  in_production?: boolean;
};

function getCleanFileUrl(fileUrl?: string) {
  if (!fileUrl) return null;
  return fileUrl.replace(/\/view\?usp=.*$/i, '');
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

const selectStyles: StylesConfig<any, true> = {
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

function toOptions(arr: string[] | undefined) {
  if (!arr || !Array.isArray(arr)) return [];
  const uniq = Array.from(new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))).sort();
  return uniq.map((v) => ({ value: v, label: v }));
}

function useDebounced(value: string, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ItemsPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToCart } = useCart();
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});

  // search + filters
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounced(searchText, 250);
  const [selectedConcepts, setSelectedConcepts] = useState<any[]>([]);
  const [selectedFabrics, setSelectedFabrics] = useState<any[]>([]);
  const [selectedColors, setSelectedColors] = useState<any[]>([]);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all');

  // pagination
  const [pageSize, setPageSize] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // lazy image observer
  const observersRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const visibleRef = useRef<Record<string, boolean>>({});
  const [, forceRerender] = useState(0);

  // track when initial items have arrived so we can fetch designs_in_production once
  const [itemsLoaded, setItemsLoaded] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function fetchItems() {
      setIsLoading(true);
      try {
        const res = await fetch('/api/items');
        if (!res.ok) {
          console.error('Failed to fetch items', res.status);
          setItems([]);
          setItemsLoaded(true);
          return;
        }
        const payload = await res.json();
        const rawList = Array.isArray(payload) ? payload : Array.isArray(payload.rows) ? payload.rows : [];

        const normalized: ItemRow[] = rawList.map((r: any) => {
          const id = String((r.Item ?? r.Product_Code ?? r.Product_Code ?? '')).trim();
          const name = String(r.Item ?? r.Product_Code ?? id).trim();
          const colors = Array.isArray(r.Colors) ? r.Colors.map((c: any) => String(c).trim()).filter(Boolean) : [];
          const thumbnail = r.Thumbnail_URL ?? r.thumbnail ?? null;
          const fileUrl = getCleanFileUrl(r.File_URL ?? r.FileUrl ?? r.file_url);
          const image = thumbnail || fileUrl || null;
          const concept = r.Concept ?? r.Concept_2 ?? r.Concept_1 ?? null;
          const fabric = r.Fabric ?? r.Concept_3 ?? null;
          const closingStockRaw = r.Closing_Stock ?? r.ClosingStock ?? r.closing_stock ?? null;
          const closingStockNum = closingStockRaw === null ? null : Number(closingStockRaw);
          return {
            raw: r,
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

    async function fetchDesignsInProd() {
      try {
        const res = await fetch('/api/designs_in_production');
        if (!res.ok) {
          console.warn('designs_in_production fetch failed', res.status);
          return;
        }
        const payload = await res.json();
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload.rows) ? payload.rows : [];

        const codes = rows
          .map((r: any) => {
            if (!r) return '';
            if (typeof r === 'string') return r;
            return r.product_code ?? r.design_name ?? r.Design_Name ?? r.Product_Code ?? r.design ?? '';
          })
          .map((s: any) => String(s || '').trim().toLowerCase())
          .filter(Boolean);

        const codeSet = new Set(codes);

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
    observersRef.current.forEach((o) => o.disconnect());
    observersRef.current.clear();
    forceRerender((n) => n + 1);
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
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages]);

  // lazy observe element
  function observeElement(id: string, el: HTMLElement | null) {
    if (!el) return;
    if (visibleRef.current[id]) return;
    const existing = observersRef.current.get(id);
    if (existing) existing.disconnect();

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleRef.current[id] = true;
            const o = observersRef.current.get(id);
            if (o) {
              o.disconnect();
              observersRef.current.delete(id);
            }
            forceRerender((s) => s + 1);
          }
        }
      },
      { root: null, rootMargin: '200px', threshold: 0.05 }
    );
    obs.observe(el);
    observersRef.current.set(id, obs);
  }

  const handleAddToCart = (item: ItemRow) => {
    addToCart({
      id: item.id,
      name: item.name,
      image: item.image || '/placeholder.svg',
      colors: item.colors,
      raw: item.raw,
    });
    setAddedMap((m) => ({ ...m, [item.id]: true }));
    setTimeout(() => setAddedMap((m) => ({ ...m, [item.id]: false })), 2500);
  };

  // pagination UI helper: show a compact list with ellipses like [1,2,3,...,20]
  function getPageButtons(current: number, total: number) {
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
            onChange={(v: any) => setSelectedConcepts(v || [])}
            placeholder="Filter by concept..."
            styles={selectStyles}
            classNamePrefix="rs"
          />
          <Select
            isMulti
            options={fabricOptions}
            value={selectedFabrics}
            onChange={(v: any) => setSelectedFabrics(v || [])}
            placeholder="Filter by fabric..."
            styles={selectStyles}
            classNamePrefix="rs"
          />
          <Select
            isMulti
            options={colorOptions}
            value={selectedColors}
            onChange={(v: any) => setSelectedColors(v || [])}
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
            {paginatedItems.map((item) => {
              const wasAdded = Boolean(addedMap[item.id]);
              const meta = stockMeta(item.closingStock);
              const visible = !!visibleRef.current[item.id];

              return (
                <article key={item.id || item.name} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col h-full">
                  <div className="relative h-64 bg-gray-700 flex items-center justify-center overflow-hidden">
                    <div
                      ref={(el) => {
                        if (el) observeElement(item.id, el);
                      }}
                      className="w-full h-full"
                      aria-hidden
                    >
                      {visible && item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = '/placeholder.svg';
                          }}
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
                <span key={`dots-b-${i}`} className="px-2 text-gray-400">
                  …
                </span>
              ) : (
                <button
                  key={`b-${p}`}
                  onClick={() => setCurrentPage(Number(p))}
                  aria-current={safeCurrentPage === p ? 'page' : undefined}
                  className={`px-3 py-2 rounded-md border ${safeCurrentPage === p ? 'bg-white text-gray-900 border-gray-300' : 'text-gray-200 border-gray-600 hover:bg-gray-700'
                    }`}
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
