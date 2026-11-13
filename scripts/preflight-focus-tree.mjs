#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const results = [];
const check = (name, ok, detail = '', level = 'fail') => results.push({ name, ok, detail, level });

function readEnv(file) {
  if (!fs.existsSync(file)) return null;
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

const envPath = path.join(root, 'focus-tree-web/.env.local');
const env = readEnv(envPath);
const envKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY',
];
const missingEnv = env ? envKeys.filter(key => !env[key]) : envKeys;
check('.env.local 存在', Boolean(env), envPath);
check('Web env 完整', missingEnv.length === 0, missingEnv.length ? `缺少：${missingEnv.join(', ')}` : 'ok');

const libIndex = path.join(root, 'functions/lib/focus-tree/index.js');
check('functions/lib 已 build', fs.existsSync(libIndex), libIndex);

const rulesPath = path.join(root, 'firestore.rules');
const rules = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : '';
check('Rules 含 focus_trees', rules.includes('match /focus_trees/'), '');
check('Rules 含 user_focus_progress', rules.includes('match /user_focus_progress/'), '');

const entryPath = path.join(root, 'functions/index.js');
const entry = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
for (const name of ['focusTreeValidate', 'focusTreeApprove', 'focusTreePublish', 'focusProgressReset']) {
  check(`index.js 匯出 ${name}`, entry.includes(name), '');
}

const fixturePath = path.join(root, 'functions/scripts/chem-2027.nodes.json');
let nodes = [];
try {
  nodes = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  check('seed fixture 可解析', Array.isArray(nodes) && nodes.length > 0, `${nodes.length} nodes`);
} catch (error) {
  check('seed fixture 可解析', false, String(error));
}

const fields = [
  'id', 'name', 'description', 'subject', 'syllabus_ref', 'mr_note',
  'prerequisites', 'soft_prerequisites', 'target_grade', 'estimated_hours',
  'validation_rule', 'reward', 'weight',
];
const byId = new Map(nodes.map(node => [node.id, node]));
let shapeOk = true;
for (const node of nodes) {
  const keys = Object.keys(node).sort();
  const expected = [...fields].sort();
  if (keys.join(',') !== expected.join(',')) shapeOk = false;
  if (!Number.isInteger(node.weight) || node.weight < 1 || node.weight > 5) shapeOk = false;
  if (!Array.isArray(node.prerequisites)) shapeOk = false;
}
check('節點 13 欄位與 weight 合法', shapeOk, '');

let refsOk = true;
for (const node of nodes) {
  for (const prerequisite of node.prerequisites) {
    if (!byId.has(prerequisite)) refsOk = false;
  }
}
check('硬前置皆存在', refsOk, '');

const totalWeight = nodes.reduce((sum, node) => sum + node.weight, 0);
check('total_weight = 17', totalWeight === 17, `目前 ${totalWeight}`);

const missingMr = nodes.filter(node => !String(node.mr_note ?? '').trim()).map(node => node.id);
check(
  'mr_note 已補齊（seed 前）',
  missingMr.length === 0,
  missingMr.length ? `待補：${missingMr.join(', ')}；也可在 admin UI 補` : 'ok',
  'warn',
);

let failed = 0;
let warned = 0;
for (const result of results) {
  if (!result.ok) {
    if (result.level === 'warn') warned += 1;
    else failed += 1;
  }
  const status = result.ok ? 'PASS' : result.level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${status}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}

console.log(`\n${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
