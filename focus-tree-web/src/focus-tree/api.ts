import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import type {
  FocusNode,
  ProgressSnapshot,
  SetProgressInput,
  TreeSummary,
} from './types';

export interface TreeBundle {
  tree: TreeSummary;
  nodes: FocusNode[];
}

export async function loadTree(treeId: string): Promise<TreeBundle> {
  const treeSnap = await getDoc(doc(db, 'focus_trees', treeId));
  if (!treeSnap.exists()) {
    throw new Error('樹不存在');
  }
  const tree = treeSnap.data() as TreeSummary;
  if (tree.status !== 'published' && tree.status !== 'archived') {
    throw new Error('樹未發佈');
  }
  const nodeSnap = await getDocs(collection(db, 'focus_trees', treeId, 'nodes'));
  const nodes = nodeSnap.docs
    .map(item => item.data() as FocusNode)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { tree, nodes };
}

export async function getProgress(treeId: string): Promise<ProgressSnapshot> {
  const call = httpsCallable<{ treeId: string }, ProgressSnapshot>(functions, 'focusProgressGet');
  const result = await call({ treeId });
  return result.data;
}

export interface SetProgressResult {
  nodeId: string;
  status: string;
  percent: number;
  newlyUnlocked: string[];
}

export async function setProgress(input: SetProgressInput): Promise<SetProgressResult> {
  const call = httpsCallable<SetProgressInput, SetProgressResult>(functions, 'focusProgressSet');
  const result = await call(input);
  return result.data;
}
