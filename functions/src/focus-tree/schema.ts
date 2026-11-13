/**
 * 國策節點 schema — 嚴格對應業務給定的 13 個欄位，不增不減。
 * Firestore 文件路徑：focus_trees/{treeId}/nodes/{nodeId}
 */

export const NODE_FIELDS = [
  'id',
  'name',
  'description',
  'subject',
  'syllabus_ref',
  'mr_note',
  'prerequisites',
  'soft_prerequisites',
  'target_grade',
  'estimated_hours',
  'validation_rule',
  'reward',
  'weight',
] as const;

export type NodeField = (typeof NODE_FIELDS)[number];

export interface FocusNode {
  id: string;
  name: string;
  description: string;
  subject: string;
  syllabus_ref: string;
  mr_note: string;
  prerequisites: string[];
  soft_prerequisites: string[];
  target_grade: string;
  estimated_hours: number;
  validation_rule: string;
  reward: string;
  weight: number;
}

export type TreeStatus = 'draft' | 'published' | 'publishing' | 'archived';

export interface TreeMeta {
  name: string;
  subject: string;
  exam_year: number;
  schema_version: string;
  status: TreeStatus;
  root_node_ids: string[];
  node_count: number;
  total_weight: number;
  version: number;
  checksum: string;
  created_by: string;
}


export interface Issue {
  code: string;
  path: string;
  message: string;
}

export interface ImportStats {
  nodeCount: number;
  totalWeight: number;
  maxDepth: number;
  rootCount: number;
}

export interface ImportDiff {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
}

export interface ImportReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  stats: ImportStats;
  diff: ImportDiff;
}

export type ProgressStatus = 'in_progress' | 'mastered';
export type ItemStatus = 'not_started' | ProgressStatus;

export interface ProgressItem {
  nodeId: string;
  weight: number;
  status: ItemStatus;
  coefficient: 0 | 0.5 | 1;
  masteredAt: string | null;
}

/** 狀態係數：只有 mastered / in_progress 會落庫。 */
export const COEFFICIENT: Record<ProgressStatus, 0.5 | 1> = {
  in_progress: 0.5,
  mastered: 1,
};

export const NODE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
export const TREE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
export const GRADES = new Set(['4', '5', '5*']);

export function progressDocId(treeId: string, nodeId: string): string {
  return `${treeId}__${nodeId}`;
}
