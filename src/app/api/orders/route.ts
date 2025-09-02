// /api/orders/route.ts (or wherever your API orders handler is)
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

type RawRecord = Record<string, unknown>;

// normalized incoming item row returned by normalizeItems
type NormalizedItemRow = {
  sku: string;
  itemName: string;
  color: string;
  quantity: number;
};

type GroupedItem = { itemName: string; colors: { color: string; sets: number }[] };

/** simple runtime helpers */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Type-guard for Firestore Timestamp-like objects */
function hasToDate(v: unknown): v is { toDate: () => Date } {
  return isObject(v) && typeof (v as { toDate?: unknown }).toDate === 'function';
}

/** Ensure we have a customer in `customers` collection.
 * Accepts unknown payload shapes and returns an id + created flag.
 */
async function ensureCustomer(customerPayload: unknown): Promise<{ id: string; created: boolean }> {
  if (isObject(customerPayload) && customerPayload['id']) {
    return { id: String(customerPayload['id']), created: false };
  }

  const name = isObject(customerPayload)
    ? safeString(customerPayload['label'] ?? customerPayload['value'] ?? customerPayload['name'])
    : safeString(customerPayload);
  const email = isObject(customerPayload) ? safeString(customerPayload['email'] ?? customerPayload['Email']) : '';
  const phone = isObject(customerPayload)
    ? safeString(customerPayload['phone'] ?? customerPayload['Number'] ?? customerPayload['contact'])
    : '';
  const broker = isObject(customerPayload) ? safeString(customerPayload['Broker'] ?? customerPayload['broker']) : '';

  const docRef = await db.collection('customers').add({
    name,
    email,
    phone,
    broker,
    createdAt: Timestamp.now(),
  });

  return { id: docRef.id, created: true };
}

/** Ensure agent exists. Returns id + created flag (id may be null if no agent payload) */
async function ensureAgent(agentPayload: unknown): Promise<{ id: string | null; created: boolean }> {
  if (!agentPayload) return { id: null, created: false };

  if (isObject(agentPayload) && agentPayload['id']) {
    return { id: String(agentPayload['id']), created: false };
  }

  const name = isObject(agentPayload)
    ? safeString(agentPayload['label'] ?? agentPayload['value'] ?? agentPayload['name'])
    : safeString(agentPayload);
  const email = isObject(agentPayload) ? safeString(agentPayload['email'] ?? agentPayload['Email']) : '';
  const phone = isObject(agentPayload) ? safeString(agentPayload['phone'] ?? agentPayload['Contact_Number']) : '';
  const number = isObject(agentPayload) ? safeString(agentPayload['number'] ?? agentPayload['Number']) : '';

  const docRef = await db.collection('agents').add({
    name,
    email,
    phone,
    number,
    createdAt: Timestamp.now(),
  });

  return { id: docRef.id, created: true };
}

/** Normalize arbitrary incoming item shapes into a predictable array of rows */
function normalizeItems(itemsInput: unknown): NormalizedItemRow[] {
  if (!Array.isArray(itemsInput)) return [];

  return (itemsInput as unknown[]).map((raw): NormalizedItemRow => {
    if (!isObject(raw)) {
      return { sku: '', itemName: '', color: '', quantity: 0 };
    }

    const sku =
      safeString(raw['sku']) ||
      safeString(isObject(raw['item']) ? (raw['item']['value'] ?? raw['item']['id']) : '') ||
      safeString(raw['itemId']) ||
      '';

    const itemNameCandidate =
      (isObject(raw['item']) && safeString((raw['item'] as RawRecord)['label'])) ??
      (isObject(raw['item']) && safeString((raw['item'] as RawRecord)['Item'])) ??
      safeString(raw['itemName']) ??
      safeString(raw['label']) ??
      safeString(raw['skuLabel']) ??
      sku;

    const itemName = itemNameCandidate || sku || '';

    const color =
      safeString(raw['color']) ||
      (isObject(raw['color']) ? safeString((raw['color'] as RawRecord)['value']) : '') ||
      '';

    const qtyRaw = raw['qty'] ?? raw['quantity'] ?? raw['quantityFromClient'] ?? raw['sets'] ?? raw['set'] ?? null;
    const quantity = safeNumber(qtyRaw);

    return {
      sku: String(sku),
      itemName: String(itemName),
      color,
      quantity,
    };
  });
}

/** group flat rows into grouped items by itemName and color */
function groupItemsToColors(rows: NormalizedItemRow[]): GroupedItem[] {
  const grouped: GroupedItem[] = [];

  for (const r of rows) {
    const name = r.itemName || r.sku || 'unknown';
    let entry = grouped.find((g) => g.itemName === name);
    if (!entry) {
      entry = { itemName: name, colors: [] };
      grouped.push(entry);
    }

    const colorName = safeString(r.color);
    const qty = Number(r.quantity) || 0;
    const colorEntry = entry.colors.find((c) => c.color === colorName);
    if (colorEntry) {
      colorEntry.sets += qty;
    } else {
      entry.colors.push({ color: colorName, sets: qty });
    }
  }

  return grouped;
}

/** GET /api/orders - list orders */
export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').limit(500).get();
    const orders: unknown[] = [];

    snapshot.forEach((doc) => {
      const dataRaw = (doc.data() ?? {}) as RawRecord;

      let createdAtIso: string | null = null;
      const createdAtVal = dataRaw['createdAt'];
      if (createdAtVal) {
        try {
          if (hasToDate(createdAtVal)) {
            const d = createdAtVal.toDate();
            if (!Number.isNaN(d.getTime())) createdAtIso = d.toISOString();
          } else {
            const d = new Date(String(createdAtVal));
            if (!Number.isNaN(d.getTime())) createdAtIso = d.toISOString();
          }
        } catch {
          createdAtIso = null;
        }
      }

      const items = Array.isArray(dataRaw['items']) ? (dataRaw['items'] as unknown[]) : [];

      let totalQty = 0;
      for (const it of items) {
        if (isObject(it) && Array.isArray(it['colors'])) {
          for (const c of it['colors'] as unknown[]) {
            if (isObject(c)) totalQty += safeNumber(c['sets']);
          }
        } else if (isObject(it)) {
          totalQty += safeNumber(it['quantity'] ?? it['qty'] ?? it['sets']);
        }
      }

      orders.push({
        id: doc.id,
        customerName: safeString(dataRaw['customerName'] ?? dataRaw['customer'] ?? ''),
        customerEmail: safeString(
          dataRaw['customerEmail'] ??
          (isObject(dataRaw['customer']) ? (dataRaw['customer'] as RawRecord)['email'] : undefined)
        ),
        customerPhone: safeString(
          dataRaw['customerPhone'] ??
          (isObject(dataRaw['customer']) ? (dataRaw['customer'] as RawRecord)['phone'] : undefined)
        ),
        agentName: safeString(dataRaw['agentName'] ?? dataRaw['agent'] ?? ''),
        agentPhone: safeString(
          dataRaw['agentPhone'] ??
          (isObject(dataRaw['agent']) ? (dataRaw['agent'] as RawRecord)['phone'] : undefined)
        ),
        items,
        createdAt: createdAtIso,
        totalQty,
        source: safeString(dataRaw['source'] ?? null),
        orderStatus: safeString(dataRaw['orderStatus'] ?? dataRaw['status'] ?? dataRaw['Order_Status'] ?? ''),
      });
    });

    return NextResponse.json(orders);
  } catch (err: unknown) {
    console.error('Failed to read orders:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

/** POST /api/orders - create new order */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as unknown;

    if (!isObject(body)) {
      return NextResponse.json({ ok: false, message: 'Bad Request: invalid JSON body' }, { status: 400 });
    }

    const customerPayload = body['customer'];
    const agentPayload = body['agent'];
    const itemsInput = body['items'];
    const rawOrderStatus = body['orderStatus'] ?? body['order_status'] ?? body['status'] ?? body['OrderStatus'];

    if (!customerPayload) {
      return NextResponse.json({ ok: false, message: 'Bad Request: Missing customer' }, { status: 400 });
    }
    if (!itemsInput || !Array.isArray(itemsInput) || (itemsInput as unknown[]).length === 0) {
      return NextResponse.json({ ok: false, message: 'Bad Request: Missing items' }, { status: 400 });
    }

    const customerResult = await ensureCustomer(customerPayload);
    const agentResult = await ensureAgent(agentPayload);

    const normalized = normalizeItems(itemsInput);
    const invalidItem = normalized.find((it) => (!it.sku && !it.itemName));
    if (invalidItem) {
      return NextResponse.json({ ok: false, message: 'Bad Request: One or more items missing sku/name' }, { status: 400 });
    }

    const groupedItems = groupItemsToColors(normalized);

    // Accept whatever non-empty string client sends for status (trimmed).
    let orderStatus = 'Unconfirmed';
    if (rawOrderStatus !== undefined && rawOrderStatus !== null) {
      const s = String(rawOrderStatus).trim();
      if (s) orderStatus = s;
    }

    const orderDoc: RawRecord = {
      customerName: safeString(
        (isObject(customerPayload) && (customerPayload['label'] ?? customerPayload['name'])) ?? customerPayload
      ),
      customerEmail: isObject(customerPayload) ? safeString(customerPayload['email'] ?? customerPayload['Email']) : '',
      customerPhone: isObject(customerPayload) ? safeString(customerPayload['phone'] ?? customerPayload['Number'] ?? customerPayload['contact']) : '',
      agentName: agentPayload ? safeString((isObject(agentPayload) && (agentPayload['label'] ?? agentPayload['name'])) ?? agentPayload) : '',
      agentPhone: agentPayload ? safeString((isObject(agentPayload) && (agentPayload['phone'] ?? agentPayload['Contact_Number'] ?? agentPayload['number'])) ?? '') : '',
      items: groupedItems,
      createdAt: Timestamp.now(),
      source: 'web',
      orderStatus, // persist the string the client specified (or Unconfirmed)
    };

    const newOrderRef = await db.collection('orders').add(orderDoc);

    // update customer/agent metadata — non-fatal
    try {
      await db.collection('customers').doc(customerResult.id).set(
        {
          lastOrderAt: Timestamp.now(),
          lastOrderId: newOrderRef.id,
          phone: isObject(customerPayload) ? (customerPayload['phone'] ?? customerPayload['Number'] ?? null) : null,
          agentId: agentResult.id ?? null,
        },
        { merge: true }
      );
    } catch (metaErr) {
      console.warn('Failed to update customer metadata:', metaErr);
    }

    if (agentResult.id) {
      try {
        await db.collection('agents').doc(agentResult.id).set(
          {
            lastAssignedOrderAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (metaErr) {
        console.warn('Failed to update agent metadata:', metaErr);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        message: 'Order created successfully',
        orderId: newOrderRef.id,
        createdCustomerId: customerResult.created ? customerResult.id : undefined,
        createdAgentId: agentResult.created ? agentResult.id : undefined,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Error creating order:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, message: `Internal Server Error: ${msg}` }, { status: 500 });
  }
}

/** PATCH /api/orders?id=ORDER_ID - update order fields (we allow updating orderStatus) */
export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ ok: false, message: 'Missing id query parameter' }, { status: 400 });
    }

    // Read JSON once and handle parse errors
    let body: unknown;
    try {
      body = await req.json();
    } catch (parseErr) {
      return NextResponse.json({ ok: false, message: 'Bad Request: invalid JSON body' }, { status: 400 });
    }

    if (!isObject(body)) {
      return NextResponse.json({ ok: false, message: 'Bad Request: invalid JSON body' }, { status: 400 });
    }

    // Only allow updating specific safe fields for now:
    const updates: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, 'orderStatus')) {
      const rawStatus = (body as Record<string, unknown>)['orderStatus'];
      const s = safeString(rawStatus);
      updates.orderStatus = s || 'Unconfirmed';
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, message: 'No updatable fields provided' }, { status: 400 });
    }

    const docRef = db.collection('orders').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });
    }

    await docRef.set(updates, { merge: true });

    return NextResponse.json({ ok: true, id, updated: updates }, { status: 200 });
  } catch (err: unknown) {
    console.error('Failed to PATCH order:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Internal Server Error: ${msg}` }, { status: 500 });
  }
}


/** DELETE /api/orders?id=ORDER_ID - original delete route (keeps existing behavior if you still want it) */
export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ ok: false, message: 'Missing id query parameter' }, { status: 400 });
    }

    const docRef = db.collection('orders').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });
    }

    await docRef.delete();

    // best-effort cleanup (same as before)
    try {
      const data = snap.data() ?? {};
      const custId = (data.customer && data.customer.id) || null;
      const agentId = (data.agent && data.agent.id) || null;

      if (custId) {
        const custRef = db.collection('customers').doc(String(custId));
        await db.runTransaction(async (tx) => {
          const c = await tx.get(custRef);
          if (c.exists) {
            const cdata = c.data() ?? {};
            if (cdata.lastOrderId === id) {
              tx.update(custRef, { lastOrderId: null, lastOrderAt: null });
            }
          }
        });
      }
      if (agentId) {
        const agentRef = db.collection('agents').doc(String(agentId));
        await db.runTransaction(async (tx) => {
          const a = await tx.get(agentRef);
          if (a.exists) {
            const adata = a.data() ?? {};
            if (adata.lastAssignedOrderId === id) {
              tx.update(agentRef, { lastAssignedOrderId: null, lastAssignedOrderAt: null });
            }
          }
        });
      }
    } catch (cleanupErr) {
      console.warn('Non-fatal cleanup error while deleting order:', cleanupErr);
    }

    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (err: unknown) {
    console.error('Failed to delete order:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Internal Server Error: ${msg}` }, { status: 500 });
  }
}
