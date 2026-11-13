import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { assertAdmin, db } from './admin';
import {
  TREE_ID_PATTERN,
  type FocusNode,
  type ImportReport,
  type TreeMeta,
} from './schema';
import { buildReport, payloadHash, validateTreeNodes } from './validate';

const REGION = 'asia-east1';
const MAX_NODES = 400;

function readTreeId(value: unknown): string {
  const treeId = String(value ?? '');
  if (!TREE_ID_PATTERN.test(treeId)) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'treeId' });
  }
  return treeId;
}

function readImportId(value: unknown): string {
  const importId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(importId)) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'importId' });
  }
  return importId;
}

export const focusTreeValidate = onCall({ region: REGION }, async request => {
  const actor = await assertAdmin(request.auth?.uid);
  const data = (request.data ?? {}) as { treeId?: unknown; nodes?: unknown };
  const treeId = readTreeId(data.treeId);

  const treeRef = db.doc(`focus_trees/${treeId}`);
  const treeSnap = await treeRef.get();
  if (!treeSnap.exists) {
    throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
  }
  if (treeSnap.get('status') === 'archived') {
    throw new HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
  }

  const meta = treeSnap.data() as TreeMeta;
  const existing = (await treeRef.collection('nodes').get()).docs.map(doc => doc.data() as FocusNode);
  const result = await validateTreeNodes(treeId, meta, existing, data.nodes);
  const report = buildReport(result);
  if (JSON.stringify({ nodes: result.nodes, report }).length > 900_000) {
    throw new HttpsError('invalid-argument', 'E_TREE_TOO_LARGE', { maxBytes: 900_000 });
  }

  const importRef = db.collection('focus_tree_imports').doc();
  await importRef.set({
    tree_id: treeId,
    status: 'dry_run',
    payload_hash: payloadHash(result.nodes),
    nodes: result.nodes,
    report,
    requested_by: actor,
    approved_by: null,
    approved_at: null,
    created_at: FieldValue.serverTimestamp(),
  });

  return { importId: importRef.id, ...report };
});

export const focusTreeApprove = onCall({ region: REGION }, async request => {
  const actor = await assertAdmin(request.auth?.uid);
  const data = (request.data ?? {}) as { treeId?: unknown; importId?: unknown };
  const treeId = readTreeId(data.treeId);
  const importId = readImportId(data.importId);

  const importRef = db.doc(`focus_tree_imports/${importId}`);
  const importSnap = await importRef.get();
  if (!importSnap.exists) {
    throw new HttpsError('not-found', 'E_IMPORT_NOT_FOUND', { importId });
  }
  if (importSnap.get('tree_id') !== treeId) {
    throw new HttpsError('invalid-argument', 'E_TREE_MISMATCH', { treeId });
  }
  if (importSnap.get('status') !== 'dry_run') {
    throw new HttpsError('failed-precondition', 'E_IMPORT_NOT_DRY_RUN', { status: importSnap.get('status') });
  }

  const report = importSnap.get('report') as ImportReport | undefined;
  if (!report?.ok) {
    throw new HttpsError('failed-precondition', 'E_VALIDATION_FAILED', { errors: report?.errors ?? [] });
  }

  const nodes = importSnap.get('nodes') as FocusNode[];
  if (!Array.isArray(nodes) || payloadHash(nodes) !== importSnap.get('payload_hash')) {
    throw new HttpsError('failed-precondition', 'E_IMPORT_HASH_MISMATCH', { importId });
  }

  await importRef.update({
    status: 'approved',
    approved_by: actor,
    approved_at: FieldValue.serverTimestamp(),
  });

  return { importId, status: 'approved', nodeCount: nodes.length };
});

export const focusTreePublish = onCall({ region: REGION }, async request => {
  const actor = await assertAdmin(request.auth?.uid);
  const data = (request.data ?? {}) as { treeId?: unknown; importId?: unknown; expectedVersion?: unknown };
  const treeId = readTreeId(data.treeId);
  const importId = readImportId(data.importId);
  const expectedVersion = Number(data.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'expectedVersion' });
  }

  const treeRef = db.doc(`focus_trees/${treeId}`);
  const importRef = db.doc(`focus_tree_imports/${importId}`);
  const [treeSnap, importSnap, existingSnap] = await Promise.all([
    treeRef.get(),
    importRef.get(),
    treeRef.collection('nodes').get(),
  ]);

  if (!treeSnap.exists) {
    throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
  }
  if (treeSnap.get('status') === 'archived') {
    throw new HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
  }
  if (!importSnap.exists) {
    throw new HttpsError('not-found', 'E_IMPORT_NOT_FOUND', { importId });
  }
  if (importSnap.get('tree_id') !== treeId) {
    throw new HttpsError('invalid-argument', 'E_TREE_MISMATCH', { treeId });
  }
  if (importSnap.get('status') !== 'approved') {
    throw new HttpsError('failed-precondition', 'E_NOT_APPROVED', { status: importSnap.get('status') });
  }
  if (importSnap.get('approved_by') !== actor) {
    throw new HttpsError('permission-denied', 'E_NOT_APPROVED', { reason: 'approved_by != caller' });
  }

  const rawNodes = importSnap.get('nodes');
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new HttpsError('failed-precondition', 'E_INVALID_FIELD', { field: 'nodes' });
  }
  if (rawNodes.length > MAX_NODES) {
    throw new HttpsError('invalid-argument', 'E_TREE_TOO_LARGE', { max: MAX_NODES, got: rawNodes.length });
  }

  const importNodes = rawNodes as FocusNode[];
  if (payloadHash(importNodes) !== importSnap.get('payload_hash')) {
    throw new HttpsError('failed-precondition', 'E_IMPORT_HASH_MISMATCH', { importId });
  }

  const missingMrNote = importNodes.filter(node => !node.mr_note || !String(node.mr_note).trim()).map(node => node.id);
  if (missingMrNote.length > 0) {
    throw new HttpsError('failed-precondition', 'E_MR_NOTE_MISSING', { nodeIds: missingMrNote });
  }

  const meta = treeSnap.data() as TreeMeta;
  const existing = existingSnap.docs.map(doc => doc.data() as FocusNode);
  const result = await validateTreeNodes(treeId, meta, existing, importNodes);
  if (result.errors.length > 0) {
    throw new HttpsError('failed-precondition', 'E_VALIDATION_FAILED', { errors: result.errors });
  }
  if (result.diff.removed.length > 0) {
    throw new HttpsError('failed-precondition', 'E_NODE_REMOVAL_UNSUPPORTED', { removed: result.diff.removed });
  }
  if (Number(meta.version) !== expectedVersion) {
    throw new HttpsError('failed-precondition', 'E_VERSION_CONFLICT', {
      expectedVersion,
      currentVersion: Number(meta.version),
    });
  }

  const roots = result.nodes.filter(node => node.prerequisites.length === 0).map(node => node.id);
  const checksum = payloadHash(result.nodes);
  const totalWeight = result.stats.totalWeight;
  const auditRef = db.collection('audit_logs').doc();
  const now = FieldValue.serverTimestamp();

  return db.runTransaction(async transaction => {
    const [freshTree, freshImport] = await Promise.all([
      transaction.get(treeRef),
      transaction.get(importRef),
    ]);
    if (!freshTree.exists || !freshImport.exists) {
      throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
    }
    if (Number(freshTree.get('version')) !== expectedVersion) {
      throw new HttpsError('failed-precondition', 'E_VERSION_CONFLICT', {
        expectedVersion,
        currentVersion: Number(freshTree.get('version')),
      });
    }
    if (freshTree.get('status') === 'archived') {
      throw new HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
    }
    if (freshImport.get('status') !== 'approved') {
      throw new HttpsError('failed-precondition', 'E_NOT_APPROVED', { status: freshImport.get('status') });
    }

    transaction.update(treeRef, {
      status: 'published',
      root_node_ids: roots,
      node_count: result.nodes.length,
      total_weight: totalWeight,
      version: expectedVersion + 1,
      checksum,
      published_at: now,
      updated_at: now,
    });

    for (const node of result.nodes) {
      transaction.set(treeRef.collection('nodes').doc(node.id), node);
    }

    transaction.set(
      importRef,
      { status: 'published', published_at: now },
      { merge: true },
    );

    transaction.set(auditRef, {
      actor,
      action: 'focus_tree.publish',
      tree_id: treeId,
      import_id: importId,
      before_version: expectedVersion,
      after_version: expectedVersion + 1,
      payload_hash: checksum,
      created_at: now,
    });

    return {
      treeId,
      version: expectedVersion + 1,
      nodeCount: result.nodes.length,
      totalWeight,
      checksum,
    };
  });
});
