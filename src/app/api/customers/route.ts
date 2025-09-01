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
    const project   = process.env.BQ_PROJECT!;
    const dataset   = process.env.BQ_DATASET!;
    const customers = process.env.BQ_CUSTOMERS_TABLE ?? 'kolkata_customer';
    const brokers   = process.env.BQ_TABLE_AGENTS   ?? 'kolkata_broker';

    if (!project || !dataset) {
      return NextResponse.json<ApiError>({ error: 'Missing BQ_PROJECT/BQ_DATASET' }, { status: 500 });
    }

    const C = `\`${project}.${dataset}.${customers}\``;
    const B = `\`${project}.${dataset}.${brokers}\``;

    const sql = `
      WITH base AS (
        SELECT
          c.Company_Name, c.Cust_Ved_Type, c.Area, c.City, c.State,
          c.Outstanding, c.Type, c.Broker, c.Contact_Name, c.Number, c.Created_Date
        FROM ${C} c
      ),
      joined AS (
        SELECT b.*, a.Broker_Name, a.Contact_Number
        FROM base b
        LEFT JOIN ${B} a
          ON LOWER(TRIM(b.Company_Name)) = LOWER(TRIM(a.Company_Name))
      )
      SELECT
        Company_Name, Cust_Ved_Type, Area, City, State, Outstanding, Type,
        Broker, Contact_Name, Number, Created_Date,
        COALESCE(NULLIF(TRIM(Broker), ''), NULLIF(STRING_AGG(DISTINCT Broker_Name, ', '), ''))   AS Agent_Name,
        COALESCE(NULLIF(TRIM(Number), ''), NULLIF(STRING_AGG(DISTINCT Contact_Number, ', '), '')) AS Agent_Number
      FROM joined
      GROUP BY
        Company_Name, Cust_Ved_Type, Area, City, State, Outstanding, Type,
        Broker, Contact_Name, Number, Created_Date
      ORDER BY Company_Name
    `;

    // ✅ Use the correct type for createQueryJob
    const options: BQQuery = { query: sql, useLegacySql: false };

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
