// app/api/orders/route.ts
import { NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';

type RawRecord = Record<string, unknown>;
type NormalizedItemRow = { sku: string; itemName: string; color: string; quantity: number };
type GroupedColor = { color: string; sets: number };
type GroupedItem = { itemName: string; colors: GroupedColor[] };

// add this helper type so we don't use `any` when calling bigquery.query
type BQQueryOptions = Parameters<BigQuery['query']>[0];

/** ========== CONFIG ========== */
const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || 'round-kit-450201-r9';
const BQ_DATASET_ID = process.env.BQ_DATASET_ID || 'frono_2025';
const BQ_TABLE_ID = process.env.BQ_TABLE_ID || 'orders';
const DEFAULT_LIMIT = 500;

const bigquery = new BigQuery({ projectId: BQ_PROJECT_ID });

/** ========== small helpers ========== */
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

/** Normalize incoming item rows (handles many shapes) */
function normalizeItems(itemsInput: unknown): NormalizedItemRow[] {
  if (!Array.isArray(itemsInput)) return [];
  return (itemsInput as unknown[]).map((raw): NormalizedItemRow => {
    if (!isObject(raw)) return { sku: '', itemName: '', color: '', quantity: 0 };

    const sku =
      safeString(raw['sku']) ||
      safeString(isObject(raw['item']) ? ((raw['item'] as RawRecord)['value'] ?? (raw['item'] as RawRecord)['id']) : '') ||
      safeString(raw['itemId']) ||
      '';

    const itemNameCandidate =
      (isObject(raw['item']) && safeString((raw['item'] as RawRecord)['label'])) ??
      (isObject(raw['item']) && safeString((raw['item'] as RawRecord)['Item'])) ??
      safeString(raw['itemName']) ??
      safeString(raw['label']) ??
      safeString(raw['skuLabel']) ??
      sku;

    const color =
      safeString(raw['color']) ||
      (isObject(raw['color']) ? safeString((raw['color'] as RawRecord)['value']) : '') ||
      '';

    const qtyRaw = raw['qty'] ?? raw['quantity'] ?? raw['sets'] ?? raw['set'] ?? null;
    const quantity = safeNumber(qtyRaw);

    return { sku: String(sku), itemName: String(itemNameCandidate || sku), color, quantity };
  });
}

/** group by itemName and color -> GroupedItem[] (colors as objects with sets) */
function groupItemsToColors(rows: NormalizedItemRow[]): GroupedItem[] {
  const map = new Map<string, GroupedItem>();
  for (const r of rows) {
    const name = r.itemName || r.sku || 'unknown';
    let entry = map.get(name);
    if (!entry) {
      entry = { itemName: name, colors: [] };
      map.set(name, entry);
    }
    const colorName = safeString(r.color) || '';
    const qty = Number(r.quantity) || 0;
    const colorEntry = entry.colors.find((c) => c.color === colorName);
    if (colorEntry) colorEntry.sets += qty;
    else entry.colors.push({ color: colorName, sets: qty });
  }
  return Array.from(map.values());
}

/** convert grouped form into desired payload shape */
function groupedItemsToPayloadShape(grouped: GroupedItem[]) {
  return grouped.map((g) => {
    const colors = Array.from(new Set(g.colors.map((c) => (c.color || '').trim()).filter(Boolean)));
    const setsVals = g.colors.map((c) => Number(c.sets) || 0);
    const uniqueSets = Array.from(new Set(setsVals));
    let sets: number;
    if (uniqueSets.length === 1) {
      sets = uniqueSets[0];
    } else {
      sets = setsVals.reduce((s, v) => s + v, 0);
    }
    return {
      itemName: g.itemName,
      colors,
      sets,
    };
  });
}

/** create dataset if it doesn't exist */
async function ensureDatasetExists(projectId: string, datasetId: string) {
  const [exists] = await bigquery.dataset(datasetId).exists();
  if (!exists) {
    await bigquery.createDataset(datasetId);
  }
}

/** create table if it doesn't exist */
async function ensureTableExists(projectId: string, datasetId: string, tableId: string) {
  const dataset = bigquery.dataset(datasetId);
  const [tableExists] = await dataset.table(tableId).exists();
  if (tableExists) return;

  const schema = {
    fields: [
      { name: 'id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'createdAt', type: 'TIMESTAMP' },
      { name: 'customerName', type: 'STRING' },
      { name: 'customerNumber', type: 'STRING' },
      { name: 'customerEmail', type: 'STRING' },
      { name: 'agentName', type: 'STRING' },
      { name: 'agentNumber', type: 'STRING' },
      { name: 'orderStatus', type: 'STRING' },
      { name: 'totalQty', type: 'INTEGER' },
      { name: 'items', type: 'STRING' },
      { name: 'payload', type: 'STRING' },
      { name: 'cancelledAt', type: 'TIMESTAMP' },
      { name: 'cancelledBy', type: 'STRING' },
    ],
  };

  await dataset.createTable(tableId, { schema });
}

/** helper to extract useful error details from unknown thrown values */
function extractErrorDetail(err: unknown) {
  if (err instanceof Error) {
    return { message: err.message, errors: undefined, reason: undefined, info: err };
  }
  if (isObject(err)) {
    // pick likely fields if present
    const message = typeof err['message'] === 'string' ? err['message'] : String(err);
    const errors = err['errors'] ?? undefined;
    const reason = err['reason'] ?? undefined;
    return { message, errors, reason, info: err };
  }
  return { message: String(err), errors: undefined, reason: undefined, info: err };
}

/** helper to insert into BigQuery table (catches/throws detailed errors) */
async function insertRowToBigQuery(
  projectId: string,
  datasetId: string,
  tableId: string,
  row: Record<string, unknown>
) {
  const dataset = bigquery.dataset(datasetId, { projectId });
  const table = dataset.table(tableId);
  try {
    await table.insert([row], { ignoreUnknownValues: false });
    return { ok: true };
  } catch (err: unknown) {
    const detail = extractErrorDetail(err);
    const out = new Error('BigQuery insert failed: ' + (detail.message || 'unknown'));
    // attach details in a typed-safe way
    (out as unknown as Record<string, unknown>)['bigQueryDetails'] = detail;
    throw out;
  }
}

/** Local typing for query options we pass to bigquery.createQueryJob */
type QueryOptionsLocal = { query: string; params?: Record<string, unknown>; location?: string };

/** Query helper (returns rows from a SQL query) */
async function runQuery(sql: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const options: QueryOptionsLocal = { query: sql, location: 'US' };
  if (params) options.params = params;
  const [job] = await bigquery.createQueryJob(options);
  const [rows] = await job.getQueryResults();
  return rows as unknown[];
}

/** =========================
 *  GET: read orders from BigQuery
 *  ========================= */
export async function GET(): Promise<NextResponse> {
  try {
    if (!BQ_PROJECT_ID || !BQ_DATASET_ID || !BQ_TABLE_ID) {
      return NextResponse.json({ ok: false, message: 'BQ config missing' }, { status: 500 });
    }
    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const fullTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;
    const sql = `SELECT id, createdAt, customerName, customerNumber, customerEmail, agentName, agentNumber, orderStatus, totalQty, items, payload
                 FROM ${fullTable}
                 ORDER BY createdAt DESC
                 LIMIT ${Number(DEFAULT_LIMIT)}`;

    const rows = await runQuery(sql);

    const out = (rows as unknown[]).map((rUn) => {
      const r = isObject(rUn) ? (rUn as Record<string, unknown>) : {};
      const parsedItems = (() => {
        const itemsVal = r['items'];
        if (typeof itemsVal === 'string' && itemsVal) {
          try { return JSON.parse(itemsVal); } catch { return itemsVal; }
        }
        const payloadVal = r['payload'];
        if (typeof payloadVal === 'string') {
          try {
            const p = JSON.parse(payloadVal);
            return isObject(p) ? (p as Record<string, unknown>)['items'] ?? payloadVal : payloadVal;
          } catch { return payloadVal; }
        }
        return itemsVal;
      })();

      const normalizedPayload = (() => {
        const p = r['payload'];
        if (typeof p === 'string') {
          try { return JSON.parse(p); } catch { return p; }
        }
        return p;
      })();

      return {
        id: r['id'],
        createdAt: r['createdAt'],
        customerName: r['customerName'],
        customerNumber: r['customerNumber'],
        customerEmail: r['customerEmail'],
        agentName: r['agentName'],
        agentNumber: r['agentNumber'],
        orderStatus: r['orderStatus'],
        totalQty: typeof r['totalQty'] === 'number' ? r['totalQty'] : Number(r['totalQty'] ?? 0),
        items: parsedItems,
        payload: normalizedPayload,
        _rawRow: r,
      } as Record<string, unknown>;
    });

    return NextResponse.json(out);
  } catch (err: unknown) {
    console.error('GET /api/orders error:', err);
    const detail = extractErrorDetail(err);
    return NextResponse.json({ ok: false, message: detail.message }, { status: 500 });
  }
}

/** =========================
 *  POST: create order (insert into BigQuery)
 * ========================= */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (!BQ_PROJECT_ID || !BQ_DATASET_ID || !BQ_TABLE_ID) {
      return NextResponse.json({ ok: false, message: 'BigQuery configuration missing' }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!isObject(body)) {
      return NextResponse.json({ ok: false, message: 'Bad Request: invalid JSON body' }, { status: 400 });
    }

    const customerPayload = body['customer'];
    const agentPayload = body['agent'];
    const itemsInput = body['items'];
    const rawOrderStatus = body['orderStatus'] ?? body['order_status'] ?? body['status'];

    if (!customerPayload) return NextResponse.json({ ok: false, message: 'Missing customer' }, { status: 400 });
    if (!itemsInput || !Array.isArray(itemsInput) || (itemsInput as unknown[]).length === 0) {
      return NextResponse.json({ ok: false, message: 'Missing items' }, { status: 400 });
    }

    const normalized = normalizeItems(itemsInput);
    const invalidItem = normalized.find((it) => (!it.sku && !it.itemName));
    if (invalidItem) {
      return NextResponse.json({ ok: false, message: 'One or more items missing sku/name' }, { status: 400 });
    }

    const groupedItems = groupItemsToColors(normalized);
    const itemsForPayload = groupedItemsToPayloadShape(groupedItems);

    let orderStatus = 'Unconfirmed';
    if (rawOrderStatus !== undefined && rawOrderStatus !== null) {
      const s = String(rawOrderStatus).trim();
      if (s) orderStatus = s;
    }

    const totalQty = normalized.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

    const orderId = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
    const createdAt = new Date().toISOString();

    const canonicalOrder: Record<string, unknown> = {
      id: orderId,
      customer: customerPayload,
      agent: agentPayload ?? null,
      items: itemsForPayload,
      totalQty,
      orderStatus,
      createdAt,
      source: 'web',
    };

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const customerName = isObject(customerPayload)
      ? safeString((customerPayload as RawRecord).label ?? (customerPayload as RawRecord).name ?? '')
      : safeString(customerPayload);
    const customerNumber = isObject(customerPayload)
      ? safeString((customerPayload as RawRecord).phone ?? (customerPayload as RawRecord).Number ?? (customerPayload as RawRecord).phoneNumber ?? '')
      : '';
    const customerEmail = isObject(customerPayload)
      ? safeString((customerPayload as RawRecord).email ?? (customerPayload as RawRecord).Email ?? '')
      : '';

    const agentName = isObject(agentPayload)
      ? safeString((agentPayload as RawRecord).label ?? (agentPayload as RawRecord).name ?? '')
      : safeString(agentPayload);
    const agentNumber = isObject(agentPayload)
      ? safeString((agentPayload as RawRecord).number ?? (agentPayload as RawRecord).phone ?? (agentPayload as RawRecord).Contact_Number ?? '')
      : '';

    const row: Record<string, unknown> = {
      id: orderId,
      createdAt,
      customerName,
      customerNumber,
      customerEmail,
      agentName,
      agentNumber,
      orderStatus,
      totalQty: Number(totalQty) || 0,
      items: JSON.stringify(itemsForPayload),
      payload: JSON.stringify(canonicalOrder),
    };

    try {
      await insertRowToBigQuery(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID, row);
    } catch (insertErr: unknown) {
      console.error('BigQuery insert error (detailed):', insertErr);
      const detail = extractErrorDetail(insertErr);
      return NextResponse.json({
        ok: false,
        message: 'BigQuery insert failed',
        bigQueryError: detail,
        canonicalOrder,
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true, orderId, inserted: 1 }, { status: 201 });
  } catch (err: unknown) {
    console.error('POST /api/orders error:', err);
    const detail = extractErrorDetail(err);
    return NextResponse.json({ ok: false, message: detail.message }, { status: 500 });
  }
}

/** =========================
 *  PATCH: update orderStatus (BigQuery DML)
 *  ========================= */
export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!isObject(body)) return NextResponse.json({ ok: false, message: 'Bad Request: invalid JSON body' }, { status: 400 });

    const id = safeString(body['id']);
    const newStatus = safeString(body['orderStatus'] ?? body['status'] ?? '');

    if (!id || !newStatus) return NextResponse.json({ ok: false, message: 'Missing id or orderStatus' }, { status: 400 });

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const fullTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;
    const sql = `UPDATE ${fullTable} SET orderStatus = @status WHERE id = @id`;
    const options: QueryOptionsLocal = {
      query: sql,
      params: { id, status: newStatus },
      location: 'US',
    };

    // use strongly-typed cast instead of `any`
    await bigquery.query(options as BQQueryOptions);

    return NextResponse.json({ ok: true, id, orderStatus: newStatus }, { status: 200 });
  } catch (err: unknown) {
    console.error('PATCH /api/orders error:', err);
    const detail = extractErrorDetail(err);
    return NextResponse.json({ ok: false, message: detail.message }, { status: 500 });
  }
}

/** =========================
 *  DELETE: soft-delete — mark as Cancelled
 *  ========================= */
export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    const cancelledBy = url.searchParams.get('cancelledBy') ?? '';

    if (!id) return NextResponse.json({ ok: false, message: 'Missing id query parameter' }, { status: 400 });

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const fullTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;

    const sql = `UPDATE ${fullTable}
                 SET orderStatus = 'Cancelled',
                     cancelledAt = CURRENT_TIMESTAMP(),
                     cancelledBy = @cancelledBy
                 WHERE id = @id`;
    const options: QueryOptionsLocal = {
      query: sql,
      params: { id, cancelledBy },
      location: 'US',
    };

    // use strongly-typed cast instead of `any`
    await bigquery.query(options as BQQueryOptions);

    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (err: unknown) {
    console.error('DELETE /api/orders error:', err);
    const detail = extractErrorDetail(err);
    return NextResponse.json({ ok: false, message: detail.message }, { status: 500 });
  }
}

