export type TreeStatus = 'draft' | 'published' | 'publishing' | 'archived';
export type ProgressStatus = 'in_progress' | 'mastered';
export type ItemStatus = 'not_started' | ProgressStatus;

/** 嚴格對應業務 schema 的 13 個欄位。 */
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

export interface TreeSummary {
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
}

export interface ProgressItem {
  nodeId: string;
  weight: number;
  status: ItemStatus;
  coefficient: 0 | 0.5 | 1;
  masteredAt: string | null;
}

export interface ProgressSnapshot {
  treeId: string;
  denominator: number;
  earned: number;
  percent: number;
  items: ProgressItem[];
  unlockedNodeIds: string[];
  lockedReasons: Record<string, string[]>;
  readOnly: boolean;
}

export interface SetProgressInput {
  treeId: string;
  nodeId: string;
  status: ProgressStatus;
  evidence?: string;
}

export interface ResetInput {
  treeId: string;
  uids?: string[];
  emails?: string[];
  nodeIds?: string[];
  cascade?: boolean;
  dryRun?: boolean;
  strict?: boolean;
}

export interface ResetUserResult {
  uid: string;
  email: string | null;
  affected: Array<{ nodeId: string; status: string; masteredAt: string | null }>;
  deleted: number;
}

export interface ResetResult {
  dryRun: boolean;
  treeId: string;
  nodeIds: string[];
  users: ResetUserResult[];
  skipped: Array<{ input: string; code: string }>;
  totals: { users: number; affectedDocs: number; deleted: number };
}

export interface LookupUserResult {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
}

export interface ImportIssue {
  code: string;
  path: string;
  message: string;
}

export interface ImportReport {
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  stats: { nodeCount: number; totalWeight: number; maxDepth: number; rootCount: number };
  diff: { added: string[]; modified: string[]; removed: string[]; unchanged: string[] };
}

export interface ValidateResult extends ImportReport {
  importId: string;
}

export interface PublishResult {
  treeId: string;
  version: number;
  nodeCount: number;
  totalWeight: number;
  checksum: string;
}
