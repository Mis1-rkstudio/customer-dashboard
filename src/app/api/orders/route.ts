// app/api/orders/route.ts
import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";
import { getBQClient } from "@/server/bq-handler";

type RawRecord = Record<string, unknown>;
type NormalizedItemRow = {
  sku: string;
  itemName: string;
  color: string;
  quantity: number;
};
type GroupedColor = { color: string; sets: number };
type GroupedItem = { itemName: string; colors: GroupedColor[] };

// add this helper type so we don't use `any` when calling bigquery.query
type BQQueryOptions = Parameters<BigQuery["query"]>[0];

/** ========== CONFIG ========== */
const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || "round-kit-450201-r9";
const BQ_DATASET_ID = process.env.BQ_DATASET_ID || "frono_2025";
const BQ_TABLE_ID = process.env.BQ_TABLE_ID || "orders";
const DEFAULT_LIMIT = 500;
const BQ_STATUS_TABLE_ID = `${BQ_TABLE_ID}_status_updates`;
const BQ_RESERVATIONS_TABLE_ID = `${BQ_TABLE_ID}_reservations`;

// Use shared client with robust credential loading (env/file/ADC)
const bigquery = getBQClient();

/** ========== small helpers ========== */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function safeString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function safeNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function makeReservationId(prefix = "res_"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.toUpperCase();
}

/** Normalize incoming item rows (handles many shapes) */
function normalizeItems(itemsInput: unknown): NormalizedItemRow[] {
  if (!Array.isArray(itemsInput)) return [];
  return (itemsInput as unknown[]).map((raw): NormalizedItemRow => {
    if (!isObject(raw))
      return { sku: "", itemName: "", color: "", quantity: 0 };

    const sku =
      safeString(raw["sku"]) ||
      safeString(
        isObject(raw["item"])
          ? (raw["item"] as RawRecord)["value"] ??
              (raw["item"] as RawRecord)["id"]
          : ""
      ) ||
      safeString(raw["itemId"]) ||
      "";

    const itemNameCandidate =
      (isObject(raw["item"]) &&
        safeString((raw["item"] as RawRecord)["label"])) ??
      (isObject(raw["item"]) &&
        safeString((raw["item"] as RawRecord)["Item"])) ??
      safeString(raw["itemName"]) ??
      safeString(raw["label"]) ??
      safeString(raw["skuLabel"]) ??
      sku;

    const color =
      safeString(raw["color"]) ||
      (isObject(raw["color"])
        ? safeString((raw["color"] as RawRecord)["value"])
        : "") ||
      "";

    const qtyRaw =
      raw["qty"] ?? raw["quantity"] ?? raw["sets"] ?? raw["set"] ?? null;
    const quantity = safeNumber(qtyRaw);

    return {
      sku: String(sku),
      itemName: String(itemNameCandidate || sku),
      color,
      quantity,
    };
  });
}

/** group by itemName and color -> GroupedItem[] (colors as objects with sets) */
function groupItemsToColors(rows: NormalizedItemRow[]): GroupedItem[] {
  const map = new Map<string, GroupedItem>();
  for (const r of rows) {
    const name = r.itemName || r.sku || "unknown";
    let entry = map.get(name);
    if (!entry) {
      entry = { itemName: name, colors: [] };
      map.set(name, entry);
    }
    const colorName = safeString(r.color) || "";
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
    const colors = Array.from(
      new Set(g.colors.map((c) => (c.color || "").trim()).filter(Boolean))
    );
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

/** ensure the status updates table exists */
async function ensureStatusTableExists(
  projectId: string,
  datasetId: string,
  statusTableId: string
) {
  const dataset = bigquery.dataset(datasetId);
  const [exists] = await dataset.table(statusTableId).exists();
  if (exists) return;

  const schema = {
    fields: [
      { name: "orderId", type: "STRING", mode: "REQUIRED" },
      { name: "status", type: "STRING" },
      { name: "changedBy", type: "STRING" },
      { name: "changedAt", type: "TIMESTAMP" },
      { name: "reason", type: "STRING" },
      { name: "meta", type: "STRING" }, // optional extra JSON/meta
    ],
  };

  await dataset.createTable(statusTableId, { schema });
}

/** insert a status update row (avoids UPDATE/streaming-buffer issues) */
async function insertStatusUpdate(
  projectId: string,
  datasetId: string,
  statusTableId: string,
  row: Record<string, unknown>
) {
  return insertRowToBigQuery(projectId, datasetId, statusTableId, row);
}

/** create dataset if it doesn't exist */
async function ensureDatasetExists(projectId: string, datasetId: string) {
  const [exists] = await bigquery.dataset(datasetId).exists();
  if (!exists) {
    await bigquery.createDataset(datasetId);
  }
}

/** create table if it doesn't exist */
async function ensureTableExists(
  projectId: string,
  datasetId: string,
  tableId: string
) {
  const dataset = bigquery.dataset(datasetId);
  const [tableExists] = await dataset.table(tableId).exists();
  if (tableExists) return;

  const schema = {
    fields: [
      { name: "id", type: "STRING", mode: "REQUIRED" },
      { name: "createdAt", type: "TIMESTAMP" },
      { name: "customerName", type: "STRING" },
      { name: "customerNumber", type: "STRING" },
      { name: "customerEmail", type: "STRING" },
      { name: "agentName", type: "STRING" },
      { name: "agentNumber", type: "STRING" },
      { name: "orderStatus", type: "STRING" },
      { name: "totalQty", type: "INTEGER" },
      { name: "items", type: "STRING" },
      { name: "payload", type: "STRING" },
      { name: "cancelledAt", type: "TIMESTAMP" },
      { name: "cancelledBy", type: "STRING" },
    ],
  };

  await dataset.createTable(tableId, { schema });
}

/** ensure reservations table exists */
async function ensureReservationsTableExists(
  projectId: string,
  datasetId: string,
  reservationsTableId: string
) {
  const dataset = bigquery.dataset(datasetId);
  const [exists] = await dataset.table(reservationsTableId).exists();
  if (exists) return;

  const schema = {
    fields: [
      { name: "reservationId", type: "STRING", mode: "REQUIRED" },
      { name: "orderId", type: "STRING", mode: "REQUIRED" },
      { name: "sku", type: "STRING" },
      { name: "itemName", type: "STRING" },
      { name: "color", type: "STRING" },
      { name: "reservedQty", type: "INTEGER" },
      { name: "status", type: "STRING" }, // e.g. "reserved", "released"
      { name: "createdAt", type: "TIMESTAMP" },
      { name: "meta", type: "STRING" }, // optional JSON/meta
    ],
  };

  await dataset.createTable(reservationsTableId, { schema });
}

/** best-effort delete reservations by orderId (used for cleanup if order insert fails) */
async function deleteReservationsByOrderId(
  projectId: string,
  datasetId: string,
  reservationsTableId: string,
  orderId: string
) {
  const fullTable = `\`${projectId}.${datasetId}.${reservationsTableId}\``;
  const sql = `DELETE FROM ${fullTable} WHERE orderId = @orderId`;
  const opts: QueryOptionsLocal = {
    query: sql,
    params: { orderId },
    types: { orderId: "STRING" },
    location: "US",
  };
  try {
    await bigquery.query(opts as BQQueryOptions);
    return { ok: true };
  } catch (err: unknown) {
    const detail = extractErrorDetail(err);
    console.warn("Failed to cleanup reservations for order", orderId, detail);
    return { ok: false, error: detail };
  }
}

/** best-effort release reservations (mark status = 'released') */
async function releaseReservationsByOrderId(
  projectId: string,
  datasetId: string,
  reservationsTableId: string,
  orderId: string
) {
  const fullTable = `\`${projectId}.${datasetId}.${reservationsTableId}\``;
  const sql = `UPDATE ${fullTable} SET status = 'released' WHERE orderId = @orderId AND status = 'reserved'`;
  const opts: QueryOptionsLocal = {
    query: sql,
    params: { orderId },
    types: { orderId: "STRING" },
    location: "US",
  };
  try {
    await bigquery.query(opts as BQQueryOptions);
    return { ok: true };
  } catch (err: unknown) {
    const detail = extractErrorDetail(err);
    console.warn("Failed to release reservations for order", orderId, detail);
    return { ok: false, error: detail };
  }
}

/** helper to extract useful error details from unknown thrown values */
function extractErrorDetail(err: unknown) {
  if (err instanceof Error) {
    return {
      message: err.message,
      errors: undefined,
      reason: undefined,
      info: err,
    };
  }
  if (isObject(err)) {
    // pick likely fields if present
    const message =
      typeof err["message"] === "string" ? err["message"] : String(err);
    const errors = err["errors"] ?? undefined;
    const reason = err["reason"] ?? undefined;
    return { message, errors, reason, info: err };
  }
  return {
    message: String(err),
    errors: undefined,
    reason: undefined,
    info: err,
  };
}

/** helper to insert into BigQuery table via DML (avoids streaming buffer) */
async function insertRowToBigQuery(
  projectId: string,
  datasetId: string,
  tableId: string,
  row: Record<string, unknown>
) {
  const fullTable = `\`${projectId}.${datasetId}.${tableId}\``;
  const cols = Object.keys(row);
  const params: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  const placeholders: string[] = [];

  for (const c of cols) {
    const paramName = c; // keep simple
    const value = row[c];

    // put value into params exactly (null allowed)
    params[paramName] = value;

    // infer a BigQuery parameter type for this param so nulls have explicit type
    if (value === null || value === undefined) {
      // default null/undefined -> STRING (safe fallback)
      types[paramName] = "STRING";
    } else if (typeof value === "number") {
      // integer vs float
      types[paramName] = Number.isInteger(value) ? "INT64" : "FLOAT64";
    } else if (typeof value === "boolean") {
      types[paramName] = "BOOL";
    } else if (typeof value === "string") {
      // if looks like an ISO datetime, you may want TIMESTAMP; we keep STRING by default
      types[paramName] = "STRING";
    } else if (value instanceof Date) {
      // JS Date -> TIMESTAMP
      params[paramName] = (value as Date).toISOString();
      types[paramName] = "TIMESTAMP";
    } else {
      // fallback to STRING for other objects (you are JSON.stringifying before calling in most cases)
      types[paramName] = "STRING";
    }

    placeholders.push(`@${paramName}`);
  }

  const sql = `INSERT INTO ${fullTable} (${cols
    .map((c) => `\`${c}\``)
    .join(", ")}) VALUES (${placeholders.join(", ")})`;
  const options: QueryOptionsLocal = {
    query: sql,
    params,
    types,
    location: "US",
  };

  try {
    await bigquery.query(options as BQQueryOptions);
    return { ok: true };
  } catch (err: unknown) {
    const detail = extractErrorDetail(err);
    const out = new Error(
      "BigQuery insert failed: " + (detail.message || "unknown")
    );
    (out as unknown as Record<string, unknown>)["bigQueryDetails"] = detail;
    throw out;
  }
}

/** Local typing for query options we pass to bigquery.createQueryJob */
type QueryOptionsLocal = {
  query: string;
  params?: Record<string, unknown>;
  // BigQuery expects a map of parameter name -> type (e.g. 'STRING','INT64','BOOL','FLOAT64','TIMESTAMP')
  types?: Record<string, string>;
  location?: string;
};

/** Query helper (returns rows from a SQL query) */
async function runQuery(
  sql: string,
  params?: Record<string, unknown>
): Promise<unknown[]> {
  const options: QueryOptionsLocal = { query: sql, location: "US" };
  if (params) options.params = params;
  const [job] = await bigquery.createQueryJob(options);
  const [rows] = await job.getQueryResults();
  return rows as unknown[];
}

/** =========================
 *  GET: read orders from BigQuery (includes latest status and full statusHistory)
 *  ========================= */
export async function GET(): Promise<NextResponse> {
  try {
    if (!BQ_PROJECT_ID || !BQ_DATASET_ID || !BQ_TABLE_ID) {
      return NextResponse.json(
        { ok: false, message: "BQ config missing" },
        { status: 500 }
      );
    }
    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);
    await ensureStatusTableExists(
      BQ_PROJECT_ID,
      BQ_DATASET_ID,
      BQ_STATUS_TABLE_ID
    );

    const ordersTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;
    const statusTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_STATUS_TABLE_ID}\``;

    const sql = `
      WITH latest_status AS (
        SELECT
          orderId,
          (ARRAY_AGG(STRUCT(status, changedBy, changedAt, reason, meta) ORDER BY TIMESTAMP(changedAt) DESC LIMIT 1))[OFFSET(0)] AS last
        FROM ${statusTable}
        GROUP BY orderId
      ),
      history AS (
        SELECT
          orderId,
          ARRAY_AGG(STRUCT(status, changedBy, changedAt, reason, meta) ORDER BY TIMESTAMP(changedAt) DESC) AS hist
        FROM ${statusTable}
        GROUP BY orderId
      )
      SELECT
        o.id,
        o.createdAt,
        o.customerName,
        o.customerNumber,
        o.customerEmail,
        o.agentName,
        o.agentNumber,
        COALESCE(ls.last.status, o.orderStatus) AS orderStatus,
        ls.last.changedBy AS cancelledBy,
        ls.last.changedAt AS cancelledAt,
        hs.hist AS statusHistory,
        o.totalQty,
        o.items,
        o.payload,
        o._rawRow
      FROM ${ordersTable} o
      LEFT JOIN latest_status ls ON o.id = ls.orderId
      LEFT JOIN history hs ON o.id = hs.orderId
      ORDER BY TIMESTAMP(o.createdAt) DESC
      LIMIT ${Number(DEFAULT_LIMIT)}
    `;

    const rows = await runQuery(sql);

    const out = (rows as unknown[]).map((rUn) => {
      const r = isObject(rUn) ? (rUn as Record<string, unknown>) : {};

      const parsedItems = (() => {
        const itemsVal = r["items"];
        if (typeof itemsVal === "string" && itemsVal) {
          try {
            return JSON.parse(itemsVal);
          } catch {
            return itemsVal;
          }
        }
        const payloadVal = r["payload"];
        if (typeof payloadVal === "string") {
          try {
            const p = JSON.parse(payloadVal);
            return isObject(p)
              ? (p as Record<string, unknown>)["items"] ?? payloadVal
              : payloadVal;
          } catch {
            return payloadVal;
          }
        }
        return itemsVal;
      })();

      const normalizedPayload = (() => {
        const p = r["payload"];
        if (typeof p === "string") {
          try {
            return JSON.parse(p);
          } catch {
            return p;
          }
        }
        return p;
      })();

      // statusHistory from BigQuery will be either null or an array of structs
      const statusHistoryRaw = r["statusHistory"] ?? r["hist"] ?? null;
      const statusHistory = Array.isArray(statusHistoryRaw)
        ? (statusHistoryRaw as unknown[])
            .map((s) => {
              if (!isObject(s)) return null;
              return {
                status: safeString((s as RawRecord)["status"]),
                changedBy: (s as RawRecord)["changedBy"] ?? null,
                changedAt: (s as RawRecord)["changedAt"] ?? null,
                reason: (s as RawRecord)["reason"] ?? null,
                meta: (s as RawRecord)["meta"] ?? null,
              };
            })
            .filter(Boolean)
        : [];

      return {
        id: r["id"],
        createdAt: r["createdAt"],
        customerName: r["customerName"],
        customerNumber: r["customerNumber"],
        customerEmail: r["customerEmail"],
        agentName: r["agentName"],
        agentNumber: r["agentNumber"],
        orderStatus: r["orderStatus"],
        cancelledBy: r["cancelledBy"] ?? null,
        cancelledAt: r["cancelledAt"] ?? null,
        statusHistory,
        totalQty:
          typeof r["totalQty"] === "number"
            ? r["totalQty"]
            : Number(r["totalQty"] ?? 0),
        items: parsedItems,
        payload: normalizedPayload,
        _rawRow: r,
      } as Record<string, unknown>;
    });

    return NextResponse.json(out);
  } catch (err: unknown) {
    console.error("GET /api/orders error:", err);
    const detail = extractErrorDetail(err);
    return NextResponse.json(
      { ok: false, message: detail.message },
      { status: 500 }
    );
  }
}

/** =========================
 *  POST: create order (insert into BigQuery)
 *  - only create reservations when orderStatus === 'Confirmed'
 * ========================= */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (!BQ_PROJECT_ID || !BQ_DATASET_ID || !BQ_TABLE_ID) {
      return NextResponse.json(
        { ok: false, message: "BigQuery configuration missing" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!isObject(body)) {
      return NextResponse.json(
        { ok: false, message: "Bad Request: invalid JSON body" },
        { status: 400 }
      );
    }

    const customerPayload = body["customer"];
    const agentPayload = body["agent"];
    const itemsInput = body["items"];
    const rawOrderStatus =
      body["orderStatus"] ?? body["order_status"] ?? body["status"];

    if (!customerPayload)
      return NextResponse.json(
        { ok: false, message: "Missing customer" },
        { status: 400 }
      );
    if (
      !itemsInput ||
      !Array.isArray(itemsInput) ||
      (itemsInput as unknown[]).length === 0
    ) {
      return NextResponse.json(
        { ok: false, message: "Missing items" },
        { status: 400 }
      );
    }

    const normalized = normalizeItems(itemsInput);
    const invalidItem = normalized.find((it) => !it.sku && !it.itemName);
    if (invalidItem)
      return NextResponse.json(
        { ok: false, message: "One or more items missing sku/name" },
        { status: 400 }
      );

    const groupedItems = groupItemsToColors(normalized);
    const itemsForPayload = groupedItemsToPayloadShape(groupedItems);

    let orderStatus = "Unconfirmed";
    if (rawOrderStatus !== undefined && rawOrderStatus !== null) {
      const s = String(rawOrderStatus).trim();
      if (s) orderStatus = s;
    }

    const shouldReserve =
      String(orderStatus).trim().toLowerCase() === "confirmed";

    const totalQty = normalized.reduce(
      (s, it) => s + (Number(it.quantity) || 0),
      0
    );

    const orderId = (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    ).toUpperCase();
    const createdAt = new Date().toISOString();

    const canonicalOrder: Record<string, unknown> = {
      id: orderId,
      customer: customerPayload,
      agent: agentPayload ?? null,
      items: itemsForPayload,
      totalQty,
      orderStatus,
      createdAt,
      source: "web",
    };

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const customerName = isObject(customerPayload)
      ? safeString(
          (customerPayload as RawRecord).label ??
            (customerPayload as RawRecord).name ??
            ""
        )
      : safeString(customerPayload);
    const customerNumber = isObject(customerPayload)
      ? safeString(
          (customerPayload as RawRecord).phone ??
            (customerPayload as RawRecord).Number ??
            (customerPayload as RawRecord).phoneNumber ??
            ""
        )
      : "";
    const customerEmail = isObject(customerPayload)
      ? safeString(
          (customerPayload as RawRecord).email ??
            (customerPayload as RawRecord).Email ??
            ""
        )
      : "";

    const agentName = isObject(agentPayload)
      ? safeString(
          (agentPayload as RawRecord).label ??
            (agentPayload as RawRecord).name ??
            ""
        )
      : safeString(agentPayload);
    const agentNumber = isObject(agentPayload)
      ? safeString(
          (agentPayload as RawRecord).number ??
            (agentPayload as RawRecord).phone ??
            (agentPayload as RawRecord).Contact_Number ??
            ""
        )
      : "";

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

    // If order is Confirmed -> create reservations first
    const createdReservationIds: string[] = [];
    if (shouldReserve) {
      try {
        await ensureReservationsTableExists(
          BQ_PROJECT_ID,
          BQ_DATASET_ID,
          BQ_RESERVATIONS_TABLE_ID
        );

        for (const it of itemsForPayload) {
          const itemName = safeString(
            (it as Record<string, unknown>).itemName ?? ""
          );
          const colors = Array.isArray((it as Record<string, unknown>).colors)
            ? ((it as Record<string, unknown>).colors as string[])
            : [];
          const sets = Number((it as Record<string, unknown>).sets ?? 0) || 0;

          if (colors.length === 0) {
            const reservationId = makeReservationId();
            const rrow: Record<string, unknown> = {
              reservationId,
              orderId,
              sku: "", // SKU not present in payload shape; keep empty
              itemName,
              color: "",
              reservedQty: sets,
              status: "reserved",
              createdAt: new Date().toISOString(),
              meta: null,
            };
            await insertRowToBigQuery(
              BQ_PROJECT_ID,
              BQ_DATASET_ID,
              BQ_RESERVATIONS_TABLE_ID,
              rrow
            );
            createdReservationIds.push(reservationId);
          } else {
            for (const color of colors) {
              const reservationId = makeReservationId();
              const rrow: Record<string, unknown> = {
                reservationId,
                orderId,
                sku: "",
                itemName,
                color: safeString(color),
                reservedQty: sets,
                status: "reserved",
                createdAt: new Date().toISOString(),
                meta: null,
              };
              await insertRowToBigQuery(
                BQ_PROJECT_ID,
                BQ_DATASET_ID,
                BQ_RESERVATIONS_TABLE_ID,
                rrow
              );
              createdReservationIds.push(reservationId);
            }
          }
        }
      } catch (resErr: unknown) {
        // if any reservation insert fails -> cleanup created reservations and abort
        console.error("Reservation insert failed, cleaning up:", resErr);
        try {
          await deleteReservationsByOrderId(
            BQ_PROJECT_ID,
            BQ_DATASET_ID,
            BQ_RESERVATIONS_TABLE_ID,
            orderId
          );
        } catch (cleanupErr) {
          console.warn(
            "Failed to cleanup reservations after reservation error",
            cleanupErr
          );
        }
        const detail = extractErrorDetail(resErr);
        return NextResponse.json(
          {
            ok: false,
            message: "Failed to reserve stock for Confirmed order",
            bigQueryError: detail,
          },
          { status: 500 }
        );
      }
    }

    // Now insert the order row
    try {
      await insertRowToBigQuery(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID, row);
    } catch (insertErr: unknown) {
      console.error("BigQuery insert error (detailed):", insertErr);
      // attempt to cleanup reservations if any were created
      if (createdReservationIds.length > 0) {
        try {
          await deleteReservationsByOrderId(
            BQ_PROJECT_ID,
            BQ_DATASET_ID,
            BQ_RESERVATIONS_TABLE_ID,
            orderId
          );
        } catch (cleanupErr) {
          console.warn(
            "Failed to cleanup reservations after order insert failure",
            cleanupErr
          );
        }
      }
      const detail = extractErrorDetail(insertErr);
      return NextResponse.json(
        {
          ok: false,
          message: "BigQuery insert failed",
          bigQueryError: detail,
          canonicalOrder,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, orderId, inserted: 1 },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("POST /api/orders error:", err);
    const detail = extractErrorDetail(err);
    return NextResponse.json(
      { ok: false, message: detail.message },
      { status: 500 }
    );
  }
}

/** =========================
 *  PATCH: update orderStatus (BigQuery DML)
 *  ========================= */
export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!isObject(body))
      return NextResponse.json(
        { ok: false, message: "Bad Request: invalid JSON body" },
        { status: 400 }
      );

    const id = safeString(body["id"]);
    const newStatus = safeString(body["orderStatus"] ?? body["status"] ?? "");

    if (!id || !newStatus)
      return NextResponse.json(
        { ok: false, message: "Missing id or orderStatus" },
        { status: 400 }
      );

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);

    const fullTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;
    const sql = `UPDATE ${fullTable} SET orderStatus = @status WHERE id = @id`;
    const options: QueryOptionsLocal = {
      query: sql,
      params: { id, status: newStatus },
      types: { id: "STRING", status: "STRING" },
      location: "US",
    };

    await bigquery.query(options as BQQueryOptions);

    return NextResponse.json(
      { ok: true, id, orderStatus: newStatus },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("PATCH /api/orders error:", err);
    const detail = extractErrorDetail(err);
    const msg = String(detail.message || "Unknown error");
    const isStreamingBuffer = /streaming buffer/i.test(msg);
    const status = isStreamingBuffer ? 409 : 500;
    const outMsg = isStreamingBuffer
      ? "Row is still in the streaming buffer. Please retry in a few minutes."
      : msg;
    return NextResponse.json({ ok: false, message: outMsg }, { status });
  }
}

/** =========================
 *  DELETE: soft-delete — mark as Cancelled
 *  - writes audit row
 *  - best-effort releases reservations and updates orders table
 * ========================= */
export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    const cancelledBy = url.searchParams.get("cancelledBy") ?? "";
    const reason = url.searchParams.get("reason") ?? "cancelled_via_api";

    if (!id)
      return NextResponse.json(
        { ok: false, message: "Missing id query parameter" },
        { status: 400 }
      );

    await ensureDatasetExists(BQ_PROJECT_ID, BQ_DATASET_ID);
    await ensureTableExists(BQ_PROJECT_ID, BQ_DATASET_ID, BQ_TABLE_ID);
    await ensureStatusTableExists(
      BQ_PROJECT_ID,
      BQ_DATASET_ID,
      BQ_STATUS_TABLE_ID
    );
    // ensure reservations table exists as we will attempt to release reservations
    await ensureReservationsTableExists(
      BQ_PROJECT_ID,
      BQ_DATASET_ID,
      BQ_RESERVATIONS_TABLE_ID
    );

    // Insert a status update row. This avoids touching the base table and avoids streaming buffer errors.
    const statusRow: Record<string, unknown> = {
      orderId: id,
      status: "Cancelled",
      changedBy: cancelledBy || null,
      changedAt: new Date().toISOString(),
      reason,
      meta: null,
    };

    await insertStatusUpdate(
      BQ_PROJECT_ID,
      BQ_DATASET_ID,
      BQ_STATUS_TABLE_ID,
      statusRow
    );

    // Best-effort: mark reservations as released for this order so stock becomes available again
    (async () => {
      try {
        await releaseReservationsByOrderId(
          BQ_PROJECT_ID,
          BQ_DATASET_ID,
          BQ_RESERVATIONS_TABLE_ID,
          id
        );
      } catch (releaseErr) {
        console.debug(
          "Non-fatal: could not release reservations for order.",
          releaseErr
        );
      }

      // Optionally, attempt to update the base orders table AFTER creating the status row.
      try {
        const fullTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET_ID}.${BQ_TABLE_ID}\``;
        const sql = `UPDATE ${fullTable}
                     SET orderStatus = 'Cancelled', cancelledAt = CURRENT_TIMESTAMP(), cancelledBy = @cancelledBy
                     WHERE id = @id`;
        const opts: QueryOptionsLocal = {
          query: sql,
          params: { id, cancelledBy },
          types: { id: "STRING", cancelledBy: "STRING" },
          location: "US",
        };
        await bigquery.query(opts as BQQueryOptions);
      } catch (updErr) {
        // swallow — the status update is the canonical source of truth now
        console.debug(
          "Non-fatal: could not update base orders table (likely streaming buffer).",
          updErr
        );
      }
    })();

    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (err: unknown) {
    console.error("DELETE /api/orders error:", err);
    const detail = extractErrorDetail(err);
    return NextResponse.json(
      { ok: false, message: detail.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
