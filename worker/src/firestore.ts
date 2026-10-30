import { SignJWT, importPKCS8 } from 'jose';
import type { Env, FirestoreDocument, FirestoreValue } from './types';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

function parseServiceAccount(env: Env): ServiceAccount {
  const raw = env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');
  let json = raw.trim();
  if (!json.startsWith('{')) {
    try {
      json = atob(json);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be JSON or base64-encoded JSON.');
    }
  }
  const parsed = JSON.parse(json) as ServiceAccount;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.');
  }
  return parsed;
}

export async function getAccessToken(env: Env): Promise<string> {
  const account = parseServiceAccount(env);
  const cacheKey = `${account.project_id}:${account.client_email}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const privateKey = await importPKCS8(account.private_key.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`);
  const payload = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  });
  return payload.access_token;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function fullDocumentName(env: Env, path: string): string {
  const base = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const encoded = encodePath(path);
  return encoded ? `${base}/${encoded}` : base;
}

export function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) fields[key] = toFirestoreValue(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, item] of Object.entries(value)) fields[key] = toFirestoreValue(item);
  return fields;
}

export function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  return undefined;
}

export function fromFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = fromFirestoreValue(value);
  return out;
}

export class Firestore {
  private tokenPromise: Promise<string> | null = null;

  constructor(private env: Env) {}

  private async token(): Promise<string> {
    if (!this.tokenPromise) this.tokenPromise = getAccessToken(this.env);
    return this.tokenPromise;
  }

  private async api(path: string, init: RequestInit = {}, allowNotFound = false): Promise<Response> {
    const token = await this.token();
    const base = `https://firestore.googleapis.com/v1/projects/${this.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const url = path.startsWith(':') ? `${base}${path}` : `${base}/${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      const body = await response.text();
      throw new Error(`Firestore ${init.method || 'GET'} ${path} failed (${response.status}): ${body.slice(0, 400)}`);
    }
    return response;
  }

  async get(path: string, transaction?: string): Promise<FirestoreDocument | null> {
    const suffix = transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
    const response = await this.api(`${encodePath(path)}${suffix}`, {}, true);
    if (response.status === 404) return null;
    return (await response.json()) as FirestoreDocument;
  }

  async list(collectionPath: string, limit = 200): Promise<FirestoreDocument[]> {
    const response = await this.api(`${encodePath(collectionPath)}?pageSize=${limit}`);
    const payload = (await response.json()) as { documents?: FirestoreDocument[] };
    return payload.documents || [];
  }

  async runQuery(parentPath: string, structuredQuery: Record<string, unknown>): Promise<FirestoreDocument[]> {
    const response = await this.api(':runQuery', {
      method: 'POST',
      body: JSON.stringify({
        parent: fullDocumentName(this.env, parentPath),
        structuredQuery,
      }),
    });
    const payload = (await response.json()) as Array<{ document?: FirestoreDocument }>;
    return payload.map((item) => item.document).filter((item): item is FirestoreDocument => Boolean(item));
  }

  async beginTransaction(): Promise<string> {
    const response = await this.api(':beginTransaction', {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const payload = (await response.json()) as { transaction: string };
    return payload.transaction;
  }

  async commit(transaction: string, writes: Record<string, unknown>[]): Promise<void> {
    await this.api(':commit', {
      method: 'POST',
      body: JSON.stringify({ transaction, writes }),
    });
  }

  updateWrite(path: string, fields: Record<string, unknown>, options?: { exists?: boolean }): Record<string, unknown> {
    const write: Record<string, unknown> = {
      update: {
        name: fullDocumentName(this.env, path),
        fields: toFields(fields),
      },
      updateMask: { fieldPaths: Object.keys(fields) },
    };
    if (options?.exists === false) write.currentDocument = { exists: false };
    if (options?.exists === true) write.currentDocument = { exists: true };
    return write;
  }

  deleteWrite(path: string): Record<string, unknown> {
    return { delete: fullDocumentName(this.env, path) };
  }

  async patch(path: string, fields: Record<string, unknown>, options?: { exists?: boolean }): Promise<void> {
    const token = await this.token();
    const url = `https://firestore.googleapis.com/v1/projects/${this.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodePath(path)}`;
    const params = new URLSearchParams();
    for (const key of Object.keys(fields)) params.append('updateMask.fieldPaths', key);
    const response = await fetch(`${url}?${params.toString()}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFields(fields) }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Firestore PATCH ${path} failed (${response.status}): ${body.slice(0, 400)}`);
    }
    void options;
  }

  async delete(path: string): Promise<void> {
    await this.api(encodePath(path), { method: 'DELETE' });
  }
}

export function docIdFromName(name: string): string {
  return name.split('/').pop() || '';
}

export function getString(data: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof data[key] === 'string' ? (data[key] as string) : fallback;
}

export function getNumber(data: Record<string, unknown>, key: string, fallback = 0): number {
  return typeof data[key] === 'number' ? (data[key] as number) : fallback;
}

export function getBool(data: Record<string, unknown>, key: string, fallback = false): boolean {
  return typeof data[key] === 'boolean' ? (data[key] as boolean) : fallback;
}
