import type { FocusNode } from '../types';

export interface AdvisorBridge {
  onNodeSelected?: (node: FocusNode) => void;
}

declare global {
  interface Window {
    __focusTreeAdvisor?: AdvisorBridge;
  }
}

/**
 * 預留給 Gemini 前端顧問的接口。
 * 節點展開時同時觸發 DOM CustomEvent 與 window bridge，兩者都不會寫入資料。
 */
export function emitNodeSelected(node: FocusNode): void {
  window.dispatchEvent(new CustomEvent('focus-tree:node-selected', { detail: node }));
  window.__focusTreeAdvisor?.onNodeSelected?.(node);
}
