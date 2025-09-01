import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

/**
 * Convert a variety of timestamp shapes to an ISO string when possible.
 * Accepts:
 *  - Firestore Timestamp-like { toDate(): Date }
 *  - plain object { seconds: number, nanoseconds?: number }
 *  - ISO string or numeric epoch
 */
type TimestampLikeWithToDate = { toDate: () => Date };
type SecondsObject = { seconds: number; nanoseconds?: number };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasToDate(v: unknown): v is TimestampLikeWithToDate {
  return isObject(v) && typeof (v as { toDate?: unknown }).toDate === 'function';
}

function hasSeconds(v: unknown): v is SecondsObject {
  return isObject(v) && typeof (v as { seconds?: unknown }).seconds === 'number';
}

function tsToISO(ts: unknown): string | null {
  if (ts === null || ts === undefined) return null;

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
    const seconds = Number(ts.seconds);
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
 * Helper that accepts an unknown `params` (maybe a Promise), resolves it if needed,
 * and returns a plain object or null. This covers both shapes Next typings might provide.
 *
 * Avoids `any` by using a narrow Thenable shape.
 */
type Thenable = { then: (onfulfilled?: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown };

async function resolveParams(params: unknown): Promise<Record<string, unknown> | null> {
  if (params === null || params === undefined) return null;

  // If it's a thenable / promise-like, await it
  if (typeof params === 'object' && params !== null && 'then' in params) {
    const maybeThenable = params as Thenable;
    if (typeof maybeThenable.then === 'function') {
      try {
        const resolved = await (params as Promise<unknown>);
        return isObject(resolved) ? (resolved as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }

  return isObject(params) ? (params as Record<string, unknown>) : null;
}

/**
 * GET /api/orders/[orderId]
 *
 * Note: type of `context` uses `params?: unknown` to accept whatever Next's runtime/type definitions may pass.
 * We handle the unknown shape safely at runtime using resolveParams().
 */
export async function GET(
  request: NextRequest,
  context: { params?: unknown } // broad & safe so it matches Next's varying types
): Promise<NextResponse> {
  // resolve params whether they were provided synchronously or as a Promise
  const paramsObj = await resolveParams(context.params);

  const maybeOrderId = paramsObj && typeof paramsObj['orderId'] === 'string' ? paramsObj['orderId'] : undefined;
  const orderId = maybeOrderId?.trim();

  if (!orderId) {
    return NextResponse.json({ ok: false, message: 'Missing orderId' }, { status: 400 });
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });
    }

    // Document data may be DocumentData | undefined
    const raw = (snap.data() ?? {}) as Record<string, unknown>;

    // Normalize createdAt to ISO if possible
    const createdAtIso = tsToISO(raw['createdAt']);
    const orderData: Record<string, unknown> = {
      ...raw,
      createdAt: createdAtIso ?? raw['createdAt'] ?? null,
    };

    return NextResponse.json({ ok: true, order: { id: snap.id, ...orderData } }, { status: 200 });
  } catch (err: unknown) {
    console.error('Error fetching order details:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, message: `Error fetching order details: ${msg}` },
      { status: 500 }
    );
  }
}
