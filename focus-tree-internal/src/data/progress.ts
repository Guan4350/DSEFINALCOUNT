import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { NodeStatus } from '../types';

export const PROGRESS_COLLECTION = 'internal_focus_progress';

export function progressRef(uid: string) {
  return doc(db, PROGRESS_COLLECTION, uid);
}

export async function fetchStatuses(uid: string, treeId: string): Promise<Record<string, NodeStatus>> {
  const { getDoc } = await import('firebase/firestore');
  const snap = await getDoc(progressRef(uid));
  if (!snap.exists()) return {};
  const data = snap.data() as { tree_id?: string; statuses?: Record<string, NodeStatus> };
  return data.tree_id === treeId ? (data.statuses ?? {}) : {};
}

export function watchStatuses(
  uid: string,
  treeId: string,
  next: (statuses: Record<string, NodeStatus>) => void,
  error: (cause: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    progressRef(uid),
    snap => {
      const data = snap.data() as { tree_id?: string; statuses?: Record<string, NodeStatus> } | undefined;
      next(data && data.tree_id === treeId ? (data.statuses ?? {}) : {});
    },
    cause => error(cause),
  );
}

export async function saveStatuses(
  uid: string,
  treeId: string,
  statuses: Record<string, NodeStatus>,
): Promise<void> {
  await setDoc(
    progressRef(uid),
    { tree_id: treeId, statuses, updated_at: serverTimestamp() },
    { merge: true },
  );
}
