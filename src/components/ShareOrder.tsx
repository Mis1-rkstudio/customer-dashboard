'use client';

import React, { JSX, useState } from 'react';
import { FaShareAlt } from 'react-icons/fa';

type OrderItem = { itemName?: string; color?: string; quantity?: number };

export type OrderShape = {
  id?: string;
  customer?: { name?: string; phone?: string; email?: string };
  agent?: { name?: string; number?: string; email?: string };
  items?: OrderItem[];
  createdAt?: string | number | Date | { seconds?: number } | null;
  source?: string;
};

function formatDateStamp(d: unknown): string {
  if (d === null || d === undefined) return '—';

  // Firestore style { seconds }
  if (typeof d === 'object' && d !== null) {
    const rec = d as Record<string, unknown>;
    if ('seconds' in rec && typeof rec.seconds === 'number') {
      const seconds = Number(rec.seconds);
      if (!Number.isNaN(seconds)) {
        return new Date(seconds * 1000).toLocaleString();
      }
    }
  }

  // Date instance
  if (d instanceof Date) {
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return String(d);
  }

  // numeric epoch
  if (typeof d === 'number') {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) return dt.toLocaleString();
    return String(d);
  }

  // string/ISO
  try {
    const s = String(d);
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toLocaleString();
    return s;
  } catch {
    return String(d);
  }
}

function buildOrderMessage(order: OrderShape, orderUrl?: string): string {
  const lines: string[] = [];
  lines.push('🧾 Order Summary');
  if (order.id) lines.push(`Order ID: ${order.id}`);
  lines.push(`Placed: ${formatDateStamp(order.createdAt)}`);
  lines.push('');
  lines.push('Customer:');
  lines.push(`  Name: ${order.customer?.name ?? '—'}`);
  if (order.customer?.phone) lines.push(`  Phone: ${order.customer.phone}`);
  if (order.customer?.email) lines.push(`  Email: ${order.customer.email}`);
  lines.push('');
  lines.push('Agent:');
  lines.push(`  Name: ${order.agent?.name ?? '—'}`);
  if (order.agent?.number) lines.push(`  Phone: ${order.agent.number}`);
  if (order.agent?.email) lines.push(`  Email: ${order.agent?.email}`);
  lines.push('');
  lines.push('Items:');

  const items: OrderItem[] = order.items ?? [];
  if (items.length === 0) {
    lines.push('  (no items)');
  } else {
    items.forEach((it, idx) => {
      lines.push(`  ${idx + 1}. ${it.itemName ?? '—'} — ${it.color ?? '—'} — qty: ${it.quantity ?? 0}`);
    });
  }

  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  lines.push('');
  lines.push(`Total qty: ${total}`);

  if (orderUrl) {
    lines.push('');
    lines.push(`View order: ${orderUrl}`);
  }

  return lines.join('\n');
}

/* --- small helpers --- */
function onlyDigits(s = ''): string {
  return String(s).replace(/\D/g, '');
}

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

type ShareResult =
  | { platform: 'desktop'; openedUrl?: string }
  | { platform: 'mobile'; method?: 'web-share' | 'deep-link' | 'fallback-api'; openedUrl?: string };

/**
 * Opens WhatsApp with message.
 * - Desktop/laptop: opens WhatsApp Web in NEW TAB addressed to phone (if provided)
 * - Mobile: tries navigator.share, falls back to whatsapp deep link
 *
 * phone: string (any format) - function will strip non-digits; do NOT include '+'
 */
export async function shareToWhatsApp(text: string, phone?: string): Promise<ShareResult | void> {
  const encoded = encodeURIComponent(text);
  const digits = onlyDigits(phone ?? '');

  // Desktop: open WhatsApp Web (direct)
  if (!isMobileDevice()) {
    const waWebUrl = digits
      ? `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`;

    try {
      // open in new tab and avoid leaking opener
      window.open(waWebUrl, '_blank', 'noopener,noreferrer');
    } catch {
      const fallback = digits
        ? `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`
        : `https://api.whatsapp.com/send?text=${encoded}`;
      try {
        window.open(fallback, '_blank', 'noopener,noreferrer');
      } catch {
        // ignore
      }
    }

    // best-effort copy to clipboard using a safe typed narrow
    try {
      const nav = navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } };
      if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(text);
      }
    } catch {
      /* ignore copy errors */
    }

    return { platform: 'desktop', openedUrl: waWebUrl };
  }

  // Mobile: Web Share API preferred
  try {
    const navShare = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (navShare.share && typeof navShare.share === 'function') {
      await navShare.share({ title: 'Order', text });
      return { platform: 'mobile', method: 'web-share' };
    }
  } catch {
    // user cancelled or not available — fall through to deep link
  }

  // Mobile fallback: whatsapp:// deep link
  const waApp = digits ? `whatsapp://send?phone=${digits}&text=${encoded}` : `whatsapp://send?text=${encoded}`;

  try {
    // attempt to open the app
    window.location.href = waApp;
    return { platform: 'mobile', method: 'deep-link', openedUrl: waApp };
  } catch {
    // Last fallback: api.whatsapp.com (opens in browser)
    const fallback = digits
      ? `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;
    // set href as last resort
    window.location.href = fallback;
    return { platform: 'mobile', method: 'fallback-api', openedUrl: fallback };
  }
}

/* --- Icon-only share button (compact) --- */
type ShareIconProps = {
  order: OrderShape;
  orderUrl?: string;
  phone?: string;
  className?: string;
};

export function ShareOrderIcon({ order, orderUrl, phone, className = '' }: ShareIconProps): JSX.Element {
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const handleShare = async (): Promise<void> => {
    setLoading(true);
    setCopied(false);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = orderUrl ?? (origin ? `${origin}/orders/${order?.id ?? ''}` : undefined);
      const text = buildOrderMessage(order, url);
      const res = await shareToWhatsApp(text, phone);
      // On desktop we copied to clipboard inside shareToWhatsApp; show temporary feedback
      if (!isMobileDevice() && res?.platform === 'desktop') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleShare}
        aria-label="Share order"
        title="Share order"
        disabled={loading}
        className={`inline-flex items-center justify-center p-2 rounded-md bg-gray-800 border border-gray-700 hover:bg-gray-700 focus:outline-none ${className}`}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4 text-gray-300" viewBox="0 0 24 24" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <FaShareAlt className="h-4 w-4 text-gray-300" aria-hidden />
        )}
      </button>

      {copied && <span className="ml-2 text-xs text-green-400">copied</span>}
    </div>
  );
}

/* --- Full button variant --- */
type ShareButtonProps = {
  order: OrderShape;
  orderUrl?: string;
  phone?: string;
  className?: string;
};

export function ShareOrderButton({ order, orderUrl, phone, className = '' }: ShareButtonProps): JSX.Element {
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const onShare = async (): Promise<void> => {
    setLoading(true);
    setCopied(false);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = orderUrl ?? (origin ? `${origin}/orders/${order?.id ?? ''}` : undefined);
      const text = buildOrderMessage(order, url);
      const res = await shareToWhatsApp(text, phone);
      if (!isMobileDevice() && res?.platform === 'desktop') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className={`inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded disabled:opacity-60 ${className}`}
      disabled={loading}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : (
        <FaShareAlt className="h-4 w-4" />
      )}
      <span>{loading ? 'Preparing...' : 'Share'}</span>
      {copied && <span className="ml-2 text-xs text-green-100">copied</span>}
    </button>
  );
}

export default ShareOrderIcon;
