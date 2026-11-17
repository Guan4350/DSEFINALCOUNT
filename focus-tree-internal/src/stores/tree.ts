import { defineStore } from 'pinia';
import { loadTree, TREE_DOC_ID } from '../data/tree';
import { saveStatuses, watchStatuses } from '../data/progress';
import { logError, logInfo } from '../lib/log';
import type { FocusNode, NodeGroup, NodeStatus, TreeDocument } from '../types';

const MODULE_IDS = ['CHEM-P1', 'CHEM-P2', 'CHEM-SBA'];

function coefficient(status: NodeStatus | undefined): number {
  if (status === 'completed') return 1;
  if (status === 'in_progress') return 0.5;
  return 0;
}

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return true;
  return /permission/i.test(error instanceof Error ? error.message : String(error));
}

export const useTreeStore = defineStore('tree', {
  state: () => ({
    tree: null as TreeDocument | null,
    statuses: {} as Record<string, NodeStatus>,
    uid: '',
    loading: false,
    saving: null as string | null,
    error: '',
    unauthorized: false,
    debug: new URLSearchParams(window.location.search).has('debug'),
    unsubscribe: null as null | (() => void),
  }),

  getters: {
    nodes: (state): FocusNode[] => state.tree?.nodes ?? [],
    treeId: (state): string => state.tree?.schema_version ?? TREE_DOC_ID,
    nodeById: (state) => (id: string): FocusNode | undefined =>
      state.tree?.nodes.find(node => node.id === id),
    statusOf: (state) => (id: string): NodeStatus => state.statuses[id] ?? 'not_started',
    isUnlocked: (state) => (id: string): boolean => {
      const node = state.tree?.nodes.find(item => item.id === id);
      if (!node) return false;
      return node.prerequisites.every(prerequisite => state.statuses[prerequisite] === 'completed');
    },
    missingPrerequisites: (state) => (id: string): string[] => {
      const node = state.tree?.nodes.find(item => item.id === id);
      if (!node) return [];
      return node.prerequisites
        .filter(prerequisite => state.statuses[prerequisite] !== 'completed')
        .map(prerequisite => state.tree?.nodes.find(item => item.id === prerequisite)?.title ?? prerequisite);
    },

    groups: (state): NodeGroup[] => {
      const nodes = state.tree?.nodes ?? [];
      const groups: NodeGroup[] = [
        {
          key: 'goal',
          label: '總目標',
          description: 'ROOT：三模塊全部達標才算完成',
          nodes: nodes.filter(node => node.id === 'CHEM-ROOT'),
        },
        {
          key: 'modules',
          label: '評核模塊',
          description: 'Paper 1 60% / Paper 2 20% / SBA 20%',
          nodes: nodes.filter(node => MODULE_IDS.includes(node.id)),
        },
        {
          key: 'topics',
          label: '必修課題',
          description: '12 個課題，官方未公佈課題層權重',
          nodes: nodes.filter(node => /^CHEM-P1-T\d+$/.test(node.id)).sort((a, b) => a.id.localeCompare(b.id)),
        },
        {
          key: 'electives',
          label: '選修單元',
          description: '三選二；Schema 無 OR 表達，前置不強制',
          nodes: nodes.filter(node => /^CHEM-P2-E\d+$/.test(node.id)).sort((a, b) => a.id.localeCompare(b.id)),
        },
        {
          key: 'sba',
          label: 'SBA 子項',
          description: '校本評核的學習節點',
          nodes: nodes.filter(node => node.id === 'CHEM-SBA-01'),
        },
        {
          key: 'ms',
          label: '2024 MS 證據（機密）',
          description: 'CONFIDENTIAL：僅限內部校準，不得對外披露',
          confidential: true,
          nodes: nodes.filter(node => node.id.startsWith('CHEM-MS')).sort((a, b) => a.id.localeCompare(b.id)),
        },
      ];
      return groups.filter(group => group.nodes.length > 0);
    },

    weightedPercent: (state): number => {
      const total = state.tree?.total_weight ?? 100;
      if (total <= 0) return 0;
      let earned = 0;
      for (const id of MODULE_IDS) {
        const node = state.tree?.nodes.find(item => item.id === id);
        if (!node) continue;
        earned += (node.weight ?? 0) * coefficient(state.statuses[id]);
      }
      return Math.round((earned / total) * 1000) / 10;
    },

    counts: (state) => {
      const nodes = state.tree?.nodes ?? [];
      const bucket = (filter: (node: FocusNode) => boolean) => {
        const selected = nodes.filter(filter);
        return {
          done: selected.filter(node => state.statuses[node.id] === 'completed').length,
          total: selected.length,
        };
      };
      return {
        topics: bucket(node => /^CHEM-P1-T\d+$/.test(node.id)),
        electives: bucket(node => /^CHEM-P2-E\d+$/.test(node.id)),
        sba: bucket(node => node.id === 'CHEM-SBA-01'),
        modules: bucket(node => MODULE_IDS.includes(node.id)),
      };
    },
  },

  actions: {
    async load() {
      this.loading = true;
      this.error = '';
      this.unauthorized = false;
      try {
        this.tree = await loadTree();
        logInfo('tree loaded', { version: this.tree.schema_version, nodes: this.tree.nodes.length });
      } catch (cause) {
        if (isPermissionDenied(cause)) {
          this.unauthorized = true;
          this.error = '此帳號沒有內部存取權限（internal_access 白名單）。';
        } else {
          this.error = cause instanceof Error ? cause.message : String(cause);
        }
        logError('tree load failed', cause);
      } finally {
        this.loading = false;
      }
    },

    attach(uid: string) {
      this.uid = uid;
      this.unsubscribe?.();
      this.unsubscribe = watchStatuses(
        uid,
        this.treeId,
        statuses => {
          this.statuses = statuses;
        },
        cause => {
          if (isPermissionDenied(cause)) {
            this.unauthorized = true;
            this.error = '進度讀取被拒絕：請確認 Firestore Rules 與 internal_access。';
          } else {
            this.error = cause instanceof Error ? cause.message : String(cause);
          }
          logError('progress watch failed', cause);
        },
      );
    },

    detach() {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.uid = '';
      this.statuses = {};
    },

    async setStatus(nodeId: string, status: NodeStatus) {
      if (!this.uid) {
        this.error = '尚未登入';
        return;
      }
      if (status !== 'not_started' && !this.isUnlocked(nodeId)) {
        this.error = `前置未完成：${this.missingPrerequisites(nodeId).join('、')}`;
        return;
      }

      const before = this.statuses[nodeId];
      const next = { ...this.statuses };
      if (status === 'not_started') delete next[nodeId];
      else next[nodeId] = status;

      this.statuses = next;
      this.saving = nodeId;
      this.error = '';
      try {
        await saveStatuses(this.uid, this.treeId, next);
      } catch (cause) {
        const rollback = { ...this.statuses };
        if (before) rollback[nodeId] = before;
        else delete rollback[nodeId];
        this.statuses = rollback;
        this.error = cause instanceof Error ? cause.message : String(cause);
        logError('set status failed', cause, { nodeId, status });
      } finally {
        this.saving = null;
      }
    },
  },
});
