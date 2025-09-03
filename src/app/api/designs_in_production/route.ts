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
    const project = process.env.BQ_PROJECT;
    const dataset = "frono";
    const tableName = process.env.BQ_TABLE ?? "Vastra_clean";

    if (!project || !dataset) {
      return new Response(
        JSON.stringify({ error: "Missing BQ_PROJECT or BQ_DATASET env var" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // fully-qualified table name: `project.dataset.table`
    const tableRef = `\`${project}.${dataset}.${tableName}\``;

    // case-insensitive match for stage LIKE '%production%' and jobslip_status LIKE '%pending%'
    const sql = `SELECT * FROM ${tableRef} WHERE LOWER(stage) LIKE '%production%' AND LOWER(jobslip_status) LIKE '%pending%'`;


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
