<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  percent: number;
  target: string;
  version: string;
  status: string;
  counts: {
    topics: { done: number; total: number };
    electives: { done: number; total: number };
    sba: { done: number; total: number };
    modules: { done: number; total: number };
  };
}>();

const clamp = computed(() => Math.max(0, Math.min(100, props.percent)));
const ring = computed(() => ({
  background: `conic-gradient(#2f6f5e ${clamp.value}%, #e4e1d8 0)`,
}));
</script>

<template>
  <section class="progress">
    <div class="ring" :style="ring" role="img" :aria-label="`官方加權完成度 ${percent}%`">
      <div class="ring-inner">
        <strong>{{ percent.toFixed(1) }}%</strong>
        <span>官方加權</span>
      </div>
    </div>

    <div class="stats">
      <p class="eyebrow">{{ version }} · LOCKED · 目標 {{ target }} · {{ status }}</p>
      <h1>Chemistry 國策樹</h1>
      <ul>
        <li>必修課題 <b>{{ counts.topics.done }}/{{ counts.topics.total }}</b></li>
        <li>選修單元 <b>{{ counts.electives.done }}/{{ counts.electives.total }}</b></li>
        <li>SBA 子項 <b>{{ counts.sba.done }}/{{ counts.sba.total }}</b></li>
        <li>評核模塊 <b>{{ counts.modules.done }}/{{ counts.modules.total }}</b></li>
      </ul>
      <p class="note">
        加權只採用官方公佈的 Paper 1 60 / Paper 2 20 / SBA 20；其餘 33 個節點 weight 為
        null，不參與加權，只計完成數。
      </p>
    </div>
  </section>
</template>

<style scoped>
.progress {
  display: flex;
  gap: 26px;
  align-items: center;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 18px;
  padding: 22px;
  flex-wrap: wrap;
}

.ring {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
}

.ring-inner {
  width: 94px;
  height: 94px;
  border-radius: 50%;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.ring-inner strong {
  font-size: 22px;
}

.ring-inner span {
  font-size: 10px;
  color: var(--muted);
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted);
}

h1 {
  margin: 0 0 10px;
  font-size: 26px;
}

ul {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0 0 8px;
  padding: 0;
  font-size: 12px;
  color: var(--muted);
}

ul b {
  color: var(--text);
  font-weight: 600;
}

.note {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  max-width: 640px;
}
</style>
