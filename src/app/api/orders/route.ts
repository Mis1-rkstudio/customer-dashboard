// api/orders/route.ts
import { NextResponse } from 'next/server';
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

type IncomingItem =
  | { sku?: string; color?: string; qty?: number }
  | { item?: any; color?: any; quantity?: number };

// -------------------- helper functions (unchanged) --------------------
async function ensureCustomer(customerPayload: any) {
  if (customerPayload?.id) {
    return { id: String(customerPayload.id), created: false };
  }

  const name = customerPayload?.label ?? customerPayload?.value ?? customerPayload?.name ?? '';
  const email = customerPayload?.email ?? customerPayload?.Email ?? '';
  const phone = customerPayload?.phone ?? customerPayload?.Number ?? customerPayload?.contact ?? '';
  const broker = customerPayload?.Broker ?? customerPayload?.broker ?? '';

  const docRef = await db.collection('customers').add({
    name,
    email,
    phone,
    broker,
    createdAt: Timestamp.now(),
  });

  return { id: docRef.id, created: true };
}

async function ensureAgent(agentPayload: any) {
  if (!agentPayload) return { id: null, created: false };

  if (agentPayload?.id) {
    return { id: String(agentPayload.id), created: false };
  }

  const name = agentPayload?.label ?? agentPayload?.value ?? agentPayload?.name ?? '';
  const email = agentPayload?.email ?? agentPayload?.Email ?? '';
  const phone = agentPayload?.phone ?? agentPayload?.Contact_Number ?? '';
  const number = agentPayload?.number ?? agentPayload?.Number ?? '';

  const docRef = await db.collection('agents').add({
    name,
    email,
    phone,
    number,
    createdAt: Timestamp.now(),
  });

  return { id: docRef.id, created: true };
}

function normalizeItems(itemsInput: IncomingItem[]) {
  return (itemsInput || []).map((it: any) => {
    const sku = it.sku ?? it.item?.value ?? it.itemId ?? it.item?.id ?? '';
    const itemName =
      it.item?.label ?? it.item?.Item ?? it.itemName ?? it.label ?? it.skuLabel ?? sku;
    const color = (it.color?.value ?? it.color ?? '').toString();
    const qty = it.qty ?? it.quantity ?? it.quantityFromClient ?? null;
    return {
      sku: String(sku),
      itemName: itemName ? String(itemName) : '',
      color,
      quantity: Number(qty),
    };
  });
}

function groupItemsToColors(rows: { itemName: string; color: string; quantity: number }[]) {
  const grouped: { itemName: string; colors: { color: string; sets: number }[] }[] = [];

  for (const r of rows) {
    const name = r.itemName || r.sku || 'unknown';
    let entry = grouped.find((g) => g.itemName === name);
    if (!entry) {
      entry = { itemName: name, colors: [] };
      grouped.push(entry);
    }

    const colorName = (r.color ?? '').toString();
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

// -------------------- GET handler (list orders) --------------------
export async function GET() {
  try {
    const { userId } = await auth()
    const user = await currentUser()

    const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').limit(500).get();
    const orders: any[] = [];

    snapshot.forEach((doc) => {
      const data: any = doc.data();

      let createdAtIso: string | null = null;
      if (data?.createdAt) {
        try {
          if (typeof data.createdAt.toDate === 'function') {
            createdAtIso = data.createdAt.toDate().toISOString();
          } else {
            createdAtIso = new Date(data.createdAt).toISOString();
          }
        } catch {
          createdAtIso = null;
        }
      }

      const items = Array.isArray(data.items) ? data.items : [];

      let totalQty = 0;
      for (const it of items) {
        if (Array.isArray(it.colors)) {
          for (const c of it.colors) {
            totalQty += Number(c.sets ?? 0);
          }
        }
      }

      orders.push({
        // userData: user,
        id: doc.id,
        customerName: data.customerName ?? '',
        customerEmail: data.customerEmail ?? '',
        customerPhone: data.customerPhone ?? '',
        agentName: data.agentName ?? '',
        agentPhone: data.agentPhone ?? '',
        items,
        createdAt: createdAtIso,
        totalQty,
        source: data.source ?? null,
      });
    });

    // keep existing behavior (return array) — if other callers expect array, keep this
    return NextResponse.json(orders);
  } catch (err: any) {
    console.error('Failed to read orders:', err);
    // return JSON error body (not plain text)
    return NextResponse.json({ ok: false, message: err?.message ?? 'Failed to read orders' }, { status: 500 });
  }
}

// -------------------- POST handler (consistent JSON responses) --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const customerPayload = body.customer;
    const agentPayload = body.agent;
    const itemsInput = body.items;

    // Basic validation -> return JSON errors
    if (!customerPayload) {
      return NextResponse.json({ ok: false, message: 'Bad Request: Missing customer' }, { status: 400 });
    }
    if (!itemsInput || !Array.isArray(itemsInput) || itemsInput.length === 0) {
      return NextResponse.json({ ok: false, message: 'Bad Request: Missing items' }, { status: 400 });
    }

    const customerResult = await ensureCustomer(customerPayload);
    const agentResult = await ensureAgent(agentPayload);

    const normalized = normalizeItems(itemsInput);
    const invalidItem = normalized.find((it) => !it.sku && !it.itemName);
    if (invalidItem) {
      return NextResponse.json({ ok: false, message: 'Bad Request: One or more items missing sku/name' }, { status: 400 });
    }

    const groupedItems = groupItemsToColors(normalized);

    const orderDoc: any = {
      customerName: customerPayload?.label ?? customerPayload?.value ?? customerPayload?.name ?? '',
      customerEmail: customerPayload?.email ?? customerPayload?.Email ?? '',
      customerPhone: customerPayload?.phone ?? customerPayload?.Number ?? customerPayload?.contact ?? '',
      agentName: agentPayload ? (agentPayload?.label ?? agentPayload?.value ?? agentPayload?.name ?? '') : '',
      agentPhone: agentPayload ? (agentPayload?.phone ?? agentPayload?.Contact_Number ?? agentPayload?.number ?? '') : '',
      items: groupedItems,
      createdAt: Timestamp.now(),
      source: 'web',
    };

    const newOrderRef = await db.collection('orders').add(orderDoc);

    // update customer/agent metadata — non-fatal
    try {
      await db.collection('customers').doc(customerResult.id).set(
        {
          lastOrderAt: Timestamp.now(),
          lastOrderId: newOrderRef.id,
          phone: customerPayload?.phone ?? customerPayload?.Number ?? null,
          agentId: agentResult.id ?? null,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to update customer metadata:', err);
    }

    if (agentResult.id) {
      try {
        await db.collection('agents').doc(agentResult.id).set(
          {
            lastAssignedOrderAt: Timestamp.now(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('Failed to update agent metadata:', err);
      }
    }

    // **Return a consistent success JSON with ok:true**
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
  } catch (error: any) {
    console.error('Error creating order:', error);
    return NextResponse.json({ ok: false, message: `Internal Server Error: ${error?.message ?? 'unknown'}` }, { status: 500 });
  }
}
