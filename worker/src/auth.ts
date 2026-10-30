import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env, FirebaseUser } from './types';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(projectId: string) {
  let set = jwksCache.get(projectId);
  if (!set) {
    set = createRemoteJWKSet(
      new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
    );
    jwksCache.set(projectId, set);
  }
  return set;
}

export async function verifyFirebaseRequest(request: Request, env: Env): Promise<FirebaseUser> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new Error('Missing Firebase ID token.');
  if (!env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is not configured.');

  const verified = await jwtVerify(token, jwks(env.FIREBASE_PROJECT_ID), {
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
  });
  const uid = verified.payload.sub;
  if (!uid) throw new Error('Firebase token has no subject.');
  return {
    uid,
    email: typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
    name: typeof verified.payload.name === 'string' ? verified.payload.name : undefined,
    picture: typeof verified.payload.picture === 'string' ? verified.payload.picture : undefined,
  };
}
