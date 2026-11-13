import { defineStore } from 'pinia';
import { getProgress, loadTree, setProgress } from '../api';
import type { FocusNode, ProgressSnapshot, TreeSummary } from '../types';

interface FocusTreeState {
  treeId: string;
  tree: TreeSummary | null;
  nodes: FocusNode[];
  snapshot: ProgressSnapshot | null;
  loading: boolean;
  marking: string | null;
  error: string;
}

export const useFocusTreeStore = defineStore('focusTree', {
  state: (): FocusTreeState => ({
    treeId: '',
    tree: null,
    nodes: [],
    snapshot: null,
    loading: false,
    marking: null,
    error: '',
  }),

  getters: {
    percent: (state): number => state.snapshot?.percent ?? 0,
    earned: (state): number => state.snapshot?.earned ?? 0,
    denominator: (state): number => state.snapshot?.denominator ?? 0,
    readOnly: (state): boolean => state.snapshot?.readOnly ?? false,
    nodesById: (state): Record<string, FocusNode> =>
      Object.fromEntries(state.nodes.map(node => [node.id, node])),
    statusOf: (state) => (nodeId: string) =>
      state.snapshot?.items.find(item => item.nodeId === nodeId)?.status ?? 'not_started',
    isUnlocked: (state) => (nodeId: string) =>
      state.snapshot?.unlockedNodeIds.includes(nodeId) ?? false,
    missingOf: (state) => (nodeId: string) =>
      state.snapshot?.lockedReasons[nodeId] ?? [],
  },

  actions: {
    async load(treeId: string) {
      this.loading = true;
      this.error = '';
      this.treeId = treeId;
      try {
        const { tree, nodes } = await loadTree(treeId);
        this.tree = tree;
        this.nodes = nodes;
        this.snapshot = await getProgress(treeId);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },

    async refresh() {
      this.snapshot = await getProgress(this.treeId);
    },

    async mark(nodeId: string, status: 'in_progress' | 'mastered', evidence?: string) {
      if (this.readOnly) {
        throw new Error('此年份已封存，進度唯讀');
      }
      this.marking = nodeId;
      try {
        await setProgress({ treeId: this.treeId, nodeId, status, evidence });
        await this.refresh();
      } finally {
        this.marking = null;
      }
    },
  },
});
