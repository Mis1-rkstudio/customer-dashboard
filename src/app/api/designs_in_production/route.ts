

import { getBQClient } from "@/server/bq-handler";

export async function GET() {
  try {
    const bq = getBQClient();
    const dataset = process.env.BQ_DATASET;
    if (!dataset) {
      return new Response(JSON.stringify({ error: 'Missing BQ_DATASET env var' }), { status: 400 });
    }

    const table = `\`round-kit-450201-r9.frono.Vastra_clean\``;

    // case-insensitive match for stage LIKE '%production%' and jobslip_status LIKE '%pending%'
    const query = `SELECT * FROM \`${process.env.BQ_PROJECT}\`.frono.Vastra_clean WHERE stage LIKE '%Production%' AND jobslip_status LIKE '%Pending%'`;

    const [job] = await bq.createQueryJob({
      query,
      useLegacySql: false,
      timeoutMs: 120000,
    });

    const [rows] = await job.getQueryResults();

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('BQ grouping error:', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
}

