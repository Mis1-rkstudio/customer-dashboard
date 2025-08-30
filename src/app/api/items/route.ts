import { getBQClient } from "@/server/bq-handler";

export async function GET() {
  try {
    const bq = getBQClient();
    const dataset = process.env.BQ_DATASET;
    if (!dataset) {
      return new Response(JSON.stringify({ error: 'Missing BQ_DATASET env var' }), { status: 400 });
    }

    // details dataset can be overridden if Sample_details lives elsewhere
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

        -- cleaned File_URL: remove the specific suffix '/view?usp=drivesdk' if present
        REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', '') AS File_URL,

        -- details renamed (Concept_2 -> Concept, Concept_3 -> Fabric)
        ANY_VALUE(s.Product_Code) AS Product_Code,
        ANY_VALUE(s.Concept_2) AS Concept,
        ANY_VALUE(s.Concept_3) AS Fabric,

        -- extract file id from the cleaned URL (if it matches /d/<id>/)
        REGEXP_EXTRACT(REPLACE(ANY_VALUE(s.File_URL), '/view?usp=drivesdk', ''), r'/d/([^/]+)') AS FileId,

        -- use the cleaned url to build a Drive thumbnail link (nullable)
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
