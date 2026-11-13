'use strict';

/**
 * 建立 chem-2027 草稿樹（4 節點）。
 * 只寫 draft；mr_note 全為空，依設計不可發佈，補齊 MR 後才可 publish。
 *
 * 用法：
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-chem-2027.js
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-chem-2027.js
 *   加 --force 覆寫既有樹。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const admin = require('firebase-admin');

const TREE_ID = 'chem-2027';
const force = process.argv.includes('--force');
const nodes = JSON.parse(fs.readFileSync(path.join(__dirname, 'chem-2027.nodes.json'), 'utf8'));
const totalWeight = nodes.reduce((sum, node) => sum + node.weight, 0);
const checksum = crypto.createHash('sha256').update(JSON.stringify(nodes)).digest('hex');

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-focus-tree' });
} else {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT });
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

async function main() {
  const treeRef = db.doc(`focus_trees/${TREE_ID}`);
  const existing = await treeRef.get();
  if (existing.exists && !force) {
    console.error(`[seed] ${TREE_ID} 已存在；如要覆寫請加 --force`);
    process.exit(1);
  }

  const batch = db.batch();
  batch.set(treeRef, {
    name: 'Chemistry 國策樹',
    subject: 'Chemistry',
    exam_year: 2027,
    schema_version: '1.0',
    status: 'draft',
    root_node_ids: ['chem_t01_planet_earth'],
    node_count: nodes.length,
    total_weight: totalWeight,
    version: 0,
    checksum,
    created_by: 'seed-script',
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    published_at: null,
  });

  for (const node of nodes) {
    batch.set(treeRef.collection('nodes').doc(node.id), node);
  }

  await batch.commit();
  console.log(`[seed] ${TREE_ID} draft written：${nodes.length} nodes, total_weight=${totalWeight}`);
  console.log('[seed] mr_note 全為空，publish 會被 E_MR_NOTE_MISSING 擋下（預期）。');
}

main().catch(error => {
  console.error('[seed] failed', error);
  process.exit(1);
});
