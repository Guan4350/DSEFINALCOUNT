"use strict";
/**
 * 國策節點 schema — 嚴格對應業務給定的 13 個欄位，不增不減。
 * Firestore 文件路徑：focus_trees/{treeId}/nodes/{nodeId}
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRADES = exports.TREE_ID_PATTERN = exports.NODE_ID_PATTERN = exports.COEFFICIENT = exports.NODE_FIELDS = void 0;
exports.progressDocId = progressDocId;
exports.NODE_FIELDS = [
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
];
/** 狀態係數：只有 mastered / in_progress 會落庫。 */
exports.COEFFICIENT = {
    in_progress: 0.5,
    mastered: 1,
};
exports.NODE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
exports.TREE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
exports.GRADES = new Set(['4', '5', '5*']);
function progressDocId(treeId, nodeId) {
    return `${treeId}__${nodeId}`;
}
//# sourceMappingURL=schema.js.map