<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import FocusNodeCard from '../components/FocusNodeCard.vue';
import FocusNodeDrawer from '../components/FocusNodeDrawer.vue';
import WeightedProgress from '../components/WeightedProgress.vue';
import { useFocusTreeStore } from '../stores/focusTree';
import type { FocusNode } from '../types';

const route = useRoute();
const store = useFocusTreeStore();
const selectedId = ref<string | null>(null);
const actionError = ref('');

const treeId = computed(() => String(route.params.treeId ?? ''));

onMounted(() => {
  if (treeId.value) void store.load(treeId.value);
});

watch(treeId, id => {
  selectedId.value = null;
  if (id) void store.load(id);
});

const selected = computed<FocusNode | null>(() =>
  selectedId.value ? store.nodesById[selectedId.value] ?? null : null,
);

const missingNames = computed(() => {
  if (!selected.value) return [];
  return store.missingOf(selected.value.id).map(id => store.nodesById[id]?.name ?? id);
});

const layers = computed<FocusNode[][]>(() => {
  const byId = store.nodesById;
  const memo = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId[id];
    if (!node || seen.has(id)) return 0;
    const next = new Set(seen);
    next.add(id);
    const value = node.prerequisites.length
      ? 1 + Math.max(...node.prerequisites.map(prereq => depthOf(prereq, next)))
      : 0;
    memo.set(id, value);
    return value;
  };

  const result: FocusNode[][] = [];
  for (const node of store.nodes) {
    const depth = depthOf(node.id, new Set());
    (result[depth] ??= []).push(node);
  }
  return result;
});

async function mark(status: 'in_progress' | 'mastered') {
  if (!selected.value) return;
  actionError.value = '';
  try {
    await store.mark(selected.value.id, status);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <section class="tree-page">
    <p v-if="store.loading" class="state">載入中…</p>
    <p v-else-if="store.error" class="state error">{{ store.error }}</p>

    <template v-else-if="store.tree">
      <header class="tree-head">
        <div>
          <p class="eyebrow">{{ store.tree.subject }} · {{ store.tree.exam_year }}</p>
          <h1>{{ store.tree.name }}</h1>
          <p class="tree-sub">
            {{ store.nodes.length }} 個節點 · 總重量 {{ store.tree.total_weight }} · v{{ store.tree.version }}
          </p>
        </div>
        <WeightedProgress
          :percent="store.percent"
          :earned="store.earned"
          :denominator="store.denominator"
        />
      </header>

      <p v-if="store.readOnly" class="banner">此年份已封存，進度僅供查閱。</p>

      <div class="layers">
        <div v-for="(layer, index) in layers" :key="index" class="layer">
          <p class="layer-title">第 {{ index + 1 }} 層</p>
          <FocusNodeCard
            v-for="node in layer"
            :key="node.id"
            :node="node"
            :status="store.statusOf(node.id)"
            :unlocked="store.isUnlocked(node.id)"
            :missing="store.missingOf(node.id).map(id => store.nodesById[id]?.name ?? id)"
            :read-only="store.readOnly"
            @open="selectedId = $event.id"
          />
        </div>
      </div>

      <p v-if="actionError" class="state error">{{ actionError }}</p>

      <FocusNodeDrawer
        v-if="selected"
        :node="selected"
        :status="store.statusOf(selected.id)"
        :unlocked="store.isUnlocked(selected.id)"
        :missing="store.missingOf(selected.id)"
        :missing-names="missingNames"
        :read-only="store.readOnly"
        :busy="store.marking === selected.id"
        @close="selectedId = null"
        @mark="mark"
      />
    </template>
  </section>
</template>

<style scoped>
.tree-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 24px 80px;
}

.tree-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.tree-sub {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.banner {
  background: #fdf3e3;
  color: #8a5a12;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12px;
}

.layers {
  display: flex;
  gap: 20px;
  overflow-x: auto;
  padding: 18px 0 12px;
  align-items: flex-start;
}

.layer {
  min-width: 250px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.layer-title {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.state {
  color: var(--muted);
  padding: 24px 0;
}

.state.error {
  color: #a33b2c;
}
</style>
