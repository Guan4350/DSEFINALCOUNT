<script setup lang="ts">
import { computed } from 'vue';
import type { NodeStatus, TreeDocument } from '../types';

const props = defineProps<{
  tree: TreeDocument;
  statuses: Record<string, NodeStatus>;
  percent: number;
}>();

const rows = computed(() =>
  props.tree.nodes.map(node => {
    const prereqs = node.prerequisites.map(id => ({
      id,
      done: props.statuses[id] === 'completed',
    }));
    return {
      id: node.id,
      weight: node.weight,
      status: props.statuses[node.id] ?? 'not_started',
      prereqs,
      unlocked: prereqs.every(item => item.done),
    };
  }),
);

const completed = computed(() => rows.value.filter(row => row.status === 'completed').length);
const raw = computed(() => JSON.stringify({ percent: props.percent, statuses: props.statuses }, null, 2));
</script>

<template>
  <aside class="debug">
    <h2>DEBUG</h2>
    <p>schema: {{ tree.schema_version }} · status: {{ tree.status }}</p>
    <p>sha256: {{ tree.source_sha256 ?? '（未記錄）' }}</p>
    <p>nodes: {{ tree.nodes.length }} · completed: {{ completed }} · weighted: {{ percent }}%</p>
    <p>release: {{ tree.release.approved_by }} · {{ tree.release.locked_at }}</p>

    <h3>前置判定</h3>
    <table>
      <thead>
        <tr><th>node</th><th>status</th><th>weight</th><th>unlocked</th><th>prereqs</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="id">{{ row.id }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.weight ?? 'null' }}</td>
          <td>{{ row.unlocked ? 'yes' : 'no' }}</td>
          <td>
            <span v-for="p in row.prereqs" :key="p.id" :class="p.done ? 'ok' : 'bad'">
              {{ p.id }}{{ p.done ? '✓' : '✗' }}
            </span>
            <span v-if="!row.prereqs.length">—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h3>progress doc</h3>
    <pre>{{ raw }}</pre>
  </aside>
</template>

<style scoped>
.debug {
  border: 1px solid var(--line);
  background: #1f2723;
  color: #d9e2dc;
  border-radius: 14px;
  padding: 16px;
  font-size: 11px;
  overflow-x: auto;
}

h2 {
  margin: 0 0 8px;
  font-size: 13px;
  letter-spacing: 0.12em;
}

h3 {
  margin: 14px 0 6px;
  font-size: 11px;
  color: #9fb3a8;
}

p {
  margin: 3px 0;
  word-break: break-all;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}

th,
td {
  text-align: left;
  padding: 3px 6px;
  border-bottom: 1px solid #33403a;
}

.id {
  white-space: nowrap;
}

.ok {
  color: #8fd0a8;
  margin-right: 6px;
}

.bad {
  color: #e6a08f;
  margin-right: 6px;
}

pre {
  margin: 0;
  padding: 8px;
  background: #151b18;
  border-radius: 8px;
  max-height: 220px;
  overflow: auto;
}
</style>
