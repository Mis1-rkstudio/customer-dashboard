// app/api/designs_in_production/route.ts
import { NextResponse } from "next/server";
import { BigQuery, type Query as BQQuery } from "@google-cloud/bigquery";

export const runtime = "nodejs";

type InProdRow = {
  Product_Code: string;
  Color?: string[] | null;
  Quantity?: number | null;
};

function makeBQ(): BigQuery {
  const key = process.env.GCLOUD_SERVICE_KEY;
  if (key) {
    const creds = JSON.parse(key);
    return new BigQuery({
      projectId: process.env.BQ_PROJECT || creds.project_id,
      credentials: creds,
    });
  }
  return new BigQuery({ projectId: process.env.BQ_PROJECT });
}

const bq = makeBQ();

export async function GET() {
  try {
    const project = process.env.BQ_PROJECT;
    const dataset = "frono";
    const tableName = process.env.BQ_TABLE || "in_prod_design";

    if (!project || !dataset) {
      return NextResponse.json(
        { error: "Missing BQ_PROJECT or BQ_DATASET env var" },
        { status: 400 }
      );
    }

    const tableRef = `\`${project}.${dataset}.${tableName}\``;

    // Aggregate by design number, return distinct trimmed colors as an array,
    // and sum the quantities. Filter out empty design_no and only return rows with total qty > 0.
    const sql = `
      SELECT
        Product_Code,
        Colors AS Color,
        Quantity
      FROM (
        SELECT
          TRIM(CAST(Design_no AS STRING)) AS Product_Code,
          ARRAY_AGG(DISTINCT TRIM(Color) IGNORE NULLS) AS Colors,
          SUM(COALESCE(CAST(Quantity AS INT64), 0)) AS Quantity
        FROM ${tableRef}
        WHERE TRIM(CAST(Design_no AS STRING)) <> ''
        GROUP BY TRIM(CAST(Design_no AS STRING))
      ) AS agg
      WHERE Quantity > 0
      ORDER BY Product_Code
    `;

    const options: BQQuery = { query: sql, useLegacySql: false };
    const [job] = await bq.createQueryJob(options);
    const [rowsRaw] = (await job.getQueryResults()) as [unknown[]];

    // Normalize returned rows so Color is always an array (and Quantity is a number if possible)
    const rows = (rowsRaw || []).map((r): InProdRow => {
      const rec =
        r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      const prod = String(rec["Product_Code"] ?? "").trim();
      let colors: string[] = [];
      const rawColors = rec["Color"] ?? rec["Colors"] ?? null;
      if (Array.isArray(rawColors)) {
        colors = rawColors.map((c) => String(c ?? "").trim()).filter(Boolean);
      } else if (rawColors != null) {
        // sometimes BigQuery returns a single value
        const c = String(rawColors ?? "").trim();
        if (c) colors = [c];
      }

      // Quantity may be a string (INT64) or number; coerce to Number (or null)
      const qtyRaw = rec["Quantity"] ?? null;
      const qtyNum =
        qtyRaw === null || qtyRaw === undefined ? null : Number(qtyRaw);
      const qty = Number.isFinite(qtyNum) ? qtyNum : null;

      return {
        Product_Code: prod,
        Color: colors,
        Quantity: qty,
      };
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: unknown) {
    const anyErr = err as { errors?: { message?: string }[]; message?: string };
    const msg =
      anyErr?.errors?.[0]?.message ??
      anyErr?.message ??
      "BigQuery query failed";
    console.error("BQ designs_in_production error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
