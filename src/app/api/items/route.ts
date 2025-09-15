import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

export const runtime = "nodejs";

type Nil<T> = T | null | undefined;

export interface ItemRow {
  Item?: string;
  Colors?: string[] | null;
  Sizes?: string[] | null;
  Opening_Stock?: Nil<number>;
  Stock_In?: Nil<number>;
  Stock_Out?: Nil<number>;
  Closing_Stock?: Nil<number>;
  Reserved?: Nil<number>;
  Available?: Nil<number>;
  File_URL?: Nil<string>;
  Product_Code?: Nil<string>;
  Concept?: Nil<string>;
  Fabric?: Nil<string>;
  FileId?: Nil<string>;
  Thumbnail_URL?: Nil<string>;
  WSP?: Nil<number>;
  // added by merger
  In_Production?: boolean;
  InProductionQuantity?: number;
}

interface ApiSuccess {
  rows: ItemRow[];
}
interface ApiError {
  error: string;
}

/* --------------------- small helpers --------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return String(v).trim();
  } catch {
    return "";
  }
}

/** Return finite number or undefined */
function getFiniteNumber(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
    return undefined;
  }
  return undefined;
}

/** Try to extract an array of strings from unknown input:
 *  - if an array, map to strings
 *  - if a JSON array string, parse
 *  - if comma/semicolon separated string, split
 *  - else return undefined
 */
function extractStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;

  if (Array.isArray(v)) {
    return v.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean);
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    // try JSON array
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith('"') && s.endsWith('"'))) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => asString(x)).map((t) => t.trim()).filter(Boolean);
        }
      } catch {
        // fallthrough to separators
      }
    }
    // split on common separators
    if (s.includes(",") || s.includes(";") || s.includes("|") || s.includes("/")) {
      return s.split(/[,;|/]/).map((x) => x.trim()).filter(Boolean);
    }
    // single token
    return [s];
  }

  // not array/string -> undefined
  return undefined;
}

/* --------------------- BigQuery factory --------------------- */

function makeBQ(): BigQuery {
  const key = process.env.GCLOUD_SERVICE_KEY;
  if (key) {
    const parsed: unknown = JSON.parse(key);
    if (!isRecord(parsed)) {
      throw new Error("GCLOUD_SERVICE_KEY did not parse to an object");
    }

    const client_email = asString((parsed as Record<string, unknown>).client_email ?? (parsed as Record<string, unknown>).clientEmail);
    const private_key = asString((parsed as Record<string, unknown>).private_key ?? (parsed as Record<string, unknown>).privateKey);
    const project_id = asString((parsed as Record<string, unknown>).project_id ?? (parsed as Record<string, unknown>).projectId);

    if (!client_email || !private_key) {
      throw new Error("GCLOUD_SERVICE_KEY missing client_email or private_key");
    }

    return new BigQuery({
      projectId: process.env.BQ_PROJECT ?? project_id,
      credentials: {
        client_email,
        private_key,
      } as { client_email: string; private_key: string; project_id?: string },
    });
  }
  return new BigQuery({ projectId: process.env.BQ_PROJECT });
}

const bq = makeBQ();

/* --------------------- handler --------------------- */

export async function GET() {
  try {
    const project = process.env.BQ_PROJECT!;
    const dataset = process.env.BQ_DATASET!;

    if (!project || !dataset) {
      return NextResponse.json<ApiError>(
        { error: "Missing BQ_PROJECT / BQ_DATASET" },
        { status: 500 }
      );
    }

    const stockTable = `\`${project}.frono.stock_combined\``;
    const detailsTable = `\`${project}.frono.Sample_details\``;
    const reservationsTable = `\`${project}.${dataset}.orders_reservations\``;
    const inProdTable = `\`${project}.frono.in_prod_design\``; // adjust if different

    const itemsQuery = `
      WITH grouped AS (
        SELECT
          Item,
          ARRAY_AGG(TRIM(CAST(Color AS STRING)) IGNORE NULLS) AS color_arr,
          ARRAY_AGG(TRIM(CAST(Size AS STRING)) IGNORE NULLS) AS size_arr,
          SUM(COALESCE(SAFE_CAST(Opening_Stock AS INT64), 0)) AS Opening_Stock,
          SUM(COALESCE(SAFE_CAST(Stock_In AS INT64), 0)) AS Stock_In,
          SUM(COALESCE(SAFE_CAST(Stock_Out AS INT64), 0)) AS Stock_Out,
          SUM(COALESCE(SAFE_CAST(Closing_Stock AS INT64), 0)) AS Closing_Stock,
          ANY_VALUE(CAST(WSP AS FLOAT64)) AS WSP
        FROM ${stockTable}
        GROUP BY Item
      ),
      reserved AS (
        SELECT
          TRIM(itemName) AS itemName,
          SUM(COALESCE(SAFE_CAST(reservedQty AS INT64), 0)) AS reserved_total
        FROM ${reservationsTable}
        WHERE LOWER(IFNULL(status, '')) = 'reserved'
        GROUP BY TRIM(itemName)
      )
      SELECT
        g.Item,
        ARRAY(
          SELECT DISTINCT col FROM UNNEST(g.color_arr) AS col
          WHERE col IS NOT NULL AND LOWER(TRIM(col)) NOT IN ('', 'nan', 'null')
        ) AS Colors,
        ARRAY(
          SELECT DISTINCT sz FROM UNNEST(g.size_arr) AS sz
          WHERE sz IS NOT NULL AND LOWER(TRIM(sz)) NOT IN ('', 'nan', 'null')
        ) AS Sizes,
        g.Opening_Stock,
        g.Stock_In,
        g.Stock_Out,
        g.Closing_Stock,
        IFNULL(r.reserved_total, 0) AS Reserved,
        GREATEST(g.Closing_Stock - IFNULL(r.reserved_total, 0), 0) AS Available,
        REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', '') AS File_URL,
        ANY_VALUE(s.Product_Code) AS Product_Code,
        ANY_VALUE(s.Concept_2) AS Concept,
        ANY_VALUE(s.Concept_3) AS Fabric,
        REGEXP_EXTRACT(REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', ''), r'/d/([^/]+)') AS FileId,
        IFNULL(
          CONCAT('https://drive.google.com/thumbnail?id=', REGEXP_EXTRACT(REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', ''), r'/d/([^/]+)')),
          NULL
        ) AS Thumbnail_URL,
        g.WSP AS WSP
      FROM grouped g
      LEFT JOIN ${detailsTable} s
        ON TRIM(g.Item) = TRIM(s.Product_Code)
      LEFT JOIN reserved r
        ON TRIM(g.Item) = TRIM(r.itemName)
      GROUP BY
        g.Item,
        g.Opening_Stock,
        g.Stock_In,
        g.Stock_Out,
        g.Closing_Stock,
        g.color_arr,
        g.size_arr,
        r.reserved_total,
        g.WSP
      ORDER BY g.Item
    `;

    const inProdQuery = `
      SELECT
        Product_Code,
        Colors AS Color,
        Quantity
      FROM (
        SELECT
          TRIM(CAST(Design_no AS STRING)) AS Product_Code,
          ARRAY_AGG(DISTINCT TRIM(Color) IGNORE NULLS) AS Colors,
          SUM(COALESCE(CAST(Quantity AS INT64), 0)) AS Quantity
        FROM ${inProdTable}
        WHERE TRIM(CAST(Design_no AS STRING)) <> ''
        GROUP BY TRIM(CAST(Design_no AS STRING))
      ) AS agg
      WHERE Quantity > 0
      ORDER BY Product_Code
    `;

    const [itemsJob] = await bq.createQueryJob({
      query: itemsQuery,
      useLegacySql: false,
    });
    const [inProdJob] = await bq.createQueryJob({
      query: inProdQuery,
      useLegacySql: false,
    });

    const [itemsResult, inProdResult] = await Promise.all([
      itemsJob.getQueryResults(),
      inProdJob.getQueryResults(),
    ]);

    const itemsRows = (itemsResult[0] || []) as unknown[]; // we'll validate per-row below
    const inProdRowsRaw = (inProdResult[0] || []) as unknown[];

    const inProdMap = new Map<string, { Quantity: number; Colors: string[] }>();
    for (const r of inProdRowsRaw) {
      const rec = isRecord(r) ? r : {};
      const code = asString(rec["Product_Code"] ?? rec["ProductCode"] ?? "").trim();
      if (!code) continue;
      const qtyRaw = rec["Quantity"] ?? null;
      const qty = Number(qtyRaw ?? 0) || 0; // coerce to number, default 0
      const colors = extractStringArray(rec["Color"] ?? rec["Colors"]) ?? [];
      inProdMap.set(code.toUpperCase(), { Quantity: qty, Colors: colors });
    }

    const merged: ItemRow[] = itemsRows.map((r) => {
      const rec = isRecord(r) ? r : {};

      const itemKey = asString(rec["Item"] ?? rec["Product_Code"] ?? "").trim();
      const upperKey = itemKey.toUpperCase();

      const inProd = inProdMap.get(upperKey);

      const itemColors = extractStringArray(rec["Colors"]) ?? [];
      const inProdColors = inProd?.Colors ?? [];

      const colorSet = new Set<string>();
      for (const c of itemColors.concat(inProdColors)) {
        const cleaned = asString(c).trim();
        if (cleaned) colorSet.add(cleaned);
      }
      const mergedColors = Array.from(colorSet);

      const out: ItemRow = {
        Item: asString(rec["Item"] ?? rec["Product_Code"] ?? ""),
        Colors: mergedColors.length ? mergedColors : (itemColors.length ? itemColors : null),
        Sizes: extractStringArray(rec["Sizes"]) ?? null,
        Opening_Stock: (() => getFiniteNumber(rec["Opening_Stock"]) ?? null)(),
        Stock_In: (() => getFiniteNumber(rec["Stock_In"]) ?? null)(),
        Stock_Out: (() => getFiniteNumber(rec["Stock_Out"]) ?? null)(),
        Closing_Stock: (() => getFiniteNumber(rec["Closing_Stock"]) ?? null)(),
        Reserved: (() => getFiniteNumber(rec["Reserved"]) ?? null)(),
        Available: (() => getFiniteNumber(rec["Available"]) ?? null)(),
        File_URL: (() => {
          const s = asString(rec["File_URL"] ?? rec["file_url"] ?? rec["FileUrl"]);
          return s ? s : null;
        })(),
        Product_Code: (() => {
          const s = asString(rec["Product_Code"] ?? rec["ProductCode"]);
          return s ? s : null;
        })(),
        Concept: (() => {
          const s = asString(rec["Concept"] ?? rec["Concept_2"]);
          return s ? s : null;
        })(),
        Fabric: (() => {
          const s = asString(rec["Fabric"] ?? rec["Concept_3"]);
          return s ? s : null;
        })(),
        FileId: (() => {
          const s = asString(rec["FileId"] ?? rec["File_Id"]);
          return s ? s : null;
        })(),
        Thumbnail_URL: (() => {
          const s = asString(rec["Thumbnail_URL"] ?? rec["ThumbnailUrl"] ?? rec["Thumbnail"]);
          return s ? s : null;
        })(),
        WSP: (() => getFiniteNumber(rec["WSP"]) ?? null)(),
        In_Production: Boolean(inProd),
        InProductionQuantity: inProd ? Number(inProd.Quantity || 0) : 0,
      };

      return out;
    });

    return NextResponse.json<ApiSuccess>({ rows: merged }, { status: 200 });
  } catch (err: unknown) {
    const anyErr = err as { errors?: { message?: string }[]; message?: string };
    const msg =
      anyErr?.errors?.[0]?.message ||
      anyErr?.message ||
      "BigQuery query failed";
    console.error("BQ items+inprod merge error:", err);
    return NextResponse.json<ApiError>({ error: msg }, { status: 500 });
  }
}
