// src/server/bq-handler.ts
import { BigQuery } from "@google-cloud/bigquery";

type ServiceAccountCreds = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/**
 * Return a BigQuery client using either:
 * - full JSON credentials in GCLOUD_SERVICE_KEY (recommended for CI/servers),
 * - or environment BQ_PROJECT (and ADC if available).
 *
 * This function is safe to call at runtime and will throw if credentials are malformed.
 */
export function getBQClient(): BigQuery {
  const rawKey = process.env.GCLOUD_SERVICE_KEY;
  if (rawKey) {
    try {
      const parsed: unknown = JSON.parse(rawKey);

      if (!isRecord(parsed)) {
        throw new Error("GCLOUD_SERVICE_KEY did not parse to an object");
      }

      const clientEmail = asString(parsed.client_email ?? parsed["client_email"]);
      const privateKey = asString(parsed.private_key ?? parsed["private_key"]);
      const projectIdFromCreds = asString(parsed.project_id ?? parsed["project_id"]);

      if (!clientEmail || !privateKey) {
        throw new Error("GCLOUD_SERVICE_KEY missing client_email or private_key");
      }

      const projectId = process.env.BQ_PROJECT ?? projectIdFromCreds;

      return new BigQuery({
        projectId,
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        } as ServiceAccountCreds,
      });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("Invalid GCLOUD_SERVICE_KEY JSON:", err);
      throw err;
    }
  }

  // Fallback: rely on environment/ADC
  const projectId = process.env.BQ_PROJECT;
  if (!projectId) {
    // Useful to fail early if nothing is provided
    throw new Error("Missing BQ_PROJECT and GCLOUD_SERVICE_KEY; cannot create BigQuery client.");
  }

  return new BigQuery({ projectId });
}
