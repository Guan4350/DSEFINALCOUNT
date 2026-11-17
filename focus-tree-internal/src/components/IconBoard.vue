<script setup lang="ts">
import { computed } from 'vue';
import { TOPIC_ICONS } from '../data/topicIcons';
import type { FocusNode, NodeStatus } from '../types';

const props = defineProps<{
  statuses: Record<string, NodeStatus>;
  nodeById: (id: string) => FocusNode | undefined;
}>();

const emit = defineEmits<{ open: [nodeId: string] }>();

const icons = computed(() =>
  TOPIC_ICONS.map(icon => {
    const nodes = icon.nodeIds
      .map(id => props.nodeById(id))
      .filter((node): node is FocusNode => Boolean(node));
    const completed = nodes.filter(node => props.statuses[node.id] === 'completed').length;
    return { ...icon, nodes, completed };
  }),
);

const base = import.meta.env.BASE_URL;
const url = (file: string) => `${base}icons/topics/${file}`;

function open(nodeIds: string[]) {
  if (nodeIds.length > 0) emit('open', nodeIds[0]);
}
</script>

<template>
  <section class="board">
    <header class="board-head">
      <div>
        <p class="eyebrow">NATIONAL FOCUS · CHEMISTRY</p>
        <h2>國策</h2>
      </div>
      <p class="hint">
        18 個課題圖標。已綁定者點擊後在樹狀圖開啟對應節點；標示「待綁定」者代表定稿沒有單一官方節點。
      </p>
    </header>

    <div class="grid">
      <button
        v-for="icon in icons"
        :key="icon.key"
        type="button"
        class="icon-card"
        :class="{ unbound: icon.nodeIds.length === 0, done: icon.nodes.length > 0 && icon.completed === icon.nodes.length }"
        :disabled="icon.nodeIds.length === 0"
        @click="open(icon.nodeIds)"
      >
        <span class="icon-wrap">
          <img :src="url(icon.file)" :alt="icon.zh" loading="lazy" />
        </span>
        <span class="label">
          <strong>{{ icon.zh }}</strong>
          <em>{{ icon.en }}</em>
        </span>
        <span class="meta">
          <template v-if="icon.nodes.length">
            {{ icon.completed }} / {{ icon.nodes.length }} 節點完成
          </template>
          <template v-else>待綁定</template>
        </span>
      </button>
    </div>

    <p class="foot">
      「化學基礎概念」「計量分析基礎」在定稿 JSON 中沒有獨立節點，保留為視覺索引，不強行對應。
    </p>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.board-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--muted);
}

h2 {
  margin: 0;
  font-size: 24px;
}

.hint {
  margin: 0;
  max-width: 520px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
  gap: 12px;
}

.icon-card {
  border: 1px solid #39443e;
  border-radius: 14px;
  background: linear-gradient(180deg, #232c27 0%, #1b221e 100%);
  color: #e6e2d6;
  padding: 12px 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
  min-height: 260px;
}

.icon-card:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: #b89b5e;
  box-shadow: 0 8px 22px rgba(20, 24, 22, 0.25);
}

.icon-card.done {
  border-color: #6f9d7c;
}

.icon-card.unbound {
  cursor: default;
  opacity: 0.72;
}

.icon-wrap {
  display: grid;
  place-items: center;
  width: 100%;
  height: 150px;
}

img {
  max-width: 100%;
  max-height: 150px;
  object-fit: contain;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
}

.label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}

.label strong {
  font-size: 13px;
  line-height: 1.35;
}

.label em {
  font-size: 10px;
  font-style: normal;
  color: #a9b3ac;
  line-height: 1.35;
}

.meta {
  margin-top: auto;
  font-size: 10px;
  color: #b8a06b;
  letter-spacing: 0.04em;
}

.unbound .meta {
  color: #c88f86;
}

.foot {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
