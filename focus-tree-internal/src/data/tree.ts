import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { TreeDocument } from '../types';

export const TREE_COLLECTION = 'internal_focus_trees';
export const TREE_DOC_ID = import.meta.env.VITE_TREE_DOC_ID || 'chem_3_1_0';

export async function loadTree(): Promise<TreeDocument> {
  const snap = await getDoc(doc(db, TREE_COLLECTION, TREE_DOC_ID));
  if (!snap.exists()) {
    throw new Error(`找不到 ${TREE_COLLECTION}/${TREE_DOC_ID}，請先執行 seed。`);
  }
  const data = snap.data() as { payload_json?: unknown; source_sha256?: string };
  if (typeof data.payload_json !== 'string') {
    throw new Error('樹文件缺少 payload_json，請重新執行 seed。');
  }

  const tree = JSON.parse(data.payload_json) as TreeDocument;
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    throw new Error('payload_json 沒有 nodes，拒絕渲染。');
  }
  tree.source_sha256 = data.source_sha256 ?? tree.source_sha256;
  return tree;
}
