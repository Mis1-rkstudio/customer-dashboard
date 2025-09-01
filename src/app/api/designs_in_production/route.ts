import { getBQClient } from "@/server/bq-handler";

export async function GET() {
  try {
    const bq = getBQClient();

    const project = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
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
    const query = `SELECT * FROM ${tableRef} WHERE LOWER(stage) LIKE '%production%' AND LOWER(jobslip_status) LIKE '%pending%'`;

    const [job] = await bq.createQueryJob({
      query,
      useLegacySql: false,
      jobTimeoutMs: 120000,
    });

    const [rows] = await job.getQueryResults();

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("BQ grouping error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
