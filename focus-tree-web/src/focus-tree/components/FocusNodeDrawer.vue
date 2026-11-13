<script setup lang="ts">
import type { FocusNode } from '../types';

const props = defineProps<{
  node: FocusNode;
  status: string;
  unlocked: boolean;
  missing: string[];
  missingNames: string[];
  readOnly: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  mark: [status: 'in_progress' | 'mastered'];
}>();
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="node.name">
      <header class="drawer-head">
        <div>
          <p class="eyebrow">重量 {{ node.weight }} · {{ node.estimated_hours }} h</p>
          <h2>{{ node.name }}</h2>
        </div>
        <button class="icon-btn" type="button" aria-label="關閉" @click="emit('close')">×</button>
      </header>

      <p class="drawer-desc">{{ node.description }}</p>

      <dl class="drawer-meta">
        <dt>大綱參照</dt>
        <dd>{{ node.syllabus_ref }}</dd>
        <dt>達標驗證</dt>
        <dd>{{ node.validation_rule }}</dd>
        <dt>獎勵</dt>
        <dd>{{ node.reward || '—' }}</dd>
        <dt>前置</dt>
        <dd>{{ missingNames.length ? missingNames.join('、') : '無（入口節點）' }}</dd>
      </dl>

      <p v-if="readOnly" class="drawer-warn">此年份已封存，進度僅供查閱。</p>
      <p v-else-if="!unlocked && status !== 'mastered'" class="drawer-warn">
        尚未解鎖，需先掌握：{{ missingNames.join('、') }}
      </p>

      <footer class="drawer-actions">
        <button
          v-if="status !== 'mastered'"
          type="button"
          class="btn"
          :disabled="busy || readOnly || !unlocked || status === 'in_progress'"
          @click="emit('mark', 'in_progress')"
        >
          開始學習
        </button>
        <button
          v-if="status !== 'mastered'"
          type="button"
          class="btn primary"
          :disabled="busy || readOnly || !unlocked"
          @click="emit('mark', 'mastered')"
        >
          標記掌握
        </button>
        <span v-if="status === 'mastered'" class="done">已掌握</span>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 22, 0.38);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}

.drawer {
  width: min(460px, 100%);
  height: 100%;
  background: var(--surface);
  padding: 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-size: 20px;
}

.drawer-desc {
  margin: 0;
  color: var(--text);
  line-height: 1.6;
}

.drawer-meta {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 12px;
}

.drawer-meta dt {
  color: var(--muted);
}

.drawer-meta dd {
  margin: 0;
  line-height: 1.5;
}

.drawer-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdf3e3;
  color: #8a5a12;
  font-size: 12px;
}

.drawer-actions {
  margin-top: auto;
  display: flex;
  gap: 10px;
  align-items: center;
}

.done {
  color: var(--accent);
  font-weight: 600;
}
</style>
