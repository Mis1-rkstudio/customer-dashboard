// app/api/customers/route.ts
import { NextResponse } from 'next/server';
import { BigQuery, type Query as BQQuery } from '@google-cloud/bigquery';

export const runtime = 'nodejs';

type Nil<T> = T | null | undefined;

export interface CustomerWithAgentRow {
  Company_Name: string;
  Cust_Ved_Type?: Nil<string>;
  Area?: Nil<string>;
  City?: Nil<string>;
  State?: Nil<string>;
  Outstanding?: Nil<number>;
  Type?: Nil<string>;
  Broker?: Nil<string>;
  Contact_Name?: Nil<string>;
  Number?: Nil<string>;
  Created_Date?: Nil<string>;
  Agent_Name?: Nil<string>;
  Agent_Number?: Nil<string>;
}

interface ApiSuccess { rows: CustomerWithAgentRow[] }
interface ApiError { error: string }

function makeBQ(): BigQuery {
  const key = process.env.GCLOUD_SERVICE_KEY;
  if (key) {
    const creds = JSON.parse(key);
    return new BigQuery({ projectId: process.env.BQ_PROJECT || creds.project_id, credentials: creds });
  }
  return new BigQuery({ projectId: process.env.BQ_PROJECT });
}

const bq = makeBQ();

export async function GET() {
  try {
    const project = process.env.BQ_PROJECT!;
    const dataset = process.env.BQ_DATASET!;

    if (!project || !dataset) {
      return NextResponse.json<ApiError>({ error: 'Missing BQ_PROJECT/BQ_DATASET' }, { status: 500 });
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

    // ✅ Use the correct type for createQueryJob
    const options: BQQuery = { query: query, useLegacySql: false };

    const [job] = await bq.createQueryJob(options);
    const [rows] = (await job.getQueryResults()) as [CustomerWithAgentRow[]];

    return NextResponse.json<ApiSuccess>({ rows }, { status: 200 });
  } catch (err: unknown) {
    const anyErr = err as { errors?: { message?: string }[]; message?: string };
    const msg = anyErr?.errors?.[0]?.message || anyErr?.message || 'BigQuery query failed';
    console.error('BQ customers join error:', err);
    return NextResponse.json<ApiError>({ error: msg }, { status: 500 });
  }
}
