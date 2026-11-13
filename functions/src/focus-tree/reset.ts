import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { assertAdmin, auth, db } from './admin';
import { NODE_ID_PATTERN, TREE_ID_PATTERN, progressDocId, type FocusNode } from './schema';

const REGION = 'asia-east1';
const MAX_USERS = 200;
const MAX_DOCS = 5000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

interface ResetUserResult {
  uid: string;
  email: string | null;
  affected: Array<{ nodeId: string; status: string; masteredAt: string | null }>;
  deleted: number;
}

export const focusAdminLookupUser = onCall({ region: REGION }, async request => {
  await assertAdmin(request.auth?.uid);

  const email = String((request.data as { email?: unknown } | undefined)?.email ?? '').trim();
  if (!email) {
    throw new HttpsError('invalid-argument', 'E_MISSING_FIELD', { field: 'email' });
  }

  try {
    const user = await auth.getUserByEmail(email);
    return {
      uid: user.uid,
      email: user.email ?? email,
      displayName: user.displayName ?? '',
      disabled: user.disabled,
    };
  } catch {
    throw new HttpsError('not-found', 'E_USER_NOT_FOUND', { email });
  }
});

export const focusProgressReset = onCall({ region: REGION }, async request => {
  const actor = await assertAdmin(request.auth?.uid);

  const data = (request.data ?? {}) as {
    treeId?: unknown;
    uids?: unknown;
    emails?: unknown;
    nodeIds?: unknown;
    cascade?: unknown;
    dryRun?: unknown;
    strict?: unknown;
  };

  const treeId = String(data.treeId ?? '');
  const uids = asStringArray(data.uids);
  const emails = asStringArray(data.emails);
  if (!treeId || (uids.length === 0 && emails.length === 0)) {
    throw new HttpsError('invalid-argument', 'E_MISSING_FIELD', { fields: ['treeId', 'uids|emails'] });
  }
  if (!TREE_ID_PATTERN.test(treeId)) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'treeId' });
  }
  const nodeIds = asStringArray(data.nodeIds);
  const cascade = data.cascade !== false;
  const dryRun = data.dryRun === true;
  const strict = data.strict !== false;

  // 1. 先解析全部使用者；strict 模式下任何失敗即整批中止。
  const resolved = new Map<string, string | null>();
  const failures: Array<{ input: string; code: string }> = [];
  for (const uid of uids) {
    resolved.set(uid, null);
  }
  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      if (!resolved.has(user.uid)) {
        resolved.set(user.uid, user.email ?? null);
      }
    } catch {
      failures.push({ input: email, code: 'E_USER_NOT_FOUND' });
    }
  }
  if (strict && failures.length > 0) {
    throw new HttpsError('not-found', 'E_USER_NOT_FOUND', { failures });
  }
  if (resolved.size === 0) {
    throw new HttpsError('invalid-argument', 'E_MISSING_FIELD', { field: 'uids' });
  }
  if (resolved.size > MAX_USERS) {
    throw new HttpsError('invalid-argument', 'E_TOO_MANY_USERS', { max: MAX_USERS, got: resolved.size });
  }
  const skipped = strict ? [] : failures;

  // 2. 讀樹、節點，建立級聯範圍（只沿硬前置的逆向邊）。
  const treeRef = db.doc(`focus_trees/${treeId}`);
  const treeSnap = await treeRef.get();
  if (!treeSnap.exists) {
    throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
  }
  if (treeSnap.get('status') === 'archived') {
    throw new HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
  }

  const nodes = (await treeRef.collection('nodes').get()).docs.map(doc => doc.data() as FocusNode);
  const known = new Set(nodes.map(node => node.id));
  const selected = nodeIds.length > 0 ? nodeIds : [...known];
  for (const id of selected) {
    if (!NODE_ID_PATTERN.test(id) || !known.has(id)) {
      throw new HttpsError('invalid-argument', 'E_UNKNOWN_NODE', { nodeId: id });
    }
  }

  const targets = new Set(selected);
  if (cascade) {
    const dependents = new Map<string, string[]>();
    for (const node of nodes) {
      for (const prerequisite of node.prerequisites) {
        dependents.set(prerequisite, [...(dependents.get(prerequisite) ?? []), node.id]);
      }
    }
    const queue = [...targets];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const child of dependents.get(current) ?? []) {
        if (!targets.has(child)) {
          targets.add(child);
          queue.push(child);
        }
      }
    }
  }

  // 3. 逐使用者讀取進度；先全部讀完，再決定刪除。
  const users: ResetUserResult[] = [];
  const deletes: Array<{ uid: string; progressId: string }> = [];

  for (const [uid, email] of resolved) {
    const collection = db.collection(`user_focus_progress/${uid}/nodes`);
    const snaps = await Promise.all([...targets].map(id => collection.doc(progressDocId(treeId, id)).get()));
    const affected = snaps
      .filter(snap => snap.exists)
      .map(snap => {
        const masteredAt = snap.get('mastered_at');
        return {
          nodeId: String(snap.get('node_id')),
          status: String(snap.get('status')),
          masteredAt: typeof masteredAt?.toDate === 'function' ? masteredAt.toDate().toISOString() : null,
        };
      });

    users.push({ uid, email, affected, deleted: 0 });
    if (!dryRun) {
      for (const item of affected) {
        deletes.push({ uid, progressId: progressDocId(treeId, item.nodeId) });
      }
    }
  }

  const affectedDocs = users.reduce((total, user) => total + user.affected.length, 0);
  if (affectedDocs > MAX_DOCS) {
    throw new HttpsError('invalid-argument', 'E_RESET_LIMIT', { maxDocs: MAX_DOCS, got: affectedDocs });
  }

  const totals = { users: users.length, affectedDocs, deleted: 0 };
  if (dryRun) {
    return { dryRun: true, treeId, nodeIds: [...targets], users, skipped, totals };
  }

  // 4. 跨使用者分塊刪除；batch 可跨集合。
  for (let index = 0; index < deletes.length; index += 400) {
    const batch = db.batch();
    for (const item of deletes.slice(index, index + 400)) {
      batch.delete(db.doc(`user_focus_progress/${item.uid}/nodes/${item.progressId}`));
    }
    await batch.commit();
  }

  const byUid = new Map<string, number>();
  for (const item of deletes) {
    byUid.set(item.uid, (byUid.get(item.uid) ?? 0) + 1);
  }
  for (const user of users) {
    user.deleted = byUid.get(user.uid) ?? 0;
  }
  totals.deleted = deletes.length;

  await db.collection('audit_logs').add({
    actor,
    action: 'focus_progress.reset.bulk',
    tree_id: treeId,
    import_id: null,
    before_version: null,
    after_version: null,
    payload_hash: sha256(JSON.stringify({ treeId, uids: [...resolved.keys()].sort(), deleted: deletes.length })),
    reset_uids: [...resolved.keys()],
    reset_deleted: deletes.length,
    created_at: FieldValue.serverTimestamp(),
  });

  return { dryRun: false, treeId, nodeIds: [...targets], users, skipped, totals };
});
