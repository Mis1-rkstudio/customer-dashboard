// app/api/sync-orders/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin'; // your firebase-admin init
import { Timestamp } from 'firebase-admin/firestore';
import { BigQuery } from '@google-cloud/bigquery';

/**
 * === FIXED CONFIG - edit these to your actual names ===
 */
const FIRESTORE_COLLECTION = 'orders'; // <-- set your Firestore collection (e.g. 'orders')
const BQ_PROJECT_ID = 'my-bq-project'; // <-- BigQuery project id
const BQ_DATASET_ID = 'frono_2025'; // <-- BigQuery dataset id
const BQ_TABLE_ID = 'orders'; // <-- BigQuery table id

const DEFAULT_BATCH_SIZE = Number(process.env.BQ_BATCH_SIZE || 500);
const DEFAULT_LIMIT = Number(process.env.SYNC_LIMIT || 1000);

/** Helper: detect Firestore Timestamp-like objects */
function hasToDate(v: unknown): v is { toDate: () => Date } {
  return typeof v === 'object' && v !== null && typeof (v as { toDate?: unknown }).toDate === 'function';
}

/** Recursively serialize Firestore values into plain JS suitable for BigQuery JSON rows */
function serializeFirestoreValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;

  // Firestore Timestamp -> ISO
  if (hasToDate(value)) {
    try {
      const d = value.toDate();
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return String(value);
    }
  }

  // array
  if (Array.isArray(value)) {
    return value.map((v) => serializeFirestoreValue(v));
  }

  // plain object (Map)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    const rec = value as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      out[k] = serializeFirestoreValue(rec[k]);
    }
    return out;
  }

  // primitive
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  // fallback
  return String(value);
}

/** Convert Firestore DocumentSnapshot.data() into row JSON for BigQuery (adds metadata) */
function docToRow(doc: FirebaseFirestore.DocumentSnapshot): { insertId: string; json: Record<string, unknown> } {
  const raw = doc.data() ?? {};
  const json: Record<string, unknown> = {};

  // Serialize each field
  const rec = raw as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    json[k] = serializeFirestoreValue(rec[k]);
  }

  // Keep doc id & path/metadata
  json._id = doc.id;
  json._firestorePath = doc.ref.path;
  json._synced_at = new Date().toISOString();

  return { insertId: String(doc.id), json };
}

/** chunk array helper */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Insert rows into BigQuery using @google-cloud/bigquery client */
async function insertRowsToBigQuery(
  bigquery: BigQuery,
  projectId: string,
  datasetId: string,
  tableId: string,
  rows: Array<{ insertId: string; json: Record<string, unknown> }>,
  batchSize = DEFAULT_BATCH_SIZE
): Promise<{
  totalFetched: number;
  totalInserted: number;
  totalErrors: number;
  batchSummaries: Array<{ batchIndex: number; requested: number; successful: number; errors: unknown[] }>;
}> {
  const batches = chunk(rows, batchSize);
  const summary = {
    totalFetched: rows.length,
    totalInserted: 0,
    totalErrors: 0,
    batchSummaries: [] as Array<{ batchIndex: number; requested: number; successful: number; errors: unknown[] }>,
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const dataset = bigquery.dataset(datasetId, { projectId });
      const table = dataset.table(tableId);
      // table.insert accepts array of rows shaped {insertId, json}
      await table.insert(batch.map((r) => ({ insertId: r.insertId, json: r.json })), {
        ignoreUnknownValues: true,
      });

      summary.batchSummaries.push({ batchIndex: i, requested: batch.length, successful: batch.length, errors: [] });
      summary.totalInserted += batch.length;
    } catch (err: unknown) {
      const rowErrors: unknown[] = [];
      if (typeof err === 'object' && err !== null) {
        const eRec = err as Record<string, unknown>;
        if (Array.isArray(eRec.insertErrors)) {
          rowErrors.push(...(eRec.insertErrors as unknown[]));
        } else if (Array.isArray(eRec.errors)) {
          rowErrors.push(...(eRec.errors as unknown[]));
        } else {
          rowErrors.push({ message: String(eRec.message ?? JSON.stringify(eRec)) });
        }
      } else {
        rowErrors.push({ message: String(err) });
      }

      summary.batchSummaries.push({ batchIndex: i, requested: batch.length, successful: 0, errors: rowErrors });
      summary.totalErrors += rowErrors.length || 1;
      // continue with remaining batches
    }
  }

  return summary;
}

/**
 * POST /api/sync-orders
 * This route ALWAYS reads from the configured FIRESTORE_COLLECTION and writes to the configured BQ table.
 * Optional query/body params:
 *  - limit (number) default DEFAULT_LIMIT
 *  - since (ISO date string) optional: only fetch createdAt >= since
 *  - batchSize (number) optional override for BigQuery batch size
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    // read optional controls
    const url = new URL(req.url);
    const q = Object.fromEntries(url.searchParams.entries());
    const parsedBody = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;

    const limit = Number(parsedBody.limit ?? q.limit ?? DEFAULT_LIMIT);
    const since = String(parsedBody.since ?? q.since ?? '').trim() || null;
    const batchSize = Number(parsedBody.batchSize ?? q.batchSize ?? DEFAULT_BATCH_SIZE);

    // Validate fixed BQ config presence (fail fast if user forgot to edit constants)
    if (!BQ_PROJECT_ID || !BQ_DATASET_ID || !BQ_TABLE_ID) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'Server misconfigured: set BQ_PROJECT_ID, BQ_DATASET_ID and BQ_TABLE_ID constants in the file.',
        },
        { status: 500 }
      );
    }

    // Build Firestore query (fixed collection)
    let colRef: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection(FIRESTORE_COLLECTION)
      .orderBy('createdAt', 'asc')
      .limit(limit);

    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json({ ok: false, message: 'Invalid "since" ISO date' }, { status: 400 });
      }
      colRef = db
        .collection(FIRESTORE_COLLECTION)
        .where('createdAt', '>=', Timestamp.fromDate(sinceDate))
        .orderBy('createdAt', 'asc')
        .limit(limit);
    }

    // fetch docs
    const snap = await colRef.get();
    const docs = snap.docs;
    if (!docs || docs.length === 0) {
      return NextResponse.json({ ok: true, message: 'No documents to sync', fetched: 0 });
    }

    // prepare rows
    const rows = docs.map((d) => docToRow(d));
    // init BigQuery client (will use ADC credentials in your runtime)
    const bigquery = new BigQuery({ projectId: BQ_PROJECT_ID });

    // insert
    const insertSummary = await insertRowsToBigQuery(bigquery, BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID, rows, batchSize);

    return NextResponse.json({ ok: true, fetched: docs.length, insertSummary });
  } catch (err: unknown) {
    console.error('Sync error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Internal Server Error: ${message}` }, { status: 500 });
  }
}

/** Optional GET health endpoint */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, message: 'sync-orders (fixed collection/table) endpoint. POST to trigger sync.' });
}
