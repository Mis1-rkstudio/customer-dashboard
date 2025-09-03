// app/api/customers/route.ts
import { NextResponse } from 'next/server';
import { BigQuery, type Query as BQQuery } from '@google-cloud/bigquery';

export const runtime = 'nodejs';

type Nil<T> = T | null | undefined;

export interface AgentRow {
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

interface ApiSuccess { rows: AgentRow[] }
interface ApiError { error: string }

function makeBQ(): BigQuery {
  const key = process.env.GCLOUD_SERVICE_KEY;
  if (key) {
    const creds = JSON.parse(key);
    return new BigQuery({ projectId: process.env.BQ_PROJECT ?? creds.project_id, credentials: creds });
  }
  return new BigQuery({ projectId: process.env.BQ_PROJECT });
}

const bq = makeBQ();

export async function GET() {
  try {
    const project = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
    const customersTableName = process.env.BQ_CUSTOMERS_TABLE ?? 'kolkata_broker';

    if (!project || !dataset) {
      return NextResponse.json<ApiError>({ error: 'Missing BQ_PROJECT/BQ_DATASET' }, { status: 500 });
    }

    // fully-qualified table name, escaped with backticks
    const customersTable = `\`${project}.${dataset}.${customersTableName}\``;

    const sql = `
      SELECT
        Broker_Name as Agent_Name,
        Contact_Number as Agent_Number,
        Email,
        City,
        GST_number,
        Created_By,
        Created_Date
      FROM ${customersTable}
    `;

    // typed options for createQueryJob
    const options: BQQuery = { query: sql, useLegacySql: false };

    const [job] = await bq.createQueryJob(options);
    const [rows] = (await job.getQueryResults()) as [AgentRow[]];

    return NextResponse.json<ApiSuccess>({ rows }, { status: 200 });
  } catch (err: unknown) {
    const anyErr = err as { errors?: { message?: string }[]; message?: string };
    const msg = anyErr?.errors?.[0]?.message || anyErr?.message || 'BigQuery query failed';
    console.error('BQ customers query error:', err);
    return NextResponse.json<ApiError>({ error: msg }, { status: 500 });
  }
}
