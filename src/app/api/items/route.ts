// src/app/api/items/route.ts  (or wherever this handler lives)
import type { Job } from '@google-cloud/bigquery';
import { getBQClient } from '@/server/bq-handler';

function isJobLike(v: unknown): v is Job {
  return typeof v === 'object' && v !== null && typeof (v as Job).getQueryResults === 'function';
}

export async function GET(): Promise<Response> {
  try {
    const bq = getBQClient();
    const dataset = process.env.BQ_DATASET;
    if (!dataset) {
      return new Response(JSON.stringify({ error: 'Missing BQ_DATASET env var' }), { status: 400 });
    }

    const detailsDataset = process.env.BQ_DETAILS_DATASET || 'frono';

    const stockTable = `\`${process.env.BQ_PROJECT}.${dataset}.kolkata_stock\``;
    const detailsTable = `\`${process.env.BQ_PROJECT}.${detailsDataset}.Sample_details\``;

    const query = `
      WITH grouped AS (
        SELECT
          Item,
          ARRAY_AGG(TRIM(Color) IGNORE NULLS) AS color_arr,
          ARRAY_AGG(TRIM(Size) IGNORE NULLS) AS size_arr,
          SUM(COALESCE(SAFE_CAST(Opening_Stock AS INT64), 0)) AS Opening_Stock,
          SUM(COALESCE(SAFE_CAST(Stock_In AS INT64), 0)) AS Stock_In,
          SUM(COALESCE(SAFE_CAST(Stock_Out AS INT64), 0)) AS Stock_Out,
          SUM(COALESCE(SAFE_CAST(Closing_Stock AS INT64), 0)) AS Closing_Stock
        FROM ${stockTable}
        GROUP BY Item
      )

      SELECT
        g.Item,

        ARRAY(
          SELECT DISTINCT col
          FROM UNNEST(g.color_arr) AS col
          WHERE col IS NOT NULL AND LOWER(TRIM(col)) NOT IN ('', 'nan', 'null')
        ) AS Colors,

        ARRAY(
          SELECT DISTINCT sz
          FROM UNNEST(g.size_arr) AS sz
          WHERE sz IS NOT NULL AND LOWER(TRIM(sz)) NOT IN ('', 'nan', 'null')
        ) AS Sizes,

        g.Opening_Stock,
        g.Stock_In,
        g.Stock_Out,
        g.Closing_Stock,

        REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', '') AS File_URL,

        ANY_VALUE(s.Product_Code) AS Product_Code,
        ANY_VALUE(s.Concept_2) AS Concept,
        ANY_VALUE(s.Concept_3) AS Fabric,

        REGEXP_EXTRACT(REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', ''), r'/d/([^/]+)') AS FileId,

        IFNULL(
          CONCAT('https://drive.google.com/thumbnail?id=', REGEXP_EXTRACT(REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', ''), r'/d/([^/]+)')),
          NULL
        ) AS Thumbnail_URL

      FROM grouped g
      LEFT JOIN ${detailsTable} s
        ON TRIM(g.Item) = TRIM(s.Product_Code)
      GROUP BY
        g.Item,
        g.Opening_Stock,
        g.Stock_In,
        g.Stock_Out,
        g.Closing_Stock,
        g.color_arr,
        g.size_arr
      ORDER BY g.Item
    `;

    // call library and treat result as unknown first (some overloads return [Job,...], some return Job)
    const createdRaw = (await bq.createQueryJob({
      query,
      useLegacySql: false,
      jobTimeoutMs: 120_000, // correct option name for BigQuery
    })) as unknown;

    // Narrow to Job in a type-safe manner
    let job: Job;
    if (Array.isArray(createdRaw) && createdRaw.length > 0) {
      job = createdRaw[0] as Job;
    } else if (isJobLike(createdRaw)) {
      job = createdRaw;
    } else {
      throw new Error('Unexpected BigQuery createQueryJob response shape');
    }

    // getQueryResults returns a tuple [rows, apiResponse?]
    const resultTuple = (await job.getQueryResults()) as [unknown[], unknown?];
    const rows = resultTuple[0];

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('BQ grouping error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
