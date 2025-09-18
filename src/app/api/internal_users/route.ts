// app/api/internal_users/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

type CustomerObj = { name: string; email: string };

export type InternalUserRow = {
  row_id?: string | null;
  name?: string | null;
  number?: string | null;
  email?: string | null;
  department?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: boolean | null;
  // support both legacy string[] and the new detailed object array
  customers?: string[] | CustomerObj[] | null; // exposed to clients
  __customers_for_db?: string | null; // internal use for writes
};

/** env / defaults */
const PROJECT_ID = process.env.BQ_PROJECT;
const DATASET = process.env.BQ_DATASET ?? "frono_2025";
const TABLE = process.env.BQ_TABLE ?? "internal_users";
const LOCATION = process.env.BQ_LOCATION ?? "US";
// view name we created earlier (must exist)
const VIEW = `${PROJECT_ID}.${DATASET}.internal_users_current`;

function ensureProjectId(): string {
  if (!PROJECT_ID) throw new Error("Missing environment variable: BQ_PROJECT");
  return PROJECT_ID;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    try {
      return String((err as { message?: unknown }).message ?? String(err));
    } catch {
      return String(err);
    }
  }
  return String(err ?? "Unknown error");
}

function getErrorDetails(err: unknown): unknown {
  if (typeof err === "object" && err !== null) {
    // prefer fields commonly returned by BigQuery client
    const e = err as { errors?: unknown; insertErrors?: unknown };
    return e.errors ?? e.insertErrors ?? err;
  }
  return err;
}

function getBigQueryClient(): BigQuery {
  const rawFullKey = process.env.GCLOUD_SERVICE_KEY;
  if (rawFullKey) {
    let keyObj: Record<string, unknown>;
    try {
      keyObj = JSON.parse(rawFullKey);
    } catch (e: unknown) {
      throw new Error("Invalid JSON in GCLOUD_SERVICE_KEY: " + getErrorMessage(e));
    }
    const clientEmail = typeof keyObj.client_email === "string" ? keyObj.client_email : undefined;
    const privateKey = typeof keyObj.private_key === "string" ? keyObj.private_key : undefined;
    if (!clientEmail || !privateKey) {
      throw new Error("GCLOUD_SERVICE_KEY missing client_email or private_key");
    }
    const projectId = (typeof keyObj.project_id === "string" && keyObj.project_id) || ensureProjectId();
    return new BigQuery({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    });
  }

  const clientEmail = process.env.GCLOUD_CLIENT_EMAIL;
  const rawPrivateKey = process.env.GCLOUD_PRIVATE_KEY;
  if (!PROJECT_ID || !clientEmail || !rawPrivateKey) {
    throw new Error(
      "Missing BigQuery credentials. Set BQ_PROJECT + (GCLOUD_SERVICE_KEY || (GCLOUD_CLIENT_EMAIL & GCLOUD_PRIVATE_KEY))."
    );
  }

  const private_key = rawPrivateKey.replace(/\\n/g, "\n");
  return new BigQuery({
    projectId: PROJECT_ID,
    credentials: {
      client_email: clientEmail,
      private_key,
    },
  });
}

/** Generate a random ID. Prefer crypto.randomUUID if available, else fallback. */
function generateRowId(): string {
  try {
    const maybeCrypto = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
      return maybeCrypto.randomUUID();
    }
  } catch {
    // ignore and fall back
  }
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `rid_${t}_${r}`;
}

/** Normalize incoming request body to snake_case keys (accepts Name/name, Email/email etc.) */
function normalizeInput(body: Record<string, unknown> | null): Partial<InternalUserRow> {
  if (!body) return {};
  const get = (k1: string, k2: string) => {
    const v1 = body[k1];
    if (typeof v1 === "string") return v1.trim();
    const v2 = body[k2];
    if (typeof v2 === "string") return v2.trim();
    return undefined;
  };

  const name = get("name", "Name");
  const email = get("email", "Email");
  const number = get("number", "Number");
  const department = get("department", "Department");

  return {
    name: typeof name !== "undefined" ? (name ?? null) : undefined,
    email: typeof email !== "undefined" ? (email ?? null) : undefined,
    number: typeof number !== "undefined" ? (number ?? null) : undefined,
    department: typeof department !== "undefined" ? (department ?? null) : undefined,
  };
}

/* ---------------------- Customer parsing helpers ---------------------- */

/** Helper: isRecord */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Safely read a string-ish field from an object using multiple candidate keys */
function readStringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** Parse different shapes into string[] (used when reading from DB or parsing input)
 *
 * Supported:
 * - ["a@x.com", "b@x.com"]
 * - [{ name, email }, ...]
 * - [{ "Company Name": "email@..." }, ...] (value extracted)
 * - JSON-string encoded array
 * - CSV string "a,b,c"
 */
function parseCustomers(raw: unknown): string[] {
  if (!raw) return [];

  // If raw is an array, process each entry
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const entry of raw) {
      if (entry === null || entry === undefined) continue;

      if (typeof entry === "string") {
        const s = entry.trim();
        if (s) out.push(s);
        continue;
      }

      if (isRecord(entry)) {
        // Prefer email fields
        const email = readStringField(entry as Record<string, unknown>, "email", "Email");
        if (email) {
          out.push(email);
          continue;
        }

        // Otherwise prefer name-like fields
        const name = readStringField(entry as Record<string, unknown>, "name", "Name", "Company_Name", "company_name");
        if (name) {
          out.push(name);
          continue;
        }

        // If object is shape { "Customer Name": "email@..." } take the first value
        const keys = Object.keys(entry as Record<string, unknown>);
        if (keys.length > 0) {
          for (const k of keys) {
            const val = (entry as Record<string, unknown>)[k];
            if (typeof val === "string") {
              const s = val.trim();
              if (s) {
                out.push(s);
                break;
              }
            } else if (typeof val === "number") {
              out.push(String(val));
              break;
            }
          }
        }

        continue;
      }

      // fallback: stringify
      const s = String(entry).trim();
      if (s) out.push(s);
    }
    return out.map((x) => x.trim()).filter(Boolean);
  }

  // If raw is an object that serializes to array (rare), attempt to parse
  if (isRecord(raw)) {
    try {
      const json = JSON.stringify(raw);
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parseCustomers(parsed);
    } catch {
      // fall through
    }
  }

  // If raw is a string, attempt JSON parse, CSV, or single value
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    // JSON encoded array?
    if ((s.startsWith("[") && s.endsWith("]")) || s.startsWith('"')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parseCustomers(parsed);
      } catch {
        // not JSON
      }
    }
    // CSV
    if (s.includes(",")) {
      return s.split(",").map((p) => p.trim()).filter(Boolean);
    }
    return [s];
  }

  // fallback convert to string
  return [String(raw)].map((x) => x.trim()).filter(Boolean);
}

/** Convert input (array/string/CSV/JSON-string) into a JSON-string for DB storage, or null */
function stringifyCustomersForDb(raw: unknown): string | null {
  const arr = parseCustomers(raw);
  if (!arr.length) return null;
  try {
    return JSON.stringify(arr);
  } catch {
    return null;
  }
}

/** Extract customers column value from a DB row and parse it into string[] */
function extractCustomersFromDbRow(row: Record<string, unknown>): string[] {
  const raw = row["customers"];
  return parseCustomers(raw);
}

/** Dedupe array preserving order, case-insensitively */
function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = String(it ?? "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(key);
    }
  }
  return out;
}

/* ---------------------- GET ---------------------- */

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const bigquery = getBigQueryClient();
    ensureProjectId();

    const url = new URL(req.url);
    const emailQ = (url.searchParams.get("email") ?? "").trim();

    if (emailQ) {
      // read the latest non-deleted row for the email
      const sqlSingle = `
        SELECT row_id, name, number, email, department, created_at, updated_at, is_deleted, customers
        FROM \`${VIEW}\`
        WHERE LOWER(email) = LOWER(@email)
        LIMIT 1
      `;
      const [resRows] = await bigquery.query({ query: sqlSingle, params: { email: emailQ }, location: LOCATION });

      const row = Array.isArray(resRows) && resRows.length ? (resRows[0] as Record<string, unknown>) : null;
      if (!row) {
        return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      }

      // enrich customers: parse stored string[] then lookup names for those emails
      const customerEmails = extractCustomersFromDbRow(row).map((e) => String(e).trim()).filter(Boolean);
      let customersDetailed: CustomerObj[] = [];

      if (customerEmails.length > 0) {
        try {
          const emailsLower = customerEmails.map((e) => e.toLowerCase());
          const sqlLookup = `
            SELECT name, email
            FROM \`${VIEW}\`
            WHERE LOWER(email) IN UNNEST(@emails)
          `;
          const [lookupRows] = await bigquery.query({
            query: sqlLookup,
            params: { emails: emailsLower },
            location: LOCATION,
          });

          const nameByEmailLower = new Map<string, string>();
          if (Array.isArray(lookupRows)) {
            for (const lr of lookupRows as Record<string, unknown>[]) {
              const emRaw = lr["email"];
              if (!emRaw) continue;
              const em = String(emRaw).trim().toLowerCase();
              const nm = typeof lr["name"] === "string" ? lr["name"] : "";
              nameByEmailLower.set(em, nm);
            }
          }

          customersDetailed = customerEmails.map((em) => {
            const lower = em.toLowerCase();
            const foundName = nameByEmailLower.get(lower);
            return { name: foundName && String(foundName).trim() ? String(foundName).trim() : em, email: em };
          });
        } catch (lookupErr: unknown) {
          console.error("customer lookup error:", getErrorMessage(lookupErr));
          customersDetailed = customerEmails.map((em) => ({ name: em, email: em }));
        }
      }

      const out: InternalUserRow = {
        row_id: typeof row["row_id"] === "string" ? row["row_id"] : null,
        name: typeof row["name"] === "string" ? row["name"] : null,
        number: typeof row["number"] === "string" ? row["number"] : null,
        email: typeof row["email"] === "string" ? row["email"] : null,
        department: typeof row["department"] === "string" ? row["department"] : null,
        created_at: typeof row["created_at"] === "string" ? row["created_at"] : null,
        updated_at: typeof row["updated_at"] === "string" ? row["updated_at"] : null,
        is_deleted: typeof row["is_deleted"] === "boolean" ? row["is_deleted"] : false,
        // legacy raw parsed list (string[])
        customers: extractCustomersFromDbRow(row),
        __customers_for_db: row["customers"] ? String(row["customers"]) : null,
      };

      return NextResponse.json(
        {
          ok: true,
          user: {
            ...out,
            customers: customersDetailed,
          },
        },
        { status: 200 }
      );
    }

    // list all current users via view
    const sqlAll = `
      SELECT row_id, name, number, email, department, created_at, updated_at, is_deleted, customers
      FROM \`${VIEW}\`
      ORDER BY LOWER(email) ASC NULLS LAST
    `;
    const [rows] = await bigquery.query({ query: sqlAll, location: LOCATION });

    const data = Array.isArray(rows)
      ? (rows as Record<string, unknown>[]).map((r) => ({
          row_id: typeof r["row_id"] === "string" ? r["row_id"] : null,
          name: typeof r["name"] === "string" ? r["name"] : null,
          number: typeof r["number"] === "string" ? r["number"] : null,
          email: typeof r["email"] === "string" ? r["email"] : null,
          department: typeof r["department"] === "string" ? r["department"] : null,
          created_at: typeof r["created_at"] === "string" ? r["created_at"] : null,
          updated_at: typeof r["updated_at"] === "string" ? r["updated_at"] : null,
          is_deleted: typeof r["is_deleted"] === "boolean" ? r["is_deleted"] : false,
          customers: extractCustomersFromDbRow(r),
        }))
      : [];

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (err: unknown) {
    console.error("GET /api/internal_users error:", getErrorMessage(err));
    return NextResponse.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

/* ---------------------- POST ---------------------- */

/**
 * POST - insert (append) one user
 * body: accepts { name?, number?, email?, department?, customers? } OR { Name?, Number?, Email?, Customers? }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const raw = (await req.json()) as Record<string, unknown> | null;
    const input = normalizeInput(raw);

    const customersForDb = stringifyCustomersForDb((raw?.customers ?? raw?.Customers) as unknown);

    if (!input.email && !input.name) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: email or name" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const rowToInsert: Record<string, unknown> = {
      row_id: generateRowId(),
      name: input.name ?? null,
      number: input.number ?? null,
      email: input.email ?? null,
      department: input.department ?? null,
      created_at: now,
      updated_at: null,
      is_deleted: false,
      customers: customersForDb,
    };

    const bigquery = getBigQueryClient();

    try {
      await bigquery.dataset(DATASET).table(TABLE).insert([rowToInsert]);
      const parsedCustomers = customersForDb ? parseCustomers(customersForDb) : [];
      return NextResponse.json({ ok: true, inserted: { ...rowToInsert, customers: parsedCustomers } }, { status: 201 });
    } catch (insertErr: unknown) {
      const msg = getErrorMessage(insertErr);
      const details = getErrorDetails(insertErr);
      console.error("BigQuery insert error:", msg, details);
      return NextResponse.json({ ok: false, error: String(msg), details }, { status: 500 });
    }
  } catch (err: unknown) {
    console.error("POST /api/internal_users error:", getErrorMessage(err));
    return NextResponse.json(
      { ok: false, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}

/* ---------------------- PUT (append new merged row = "update" in append-only model) ---------------------- */

/**
 * PUT - append a merged row (no in-place UPDATE). Identify target by:
 *  - ?row_id=... or body { row_id } to target that exact row
 *  - else ?email=... or body { email } to target the current row for that email
 *
 * This performs:
 *  1) lookup current row (from view or fallback),
 *  2) merge provided fields,
 *  3) insert a new row into the base table with merged values and updated_at.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const qRowId = (url.searchParams.get("row_id") ?? url.searchParams.get("rowId") ?? "").trim();
    const qEmail = (url.searchParams.get("email") ?? "").trim();

    const raw = (await req.json()) as Record<string, unknown> | null;
    const input = normalizeInput(raw);

    // allow row_id or rowId in body
    const bodyRowIdRaw = raw?.row_id ?? raw?.rowId;
    const bodyRowId = typeof bodyRowIdRaw === "string" ? String(bodyRowIdRaw).trim() : "";

    const bodyEmailRaw = raw?.email ?? raw?.Email;
    const bodyEmail = typeof bodyEmailRaw === "string" ? String(bodyEmailRaw).trim() : "";

    const rowId = qRowId || bodyRowId || "";
    const emailQ = qEmail || bodyEmail || (input.email ?? "");

    const bigquery = getBigQueryClient();
    ensureProjectId();

    // Helper: fetch current (latest) row for an email from the view
    async function fetchLatestByEmailFromView(em: string): Promise<Record<string, unknown> | null> {
      const sql = `
        SELECT row_id, name, number, email, department, created_at, updated_at, is_deleted, customers
        FROM \`${VIEW}\`
        WHERE LOWER(email) = LOWER(@em)
        LIMIT 1
      `;
      const [rows] = await bigquery.query({ query: sql, params: { em }, location: LOCATION });
      return Array.isArray(rows) && rows.length ? (rows[0] as Record<string, unknown>) : null;
    }

    // Helper: fetch by row_id using base table (single row)
    async function fetchByRowId(rid: string): Promise<Record<string, unknown> | null> {
      const sql = `
        SELECT row_id, name, number, email, department, created_at, updated_at, is_deleted, customers
        FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\`
        WHERE row_id = @rid
        LIMIT 1
      `;
      const [rows] = await bigquery.query({ query: sql, params: { rid }, location: LOCATION });
      return Array.isArray(rows) && rows.length ? (rows[0] as Record<string, unknown>) : null;
    }

    // determine existing row (prefer row_id if provided)
    let existing: Record<string, unknown> | null = null;
    if (rowId) {
      existing = await fetchByRowId(rowId);
      if (!existing) {
        return NextResponse.json({ ok: false, error: "Row not found for the provided row_id." }, { status: 404 });
      }
    } else if (emailQ) {
      existing = await fetchLatestByEmailFromView(String(emailQ));
      if (!existing) {
        return NextResponse.json({ ok: false, error: "No existing row found for the provided email." }, { status: 404 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "row_id or email is required to identify the row to update." }, { status: 400 });
    }

    // ------------------ merge/append customers (new behavior) ------------------
    // We want to append incoming customers to existing customers (no replace),
    // dedupe case-insensitively, and store as a JSON string in the "customers" column.
    const hasIncomingCustomers =
      raw && (Object.prototype.hasOwnProperty.call(raw, "customers") || Object.prototype.hasOwnProperty.call(raw, "Customers"));

    // parse existing customers (array of strings)
    const existingCustomersArr = extractCustomersFromDbRow(existing);
    const existingCustomersForDb = existing["customers"] ? String(existing["customers"]) : null;

    let customersForDb: string | null = existingCustomersForDb;

    if (hasIncomingCustomers) {
      // parse incoming payload into string[] (supports all shapes)
      const incomingArr = parseCustomers((raw?.customers ?? raw?.Customers) as unknown);

      // append preserving order, then dedupe (preserve first seen)
      const merged = dedupePreserveOrder(existingCustomersArr.concat(incomingArr));

      customersForDb = merged.length ? JSON.stringify(merged) : null;
    } else {
      // no incoming customers provided => keep existing value unchanged
      customersForDb = existingCustomersForDb;
    }
    // --------------------------------------------------------------------------

    const now = new Date().toISOString();

    const mergedName = typeof input.name !== "undefined" ? (input.name ?? null) : (typeof existing["name"] === "string" ? existing["name"] : null);
    const mergedNumber = typeof input.number !== "undefined" ? (input.number ?? null) : (typeof existing["number"] === "string" ? existing["number"] : null);
    const mergedDepartment = typeof input.department !== "undefined" ? (input.department ?? null) : (typeof existing["department"] === "string" ? existing["department"] : null);
    const mergedEmail = typeof input.email !== "undefined" ? (input.email ?? null) : (typeof existing["email"] === "string" ? existing["email"] : null);
    const mergedIsDeleted = false;

    // Build a new row (append) representing the update
    const newRow: Record<string, unknown> = {
      row_id: generateRowId(), // new row id
      name: mergedName,
      number: mergedNumber,
      email: mergedEmail,
      department: mergedDepartment,
      created_at: existing["created_at"] ?? new Date().toISOString(), // preserve original created_at if present
      updated_at: now,
      is_deleted: mergedIsDeleted,
      customers: customersForDb,
    };

    try {
      await bigquery.dataset(DATASET).table(TABLE).insert([newRow]);
      const parsedCustomers = customersForDb ? parseCustomers(customersForDb) : existingCustomersArr;
      const result: InternalUserRow = {
        row_id: String(newRow.row_id),
        name: mergedName as string | null,
        number: mergedNumber as string | null,
        email: mergedEmail as string | null,
        department: mergedDepartment as string | null,
        created_at: typeof newRow.created_at === "string" ? (newRow.created_at as string) : null,
        updated_at: now,
        is_deleted: mergedIsDeleted,
        customers: parsedCustomers,
      };
      return NextResponse.json({ ok: true, inserted: result }, { status: 200 });
    } catch (insertErr: unknown) {
      const msg = getErrorMessage(insertErr);
      const details = getErrorDetails(insertErr);
      console.error("PUT - append merged row insert error:", msg, details);
      return NextResponse.json({ ok: false, error: String(msg), details }, { status: 500 });
    }
  } catch (err: unknown) {
    console.error("PUT /api/internal_users error:", getErrorMessage(err));
    return NextResponse.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

/* ---------------------- DELETE (append tombstone row) ---------------------- */

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const qRowId = (url.searchParams.get("row_id") ?? url.searchParams.get("rowId") ?? "").trim();
    const qEmail = (url.searchParams.get("email") ?? "").trim();

    let body: Record<string, unknown> | null = null;
    try {
      body = (await req.json()) as Record<string, unknown> | null;
    } catch {
      body = null;
    }

    const bodyRowIdRaw = body?.row_id ?? body?.rowId;
    const bodyRowId = typeof bodyRowIdRaw === "string" ? String(bodyRowIdRaw).trim() : "";

    const bodyEmailRaw = body?.email ?? body?.Email;
    const bodyEmail = typeof bodyEmailRaw === "string" ? String(bodyEmailRaw).trim() : "";

    const rowId = qRowId || bodyRowId || "";
    const email = (qEmail || bodyEmail || "").trim();

    const bigquery = getBigQueryClient();
    ensureProjectId();

    if (rowId) {
      // Append tombstone row for the same email (lookup email first to preserve email in tombstone)
      const fetchSql = `
        SELECT row_id, email FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\` WHERE row_id = @rid LIMIT 1
      `;
      const [rows] = await bigquery.query({ query: fetchSql, params: { rid: rowId }, location: LOCATION });
      const target = Array.isArray(rows) && rows.length ? (rows[0] as Record<string, unknown>) : null;
      const targetEmail = target ? (typeof target["email"] === "string" ? target["email"] : null) : null;

      const tombstone: Record<string, unknown> = {
        row_id: generateRowId(),
        name: null,
        number: null,
        email: targetEmail ?? null,
        department: null,
        created_at: new Date().toISOString(),
        updated_at: null,
        is_deleted: true,
        customers: null,
      };

      try {
        await bigquery.dataset(DATASET).table(TABLE).insert([tombstone]);
        return NextResponse.json({ ok: true, inserted_tombstone: tombstone }, { status: 200 });
      } catch (insertErr: unknown) {
        console.error("DELETE (tombstone by row_id) insert failed:", getErrorMessage(insertErr));
        return NextResponse.json({ ok: false, error: getErrorMessage(insertErr), details: getErrorDetails(insertErr) }, { status: 500 });
      }
    }

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "row_id or email is required to identify the row(s) to delete." },
        { status: 400 }
      );
    }

    const tombstoneByEmail: Record<string, unknown> = {
      row_id: generateRowId(),
      name: null,
      number: null,
      email,
      department: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      is_deleted: true,
      customers: null,
    };

    try {
      await bigquery.dataset(DATASET).table(TABLE).insert([tombstoneByEmail]);
      return NextResponse.json({ ok: true, inserted_tombstone: tombstoneByEmail }, { status: 200 });
    } catch (dErr: unknown) {
      console.error("DELETE (tombstone by email) insert failed:", getErrorMessage(dErr));
      return NextResponse.json({ ok: false, error: getErrorMessage(dErr), details: getErrorDetails(dErr) }, { status: 500 });
    }
  } catch (err: unknown) {
    console.error("DELETE /api/internal_users error:", getErrorMessage(err));
    return NextResponse.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}
