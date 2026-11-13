<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { approveTree, publishTree, validateTree } from '../admin-api';
import type { FocusNode, PublishResult, ValidateResult } from '../types';

interface TreeRow {
  id: string;
  name: string;
  subject: string;
  examYear: number;
  status: string;
  version: number;
}

const trees = ref<TreeRow[]>([]);
const treeId = ref('');
const nodesJson = ref('');
const report = ref<ValidateResult | null>(null);
const approved = ref(false);
const published = ref<PublishResult | null>(null);
const confirmText = ref('');
const busy = ref(false);
const error = ref('');

const current = computed(() => trees.value.find(tree => tree.id === treeId.value));
const isArchived = computed(() => current.value?.status === 'archived');

const parsed = computed<FocusNode[]>(() => {
  try {
    const value: unknown = JSON.parse(nodesJson.value);
    return Array.isArray(value) ? (value as FocusNode[]) : [];
  } catch {
    return [];
  }
});

const missingMr = computed(
  () => parsed.value.filter(node => typeof node.mr_note !== 'string' || !node.mr_note.trim()).length,
);

onMounted(async () => {
  const snap = await getDocs(collection(db, 'focus_trees'));
  trees.value = snap.docs.map(item => {
    const data = item.data() as Record<string, unknown>;
    return {
      id: item.id,
      name: String(data.name),
      subject: String(data.subject),
      examYear: Number(data.exam_year),
      status: String(data.status),
      version: Number(data.version),
    };
  });
});

async function selectTree(id: string) {
  treeId.value = id;
  report.value = null;
  approved.value = false;
  published.value = null;
  confirmText.value = '';
  error.value = '';

  const treeSnap = await getDoc(doc(db, 'focus_trees', id));
  if (!treeSnap.exists()) {
    error.value = '樹不存在';
    return;
  }
  const data = treeSnap.data() as Record<string, unknown>;
  const row = trees.value.find(tree => tree.id === id);
  if (row) {
    row.version = Number(data.version);
    row.status = String(data.status);
  }

  const nodeSnap = await getDocs(collection(db, 'focus_trees', id, 'nodes'));
  const nodes = nodeSnap.docs.map(item => item.data() as FocusNode);
  nodesJson.value = JSON.stringify(nodes, null, 2);
}

async function loadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  nodesJson.value = await file.text();
  onJsonEdit();
  input.value = '';
}

function downloadJson() {
  const blob = new Blob([nodesJson.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${treeId.value}-nodes.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function onJsonEdit() {
  if (report.value) {
    report.value = null;
    approved.value = false;
    published.value = null;
  }
}

function parseInput(): FocusNode[] | null {
  try {
    const value: unknown = JSON.parse(nodesJson.value);
    if (!Array.isArray(value)) {
      error.value = 'JSON 必須是節點陣列';
      return null;
    }
    return value as FocusNode[];
  } catch (cause) {
    error.value = `JSON 解析失敗：${cause instanceof Error ? cause.message : String(cause)}`;
    return null;
  }
}

async function runValidate() {
  const nodes = parseInput();
  if (!nodes) return;
  busy.value = true;
  error.value = '';
  approved.value = false;
  published.value = null;
  try {
    report.value = await validateTree({ treeId: treeId.value, nodes });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function runApprove() {
  if (!report.value?.ok) return;
  busy.value = true;
  error.value = '';
  try {
    await approveTree({ treeId: treeId.value, importId: report.value.importId });
    approved.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function runPublish() {
  if (!report.value || !current.value) return;
  if (confirmText.value !== treeId.value) {
    error.value = '請輸入完整 treeId 以確認';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    published.value = await publishTree({
      treeId: treeId.value,
      importId: report.value.importId,
      expectedVersion: current.value.version,
    });
    current.value.version = published.value.version;
    current.value.status = 'published';
    report.value = null;
    approved.value = false;
    confirmText.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="publish-page">
    <header>
      <p class="eyebrow">ADMIN</p>
      <h1>驗證與發佈樹版本</h1>
      <p class="sub">validate（dry-run）→ approve → publish；mr_note 為空會被擋下。</p>
    </header>

    <label class="field">
      <span>樹</span>
      <select v-model="treeId" @change="selectTree(treeId)">
        <option value="" disabled>選擇樹</option>
        <option v-for="tree in trees" :key="tree.id" :value="tree.id">
          {{ tree.subject }} · {{ tree.examYear }} · {{ tree.name }}（{{ tree.status }} / v{{ tree.version }}）
        </option>
      </select>
    </label>

    <p v-if="isArchived" class="banner">此樹已封存，不可再發佈。</p>

    <template v-if="treeId">
      <p class="meta">
        節點 {{ parsed.length }} · MR 待回填 {{ missingMr }} · 版本
        {{ current?.version ?? '—' }}
      </p>

      <label class="field">
        <span>節點 JSON（13 欄位）</span>
        <textarea v-model="nodesJson" rows="18" spellcheck="false" @input="onJsonEdit" />
      </label>

      <div class="actions">
        <label class="btn file-btn">
          載入 JSON 檔
          <input type="file" accept="application/json" hidden @change="loadFile" />
        </label>
        <button class="btn" type="button" :disabled="!nodesJson" @click="downloadJson">
          下載目前 JSON
        </button>
        <button class="btn primary" type="button" :disabled="busy || isArchived" @click="runValidate">
          驗證（dry-run）
        </button>
        <button
          class="btn primary"
          type="button"
          :disabled="busy || !report?.ok || approved || isArchived"
          @click="runApprove"
        >
          核准
        </button>
      </div>

      <div v-if="report" class="report">
        <p :class="['badge', report.ok ? 'ok' : 'bad']">
          {{ report.ok ? '校驗通過' : '校驗失敗' }} · import {{ report.importId }}
        </p>

        <ul v-if="report.errors.length" class="issues errors">
          <li v-for="issue in report.errors" :key="`${issue.code}-${issue.path}`">
            <code>{{ issue.code }}</code> {{ issue.path }} — {{ issue.message }}
          </li>
        </ul>

        <ul v-if="report.warnings.length" class="issues warnings">
          <li v-for="issue in report.warnings" :key="`${issue.code}-${issue.path}`">
            <code>{{ issue.code }}</code> {{ issue.path }} — {{ issue.message }}
          </li>
        </ul>

        <p class="stats">
          節點 {{ report.stats.nodeCount }} · 總重 {{ report.stats.totalWeight }} · 最深
          {{ report.stats.maxDepth }} · root {{ report.stats.rootCount }}
        </p>

        <p class="diff">
          新增 {{ report.diff.added.length }} · 修改 {{ report.diff.modified.length }} · 刪除
          {{ report.diff.removed.length }} · 不變 {{ report.diff.unchanged.length }}
        </p>
      </div>

      <div v-if="approved" class="publish-box">
        <p class="badge ok">已核准，可發佈</p>
        <label class="field">
          <span>輸入 <code>{{ treeId }}</code> 確認</span>
          <input v-model="confirmText" autocomplete="off" />
        </label>
        <button
          class="btn danger"
          type="button"
          :disabled="busy || confirmText !== treeId || isArchived"
          @click="runPublish"
        >
          發佈
        </button>
      </div>

      <p v-if="published" class="result">
        已發佈 v{{ published.version }} · {{ published.nodeCount }} 節點 · 總重
        {{ published.totalWeight }} · checksum {{ published.checksum.slice(0, 12) }}…
      </p>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.publish-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--muted);
}

h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.sub,
.meta {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.field > span {
  color: var(--muted);
  font-size: 12px;
}

select,
textarea,
input[type='text'] {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  background: var(--surface);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.actions {
  display: flex;
  gap: 10px;
}

.banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fdf3e3;
  color: #8a5a12;
  font-size: 12px;
}

.report {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.badge {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.badge.ok {
  color: var(--accent);
}

.badge.bad {
  color: #a33b2c;
}

.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.errors li {
  color: #a33b2c;
}

.warnings li {
  color: #8a5a12;
}

.stats,
.diff {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.publish-box {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--accent-soft);
}

.result {
  margin: 0;
  color: var(--accent);
  font-size: 13px;
}

.error {
  margin: 0;
  color: #a33b2c;
  font-size: 13px;
}
</style>
