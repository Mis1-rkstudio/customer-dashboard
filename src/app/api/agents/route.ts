import { getBQClient } from "@/server/bq-handler";

export async function GET(): Promise<Response> {
  try {
    const bq = getBQClient();
    const dataset = process.env.BQ_DATASET;

    if (!dataset) {
      return new Response(JSON.stringify({ error: 'Missing BQ_DATASET env var' }), { status: 400 });
    }

    const query = `SELECT * FROM \`${process.env.BQ_PROJECT}.${dataset}\`.kolkata_broker`;
    const [job] = await bq.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return new Response(JSON.stringify({ rows }), { status: 200 });
  } catch (err: unknown) {
    // Narrow unknown -> extract a safe message
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
