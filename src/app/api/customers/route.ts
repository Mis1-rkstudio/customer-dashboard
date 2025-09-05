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
  // Support either raw JSON in GCLOUD_SERVICE_KEY or base64-encoded JSON in
  // GCLOUD_SERVICE_KEY_B64. If neither is present we'll fall back to ADC.
  const raw = process.env.GCLOUD_SERVICE_KEY;
  const rawB64 = process.env.GCLOUD_SERVICE_KEY_B64;

  if (raw) {
    try {
      const creds = JSON.parse(raw);
      return new BigQuery({ projectId: process.env.BQ_PROJECT ?? creds.project_id, credentials: creds });
    } catch (e) {
      console.error('Failed to parse GCLOUD_SERVICE_KEY JSON:', e);
      // fall through and try other sources
    }
  }

  if (rawB64) {
    try {
      const decoded = Buffer.from(rawB64, 'base64').toString('utf8');
      const creds = JSON.parse(decoded);
      return new BigQuery({ projectId: process.env.BQ_PROJECT ?? creds.project_id, credentials: creds });
    } catch (e) {
      console.error('Failed to parse GCLOUD_SERVICE_KEY_B64:', e);
    }
  }

  // Last resort: rely on Application Default Credentials or the environment
  return new BigQuery({ projectId: process.env.BQ_PROJECT });
}

const bq = makeBQ();

export async function GET() {
  try {
    const project = process.env.BQ_PROJECT!;
    const dataset = process.env.BQ_DATASET!;
    const customers = process.env.BQ_CUSTOMERS_TABLE ?? 'kolkata_customer';
    const brokers = process.env.BQ_TABLE_AGENTS ?? 'kolkata_broker';

    if (!project || !dataset) {
      return NextResponse.json<ApiError>({ error: 'Missing BQ_PROJECT/BQ_DATASET' }, { status: 500 });
    }

    const C = \${project}.${dataset}.${customers}\``;
    const B = \${project}.${dataset}.${brokers}\``;

    const sql = `
      WITH base AS (
        SELECT
          c.Company_Name,
          c.Cust_Ved_Type,
          c.Number,
          c.Area,
          c.City,
          c.State,
          c.Outstanding,
          c.Type,
          c.Broker,
          c.Contact_Name,
          c.Created_Date
        FROM ${C} c
      )
      SELECT
        b.Company_Name,
        b.Cust_Ved_Type,
        b.Area,
        b.City,
        b.State,
        b.Outstanding,
        b.Type,
        b.Broker,
        b.Contact_Name,
        b.Number,
        b.Created_Date,
        COALESCE(
          NULLIF(TRIM(b.Broker), ''),
          NULLIF(STRING_AGG(DISTINCT a.Company_Name, ', '), '')
        ) AS Agent_Name,
        COALESCE(
          NULLIF(TRIM(b.Number), ''),
          NULLIF(STRING_AGG(DISTINCT a.Contact_Number, ', '), '')
        ) AS Agent_Number
      FROM base b
      LEFT JOIN ${B} a
        ON LOWER(TRIM(b.Broker)) = LOWER(TRIM(a.Company_Name))
      GROUP BY
        b.Company_Name,
        b.Cust_Ved_Type,
        b.Area,
        b.City,
        b.State,
        b.Outstanding,
        b.Type,
        b.Broker,
        b.Contact_Name,
        b.Number,
        b.Created_Date
      ORDER BY b.Company_Name
    `;


    // ✅ Use the correct type for createQueryJob
    const options: BQQuery = {
      query: sql,
      useLegacySql: false,
      location: process.env.BQ_LOCATION ?? 'US',
    };

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