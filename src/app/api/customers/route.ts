// src/app/api/customers/route.ts
import type { Job } from '@google-cloud/bigquery';
import { getBQClient } from '@/server/bq-handler';

function isJobLike(v: unknown): v is Job {
  return typeof v === 'object' && v !== null && 'getQueryResults' in v && typeof (v as Record<string, unknown>)['getQueryResults'] === 'function';
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
      -- your full SQL here, using ${stockTable} and ${detailsTable}
    `;

    // Await the library call and treat the result as unknown first
    const createdRaw = (await bq.createQueryJob({
      query,
      useLegacySql: false,
      jobTimeoutMs: 120_000, // <-- fixed: use jobTimeoutMs (BigQuery API)
    })) as unknown;

    // Normalize to a Job instance in a type-safe way
    let job: Job;
    if (Array.isArray(createdRaw) && createdRaw.length > 0) {
      // common case: [Job, apiResponse?]
      job = createdRaw[0] as Job;
    } else if (isJobLike(createdRaw)) {
      // some overloads / runtime shapes return the Job directly
      job = createdRaw;
    } else {
      throw new Error('Unexpected BigQuery createQueryJob response shape');
    }

    // getQueryResults returns a tuple; annotate rows as unknown[] to avoid implicit any
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
