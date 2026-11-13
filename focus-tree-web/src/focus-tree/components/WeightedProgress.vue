<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  percent: number;
  earned: number;
  denominator: number;
  label?: string;
}>();

const clamped = computed(() => Math.max(0, Math.min(100, props.percent)));
const ring = computed(() => ({
  background: `conic-gradient(#2f6f5e ${clamped.value}%, #e4e1d8 0)`,
}));
</script>

<template>
  <div class="weighted">
    <div class="weighted-ring" :style="ring" role="img" :aria-label="`加權完成度 ${percent}%`">
      <div class="weighted-inner">
        <strong>{{ percent.toFixed(1) }}%</strong>
        <span>{{ label ?? '加權完成度' }}</span>
      </div>
    </div>
    <p class="weighted-meta">{{ earned }} / {{ denominator }} 分</p>
  </div>
</template>

<style scoped>
.weighted {
  display: flex;
  align-items: center;
  gap: 16px;
}

.weighted-ring {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}

.weighted-inner {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.weighted-inner strong {
  font-size: 18px;
}

.weighted-inner span,
.weighted-meta {
  font-size: 11px;
  color: var(--muted);
}

.weighted-meta {
  margin: 0;
}
</style>
