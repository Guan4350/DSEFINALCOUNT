<script setup lang="ts">
import { computed } from 'vue';
import type { FocusNode, NodeStatus } from '../types';

const props = defineProps<{
  node: FocusNode;
  status: NodeStatus;
  unlocked: boolean;
  missing: string[];
  saving: boolean;
}>();

const emit = defineEmits<{
  close: [];
  setStatus: [status: NodeStatus];
}>();

const weight = computed(() => (props.node.weight === null ? '官方未公佈' : String(props.node.weight)));
const difficulty = computed(() =>
  props.node.difficulty
    ? `${props.node.difficulty.level ?? '—'} / 5（${props.node.difficulty.basis}）`
    : '—',
);
const hours = computed(() =>
  props.node.estimated_hours
    ? `${props.node.estimated_hours.value} h（${props.node.estimated_hours.label}）`
    : '—',
);
const confidential = computed(() => props.node.id.startsWith('CHEM-MS'));

const buttons: Array<{ value: NodeStatus; label: string }> = [
  { value: 'not_started', label: '未開始' },
  { value: 'in_progress', label: '進行中' },
  { value: 'completed', label: '已完成' },
];

function canSet(status: NodeStatus): boolean {
  if (props.saving) return false;
  if (status === 'not_started') return true;
  return props.unlocked;
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="node.title">
      <header class="head">
        <div>
          <p class="eyebrow">{{ node.id }}</p>
          <h2>{{ node.title }}</h2>
        </div>
        <button class="icon" type="button" aria-label="關閉" @click="emit('close')">×</button>
      </header>

      <p v-if="confidential" class="danger">
        此節點來自 2024 HKEAA Marking Scheme（CONFIDENTIAL）。僅限內部校準，禁止對外披露或令學生取得。
      </p>
      <p v-if="!unlocked" class="warn">
        前置未完成：{{ missing.join('、') || '（無）' }}；目前只可維持「未開始」。
      </p>

      <section>
        <h3>狀態</h3>
        <div class="status-row">
          <button
            v-for="item in buttons"
            :key="item.value"
            type="button"
            class="status-btn"
            :class="{ active: status === item.value }"
            :disabled="!canSet(item.value)"
            @click="emit('setStatus', item.value)"
          >
            {{ item.label }}
          </button>
        </div>
      </section>

      <dl class="meta">
        <dt>權重</dt>
        <dd>{{ weight }}</dd>
        <dt>難度</dt>
        <dd>{{ difficulty }}</dd>
        <dt>預估時數</dt>
        <dd>{{ hours }}</dd>
        <dt>前置</dt>
        <dd>{{ node.prerequisites.length ? node.prerequisites.join('、') : '無（root）' }}</dd>
      </dl>

      <section>
        <h3>達標條件</h3>
        <p class="text">{{ node.completion_threshold }}</p>
      </section>

      <section>
        <h3>評分／學習成果</h3>
        <p class="criteria-status">{{ node.marking_criteria.status }}</p>
        <ul class="criteria">
          <li v-for="(item, index) in node.marking_criteria.items" :key="index">{{ item }}</li>
        </ul>
      </section>

      <section>
        <h3>來源</h3>
        <p class="text">{{ node.source }}</p>
      </section>

      <section v-if="node.gap_note">
        <h3>缺口備註</h3>
        <p class="text muted">{{ node.gap_note }}</p>
      </section>

      <footer class="foot">
        <p>節點展開時已觸發 <code>focus-tree:node-selected</code>，可交給 Gemini 顧問。</p>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 22, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}

.drawer {
  width: min(560px, 100%);
  height: 100%;
  overflow-y: auto;
  background: var(--surface);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.06em;
}

h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.35;
}

h3 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.icon {
  border: 0;
  background: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: var(--muted);
}

.danger,
.warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
}

.danger {
  background: #fbe9e7;
  color: #9b2c1f;
}

.warn {
  background: #fdf3e3;
  color: #8a5a12;
}

.status-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.status-btn {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 9px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
}

.status-btn.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.status-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.meta {
  display: grid;
  grid-template-columns: 84px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 12px;
}

.meta dt {
  color: var(--muted);
}

.meta dd {
  margin: 0;
  line-height: 1.5;
}

.text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.text.muted {
  color: var(--muted);
}

.criteria-status {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--accent);
}

.criteria {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.65;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.foot {
  margin-top: auto;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.foot p {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
