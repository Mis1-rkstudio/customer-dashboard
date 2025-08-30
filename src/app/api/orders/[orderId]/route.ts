// app/api/orders/[orderId]/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

/**
 * GET /api/orders/:orderId
 * Returns: { ok: true, order: { id, ...data, createdAt: "<ISO string>" } }
 * Errors return JSON with ok:false and a proper HTTP status.
 */

function tsToISO(ts: any): string | null {
  if (!ts) return null;

  // Firestore Timestamp (has toDate)
  if (typeof ts.toDate === 'function') {
    try {
      return ts.toDate().toISOString();
    } catch {
      // fallthrough
    }
  }

  // Plain object with seconds/nanoseconds
  if (typeof ts.seconds === 'number') {
    const seconds = Number(ts.seconds);
    const nanoseconds = Number(ts.nanoseconds || 0);
    const ms = seconds * 1000 + Math.floor(nanoseconds / 1e6);
    return new Date(ms).toISOString();
  }

  // ISO string or epoch
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts as any);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: { orderId?: string } }
) {
  const orderId = params?.orderId;
  if (!orderId) {
    return NextResponse.json({ ok: false, message: 'Missing orderId' }, { status: 400 });
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });
    }

    const raw = snap.data() || {};

    // Normalize createdAt to ISO if possible (keeps frontend handling consistent)
    const createdAtIso = tsToISO((raw as any).createdAt);
    const orderData = {
      ...raw,
      createdAt: createdAtIso ?? (raw.createdAt ?? null), // ISO string if convertible, else original value
    };

    return NextResponse.json({ ok: true, order: { id: snap.id, ...orderData } }, { status: 200 });
  } catch (err: any) {
    console.error('Error fetching order details:', err);
    return NextResponse.json(
      { ok: false, message: `Error fetching order details: ${err?.message ?? 'unknown'}` },
      { status: 500 }
    );
  }
}
