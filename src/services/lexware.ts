import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import { get as httpsGet } from 'node:https';
import { createPublicKey } from 'node:crypto';
import { LEXWARE_API_BASE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';
import { LexwareLegacyError, LexwareStandardError } from '../types/common.js';

function getToken(): string {
  const token = process.env.LEXWARE_API_TOKEN;
  if (!token) {
    throw new Error(
      'LEXWARE_API_TOKEN environment variable is required. ' +
      'Get your token from https://app.lexware.io/settings/public-api'
    );
  }
  return token;
}

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: LEXWARE_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 429) {
        const config = error.config;
        if (!config) return Promise.reject(error);

        const retryCount = ((config as unknown as Record<string, unknown>).__retryCount as number) || 0;
        if (retryCount >= MAX_RETRIES) {
          return Promise.reject(new Error('Rate limit exceeded after maximum retries'));
        }

        const retryAfter = error.response.headers['retry-after'];
        let delay: number;

        if (retryAfter) {
          delay = parseInt(retryAfter, 10) * 1000;
        } else {
          delay = Math.pow(2, retryCount) * 1000;
        }

        (config as unknown as Record<string, unknown>).__retryCount = retryCount + 1;
        console.error(`[lexware-mcp] Rate limited. Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);

        await new Promise((resolve) => setTimeout(resolve, delay));
        return client.request(config);
      }

      return Promise.reject(error);
    }
  );

  return client;
}

let clientInstance: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function formatError(err: AxiosError): Error {
  if (!err.response) {
    return new Error(`Network error: ${err.message}`);
  }

  const body = err.response.data;

  // Legacy error format (contacts, files, vouchers)
  const legacy = body as LexwareLegacyError | undefined;
  if (legacy?.IssueList?.length) {
    const issues = legacy.IssueList.map(
      (i) => `[${i.type}] ${i.source}: ${i.i18nKey}`
    ).join('; ');
    return new Error(`Lexware API validation error: ${issues}`);
  }

  // Standard error format
  const standard = body as LexwareStandardError | undefined;
  if (standard?.message) {
    return new Error(`Lexware API [${standard.status}]: ${standard.message}`);
  }

  return new Error(`Lexware API error: ${err.response.status} ${err.response.statusText}`);
}

export async function lexwareRequest<T = unknown>(
  method: Method,
  path: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const client = getClient();
    const response = await client.request<T>({
      method,
      url: path,
      data,
      params: params ? stripUndefined(params) : undefined,
    });
    return response.data;
  } catch (err) {
    if (err instanceof AxiosError && err.response) {
      throw formatError(err);
    }
    if (err instanceof AxiosError && err.code) {
      throw new Error(`Network error: ${err.message}`);
    }
    throw err;
  }
}

export async function lexwareUpload<T = unknown>(
  path: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<T> {
  const client = getClient();
  // GOTCHA: Dynamic import — won't fail at compile time if form-data is missing, only at runtime.
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName, contentType });

  const response = await client.request<T>({
    method: 'POST',
    url: path,
    data: form,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${getToken()}`,
    },
  });
  return response.data;
}

const WEBHOOK_PUBLIC_KEY_URL =
  'https://developers.lexware.io/webhookSignature/public/public_key.pub';

// Cache the in-flight Promise (single-flight) so concurrent first callers
// share one network fetch. Cleared on rejection so the next call retries.
let webhookKeyCache: Promise<string> | null = null;

export function getWebhookPublicKey(): Promise<string> {
  const override = process.env.LEXWARE_WEBHOOK_PUBLIC_KEY;
  if (override) return Promise.resolve(override);
  if (webhookKeyCache) return webhookKeyCache;

  const pending = fetchAndValidatePublicKey().catch((err) => {
    if (webhookKeyCache === pending) webhookKeyCache = null;
    throw err;
  });
  webhookKeyCache = pending;
  return pending;
}

function fetchAndValidatePublicKey(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = httpsGet(WEBHOOK_PUBLIC_KEY_URL, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Public key fetch failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const pem = Buffer.concat(chunks).toString('utf8');
        try {
          createPublicKey(pem);
        } catch {
          reject(new Error('Public key fetch returned invalid PEM'));
          return;
        }
        resolve(pem);
      });
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT, () => req.destroy(new Error('Public key fetch timed out')));
    req.on('error', reject);
  });
}

// Test-only: reset cached webhook key. Underscore-prefixed to signal internal use.
export function __resetWebhookKeyCache(): void {
  webhookKeyCache = null;
}

export async function lexwareDownload(
  path: string
): Promise<{ data: Buffer; contentType: string; fileName?: string }> {
  const client = getClient();
  const response = await client.request({
    method: 'GET',
    url: path,
    responseType: 'arraybuffer',
    headers: {
      Accept: 'application/pdf',
    },
  });

  const contentDisposition = response.headers['content-disposition'] as string | undefined;
  let fileName: string | undefined;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
    if (match) fileName = match[1];
  }

  return {
    data: Buffer.from(response.data as ArrayBuffer),
    contentType: (response.headers['content-type'] as string) || 'application/octet-stream',
    fileName,
  };
}
