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

type FileLoad =
  | { useADC: true; path: string }
  | { useADC: false; credentials: ServiceAccount; path: string }
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

function loadCredentialsFromFile(): FileLoad {
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
    return { useADC: false, credentials: parsed as ServiceAccount, path: candidate };
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

  const projectId = process.env.BQ_PROJECT;
  if (!projectId) throw new Error('Missing required env var BQ_PROJECT');

  const fileLoad = loadCredentialsFromFile();
  if (fileLoad === null) {
    throw new Error(
      'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, ' +
      'or set GCLOUD_KEY_FILE (or place key.json in project root).'
    );
  }

  if (fileLoad.useADC) {
    cachedClient = new BigQuery({ projectId });
    return cachedClient;
  }

  // fileLoad.credentials is now strongly typed as ServiceAccount
  cachedClient = new BigQuery({
    projectId,
    credentials: {
      client_email: fileLoad.credentials.client_email,
      private_key: fileLoad.credentials.private_key,
    },
  });

  return cachedClient;
}
