// src/server/bq-handler.ts
import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs';
import path from 'path';

type ServiceAccount = {
  type?: string;
  project_id?: string;
  private_key: string;
  client_email: string;
  [k: string]: unknown; // allow other fields but don't use `any`
};

type CredLoad =
  | { useADC: true; path?: string }
  | { useADC: false; credentials: ServiceAccount; source: 'env' | 'file' }
  | null;

/** cached BigQuery client to reuse across invocations */
let cachedClient: BigQuery | null = null;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function looksLikeServiceAccount(v: unknown): v is ServiceAccount {
  if (!isObject(v)) return false;
  const maybe = v as Record<string, unknown>;
  return typeof maybe.client_email === 'string' && typeof maybe.private_key === 'string';
}

function loadCredentials(): CredLoad {
  // Prefer explicit JSON provided via env var (GCLOUD_SERVICE_KEY)
  const keyEnv = process.env.GCLOUD_SERVICE_KEY;
  if (keyEnv) {
    try {
      // Try direct JSON first
      const parsed = JSON.parse(keyEnv);
      if (!looksLikeServiceAccount(parsed)) {
        throw new Error('Env JSON does not look like service account');
      }
      return { useADC: false, credentials: parsed as ServiceAccount, source: 'env' };
    } catch (_) {
      // If not JSON, try base64 -> JSON
      try {
        const buf = Buffer.from(keyEnv, 'base64');
        const decoded = buf.toString('utf8');
        const parsed = JSON.parse(decoded);
        if (!looksLikeServiceAccount(parsed)) {
          throw new Error('Decoded JSON does not look like service account');
        }
        return { useADC: false, credentials: parsed as ServiceAccount, source: 'env' };
      } catch (e) {
        throw new Error('GCLOUD_SERVICE_KEY is neither JSON nor base64-encoded JSON');
      }
    }
  }

  const keyFileEnv = process.env.GCLOUD_KEY_FILE;
  const adcEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  // If GOOGLE_APPLICATION_CREDENTIALS is set and file exists, use ADC
  if (adcEnv) {
    if (fs.existsSync(adcEnv)) return { useADC: true, path: adcEnv };
  }

  // Otherwise look for provided key file or fallback to project root key file
  const candidate = keyFileEnv || path.resolve(process.cwd(), 'bigquery_key.json');
  if (!fs.existsSync(candidate)) return null;

  const raw = fs.readFileSync(candidate, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!looksLikeServiceAccount(parsed)) {
      throw new Error('Credential JSON does not look like a service account (missing client_email/private_key)');
    }
    return { useADC: false, credentials: parsed as ServiceAccount, source: 'file' };
  } catch (errUnknown) {
    const msg = errUnknown instanceof Error ? errUnknown.message : String(errUnknown);
    throw new Error(`Invalid JSON in key file at ${candidate}: ${msg}`);
  }
}

/**
 * Return a cached BigQuery client (singleton-like).
 * Throws if required env vars / credentials are missing.
 */
export function getBQClient(): BigQuery {
  if (cachedClient) return cachedClient;

  const projectId = process.env.BQ_PROJECT || process.env.BQ_PROJECT_ID;
  if (!projectId) throw new Error('Missing required env var BQ_PROJECT (or BQ_PROJECT_ID)');

  const credLoad = loadCredentials();
  if (credLoad === null) {
    throw new Error(
      'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, ' +
      'or set GCLOUD_SERVICE_KEY to JSON (or base64 JSON), or set GCLOUD_KEY_FILE (or place bigquery_key.json in project root).'
    );
  }

  if (credLoad.useADC) {
    cachedClient = new BigQuery({ projectId });
    return cachedClient;
  }

  // fileLoad.credentials is now strongly typed as ServiceAccount
  cachedClient = new BigQuery({
    projectId,
    credentials: {
      client_email: credLoad.credentials.client_email,
      private_key: credLoad.credentials.private_key,
    },
  });

  return cachedClient;
}
