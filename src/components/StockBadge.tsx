// src/components/StockBadge.tsx
import React from 'react';
import { Tag } from 'lucide-react';

type Props = {
  qty?: number | null;
  className?: string;
};

function classifyStock(qty?: number | null) {
  if (qty === null || qty === undefined) return 'unknown';
  const n = Number(qty);
  if (Number.isNaN(n)) return 'unknown';
  if (n <= 4) return 'low';
  if (n <= 24) return 'medium';
  return 'high';
}

export default function StockBadge({ qty = null, className = '' }: Props) {
  const state = classifyStock(qty);

  const meta: Record<string, { label: string; bg: string; iconBg: string; text: string }> = {
    low: { label: 'Low stock', bg: 'bg-red-600', iconBg: 'bg-red-700', text: 'text-white' },
    medium: { label: 'Medium stock', bg: 'bg-orange-500', iconBg: 'bg-orange-600', text: 'text-white' },
    high: { label: 'In stock', bg: 'bg-green-600', iconBg: 'bg-green-700', text: 'text-white' },
    unknown: { label: 'Unknown', bg: 'bg-gray-600', iconBg: 'bg-gray-700', text: 'text-white' },
  };

  const m = meta[state] ?? meta.unknown;

  return (
    <span
      className={`${className} inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold shadow ${m.bg} ${m.text}`}
      title={`${m.label} • ${qty ?? '-'}`}
      aria-label={`${m.label} ${qty ?? ''}`}
    >
      <span className={`inline-flex items-center justify-center rounded-full p-0.5 ${m.iconBg}`} aria-hidden>
        <Tag className="w-3 h-3 text-white" />
      </span>
      <span className="whitespace-nowrap">{m.label}</span>
      {typeof qty === 'number' ? <span className="ml-1 opacity-90">• {qty}</span> : null}
    </span>
  );
}
