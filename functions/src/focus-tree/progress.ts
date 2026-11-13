import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import {
  COEFFICIENT,
  NODE_ID_PATTERN,
  TREE_ID_PATTERN,
  progressDocId,
  type FocusNode,
  type ProgressItem,
  type ProgressStatus,
  type TreeMeta,
} from './schema';

const REGION = 'asia-east1';

interface TreeBundle {
  meta: TreeMeta;
  nodes: FocusNode[];
}

interface TreeSnapshot {
  denominator: number;
  earned: number;
  percent: number;
  items: ProgressItem[];
  unlockedNodeIds: string[];
  lockedReasons: Record<string, string[]>;
}

type ProgressMap = Map<string, { status: ProgressStatus; masteredAt: string | null }>;

async function readTree(treeId: string): Promise<TreeBundle> {
  const snap = await db.doc(`focus_trees/${treeId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
  }
  const meta = snap.data() as TreeMeta;
  const nodesSnap = await snap.ref.collection('nodes').get();
  const nodes = nodesSnap.docs.map(doc => doc.data() as FocusNode);
  return { meta, nodes };
}

function assertReadable(meta: TreeMeta): void {
  if (meta.status !== 'published' && meta.status !== 'archived') {
    throw new HttpsError('failed-precondition', 'E_TREE_NOT_PUBLISHED', { status: meta.status });
  }
}

async function loadProgress(uid: string, treeId: string): Promise<ProgressMap> {
  const snap = await db
    .collection(`user_focus_progress/${uid}/nodes`)
    .where('tree_id', '==', treeId)
    .get();
  const map: ProgressMap = new Map();
  for (const doc of snap.docs) {
    const masteredAt = doc.get('mastered_at') as Timestamp | null;
    map.set(String(doc.get('node_id')), {
      status: doc.get('status') as ProgressStatus,
      masteredAt: masteredAt ? masteredAt.toDate().toISOString() : null,
    });
  }
  return map;
}

function buildSnapshot(meta: TreeMeta, nodes: FocusNode[], progress: ProgressMap): TreeSnapshot {
  const denominator = Number(meta.total_weight ?? 0);
  let earned = 0;

  const items: ProgressItem[] = nodes.map(node => {
    const entry = progress.get(node.id);
    const status = entry?.status ?? 'not_started';
    const coefficient = status === 'not_started' ? 0 : COEFFICIENT[status];
    earned += node.weight * coefficient;
    return {
      nodeId: node.id,
      weight: node.weight,
      status,
      coefficient,
      masteredAt: entry?.masteredAt ?? null,
    };
  });

  const unlockedNodeIds = nodes
    .filter(node => node.prerequisites.every(id => progress.get(id)?.status === 'mastered'))
    .map(node => node.id);

  const lockedReasons: Record<string, string[]> = {};
  for (const node of nodes) {
    const missing = node.prerequisites.filter(id => progress.get(id)?.status !== 'mastered');
    if (missing.length > 0) lockedReasons[node.id] = missing;
  }

  const percent = denominator > 0 ? Math.round((earned / denominator) * 1000) / 10 : 0;
  return { denominator, earned, percent, items, unlockedNodeIds, lockedReasons };
}

export const focusProgressGet = onCall({ region: REGION }, async request => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'E_UNAUTHENTICATED');
  }
  const treeId = String((request.data as { treeId?: unknown } | undefined)?.treeId ?? '');
  if (!TREE_ID_PATTERN.test(treeId)) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'treeId' });
  }

  const { meta, nodes } = await readTree(treeId);
  assertReadable(meta);

  const progress = await loadProgress(uid, treeId);
  const snapshot = buildSnapshot(meta, nodes, progress);
  return { treeId, ...snapshot, readOnly: meta.status === 'archived' };
});

export const focusProgressSet = onCall({ region: REGION }, async request => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'E_UNAUTHENTICATED');
  }

  const data = (request.data ?? {}) as {
    treeId?: unknown;
    nodeId?: unknown;
    status?: unknown;
    evidence?: unknown;
  };
  const treeId = String(data.treeId ?? '');
  const nodeId = String(data.nodeId ?? '');
  if (!TREE_ID_PATTERN.test(treeId) || !NODE_ID_PATTERN.test(nodeId)) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { fields: ['treeId', 'nodeId'] });
  }
  if (data.status !== 'in_progress' && data.status !== 'mastered') {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'status' });
  }
  const status = data.status;
  const evidence = typeof data.evidence === 'string' ? data.evidence.slice(0, 500) : '';

  const { meta, nodes } = await readTree(treeId);
  if (meta.status === 'archived') {
    throw new HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
  }
  if (meta.status !== 'published') {
    throw new HttpsError('failed-precondition', 'E_TREE_NOT_PUBLISHED', { status: meta.status });
  }

  const node = nodes.find(candidate => candidate.id === nodeId);
  if (!node) {
    throw new HttpsError('not-found', 'E_UNKNOWN_NODE', { nodeId });
  }

  const beforeMap = await loadProgress(uid, treeId);
  const before = buildSnapshot(meta, nodes, beforeMap);

  if (beforeMap.get(nodeId)?.status === 'mastered' && status === 'in_progress') {
    throw new HttpsError('failed-precondition', 'E_TERMINAL_STATE', { nodeId });
  }
  const missing = node.prerequisites.filter(id => beforeMap.get(id)?.status !== 'mastered');
  if (missing.length > 0) {
    throw new HttpsError('failed-precondition', 'E_PREREQUISITE_NOT_MET', { nodeId, missing });
  }

  const ref = db.doc(`user_focus_progress/${uid}/nodes/${progressDocId(treeId, nodeId)}`);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();

  const payload: Record<string, unknown> = {
    tree_id: treeId,
    node_id: nodeId,
    status,
    evidence: evidence || String(existing.get('evidence') ?? ''),
    mastered_at: status === 'mastered' ? now : null,
    updated_at: now,
  };
  if (!existing.exists) {
    payload.started_at = now;
  }
  await ref.set(payload, { merge: true });

  const afterMap = await loadProgress(uid, treeId);
  const after = buildSnapshot(meta, nodes, afterMap);
  const newlyUnlocked = after.unlockedNodeIds.filter(id => !before.unlockedNodeIds.includes(id));

  return { nodeId, status, percent: after.percent, newlyUnlocked };
});
