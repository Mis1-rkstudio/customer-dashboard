import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs';
import path from 'path';

let cachedClient = null;

function loadCredentialsFromFile() {
  const keyFileEnv = process.env.GCLOUD_KEY_FILE;
  const adcEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (adcEnv) {
    if (fs.existsSync(adcEnv)) return { useADC: true, path: adcEnv };
  }

  const candidate = keyFileEnv || path.resolve(process.cwd(), 'key.json');
  if (!fs.existsSync(candidate)) return null;

  const raw = fs.readFileSync(candidate, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return { useADC: false, credentials: parsed, path: candidate };
  } catch (err) {
    throw new Error(`Invalid JSON in key file at ${candidate}: ${err.message}`);
  }
}

export function getBQClient() {
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

  cachedClient = new BigQuery({
    projectId,
    credentials: fileLoad.credentials,
  });

  return cachedClient;
}