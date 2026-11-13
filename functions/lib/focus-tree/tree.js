"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusTreePublish = exports.focusTreeApprove = exports.focusTreeValidate = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const admin_1 = require("./admin");
const schema_1 = require("./schema");
const validate_1 = require("./validate");
const REGION = 'asia-east1';
const MAX_NODES = 400;
function readTreeId(value) {
    const treeId = String(value ?? '');
    if (!schema_1.TREE_ID_PATTERN.test(treeId)) {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'treeId' });
    }
    return treeId;
}
function readImportId(value) {
    const importId = String(value ?? '').trim();
    if (!/^[A-Za-z0-9]{10,64}$/.test(importId)) {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'importId' });
    }
    return importId;
}
exports.focusTreeValidate = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await (0, admin_1.assertAdmin)(request.auth?.uid);
    const data = (request.data ?? {});
    const treeId = readTreeId(data.treeId);
    const treeRef = admin_1.db.doc(`focus_trees/${treeId}`);
    const treeSnap = await treeRef.get();
    if (!treeSnap.exists) {
        throw new https_1.HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
    }
    if (treeSnap.get('status') === 'archived') {
        throw new https_1.HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
    }
    const meta = treeSnap.data();
    const existing = (await treeRef.collection('nodes').get()).docs.map(doc => doc.data());
    const result = await (0, validate_1.validateTreeNodes)(treeId, meta, existing, data.nodes);
    const report = (0, validate_1.buildReport)(result);
    if (JSON.stringify({ nodes: result.nodes, report }).length > 900_000) {
        throw new https_1.HttpsError('invalid-argument', 'E_TREE_TOO_LARGE', { maxBytes: 900_000 });
    }
    const importRef = admin_1.db.collection('focus_tree_imports').doc();
    await importRef.set({
        tree_id: treeId,
        status: 'dry_run',
        payload_hash: (0, validate_1.payloadHash)(result.nodes),
        nodes: result.nodes,
        report,
        requested_by: actor,
        approved_by: null,
        approved_at: null,
        created_at: firestore_1.FieldValue.serverTimestamp(),
    });
    return { importId: importRef.id, ...report };
});
exports.focusTreeApprove = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await (0, admin_1.assertAdmin)(request.auth?.uid);
    const data = (request.data ?? {});
    const treeId = readTreeId(data.treeId);
    const importId = readImportId(data.importId);
    const importRef = admin_1.db.doc(`focus_tree_imports/${importId}`);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new https_1.HttpsError('not-found', 'E_IMPORT_NOT_FOUND', { importId });
    }
    if (importSnap.get('tree_id') !== treeId) {
        throw new https_1.HttpsError('invalid-argument', 'E_TREE_MISMATCH', { treeId });
    }
    if (importSnap.get('status') !== 'dry_run') {
        throw new https_1.HttpsError('failed-precondition', 'E_IMPORT_NOT_DRY_RUN', { status: importSnap.get('status') });
    }
    const report = importSnap.get('report');
    if (!report?.ok) {
        throw new https_1.HttpsError('failed-precondition', 'E_VALIDATION_FAILED', { errors: report?.errors ?? [] });
    }
    const nodes = importSnap.get('nodes');
    if (!Array.isArray(nodes) || (0, validate_1.payloadHash)(nodes) !== importSnap.get('payload_hash')) {
        throw new https_1.HttpsError('failed-precondition', 'E_IMPORT_HASH_MISMATCH', { importId });
    }
    await importRef.update({
        status: 'approved',
        approved_by: actor,
        approved_at: firestore_1.FieldValue.serverTimestamp(),
    });
    return { importId, status: 'approved', nodeCount: nodes.length };
});
exports.focusTreePublish = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await (0, admin_1.assertAdmin)(request.auth?.uid);
    const data = (request.data ?? {});
    const treeId = readTreeId(data.treeId);
    const importId = readImportId(data.importId);
    const expectedVersion = Number(data.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new https_1.HttpsError('invalid-argument', 'E_INVALID_FIELD', { field: 'expectedVersion' });
    }
    const treeRef = admin_1.db.doc(`focus_trees/${treeId}`);
    const importRef = admin_1.db.doc(`focus_tree_imports/${importId}`);
    const [treeSnap, importSnap, existingSnap] = await Promise.all([
        treeRef.get(),
        importRef.get(),
        treeRef.collection('nodes').get(),
    ]);
    if (!treeSnap.exists) {
        throw new https_1.HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
    }
    if (treeSnap.get('status') === 'archived') {
        throw new https_1.HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
    }
    if (!importSnap.exists) {
        throw new https_1.HttpsError('not-found', 'E_IMPORT_NOT_FOUND', { importId });
    }
    if (importSnap.get('tree_id') !== treeId) {
        throw new https_1.HttpsError('invalid-argument', 'E_TREE_MISMATCH', { treeId });
    }
    if (importSnap.get('status') !== 'approved') {
        throw new https_1.HttpsError('failed-precondition', 'E_NOT_APPROVED', { status: importSnap.get('status') });
    }
    if (importSnap.get('approved_by') !== actor) {
        throw new https_1.HttpsError('permission-denied', 'E_NOT_APPROVED', { reason: 'approved_by != caller' });
    }
    const rawNodes = importSnap.get('nodes');
    if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'E_INVALID_FIELD', { field: 'nodes' });
    }
    if (rawNodes.length > MAX_NODES) {
        throw new https_1.HttpsError('invalid-argument', 'E_TREE_TOO_LARGE', { max: MAX_NODES, got: rawNodes.length });
    }
    const importNodes = rawNodes;
    if ((0, validate_1.payloadHash)(importNodes) !== importSnap.get('payload_hash')) {
        throw new https_1.HttpsError('failed-precondition', 'E_IMPORT_HASH_MISMATCH', { importId });
    }
    const missingMrNote = importNodes.filter(node => !node.mr_note || !String(node.mr_note).trim()).map(node => node.id);
    if (missingMrNote.length > 0) {
        throw new https_1.HttpsError('failed-precondition', 'E_MR_NOTE_MISSING', { nodeIds: missingMrNote });
    }
    const meta = treeSnap.data();
    const existing = existingSnap.docs.map(doc => doc.data());
    const result = await (0, validate_1.validateTreeNodes)(treeId, meta, existing, importNodes);
    if (result.errors.length > 0) {
        throw new https_1.HttpsError('failed-precondition', 'E_VALIDATION_FAILED', { errors: result.errors });
    }
    if (result.diff.removed.length > 0) {
        throw new https_1.HttpsError('failed-precondition', 'E_NODE_REMOVAL_UNSUPPORTED', { removed: result.diff.removed });
    }
    if (Number(meta.version) !== expectedVersion) {
        throw new https_1.HttpsError('failed-precondition', 'E_VERSION_CONFLICT', {
            expectedVersion,
            currentVersion: Number(meta.version),
        });
    }
    const roots = result.nodes.filter(node => node.prerequisites.length === 0).map(node => node.id);
    const checksum = (0, validate_1.payloadHash)(result.nodes);
    const totalWeight = result.stats.totalWeight;
    const auditRef = admin_1.db.collection('audit_logs').doc();
    const now = firestore_1.FieldValue.serverTimestamp();
    return admin_1.db.runTransaction(async (transaction) => {
        const [freshTree, freshImport] = await Promise.all([
            transaction.get(treeRef),
            transaction.get(importRef),
        ]);
        if (!freshTree.exists || !freshImport.exists) {
            throw new https_1.HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });
        }
        if (Number(freshTree.get('version')) !== expectedVersion) {
            throw new https_1.HttpsError('failed-precondition', 'E_VERSION_CONFLICT', {
                expectedVersion,
                currentVersion: Number(freshTree.get('version')),
            });
        }
        if (freshTree.get('status') === 'archived') {
            throw new https_1.HttpsError('failed-precondition', 'E_TREE_ARCHIVED', { treeId });
        }
        if (freshImport.get('status') !== 'approved') {
            throw new https_1.HttpsError('failed-precondition', 'E_NOT_APPROVED', { status: freshImport.get('status') });
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
        transaction.set(importRef, { status: 'published', published_at: now }, { merge: true });
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
//# sourceMappingURL=tree.js.map