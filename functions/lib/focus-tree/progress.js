"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusProgressSet = exports.focusProgressGet = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("./admin");
const schema_1 = require("./schema");
const REGION = 'asia-east1';
async function readTree(treeId) {
    const snap = await admin_1.db.doc(`focus_trees/${treeId}`).get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
    }
    const meta = snap.data();
    const nodesSnap = await snap.ref.collection('nodes').get();
    const nodes = nodesSnap.docs.map(doc => doc.data());
    return { meta, nodes };
}
function assertReadable(meta) {
    if (meta.status !== 'published' && meta.status !== 'archived') {
        throw new https_1.HttpsError('failed-precondition', 'E_TREE_NOT_PUBLISHED', { status: meta.status });
    }
}
async function loadProgress(uid, treeId) {
    const snap = await admin_1.db
        .collection(`user_focus_progress/${uid}/nodes`)
        .where('tree_id', '==', treeId)
        .get();
    const map = new Map();
    for (const doc of snap.docs) {
        const masteredAt = doc.get('mastered_at');
        map.set(String(doc.get('node_id')), {
            status: doc.get('status'),
            masteredAt: masteredAt ? masteredAt.toDate().toISOString() : null,
        });
    }
    return map;
}
function buildSnapshot(meta, nodes, progress) {
    const denominator = Number(meta.total_weight ?? 0);
    let earned = 0;
    const items = nodes.map(node => {
        const entry = progress.get(node.id);
        const status = entry?.status ?? 'not_started';
        const coefficient = status === 'not_started' ? 0 : schema_1.COEFFICIENT[status];
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
    const lockedReasons = {};
    for (const node of nodes) {
        const missing = node.prerequisites.filter(id => progress.get(id)?.status !== 'mastered');
        if (missing.length > 0)
            lockedReasons[node.id] = missing;
    }
    const percent = denominator > 0 ? Math.round((earned / denominator) * 1000) / 10 : 0;
    return { denominator, earned, percent, items, unlockedNodeIds, lockedReasons };
}
exports.focusProgressGet = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'E_UNAUTHENTICATED');
    }
    const treeId = String(request.data?.treeId ?? '');
    if (!schema_1.TREE_ID_PATTERN.test(treeId)) {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'treeId' });
    }
    const { meta, nodes } = await readTree(treeId);
    assertReadable(meta);
    const progress = await loadProgress(uid, treeId);
    const snapshot = buildSnapshot(meta, nodes, progress);
    return { treeId, ...snapshot, readOnly: meta.status === 'archived' };
});
exports.focusProgressSet = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'E_UNAUTHENTICATED');
    }
    const data = (request.data ?? {});
    const treeId = String(data.treeId ?? '');
    const nodeId = String(data.nodeId ?? '');
    if (!schema_1.TREE_ID_PATTERN.test(treeId) || !schema_1.NODE_ID_PATTERN.test(nodeId)) {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { fields: ['treeId', 'nodeId'] });
    }
    if (data.status !== 'in_progress' && data.status !== 'mastered') {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'status' });
    }
    const status = data.status;
    const evidence = typeof data.evidence === 'string' ? data.evidence.slice(0, 500) : '';
    const { meta, nodes } = await readTree(treeId);
    if (meta.status === 'archived') {
        throw new https_1.HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
    }
    if (meta.status !== 'published') {
        throw new https_1.HttpsError('failed-precondition', 'E_TREE_NOT_PUBLISHED', { status: meta.status });
    }
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (!node) {
        throw new https_1.HttpsError('not-found', 'E_UNKNOWN_NODE', { nodeId });
    }
    const beforeMap = await loadProgress(uid, treeId);
    const before = buildSnapshot(meta, nodes, beforeMap);
    if (beforeMap.get(nodeId)?.status === 'mastered' && status === 'in_progress') {
        throw new https_1.HttpsError('failed-precondition', 'E_TERMINAL_STATE', { nodeId });
    }
    const missing = node.prerequisites.filter(id => beforeMap.get(id)?.status !== 'mastered');
    if (missing.length > 0) {
        throw new https_1.HttpsError('failed-precondition', 'E_PREREQUISITE_NOT_MET', { nodeId, missing });
    }
    const ref = admin_1.db.doc(`user_focus_progress/${uid}/nodes/${(0, schema_1.progressDocId)(treeId, nodeId)}`);
    const existing = await ref.get();
    const now = firestore_1.FieldValue.serverTimestamp();
    const payload = {
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
//# sourceMappingURL=progress.js.map