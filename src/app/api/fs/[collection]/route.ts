// app/api/fs/[collection]/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

type ColName = 'customers' | 'agents' | 'items';
const ALLOWED: ReadonlySet<ColName> = new Set(['customers', 'agents', 'items']);

function assertCollection(col: string | null): asserts col is ColName {
  if (!col || !ALLOWED.has(col as ColName)) {
    throw new Error('Invalid collection');
  }
}

/**
 * RouteContext<T> models the fact that Next's context.params might be a plain object or a Promise.
 * Awaiting `context.params` is safe in both cases and returns T.
 */
type RouteContext<T> = { params: T } | { params: Promise<T> };

/* GET handler */
export async function GET(
  _req: NextRequest,
  context: RouteContext<{ collection: string }>
): Promise<NextResponse> {
  try {
    // await works for both a Promise and a plain object
    const paramsResolved = (await context.params) as { collection: string } | undefined;
    const col = paramsResolved?.collection ?? null;
    assertCollection(col);

    const snap = await db.collection(col).orderBy('createdAt', 'desc').get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* POST handler */
export async function POST(
  req: NextRequest,
  context: RouteContext<{ collection: string }>
): Promise<NextResponse> {
  try {
    const paramsResolved = (await context.params) as { collection: string } | undefined;
    const col = paramsResolved?.collection ?? null;
    assertCollection(col);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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
            Colors: Array.isArray(body.Colors) ? (body.Colors as unknown[]).map(String) : [],
            ...base,
          };

    // Narrow and check required fields without assuming union properties exist
    if (col !== 'items') {
      const dCust = data as { Company_Name?: unknown };
      const companyNameStr = String(dCust.Company_Name ?? '').trim();
      if (!companyNameStr) {
        return NextResponse.json({ error: 'Company_Name is required' }, { status: 400 });
      }
    } else {
      const dItem = data as { Item?: unknown };
      const itemStr = String(dItem.Item ?? '').trim();
      if (!itemStr) {
        return NextResponse.json({ error: 'Item is required' }, { status: 400 });
      }
    }

    const ref = await db.collection(col).add(data);
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
