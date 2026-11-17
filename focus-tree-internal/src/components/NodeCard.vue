<script setup lang="ts">
import { computed } from 'vue';
import type { FocusNode, NodeStatus } from '../types';

const props = defineProps<{
  node: FocusNode;
  status: NodeStatus;
  unlocked: boolean;
  missing: string[];
  confidential?: boolean;
}>();

defineEmits<{ open: [node: FocusNode] }>();

const label = computed(() => {
  if (props.status === 'completed') return '已完成';
  if (props.status === 'in_progress') return '進行中';
  return props.unlocked ? '未開始' : '未解鎖';
});

const weight = computed(() => (props.node.weight === null ? '權重未公佈' : `權重 ${props.node.weight}`));
const difficulty = computed(() =>
  props.node.difficulty?.level ? `難度 ${props.node.difficulty.level}` : '難度 —',
);
const hours = computed(() =>
  props.node.estimated_hours ? `${props.node.estimated_hours.value} h` : '時數 —',
);
</script>

<template>
  <button
    type="button"
    class="card"
    :class="[`is-${status}`, { locked: !unlocked && status === 'not_started', confidential }]"
    @click="$emit('open', node)"
  >
    <header>
      <h3>{{ node.title }}</h3>
      <span class="status">{{ label }}</span>
    </header>
    <p class="meta">
      <span>{{ weight }}</span>
      <span>{{ difficulty }}</span>
      <span>{{ hours }}</span>
    </p>
    <p v-if="!unlocked && status === 'not_started'" class="lock">
      需先完成：{{ missing.join('、') }}
    </p>
    <p v-else-if="confidential" class="lock warn">機密：僅限內部</p>
  </button>
</template>

<style scoped>
.card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.15s, transform 0.15s;
}

.card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.card.is-completed {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.card.is-in_progress {
  border-color: #c9a227;
}

.card.locked {
  opacity: 0.66;
}

.card.confidential {
  border-style: dashed;
}

header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

h3 {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
}

.status {
  flex: none;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--muted);
}

.is-completed .status {
  background: var(--accent);
  color: #fff;
}

.meta {
  margin: 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted);
}

.lock {
  margin: 0;
  font-size: 11px;
  color: var(--warn);
}

.lock.warn {
  color: #a33b2c;
}
</style>
