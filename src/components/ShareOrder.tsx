// components/ShareOrder.tsx
'use client';

import React, { useState } from 'react';
import { FaShareAlt } from 'react-icons/fa';

type OrderItem = { itemName?: string; color?: string; quantity?: number };
export type OrderShape = {
  id?: string;
  customer?: { name?: string; phone?: string; email?: string };
  agent?: { name?: string; number?: string; email?: string };
  items?: OrderItem[];
  createdAt?: string | { seconds?: number };
  source?: string;
};

function formatDateStamp(d: any) {
  if (!d) return '—';
  if (typeof d === 'object' && d?.seconds) return new Date(d.seconds * 1000).toLocaleString();
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}

function buildOrderMessage(order: OrderShape, orderUrl?: string) {
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

  const items = order.items ?? [];
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

// helper utils (keep in same file)
function onlyDigits(s = '') {
    return String(s).replace(/\D/g, '');
  }
  function isMobileDevice() {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }
  
  /**
   * Opens WhatsApp with message.
   * - Desktop/laptop: opens WhatsApp Web in NEW TAB addressed to phone (if provided)
   * - Mobile: tries navigator.share, falls back to whatsapp deep link
   *
   * phone: string (any format) - function will strip non-digits; do NOT include '+'
   */
  export async function shareToWhatsApp(text, phone) {
    const encoded = encodeURIComponent(text);
    const digits = onlyDigits(phone || '');
  
    // Desktop: open WhatsApp Web (direct)
    if (!isMobileDevice()) {
      // If phone digits exist, open chat to that number. Otherwise open generic composer.
      const waWebUrl = digits
        ? `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`
        : `https://web.whatsapp.com/send?text=${encoded}`;
  
      // Open in a new tab/window and avoid leaking window.opener
      try {
        window.open(waWebUrl, '_blank', 'noopener');
      } catch (err) {
        // fallback to api.whatsapp.com if window.open fails for some reason
        const fallback = digits
          ? `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`
          : `https://api.whatsapp.com/send?text=${encoded}`;
        window.open(fallback, '_blank', 'noopener');
      }
  
      // copy to clipboard as convenience (best-effort)
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          /* ignore copy errors */
        }
      }
      return { platform: 'desktop', openedUrl: waWebUrl };
    }
  
    // Mobile: Web Share API preferred
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Order', text });
        return { platform: 'mobile', method: 'web-share' };
      } catch (err) {
        // user cancelled or not available — fall back to app deep link
      }
    }
  
    // Mobile fallback: whatsapp:// deep link
    const waApp = digits
      ? `whatsapp://send?phone=${digits}&text=${encoded}`
      : `whatsapp://send?text=${encoded}`;
  
    // Redirect user to whatsapp app; on some Android devices this will open WhatsApp
    try {
      window.location.href = waApp;
      return { platform: 'mobile', method: 'deep-link', openedUrl: waApp };
    } catch (err) {
      // Last fallback: api.whatsapp.com (opens in browser)
      const fallback = digits
        ? `https://api.whatsapp.com/send?phone=${digits}&text=${encoded}`
        : `https://api.whatsapp.com/send?text=${encoded}`;
      window.location.href = fallback;
      return { platform: 'mobile', method: 'fallback-api', openedUrl: fallback };
    }
  }
  

/** Icon-only share button (compact) */
export function ShareOrderIcon({
  order,
  orderUrl,
  phone,
  className = '',
}: {
  order: OrderShape;
  orderUrl?: string;
  phone?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = orderUrl ?? (origin ? `${origin}/orders/${order?.id ?? ''}` : undefined);
      const text = buildOrderMessage(order, url);
      if (!isMobileDevice()) {
        await shareToWhatsApp(text, phone);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        await shareToWhatsApp(text, phone);
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

/** Full button variant if you ever want it */
export function ShareOrderButton({
  order,
  orderUrl,
  phone,
  className = '',
}: {
  order: OrderShape;
  orderUrl?: string;
  phone?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = orderUrl ?? (origin ? `${origin}/orders/${order?.id ?? ''}` : undefined);
      const text = buildOrderMessage(order, url);
      await shareToWhatsApp(text, phone);
      if (!isMobileDevice()) {
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
