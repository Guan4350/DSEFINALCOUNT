export type NodeStatus = 'not_started' | 'in_progress' | 'completed';

export interface MarkingCriteria {
  status: string;
  items: string[];
}

export interface Difficulty {
  level: number | null;
  basis: string;
}

export interface EstimatedHours {
  value: number;
  label: string;
}

export interface FocusNode {
  id: string;
  title: string;
  prerequisites: string[];
  marking_criteria: MarkingCriteria;
  completion_threshold: string;
  weight: number | null;
  difficulty: Difficulty | null;
  estimated_hours: EstimatedHours | null;
  source: string;
  gap_note: string;
}

export interface GapEntry {
  id: string;
  category: string;
  description: string;
  affected: string[];
  status: string;
}

export interface TreeDocument {
  schema_version: string;
  status: string;
  subject: string;
  target_grade: string;
  total_weight: number;
  source_documents: Array<Record<string, string>>;
  conventions: Record<string, string>;
  nodes: FocusNode[];
  usage_restriction: { applies_to: string; rule: string };
  ms_inventory: Array<Record<string, unknown>>;
  cut_off_reference: Record<string, unknown>;
  gap_register: GapEntry[];
  release: {
    version: string;
    locked_at: string;
    approved_by: string;
    approval_note: string;
  };
  source_sha256?: string;
  imported_at?: unknown;
}

export interface NodeGroup {
  key: string;
  label: string;
  description: string;
  nodes: FocusNode[];
  confidential?: boolean;
}
