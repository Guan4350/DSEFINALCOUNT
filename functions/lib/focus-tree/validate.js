"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = void 0;
exports.canonicalNode = canonicalNode;
exports.payloadHash = payloadHash;
exports.validateTreeNodes = validateTreeNodes;
exports.buildReport = buildReport;
const node_crypto_1 = require("node:crypto");
const admin_1 = require("./admin");
const schema_1 = require("./schema");
const sha256 = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
exports.sha256 = sha256;
function canonicalNode(node) {
    const out = {};
    for (const field of schema_1.NODE_FIELDS) {
        out[field] = node[field];
    }
    return out;
}
function payloadHash(nodes) {
    const sorted = nodes.map(canonicalNode).sort((a, b) => a.id.localeCompare(b.id));
    return (0, exports.sha256)(JSON.stringify(sorted));
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value) => (typeof value === 'string' ? value : '');
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');
async function validateTreeNodes(treeId, meta, existing, input) {
    const errors = [];
    const warnings = [];
    const nodes = [];
    const ids = new Set();
    if (!Array.isArray(input) || input.length === 0) {
        errors.push({ code: 'E_EMPTY_TREE', path: 'nodes', message: '至少需要一個節點' });
    }
    const rawNodes = Array.isArray(input) ? input : [];
    if (rawNodes.length > 400) {
        errors.push({ code: 'E_TREE_TOO_LARGE', path: 'nodes', message: '單次最多 400 個節點' });
    }
    rawNodes.forEach((item, index) => {
        const path = `nodes[${index}]`;
        if (!isRecord(item)) {
            errors.push({ code: 'E_INVALID_FIELD', path, message: '節點必須是物件' });
            return;
        }
        const extra = Object.keys(item).filter(key => !schema_1.NODE_FIELDS.includes(key));
        const missing = schema_1.NODE_FIELDS.filter(field => !(field in item));
        if (extra.length > 0) {
            errors.push({ code: 'E_UNKNOWN_FIELD', path, message: `不允許的欄位：${extra.join(', ')}` });
        }
        if (missing.length > 0) {
            errors.push({ code: 'E_MISSING_FIELD', path, message: `缺少欄位：${missing.join(', ')}` });
        }
        const id = asString(item.id);
        if (!schema_1.NODE_ID_PATTERN.test(id)) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.id`, message: 'id 需符合 ^[a-z][a-z0-9_]{2,63}$' });
        }
        else if (ids.has(id)) {
            errors.push({ code: 'E_DUPLICATE_ID', path: `${path}.id`, message: `id 重複：${id}` });
        }
        ids.add(id);
        const name = asString(item.name);
        if (name.length < 1 || name.length > 120) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.name`, message: 'name 長度需為 1–120' });
        }
        const description = asString(item.description);
        if (description.length < 1 || description.length > 2000) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.description`, message: 'description 長度需為 1–2000' });
        }
        const subject = asString(item.subject);
        if (subject !== meta.subject) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.subject`, message: `subject 必須等於樹的 ${meta.subject}` });
        }
        const syllabusRef = asString(item.syllabus_ref);
        if (syllabusRef.length < 1 || syllabusRef.length > 200) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.syllabus_ref`, message: 'syllabus_ref 長度需為 1–200' });
        }
        if (typeof item.mr_note !== 'string' || item.mr_note.length > 5000) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.mr_note`, message: 'mr_note 需為字串且 ≤5000 字' });
        }
        const mrNote = asString(item.mr_note);
        if (mrNote.trim().length === 0) {
            warnings.push({ code: 'E_MR_NOTE_PENDING', path: `${path}.mr_note`, message: 'mr_note 尚未回填，發佈會被擋下' });
        }
        if (!Array.isArray(item.prerequisites)) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.prerequisites`, message: 'prerequisites 需為陣列' });
        }
        const prerequisites = asStringArray(item.prerequisites);
        if (prerequisites.length > 10) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.prerequisites`, message: 'prerequisites 最多 10 個' });
        }
        if (!Array.isArray(item.soft_prerequisites)) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.soft_prerequisites`, message: 'soft_prerequisites 需為陣列' });
        }
        const softPrerequisites = asStringArray(item.soft_prerequisites);
        if (softPrerequisites.length > 10) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.soft_prerequisites`, message: 'soft_prerequisites 最多 10 個' });
        }
        for (const soft of softPrerequisites) {
            if (soft.length > 200) {
                errors.push({ code: 'E_INVALID_FIELD', path: `${path}.soft_prerequisites`, message: 'soft_prerequisites 單項需 ≤200 字' });
                break;
            }
        }
        const targetGrade = asString(item.target_grade);
        if (!schema_1.GRADES.has(targetGrade)) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.target_grade`, message: 'target_grade 需為 4 / 5 / 5*' });
        }
        const hours = asNumber(item.estimated_hours);
        if (!(hours > 0 && hours <= 200)) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.estimated_hours`, message: 'estimated_hours 需 >0 且 ≤200' });
        }
        const validationRule = asString(item.validation_rule);
        if (validationRule.length < 1 || validationRule.length > 2000) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.validation_rule`, message: 'validation_rule 長度需為 1–2000' });
        }
        const reward = asString(item.reward);
        if (reward.length > 500) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.reward`, message: 'reward 需 ≤500 字' });
        }
        const weight = asNumber(item.weight);
        if (!Number.isInteger(weight) || weight < 1 || weight > 5) {
            errors.push({ code: 'E_INVALID_FIELD', path: `${path}.weight`, message: 'weight 需為 1–5 的整數' });
        }
        nodes.push({
            id,
            name,
            description,
            subject,
            syllabus_ref: syllabusRef,
            mr_note: mrNote,
            prerequisites,
            soft_prerequisites: softPrerequisites,
            target_grade: targetGrade,
            estimated_hours: Number.isFinite(hours) ? hours : 0,
            validation_rule: validationRule,
            reward,
            weight: Number.isFinite(weight) ? weight : 0,
        });
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
        for (const prerequisite of node.prerequisites) {
            if (prerequisite === node.id) {
                errors.push({ code: 'E_SELF_REFERENCE', path: `nodes.${node.id}.prerequisites`, message: '節點不可自引' });
            }
            else if (!byId.has(prerequisite)) {
                errors.push({
                    code: 'E_MISSING_REF',
                    path: `nodes.${node.id}.prerequisites`,
                    message: `前置節點不存在：${prerequisite}`,
                });
            }
        }
    }
    // 硬前置環檢測（三色 DFS）。
    const state = new Map();
    const stack = [];
    const cycles = [];
    const visit = (id) => {
        state.set(id, 1);
        stack.push(id);
        for (const prerequisite of byId.get(id)?.prerequisites ?? []) {
            if (!byId.has(prerequisite))
                continue;
            const status = state.get(prerequisite);
            if (status === 1) {
                const start = stack.indexOf(prerequisite);
                cycles.push([...stack.slice(start), prerequisite]);
            }
            else if (status === undefined) {
                visit(prerequisite);
            }
        }
        stack.pop();
        state.set(id, 2);
    };
    for (const id of byId.keys()) {
        if (state.get(id) === undefined)
            visit(id);
    }
    for (const cycle of cycles.slice(0, 5)) {
        errors.push({ code: 'E_CYCLE_HARD', path: 'nodes.prerequisites', message: `硬前置成環：${cycle.join(' → ')}` });
    }
    const roots = nodes.filter(node => node.prerequisites.length === 0).map(node => node.id);
    const providedRoots = (meta.root_node_ids ?? []).slice().sort();
    if (providedRoots.length > 0 && providedRoots.join(',') !== roots.slice().sort().join(',')) {
        warnings.push({
            code: 'E_ROOT_MISMATCH',
            path: 'root_node_ids',
            message: `樹的 root_node_ids 與推導結果不同，發佈時將更新為 ${roots.join(', ') || '（無）'}`,
        });
    }
    // 可達性：root 沿硬前置反向邊（含可解析的軟前置）。
    const dependents = new Map();
    for (const node of nodes) {
        for (const prerequisite of node.prerequisites) {
            dependents.set(prerequisite, [...(dependents.get(prerequisite) ?? []), node.id]);
        }
        for (const soft of node.soft_prerequisites) {
            if (byId.has(soft)) {
                dependents.set(soft, [...(dependents.get(soft) ?? []), node.id]);
            }
        }
    }
    const reachable = new Set();
    const queue = [...roots];
    while (queue.length > 0) {
        const current = queue.pop();
        if (reachable.has(current))
            continue;
        reachable.add(current);
        for (const child of dependents.get(current) ?? []) {
            if (!reachable.has(child))
                queue.push(child);
        }
    }
    if (cycles.length === 0) {
        for (const node of nodes) {
            if (!reachable.has(node.id)) {
                warnings.push({
                    code: 'E_ORPHAN',
                    path: `nodes.${node.id}`,
                    message: '節點不可由任何 root 抵達',
                });
            }
        }
    }
    const depthMemo = new Map();
    const depthOf = (id, seen) => {
        const cached = depthMemo.get(id);
        if (cached !== undefined)
            return cached;
        const node = byId.get(id);
        if (!node || seen.has(id))
            return 0;
        const next = new Set(seen);
        next.add(id);
        const depth = node.prerequisites.length
            ? 1 + Math.max(...node.prerequisites.filter(p => byId.has(p)).map(p => depthOf(p, next)), 0)
            : 0;
        depthMemo.set(id, depth);
        return depth;
    };
    const maxDepth = nodes.length > 0 ? Math.max(...nodes.map(node => depthOf(node.id, new Set()))) : 0;
    // 跨樹查重：只比對同 subject + 同 exam_year 的其他樹。
    const treesSnap = await admin_1.db.collection('focus_trees').where('subject', '==', meta.subject).get();
    for (const treeDoc of treesSnap.docs) {
        if (treeDoc.id === treeId)
            continue;
        if (Number(treeDoc.get('exam_year')) !== Number(meta.exam_year))
            continue;
        const otherSnap = await treeDoc.ref.collection('nodes').get();
        for (const otherDoc of otherSnap.docs) {
            const other = otherDoc.data();
            const match = nodes.find(node => normalize(node.name) === normalize(String(other.name)) ||
                normalize(node.syllabus_ref) === normalize(String(other.syllabus_ref)));
            if (match) {
                warnings.push({
                    code: 'E_DUPLICATE_CROSS_TREE',
                    path: `nodes.${match.id}`,
                    message: `與 ${treeDoc.id}/${otherDoc.id} 名稱或 syllabus_ref 重複`,
                });
            }
        }
    }
    const existingById = new Map(existing.map(node => [node.id, node]));
    const incomingById = new Map(nodes.map(node => [node.id, node]));
    const added = [...incomingById.keys()].filter(id => !existingById.has(id));
    const removed = [...existingById.keys()].filter(id => !incomingById.has(id));
    const modified = [...incomingById.keys()].filter(id => {
        const before = existingById.get(id);
        if (!before)
            return false;
        return JSON.stringify(canonicalNode(before)) !== JSON.stringify(canonicalNode(incomingById.get(id)));
    });
    const unchanged = [...incomingById.keys()].filter(id => existingById.has(id) && !modified.includes(id));
    const stats = {
        nodeCount: nodes.length,
        totalWeight: nodes.reduce((sum, node) => sum + (Number.isFinite(node.weight) ? node.weight : 0), 0),
        maxDepth,
        rootCount: roots.length,
    };
    return {
        nodes,
        errors,
        warnings,
        stats,
        diff: { added, modified, removed, unchanged },
    };
}
function buildReport(result) {
    return {
        ok: result.errors.length === 0,
        errors: result.errors,
        warnings: result.warnings,
        stats: result.stats,
        diff: result.diff,
    };
}
//# sourceMappingURL=validate.js.map