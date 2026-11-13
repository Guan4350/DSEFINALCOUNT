<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { lookupUser, resetProgress } from '../admin-api';
import type { ResetResult } from '../types';

interface TreeRow {
  id: string;
  name: string;
  subject: string;
  examYear: number;
  status: string;
}

interface NodeRow {
  id: string;
  name: string;
  weight: number;
}

interface Target {
  uid: string;
  email: string;
  displayName: string;
}

const trees = ref<TreeRow[]>([]);
const treeId = ref('');
const emailInput = ref('');
const targets = ref<Target[]>([]);
const nodes = ref<NodeRow[]>([]);
const selected = ref<string[]>([]);
const cascade = ref(true);
const preview = ref<ResetResult | null>(null);
const result = ref<ResetResult | null>(null);
const confirmText = ref('');
const expanded = ref<Set<string>>(new Set());
const busy = ref(false);
const error = ref('');

const currentTree = computed(() => trees.value.find(tree => tree.id === treeId.value));
const isReadOnly = computed(() => currentTree.value?.status === 'archived');
const allSelected = computed(() => nodes.value.length > 0 && selected.value.length === nodes.value.length);
const nodeName = (id: string) => nodes.value.find(node => node.id === id)?.name ?? id;

onMounted(async () => {
  const snap = await getDocs(collection(db, 'focus_trees'));
  trees.value = snap.docs.map(doc => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      name: String(data.name),
      subject: String(data.subject),
      examYear: Number(data.exam_year),
      status: String(data.status),
    };
  });
});

async function selectTree(id: string) {
  treeId.value = id;
  preview.value = null;
  result.value = null;
  confirmText.value = '';
  expanded.value = new Set();

  const snap = await getDocs(collection(db, 'focus_trees', id, 'nodes'));
  nodes.value = snap.docs.map(doc => {
    const data = doc.data() as Record<string, unknown>;
    return { id: String(data.id), name: String(data.name), weight: Number(data.weight) };
  });
  selected.value = nodes.value.map(node => node.id);
}

async function addTarget() {
  error.value = '';
  const email = emailInput.value.trim();
  if (!email) return;
  try {
    const user = await lookupUser(email);
    if (!targets.value.some(target => target.uid === user.uid)) {
      targets.value.push({ uid: user.uid, email: user.email, displayName: user.displayName });
    }
    emailInput.value = '';
    preview.value = null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function removeTarget(uid: string) {
  targets.value = targets.value.filter(target => target.uid !== uid);
  preview.value = null;
}

function toggleAll() {
  selected.value = allSelected.value ? [] : nodes.value.map(node => node.id);
}

function toggleExpand(uid: string) {
  const next = new Set(expanded.value);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  expanded.value = next;
}

function expandAll() {
  expanded.value = new Set((preview.value?.users ?? []).map(user => user.uid));
}

async function runPreview() {
  if (!targets.value.length || isReadOnly.value) return;
  busy.value = true;
  error.value = '';
  try {
    preview.value = await resetProgress({
      treeId: treeId.value,
      uids: targets.value.map(target => target.uid),
      nodeIds: selected.value,
      cascade: cascade.value,
      dryRun: true,
    });
    expanded.value = new Set();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function runReset() {
  if (!preview.value || isReadOnly.value) return;
  if (confirmText.value !== treeId.value) {
    error.value = '請輸入完整 treeId 以確認';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    result.value = await resetProgress({
      treeId: treeId.value,
      uids: targets.value.map(target => target.uid),
      nodeIds: selected.value,
      cascade: cascade.value,
      dryRun: false,
    });
    preview.value = null;
    confirmText.value = '';
    expanded.value = new Set();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="admin-page">
    <header class="admin-head">
      <p class="eyebrow">ADMIN</p>
      <h1>重置學習進度</h1>
      <p class="sub">批次重置，dry-run 預覽後才執行；每筆操作會寫入 audit_logs。</p>
    </header>

    <label class="field">
      <span>樹（subject · exam_year）</span>
      <select v-model="treeId" @change="selectTree(treeId)">
        <option value="" disabled>選擇樹</option>
        <option v-for="tree in trees" :key="tree.id" :value="tree.id">
          {{ tree.subject }} · {{ tree.examYear }} · {{ tree.name }}（{{ tree.status }}）
        </option>
      </select>
    </label>

    <p v-if="isReadOnly" class="banner">此年份已封存，進度唯讀，不可重置。</p>

    <div class="field">
      <span>加入學習者</span>
      <div class="row">
        <input
          v-model="emailInput"
          type="email"
          placeholder="student@example.com"
          @keyup.enter="addTarget"
        />
        <button class="btn" type="button" :disabled="!emailInput" @click="addTarget">加入</button>
      </div>
    </div>

    <ul v-if="targets.length" class="targets">
      <li v-for="target in targets" :key="target.uid">
        <span>{{ target.displayName || target.email }}</span>
        <small>{{ target.email }}</small>
        <button class="link" type="button" @click="removeTarget(target.uid)">移除</button>
      </li>
    </ul>

    <template v-if="treeId && targets.length">
      <div class="field">
        <div class="field-head">
          <span>節點範圍</span>
          <button class="link" type="button" @click="toggleAll">
            {{ allSelected ? '取消全選' : '全選' }}
          </button>
        </div>
        <ul class="node-list">
          <li v-for="node in nodes" :key="node.id">
            <label>
              <input v-model="selected" type="checkbox" :value="node.id" />
              {{ node.name }}
              <small>重量 {{ node.weight }}</small>
            </label>
          </li>
        </ul>
      </div>

      <label class="check">
        <input v-model="cascade" type="checkbox" />
        級聯重置硬前置下游
      </label>

      <button
        class="btn primary"
        type="button"
        :disabled="busy || isReadOnly || !selected.length"
        @click="runPreview"
      >
        預覽影響（{{ targets.length }} 人）
      </button>

      <div v-if="preview" class="preview">
        <div class="preview-head">
          <h2>預覽：{{ preview.totals.affectedDocs }} 份進度</h2>
          <button class="link" type="button" @click="expandAll">展開全部</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>學習者</th>
              <th>受影響</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="user in preview.users" :key="user.uid">
              <tr class="clickable" @click="toggleExpand(user.uid)">
                <td>{{ user.email || user.uid }}</td>
                <td>{{ user.affected.length }}</td>
                <td class="toggle">{{ expanded.has(user.uid) ? '收起' : '展開' }}</td>
              </tr>
              <tr v-if="expanded.has(user.uid)" class="detail-row">
                <td colspan="3">
                  <ul v-if="user.affected.length" class="detail-list">
                    <li v-for="item in user.affected" :key="item.nodeId">
                      <strong>{{ nodeName(item.nodeId) }}</strong>
                      <span>{{ item.status }}</span>
                      <span>{{ item.masteredAt ?? '—' }}</span>
                    </li>
                  </ul>
                  <p v-else class="empty">此範圍沒有進度。</p>
                </td>
              </tr>
            </template>
          </tbody>
          <tfoot>
            <tr>
              <td>合計</td>
              <td>{{ preview.totals.affectedDocs }}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <p v-if="preview.skipped.length" class="warn">
          略過：{{ preview.skipped.map(item => `${item.input}（${item.code}）`).join('、') }}
        </p>

        <label class="field">
          <span>輸入 <code>{{ treeId }}</code> 以確認</span>
          <input v-model="confirmText" autocomplete="off" />
        </label>

        <button
          class="btn danger"
          type="button"
          :disabled="busy || isReadOnly || confirmText !== treeId"
          @click="runReset"
        >
          確認重置
        </button>
      </div>
    </template>

    <p v-if="result" class="result">
      已重置 {{ result.totals.deleted }} 份進度，影響 {{ result.totals.users }} 人。
    </p>
    <p v-if="error" class="state error">{{ error }}</p>
  </section>
</template>

<style scoped>
.admin-page {
  max-width: 940px;
  margin: 0 auto;
  padding: 28px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-head h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--muted);
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.field,
.check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.field-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.field > span {
  color: var(--muted);
  font-size: 12px;
}

select,
input[type='email'],
input[type='text'] {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  background: var(--surface);
  color: var(--text);
}

.row {
  display: flex;
  gap: 8px;
}

.row input {
  flex: 1;
}

.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.targets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.targets li {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}

.targets small {
  color: var(--muted);
}

.node-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
  font-size: 12px;
}

.node-list li label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-list small {
  color: var(--muted);
}

.banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fdf3e3;
  color: #8a5a12;
  font-size: 12px;
}

.preview {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preview-head h2 {
  margin: 0;
  font-size: 15px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}

th {
  color: var(--muted);
  font-weight: 500;
}

tr.clickable {
  cursor: pointer;
}

tr.clickable:hover {
  background: var(--accent-soft);
}

.toggle {
  color: var(--accent);
  text-align: right;
}

.detail-row td {
  background: #faf9f5;
}

.detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-list li {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.detail-list strong {
  font-weight: 500;
}

.detail-list span {
  color: var(--muted);
  font-size: 11px;
}

.empty {
  margin: 0;
  color: var(--muted);
}

.warn {
  margin: 0;
  color: #8a5a12;
  font-size: 12px;
}

.result {
  margin: 0;
  color: var(--accent);
  font-size: 13px;
}

.state {
  margin: 0;
  font-size: 13px;
}

.state.error {
  color: #a33b2c;
}
</style>
