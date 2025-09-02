// app/api/fs/[collection]/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin'; // your file
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

type ColName = 'customers' | 'agents' | 'items';
const ALLOWED: ReadonlySet<ColName> = new Set(['customers', 'agents', 'items']);

function assertCollection(col: string | null): asserts col is ColName {
  if (!col || !ALLOWED.has(col as ColName)) {
    throw new Error('Invalid collection');
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { collection: string } }
) {
  try {
    const col = params.collection ?? null;
    assertCollection(col);

    const snap = await db.collection(col).orderBy('createdAt', 'desc').get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { collection: string } }
) {
  try {
    const col = params.collection ?? null;
    assertCollection(col);

    const body = (await req.json()) as Record<string, unknown>;
    // Normalize minimal fields by collection (optional)
    const base = { createdAt: FieldValue.serverTimestamp() };

    const data =
      col === 'customers'
        ? {
            Company_Name: String(body.Company_Name ?? body.name ?? '').trim(),
            City: String(body.City ?? '').trim(),
            Email: String(body.Email ?? '').trim(),
            Number: String(body.Number ?? '').trim(),
            Broker: String(body.Broker ?? '').trim(),
            ...base,
          }
        : col === 'agents'
        ? {
            Company_Name: String(body.Company_Name ?? body.name ?? '').trim(),
            Number: String(body.Number ?? body.Contact_Number ?? '').trim(),
            ...base,
          }
        : {
            Item: String(body.Item ?? body.label ?? '').trim(),
            Colors: Array.isArray(body.Colors)
              ? (body.Colors as unknown[]).map(String)
              : [],
            ...base,
          };

    if (col !== 'items' && !data.Company_Name) {
      return NextResponse.json(
        { error: 'Company_Name is required' },
        { status: 400 }
      );
    }
    if (col === 'items' && !data.Item) {
      return NextResponse.json({ error: 'Item is required' }, { status: 400 });
    }

    const ref = await db.collection(col).add(data);
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
