<script setup lang="ts">
import { computed } from 'vue';
import type { FocusNode } from '../types';

const props = defineProps<{
  node: FocusNode;
  status: string;
  unlocked: boolean;
  missing: string[];
  readOnly: boolean;
}>();

defineEmits<{ open: [node: FocusNode] }>();

const label = computed(() => {
  if (props.status === 'mastered') return '已掌握';
  if (props.status === 'in_progress') return '進行中';
  return props.unlocked ? '可開始' : '未解鎖';
});
</script>

<template>
  <button
    type="button"
    class="node-card"
    :class="[`status-${status}`, { locked: !unlocked && status !== 'mastered' }]"
    @click="$emit('open', node)"
  >
    <header class="node-head">
      <span class="node-weight">重量 {{ node.weight }}</span>
      <span class="node-chip">{{ label }}</span>
    </header>
    <h3>{{ node.name }}</h3>
    <p class="node-desc">{{ node.description }}</p>
    <footer class="node-foot">
      <span>{{ node.estimated_hours }} h</span>
      <span v-if="node.reward" class="node-reward">{{ node.reward }}</span>
    </footer>
    <p v-if="!unlocked && status !== 'mastered'" class="node-lock">
      需先完成：{{ missing.length ? missing.join('、') : '前置節點' }}
    </p>
    <p v-if="readOnly" class="node-lock">封存年度，唯讀</p>
  </button>
</template>

<style scoped>
.node-card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  padding: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text);
  transition: border-color 0.15s, transform 0.15s;
}

.node-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.node-card.status-mastered {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.node-card.locked {
  opacity: 0.72;
}

.node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
}

.node-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--chip);
}

.status-mastered .node-chip {
  background: var(--accent);
  color: #fff;
}

h3 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.node-desc {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.node-foot {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
  flex-wrap: wrap;
}

.node-reward {
  color: var(--accent);
}

.node-lock {
  margin: 0;
  font-size: 11px;
  color: var(--warn);
}
</style>
