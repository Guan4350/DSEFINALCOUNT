#!/usr/bin/env node
/**
 * 將簽收定稿 JSON 寫入 internal_focus_trees。
 * 用法：node seed/seed-tree.mjs <final.json> [internalUid]
 * 需要 GOOGLE_APPLICATION_CREDENTIALS 或 ADC。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

function loadAdmin() {
  const candidates = [
    createRequire(import.meta.url),
    createRequire(new URL('../../functions/package.json', import.meta.url)),
  ];
  for (const req of candidates) {
    try {
      return { app: req('firebase-admin/app'), store: req('firebase-admin/firestore') };
    } catch (error) {
      if (!/Cannot find module/.test(String(error))) throw error;
    }
  }
  throw new Error('firebase-admin 未安裝：請在 focus-tree-internal 或 functions 執行 npm install');
}

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const file = args[0] ?? new URL('./chem_focus_tree.final.json', import.meta.url).pathname;
const internalUid = args[1] ?? process.env.INTERNAL_UID ?? '';
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
const dryRun = process.argv.includes('--dry-run');

if (!file) {
  console.error('usage: node seed/seed-tree.mjs [chem_focus_tree.final.json] [internalUid]');
  process.exit(1);
}

const bytes = fs.readFileSync(path.resolve(file));
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const tree = JSON.parse(bytes.toString('utf8'));

if (tree.status !== 'LOCKED' || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
  console.error('拒絕寫入：JSON 不是 LOCKED 或沒有 nodes。');
  process.exit(1);
}



const docId = process.env.TREE_DOC_ID || 'chem_3_1_0';

async function main() {
  if (dryRun) {
    console.log(`[dry-run] file=${path.resolve(file)}`);
    console.log(`[dry-run] version=${tree.schema_version} status=${tree.status} nodes=${tree.nodes.length}`);
    console.log(`[dry-run] sha256=${sha256}`);
    return;
  }

  const { app: adminApp, store: adminStore } = loadAdmin();
  const { initializeApp, applicationDefault } = adminApp;
  const { getFirestore, FieldValue } = adminStore;

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  // 以單一字串欄位保存原始 JSON，避免 Firestore 巢狀欄位名稱限制（例如 5**）。
  await db.doc(`internal_focus_trees/${docId}`).set({
    schema_version: tree.schema_version,
    status: tree.status,
    node_count: tree.nodes.length,
    source_sha256: sha256,
    payload_json: bytes.toString('utf8'),
    imported_at: FieldValue.serverTimestamp(),
  });

  if (internalUid) {
    await db.doc(`internal_access/${internalUid}`).set({
      active: true,
      note: 'seeded internal access',
      created_at: FieldValue.serverTimestamp(),
    });
  }

  console.log(`[seed] internal_focus_trees/${docId}`);
  console.log(`[seed] nodes=${tree.nodes.length} sha256=${sha256}`);
  if (internalUid) console.log(`[seed] internal_access/${internalUid} active=true`);
}

main().catch(error => {
  console.error('[seed] failed', error);
  process.exit(1);
});
