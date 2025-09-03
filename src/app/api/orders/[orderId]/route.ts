// app/api/orders/[orderId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

/**
 * Helpers for timestamp normalization and runtime type-guards
 */

type TimestampLikeWithToDate = { toDate: () => Date };
type SecondsObject = { seconds: number; nanoseconds?: number };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasToDate(v: unknown): v is TimestampLikeWithToDate {
  return isObject(v) && typeof (v as Partial<TimestampLikeWithToDate>).toDate === 'function';
}

function hasSeconds(v: unknown): v is SecondsObject {
  return isObject(v) && typeof (v as Partial<SecondsObject>).seconds === 'number';
}

/**
 * Convert many timestamp-like shapes to an ISO string when possible.
 * - Firestore Timestamp-like { toDate(): Date }
 * - plain object { seconds: number, nanoseconds?: number }
 * - wrapper { value: '2025-09-03T...' }
 * - ISO string or numeric epoch
 */
function tsToISO(ts: unknown): string | null {
  if (ts === null || ts === undefined) return null;

  // wrapper object with 'value' string (your screenshot had createdAt: { value: "ISO..." })
  if (isObject(ts) && 'value' in ts && typeof (ts as Record<string, unknown>).value === 'string') {
    try {
      const maybeIso = String((ts as Record<string, unknown>).value).trim();
      if (maybeIso) {
        const d = new Date(maybeIso);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    } catch {
      /* fall through */
    }
  }

  // Firestore Timestamp-like: has toDate()
  if (hasToDate(ts)) {
    try {
      const d = ts.toDate();
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    } catch {
      // fallthrough to other checks
    }
  }

  // Plain object with seconds/nanoseconds
  if (hasSeconds(ts)) {
    const seconds = Number((ts as SecondsObject).seconds);
    const nanoseconds = Number((ts as SecondsObject).nanoseconds ?? 0);
    const ms = seconds * 1000 + Math.floor(nanoseconds / 1e6);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  // String or number epoch/ISO
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * Safely parse JSON if it's a string; returns parsed object or null.
 * If input is already an object, returns it (cast to Record).
 */
function tryParseJson(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (isObject(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }
  if (isObject(v)) return v as Record<string, unknown>;
  return null;
}

/**
 * GET /api/orders/[orderId]
 *
 * Returns:
 *   { ok: true, order: { id, ... } } on success
 *   { ok: false, message } on error
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // use request.nextUrl when available, otherwise fallback to request.url
    const url = (request as { nextUrl?: URL }).nextUrl ?? new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const maybeOrderId = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : '';
    const orderId = String(maybeOrderId ?? '').trim();

    if (!orderId) {
      return NextResponse.json({ ok: false, message: 'Missing orderId' }, { status: 400 });
    }

    // Read document by id
    const docRef = db.collection('orders').doc(orderId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });
    }

    // Document data
    const raw = (snap.data() ?? {}) as Record<string, unknown>;

    // If document has a `payload` (string or object) prefer it as canonical order
    // but still keep wrapper fields available (we merge wrapper fields onto payload when safe)
    let canonical: Record<string, unknown> | null = null;
    if ('payload' in raw) {
      const p = raw.payload;
      // Try parse string payload
      if (typeof p === 'string' && p.trim()) {
        canonical = tryParseJson(p);
      } else if (isObject(p)) {
        // payload already object
        canonical = p as Record<string, unknown>;
      } else {
        // payload present but not useful — leave canonical null to fall back to raw
        canonical = null;
      }
    }

    // If no payload or payload isn't usable, use doc fields as canonical
    if (!canonical) {
      canonical = { ...raw };
    } else {
      // Merge wrapper fields (raw) with payload, letting payload values win for duplicate keys
      canonical = { ...raw, ...canonical };
    }

    // Normalize createdAt using any of the common shapes (including nested { value })
    const createdAtCandidate =
      canonical['createdAt'] ??
      canonical['created_at'] ??
      raw['createdAt'] ??
      raw['created_at'] ??
      null;
    const createdAtIso = tsToISO(createdAtCandidate ?? null) ?? null;

    // Ensure id is present (prefer payload id if present, otherwise doc id)
    const payloadId =
      canonical['id'] ?? canonical['orderId'] ?? canonical['order_id'] ?? canonical['ID'] ?? null;
    const finalId = String(payloadId ?? snap.id);

    // Build final order object to return
    const orderData: Record<string, unknown> = {
      id: finalId,
      ...canonical,
      // normalize createdAt to ISO string when possible, otherwise preserve original
      createdAt: createdAtIso ?? (canonical['createdAt'] ?? canonical['created_at'] ?? null),
    };

    // Return a stable, single-order response
    return NextResponse.json({ ok: true, order: orderData }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('Error fetching order details:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Error fetching order details: ${msg}` }, { status: 500 });
  }
}
