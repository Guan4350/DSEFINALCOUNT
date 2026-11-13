import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();

/** 管理員判定沿用現有 admins/{uid}.active 模型。 */
export async function assertAdmin(uid: string | undefined): Promise<string> {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'E_NOT_ADMIN');
  }
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.get('active') !== true) {
    throw new HttpsError('permission-denied', 'E_NOT_ADMIN');
  }
  return uid;
}
