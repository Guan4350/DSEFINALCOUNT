# 國策樹系統 — 架構、Firestore Schema、Cloud Functions、Vue 元件

> 文件狀態：設計稿。所有寫入路徑皆為「先校驗、後人工確認、再由具權限流程提交」，本文件不執行任何資料庫寫入。

## 1. 範圍與技術決策

| 項目 | 決策 |
| --- | --- |
| 前端 | Vue 3 + Vite + Pinia + TypeScript（依本模式規範） |
| 後端 | Cloud Functions for Firebase v2，Node.js 20，region `asia-east1`（與現有 `functions/index.js` 一致） |
| 資料庫 | Firestore（Native） |
| 認證 | Firebase Auth（Google）；管理員以 `admins/{uid}.active == true` 判定 |
| 機密 | 無任何 API Key 進入前端；Functions 使用 ADC；前端僅持有可公開的 Firebase Web 設定（env 注入） |
| 寫入權限 | 節點、樹、進度全部經 Cloud Function（Admin SDK）寫入；Security Rules 對客戶端一律 `write: false` |

> 註：現有 `DSEFINALCOUNT` 前端為 React 19。本文件的資料層、Cloud Functions、Rules 與框架無關；若最終要併入現有殼層，只需將第 9 節的 Vue 元件改寫為 React 元件，介面與集合不變。

## 2. 系統架構

```text
┌─────────────────────────────┐
│ Vue 3 SPA                    │
│  FocusTreeView / Drawer      │
│  Pinia store                 │
└──────────┬──────────────────┘
           │ 1. 直接讀取（published only, Rules 允許）
           │ 2. httpsCallable（進度、校驗、發佈）
           ▼
┌─────────────────────────────┐        ┌──────────────────────────┐
│ Cloud Functions (asia-east1) │        │ Firestore                │
│  focusProgressGet            │◄──────►│  focus_trees/{treeId}    │
│  focusProgressSet            │        │    nodes/{nodeId}        │
│  focusTreeValidate (admin)   │        │  user_focus_progress/... │
│  focusTreePublish  (admin)   │        │  focus_tree_imports/...  │
│  audit log writer            │        │  audit_logs/...          │
└─────────────────────────────┘        └──────────────────────────┘
```

讀寫分離原則：

- **讀**：已發佈（`status == "published"`）的樹與節點由客戶端直接讀 Firestore，省 Function 冷啟動；Rules 限制只可讀已發佈版本。
- **寫**：一律經 Callable Function，Function 內做 schema 校驗、圖校驗、權限檢查與交易寫入。
- **敏感邏輯**：前置解鎖判定、加權完成度、跨樹查重、環檢測全部在伺服器端，前端只顯示結果。

## 3. Firestore Schema

### 3.1 `focus_trees/{treeId}` — 樹級中繼資料

```text
focus_trees/{treeId}
  name: string                  // 例："Chemistry 國策樹"
  subject: string               // 必須等於所有節點的 subject
  exam_year: number             // 例：2027
  schema_version: "1.0"
  status: "draft" | "published" | "archived"
  root_node_ids: string[]       // 入口節點，必須存在且無硬前置
  node_count: number
  total_weight: number          // 分母來源，本 4 節點 = 17
  version: number               // 樂觀鎖，每次發佈 +1
  checksum: string              // sha256(canonical nodes JSON)
  created_by: string            // uid
  created_at: timestamp
  updated_at: timestamp
  published_at: timestamp | null
```

`treeId` 慣例：`{subject}-{examYear}`（例：`chem-2027`）。

- 同一 subject **允許多棵樹**，以 `exam_year` 區分；`(subject, exam_year)` 全庫唯一，由發佈流程以查詢 + 交易保證。
- 舊年份樹改為 `status: "archived"` 保留，不刪除（歷史進度仍可回溯）。
- 學習者進度與樹綁定（`user_focus_progress/.../nodes/{treeId__nodeId}`），**不同年份的樹互不影響**。
- 發佈硬閘門：`mr_note` 不得為空，沒有開關可關閉（見第 7 節）。

### 3.2 `focus_trees/{treeId}/nodes/{nodeId}` — 節點（**僅 13 個欄位，不得增減**）

```text
focus_trees/{treeId}/nodes/{nodeId}
  id: string
  name: string
  description: string
  subject: string
  syllabus_ref: string
  mr_note: string               // "" 表示「待回填」，系統不得自動生成
  prerequisites: string[]       // 硬前置，節點 id
  soft_prerequisites: string[]  // 弱前置，id 或外部知識標籤
  target_grade: string          // "4" | "5" | "5*"（字串，不轉數字）
  estimated_hours: number
  validation_rule: string
  reward: string
  weight: number                // 整數 1–5
```

節點歸屬以**路徑**表示（`focus_trees/{treeId}/nodes/{nodeId}`），因此不需要在節點文件內加 `tree_id` 欄位；跨樹查詢用 collection group `nodes`。

### 3.3 `user_focus_progress/{uid}/nodes/{treeId__nodeId}` — 學習者進度

```text
user_focus_progress/{uid}/nodes/{treeId__nodeId}
  tree_id: string
  node_id: string
  status: "in_progress" | "mastered"
  evidence: string              // 可選，<= 500 字
  started_at: timestamp
  mastered_at: timestamp | null
  updated_at: timestamp
```

設計要點：

- **不儲存 `locked` / `available`**。解鎖狀態由「硬前置是否全部 mastered」即時推導，避免前置變更後狀態過期。
- 狀態係數（伺服器端計算，不落庫）：`mastered = 1`、`in_progress = 0.5`、無記錄 `= 0`。
- 文件 id 用 `treeId__nodeId`，一個使用者的一個節點只會有一份進度。

### 3.4 `focus_tree_imports/{importId}` — 匯入作業（人工確認載體）

```text
focus_tree_imports/{importId}
  tree_id: string
  status: "dry_run" | "approved" | "published" | "rejected"
  payload_hash: string          // sha256(節點陣列)，防止確認後內容被替換
  report: map                   // 校驗報告快照（errors / warnings / diff / stats）
  requested_by: string
  approved_by: string | null
  created_at: timestamp
  approved_at: timestamp | null
```

### 3.5 `audit_logs/{logId}` — 審計

```text
audit_logs/{logId}
  actor: string
  action: "focus_tree.validate" | "focus_tree.publish" | "focus_progress.set" | "focus_progress.reset"
  tree_id: string
  import_id: string | null
  before_version: number | null
  after_version: number | null
  payload_hash: string
  created_at: timestamp
```

### 3.6 重置語義（`focusProgressReset`）

- 重置 = **刪除**對應的進度文件，回到「未開始」；解鎖狀態即時重算。
- **級聯失效**：節點 X 被重置後，所有以 X 為硬前置（含遞迴下游）且已有進度的節點一併重置，預設 `cascade: true`。否則會出現「前置未掌握但下游已 mastered」的矛盾狀態。
- 重置只作用於指定 `treeId`；同一 subject 的其他年份樹不受影響。
- 管理介面流程：先 `dryRun` 取得受影響清單，人工確認後才送出 `dryRun: false`；API 不強制兩段式，供維運腳本使用。
- 重置寫入 `audit_logs`（actor、uid、treeId、被刪節點清單）。

## 4. 節點欄位規格與校驗規則

| 欄位 | 型別 | 規則 | 違反時 |
| --- | --- | --- | --- |
| `id` | string | `^[a-z][a-z0-9_]{2,63}$`，同一 payload 內唯一 | error |
| `name` | string | 1–120 字 | error |
| `description` | string | 1–2000 字 | error |
| `subject` | string | 必須等於 `tree.subject` | error |
| `syllabus_ref` | string | 1–200 字，非空 | error |
| `mr_note` | string | 0–5000 字；可為 `""`；**不自動生成** | missing 時 warning |
| `prerequisites` | string[] | ≤ 10；不得自引；必須存在於同樹 | error |
| `soft_prerequisites` | string[] | ≤ 10；每項 ≤ 200 字；可為外部標籤 | 未解析時 warning |
| `target_grade` | string | `"4"` / `"5"` / `"5*"` | error |
| `estimated_hours` | number | `0 < h ≤ 200` | error |
| `validation_rule` | string | 1–2000 字，非空 | error |
| `reward` | string | 0–500 字 | error |
| `weight` | number | 整數 1–5 | error |

嚴格模式：節點物件出現上述 13 個以外的 key 一律 `E_UNKNOWN_FIELD`；缺少任何 key 一律 `E_MISSING_FIELD`。

## 5. Cloud Functions 接口

所有函式回傳 `{ ok: true, data }` 或拋出 `HttpsError(code, message, details)`。

### 5.1 `focusProgressGet`（callable）

```ts
// 入參
{ treeId: string }

// 出參
{
  treeId: string
  denominator: number                    // total_weight，例 17
  earned: number                         // Σ(weight × 係數)
  percent: number                        // 0–100，一位小數
  items: Array<{
    nodeId: string
    weight: number
    status: "not_started" | "in_progress" | "mastered"
    coefficient: 0 | 0.5 | 1
    masteredAt: string | null
  }>
  unlockedNodeIds: string[]              // 硬前置全 mastered
  lockedReasons: Record<string, string[]> // nodeId -> 未 mastered 的前置 id
}
```

### 5.2 `focusProgressSet`（callable）

```ts
// 入參
{ treeId: string; nodeId: string; status: "in_progress" | "mastered"; evidence?: string }

// 出參
{ nodeId: string; status: string; percent: number; newlyUnlocked: string[] }
```

規則：

- `mastered` 為終態；由使用者發起的請求不可降級（管理員另走 `focusProgressReset`）。
- 設為 `mastered` 前，伺服器必須確認所有硬前置已 `mastered`，否則 `E_PREREQUISITE_NOT_MET`（details 列出缺哪幾個）。
- 寫入成功後重算加權百分比並回傳，前端不需自行計算。

### 5.3 `focusTreeValidate`（admin，dry-run）

```ts
// 入參
{ treeId: string; nodes: FocusNode[]; mode?: "dry_run" }   // mode 固定 dry_run

// 出參
{
  ok: boolean
  importId: string
  errors: Array<{ code: string; path: string; message: string }>
  warnings: Array<{ code: string; path: string; message: string }>
  stats: { nodeCount: number; totalWeight: number; maxDepth: number; rootCount: number }
  diff: {
    added: string[]; modified: string[]; removed: string[]; unchanged: string[]
  }
}
```

永不寫入 `nodes`；只寫 `focus_tree_imports/{importId}`（狀態 `dry_run`）。

### 5.4 `focusTreePublish`（admin）

```ts
// 入參
{ treeId: string; importId: string; expectedVersion: number }

// 出參
{ treeId: string; version: number; nodeCount: number; totalWeight: number; checksum: string; publishedAt: string }
```

驗證：

1. `importId` 存在且 `status == "approved"`，`approved_by == caller.uid`。
2. `payload_hash` 與核准時一致（防止確認後替換內容）。
3. `tree.version == expectedVersion`，否則 `E_VERSION_CONFLICT`。
4. 重新執行完整校驗（伺服器為準，不信任 dry-run 結果），且 **`mr_note` 全部非空**，否則 `E_MR_NOTE_MISSING`（details 列出 nodeId）。
5. 交易內寫入；超過 400 節點時改用分塊批次 + `status: "publishing"` 兩階段（見第 7 節）。

### 5.5 `focusProgressReset`（admin）

```ts
// 入參
{
  uid?: string            // 二選一
  email?: string          // 二選一，伺服器用 Admin Auth 解析
  treeId: string
  nodeIds?: string[]      // 省略 = 該樹全部節點
  cascade?: boolean       // 預設 true：連帶重置硬前置下游
  dryRun?: boolean        // 預設 false；true 只回報，不刪除
}

// 出參
{
  dryRun: boolean
  uid: string
  treeId: string
  nodeIds: string[]       // 實際作用範圍（已含級聯）
  affected: Array<{ nodeId: string; status: string; masteredAt: string | null }>
  deleted?: number        // dryRun=true 時不提供
}
```

```ts
// functions/src/focus-tree/reset.ts（節錄）
export const focusProgressReset = onCall({ region: REGION }, async (request) => {
  const actor = request.auth?.uid;
  await assertAdmin(actor);

  const { uid, email, treeId, nodeIds, cascade = true, dryRun = false } = request.data ?? {};
  if (!treeId || (!uid && !email)) {
    throw new HttpsError('invalid-argument', 'E_MISSING_FIELD', { fields: ['treeId', 'uid|email'] });
  }
  const targetUid = uid ?? (await getAuth().getUserByEmail(email)).uid;

  const treeRef = db.doc(`focus_trees/${treeId}`);
  const treeSnap = await treeRef.get();
  if (!treeSnap.exists) throw new HttpsError('not-found', 'E_TREE_NOT_FOUND', { treeId });

  const nodes = (await treeRef.collection('nodes').get()).docs.map(d => d.data() as FocusNode);
  const known = new Set(nodes.map(n => n.id));
  const selected = nodeIds?.length ? nodeIds : [...known];
  for (const id of selected) {
    if (!known.has(id)) throw new HttpsError('invalid-argument', 'E_UNKNOWN_NODE', { nodeId: id });
  }

  const targets = new Set(selected);
  if (cascade) {
    const dependents = new Map<string, string[]>();
    for (const n of nodes) {
      for (const p of n.prerequisites) {
        dependents.set(p, [...(dependents.get(p) ?? []), n.id]);
      }
    }
    const queue = [...targets];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const child of dependents.get(cur) ?? []) {
        if (!targets.has(child)) { targets.add(child); queue.push(child); }
      }
    }
  }

  const col = db.collection(`user_focus_progress/${targetUid}/nodes`);
  const snaps = await Promise.all([...targets].map(id => col.doc(`${treeId}__${id}`).get()));
  const affected = snaps.filter(s => s.exists).map(s => ({
    nodeId: (s.data()!.node_id as string),
    status: (s.data()!.status as string),
    masteredAt: s.data()!.mastered_at?.toDate?.().toISOString() ?? null,
  }));

  if (dryRun) {
    return { dryRun: true, uid: targetUid, treeId, nodeIds: [...targets], affected };
  }

  const ids = affected.map(a => `${treeId}__${a.nodeId}`);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 400)) batch.delete(col.doc(id));
    await batch.commit();
  }

  await db.collection('audit_logs').add({
    actor, action: 'focus_progress.reset', tree_id: treeId, import_id: null,
    before_version: null, after_version: null,
    payload_hash: sha256(JSON.stringify({ uid: targetUid, treeId, ids: ids.sort() })),
    created_at: FieldValue.serverTimestamp(),
  });

  return { dryRun: false, uid: targetUid, treeId, nodeIds: [...targets], affected, deleted: ids.length };
});
```

### 5.6 `focusAdminLookupUser`（admin）

```ts
// 入參
{ email: string }

// 出參
{ uid: string; email: string; displayName: string; disabled: boolean }
```

供管理介面以 email 搜尋學習者；僅 admin 可呼叫，不開放一般使用者列舉帳號。

### 5.7 錯誤碼

| 代碼 | 含義 |
| --- | --- |
| `E_MISSING_FIELD` / `E_UNKNOWN_FIELD` | 節點欄位缺漏或多出 |
| `E_INVALID_FIELD` | 型別或長度不符 |
| `E_DUPLICATE_ID` | payload 內 id 重複 |
| `E_MISSING_REF` | 硬前置指向不存在的節點 |
| `E_CYCLE_HARD` | 硬前置成環 |
| `E_ORPHAN` | 節點不可達且非 root（報告為 warning） |
| `E_VERSION_CONFLICT` | 樂觀鎖失敗 |
| `E_PREREQUISITE_NOT_MET` | 前置未掌握 |
| `E_NODE_HAS_PROGRESS` | 刪除仍有學習者進度的節點 |
| `E_NOT_APPROVED` | 未經人工核准即發佈 |
| `E_MR_NOTE_MISSING` | 有節點 `mr_note` 為空，禁止發佈（details 列出 nodeId） |
| `E_NOT_ADMIN` | 呼叫者非管理員 |
| `E_TREE_NOT_FOUND` / `E_UNKNOWN_NODE` | 樹或節點不存在 |
| `E_USER_NOT_FOUND` | email 查無帳號 |

## 6. 圖校驗與加權完成度

### 6.1 圖校驗順序

```text
1. 欄位白名單 / 型別 / 長度
2. id 格式與重複
3. 硬前置存在性、自引
4. 硬前置環檢測（DFS 三色）→ error
5. 弱前置解析：能對應到 id 的建立軟邊；否則視為外部標籤 → warning
6. root 判定：無硬前置者；root_node_ids 必須是其子集
7. 可達性：由 root 沿硬+軟邊下行，不可達 → orphan warning
8. 跨樹查重：collection group nodes，僅比對**同 subject + 同 exam_year** 的其他樹，name/syllabus_ref 正規化後相等 → warning；跨年份重複屬預期，不告警
9. 統計：node_count、total_weight、maxDepth
```

### 6.2 加權完成度

```text
分母 = Σ weight（本 4 節點 = 2+5+5+5 = 17）
分子 = Σ(weight_i × 係數_i)
係數：mastered = 1，in_progress = 0.5，未開始 = 0
percent = round(分子 / 分母 × 1000) / 10
```

範例：t01 mastered、t02 in_progress → (2×1 + 5×0.5) / 17 = 4.5 / 17 = 26.5%。

邊界：`total_weight == 0` 回傳 `percent: 0` 並附 `EMPTY_TREE` warning；進度中存在已不在樹內的節點時忽略並回傳 `stale_node_ids`。

## 7. 寫入管線（dry-run → 人工確認 → 發佈）

```text
JSON（業務給定）
   │
   ▼
focusTreeValidate ──► 報告（errors / warnings / diff）
   │                      │
   │  errors > 0          │ 人類審閱
   ▼                      ▼
拒絕，修正規格      核准（approved_by）
                          │
                          ▼
                 focusTreePublish（交易）
                    - 版本檢查
                    - 全量重校驗
                    - 寫 nodes + 更新 tree
                    - audit_logs
                          │
                          ▼
                    status = published
```

硬性約束：

- 同一 `treeId` 同時只允許一個 `approved` 的 import；新的 dry-run 使舊核准失效。
- 刪除節點前檢查 `user_focus_progress` 是否存在該 `treeId__nodeId`；存在則 `E_NODE_HAS_PROGRESS`，需管理員先遷移或封存。
- 節點 id 發佈後不可改名（改名 = 刪除 + 新增），避免進度斷鏈。
- `mr_note` 為**發佈硬閘門**：任何節點 `mr_note == ""` 即 `E_MR_NOTE_MISSING`，不可發佈。草稿階段可保存空字串，UI 標示「MR 待回填 n 條」，但不得繞過函式寫入 published。
- 目前 4 條節點 `mr_note` 皆為 `""`，因此在新 MR 內容補齊前，發佈會被拒絕（這是預期行為，不是 bug）。

## 8. Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isSelf(uid) { return signedIn() && request.auth.uid == uid; }
    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
        && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.active == true;
    }

    match /focus_trees/{treeId} {
      allow read: if resource.data.status == 'published' || isAdmin();

      match /nodes/{nodeId} {
        allow read: if isAdmin()
          || get(/databases/$(database)/documents/focus_trees/$(treeId)).data.status == 'published';
        allow write: if false;
      }
      allow write: if false;
    }

    match /user_focus_progress/{uid}/nodes/{progressId} {
      allow read: if isSelf(uid);
      allow write: if false;   // 只由 Cloud Function 寫入
    }

    match /focus_tree_imports/{importId} {
      allow read: if false;
      allow write: if false;
    }

    match /audit_logs/{logId} {
      allow read, write: if false;
    }
  }
}
```

`focusProgressSet` 以 Admin SDK 寫入，繞過 Rules；前端無法偽造進度或節點。

## 9. 前端 Vue 3 元件與資料流

### 9.1 檔案結構

```text
src/focus-tree/
  api.ts                     // 學習者 callable 封裝，無金鑰
  admin-api.ts               // 管理員 callable 封裝
  types.ts                   // FocusNode / Tree / ProgressSnapshot / ResetResult
  stores/focusTree.ts        // Pinia（學習者）
  components/FocusNodeCard.vue
  components/FocusNodeDrawer.vue
  components/WeightedProgress.vue
  views/FocusTreeView.vue
  views/AdminProgressResetView.vue
```

路由：`/focus/:treeId`（學習者）、`/admin/focus-progress`（admin guard，讀 `admins/{uid}` 或 custom claim）。

### 9.2 資料流

```text
mount
  ├─ Firestore 直接讀 focus_trees/{treeId}（status=published）
  ├─ Firestore 直接讀 nodes 子集合
  └─ focusProgressGet → items / percent / unlockedNodeIds
        │
        ▼
  store.tree / store.nodes / store.progress
        │
        ├─ 卡片點擊 → Drawer 顯示 validation_rule / reward / 前置
        └─ 標記掌握 → focusProgressSet → 回傳 percent + newlyUnlocked → 區域更新
```

### 9.3 `api.ts`

```ts
import { getFunctions, httpsCallable } from 'firebase/functions';

const fns = getFunctions(undefined, 'asia-east1');

export interface FocusNode {
  id: string; name: string; description: string; subject: string;
  syllabus_ref: string; mr_note: string;
  prerequisites: string[]; soft_prerequisites: string[];
  target_grade: string; estimated_hours: number;
  validation_rule: string; reward: string; weight: number;
}

export interface ProgressSnapshot {
  treeId: string; denominator: number; earned: number; percent: number;
  items: Array<{ nodeId: string; weight: number; status: string; coefficient: number; masteredAt: string | null }>;
  unlockedNodeIds: string[];
  lockedReasons: Record<string, string[]>;
}

const call = <TReq, TRes>(name: string) => httpsCallable<TReq, TRes>(fns, name);

export const getProgress = (treeId: string) =>
  call<{ treeId: string }, ProgressSnapshot>('focusProgressGet')({ treeId }).then(r => r.data);

export const setProgress = (input: { treeId: string; nodeId: string; status: 'in_progress' | 'mastered'; evidence?: string }) =>
  call<typeof input, { nodeId: string; status: string; percent: number; newlyUnlocked: string[] }>('focusProgressSet')(input).then(r => r.data);
```

### 9.4 Pinia store（節錄）

```ts
import { defineStore } from 'pinia';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getProgress, setProgress, type FocusNode } from '../api';

export const useFocusTree = defineStore('focusTree', {
  state: () => ({
    treeId: '' as string,
    tree: null as null | Record<string, unknown>,
    nodes: [] as FocusNode[],
    percent: 0,
    items: new Map<string, { status: string; coefficient: number }>(),
    unlocked: new Set<string>(),
    reasons: {} as Record<string, string[]>,
    loading: false,
    error: '' as string,
  }),
  getters: {
    nodeById: (s) => (id: string) => s.nodes.find(n => n.id === id),
    weightOf: (s) => (id: string) => s.nodes.find(n => n.id === id)?.weight ?? 0,
  },
  actions: {
    async load(treeId: string) {
      this.loading = true; this.error = '';
      try {
        const treeSnap = await getDoc(doc(db, 'focus_trees', treeId));
        if (!treeSnap.exists() || treeSnap.data().status !== 'published') throw new Error('樹未發佈');
        this.treeId = treeId; this.tree = treeSnap.data();
        const nodeSnap = await getDocs(collection(db, 'focus_trees', treeId, 'nodes'));
        this.nodes = nodeSnap.docs.map(d => d.data() as FocusNode);
        await this.refresh();
      } catch (e) {
        this.error = (e as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      const snap = await getProgress(this.treeId);
      this.percent = snap.percent;
      this.items = new Map(snap.items.map(i => [i.nodeId, { status: i.status, coefficient: i.coefficient }]));
      this.unlocked = new Set(snap.unlockedNodeIds);
      this.reasons = snap.lockedReasons;
    },
    async mark(nodeId: string, status: 'in_progress' | 'mastered', evidence?: string) {
      const res = await setProgress({ treeId: this.treeId, nodeId, status, evidence });
      this.percent = res.percent;
      await this.refresh();
    },
  },
});
```

### 9.5 `FocusNodeCard.vue`（節錄）

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { FocusNode } from '../api';

const props = defineProps<{ node: FocusNode; status: string; unlocked: boolean; missing: string[] }>();
const emit = defineEmits<{ open: [id: string] }>();

const statusLabel = computed(() => ({
  mastered: '已掌握', in_progress: '進行中', not_started: props.unlocked ? '可開始' : '未解鎖',
})[props.status] ?? '可開始');
</script>

<template>
  <article class="focus-node" :class="[`is-${status}`, { locked: !unlocked }]" @click="emit('open', node.id)">
    <header>
      <span class="weight">重量 {{ node.weight }}</span>
      <h3>{{ node.name }}</h3>
      <span class="chip">{{ statusLabel }}</span>
    </header>
    <p class="desc">{{ node.description }}</p>
    <footer>
      <span>{{ node.estimated_hours }} h</span>
      <span v-if="node.reward">{{ node.reward }}</span>
      <span v-if="!unlocked" class="hint">需先完成：{{ missing.join('、') }}</span>
    </footer>
  </article>
</template>
```

樹狀排版：前端由 `prerequisites` 計算最長路徑深度，節點按 depth 分欄，硬邊畫實線、軟邊畫虛線；4 節點規模不需要後端拓撲排序介面。

### 9.6 `admin-api.ts`

```ts
import { getFunctions, httpsCallable } from 'firebase/functions';

const fns = getFunctions(undefined, 'asia-east1');

export interface ResetInput {
  uid?: string; email?: string; treeId: string;
  nodeIds?: string[]; cascade?: boolean; dryRun?: boolean;
}

export interface ResetResult {
  dryRun: boolean; uid: string; treeId: string; nodeIds: string[];
  affected: Array<{ nodeId: string; status: string; masteredAt: string | null }>;
  deleted?: number;
}

export const adminLookupUser = (email: string) =>
  httpsCallable<{ email: string }, { uid: string; email: string; displayName: string; disabled: boolean }>(
    fns, 'focusAdminLookupUser',
  )({ email }).then(r => r.data);

export const adminResetProgress = (input: ResetInput) =>
  httpsCallable<ResetInput, ResetResult>(fns, 'focusProgressReset')(input).then(r => r.data);
```

### 9.7 `AdminProgressResetView.vue`（管理員重置介面）

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { adminLookupUser, adminResetProgress, type ResetResult } from '../admin-api';

interface TreeRow { id: string; name: string; subject: string; examYear: number; status: string }
interface NodeRow { id: string; name: string; weight: number }

const trees = ref<TreeRow[]>([]);
const treeId = ref('');
const email = ref('');
const user = ref<{ uid: string; email: string; displayName: string } | null>(null);
const nodes = ref<NodeRow[]>([]);
const selected = ref<string[]>([]);
const cascade = ref(true);
const preview = ref<ResetResult | null>(null);
const confirmText = ref('');
const busy = ref(false);
const error = ref('');

const currentTree = computed(() => trees.value.find(t => t.id === treeId.value));
const allSelected = computed(() => nodes.value.length > 0 && selected.value.length === nodes.value.length);

onMounted(async () => {
  const snap = await getDocs(collection(db, 'focus_trees'));
  trees.value = snap.docs.map(d => {
    const v = d.data() as Record<string, unknown>;
    return { id: d.id, name: String(v.name), subject: String(v.subject), examYear: Number(v.exam_year), status: String(v.status) };
  });
});

async function selectTree(id: string) {
  treeId.value = id;
  preview.value = null;
  confirmText.value = '';
  const snap = await getDocs(collection(db, 'focus_trees', id, 'nodes'));
  nodes.value = snap.docs.map(d => {
    const v = d.data() as Record<string, unknown>;
    return { id: String(v.id), name: String(v.name), weight: Number(v.weight) };
  });
  selected.value = nodes.value.map(n => n.id);
}

async function findUser() {
  error.value = '';
  try {
    user.value = await adminLookupUser(email.value.trim());
    preview.value = null;
  } catch (e) {
    user.value = null;
    error.value = (e as Error).message;
  }
}

function toggleAll() {
  selected.value = allSelected.value ? [] : nodes.value.map(n => n.id);
}

async function runPreview() {
  if (!user.value) return;
  busy.value = true; error.value = '';
  try {
    preview.value = await adminResetProgress({
      uid: user.value.uid, treeId: treeId.value,
      nodeIds: selected.value, cascade: cascade.value, dryRun: true,
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function runReset() {
  if (!user.value || !preview.value) return;
  if (confirmText.value !== treeId.value) { error.value = '請輸入完整 treeId 以確認'; return; }
  busy.value = true; error.value = '';
  try {
    await adminResetProgress({
      uid: user.value.uid, treeId: treeId.value,
      nodeIds: selected.value, cascade: cascade.value, dryRun: false,
    });
    preview.value = null;
    confirmText.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="admin-reset">
    <h1>重置學習進度</h1>

    <label>樹（按 subject / 年份）</label>
    <select v-model="treeId" @change="selectTree(treeId)">
      <option value="" disabled>選擇樹</option>
      <option v-for="t in trees" :key="t.id" :value="t.id">
        {{ t.subject }} · {{ t.examYear }} · {{ t.name }}（{{ t.status }}）
      </option>
    </select>

    <label>學習者 email</label>
    <div class="row">
      <input v-model="email" type="email" placeholder="student@example.com" />
      <button :disabled="!email" @click="findUser">查找</button>
    </div>
    <p v-if="user">{{ user.displayName }}（{{ user.uid }}）</p>

    <template v-if="currentTree && user">
      <label>節點範圍（預設全樹）</label>
      <button class="link" @click="toggleAll">{{ allSelected ? '取消全選' : '全選' }}</button>
      <ul class="nodes">
        <li v-for="n in nodes" :key="n.id">
          <label><input v-model="selected" type="checkbox" :value="n.id" /> {{ n.name }}（重量 {{ n.weight }}）</label>
        </li>
      </ul>

      <label><input v-model="cascade" type="checkbox" /> 級聯重置下游節點</label>

      <button :disabled="busy || !selected.length" @click="runPreview">預覽影響</button>

      <div v-if="preview">
        <p>影響 {{ preview.affected.length }} 份進度：</p>
        <ul>
          <li v-for="a in preview.affected" :key="a.nodeId">{{ a.nodeId }} — {{ a.status }} — {{ a.masteredAt ?? '—' }}</li>
        </ul>
        <label>輸入 <code>{{ treeId }}</code> 確認</label>
        <input v-model="confirmText" />
        <button class="danger" :disabled="busy || confirmText !== treeId" @click="runReset">確認重置</button>
      </div>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>
```

### 9.8 管理員重置資料流

```text
/admin/focus-progress
  ├─ 讀 focus_trees（admin 可讀全部 state）
  ├─ 選 treeId → 讀 nodes 子集合 → 勾選節點
  ├─ email → focusAdminLookupUser → uid
  ├─ focusProgressReset(dryRun: true) → 影響清單（含級聯）
  ├─ 人工輸入 treeId 確認
  └─ focusProgressReset(dryRun: false) → 刪除 + audit_logs
```

## 10. 索引與部署

`firestore.indexes.json` 追加：

```json
{
  "indexes": [
    { "collectionGroup": "focus_trees", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "updated_at", "order": "DESCENDING" }] },
    { "collectionGroup": "focus_trees", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "subject", "order": "ASCENDING" }, { "fieldPath": "exam_year", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": []
}
```

`collection group nodes` 的 `subject` 等值查詢使用 Firestore 自動建立的單欄位索引，無需複合索引。

部署指令：

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions:focusProgressGet,functions:focusProgressSet,functions:focusTreeValidate,functions:focusTreePublish
```

## 11. 現有 4 節點的落地檢查

| 檢查項 | 結果 | 處理 |
| --- | --- | --- |
| id 命名 | `chem_t01_*` … `chem_t04_*` 符合 `^[a-z][a-z0-9_]{2,63}$` | 可直接匯入 |
| weight 量表 | 2 / 5 / 5 / 5，落在 1–5 整數 | `total_weight = 17`，與分母一致 |
| 孤兒節點 | t01 無前置為 root；t02←t01、t03←t02、t04←t03 | 4 條同樹發佈即連通；只匯入部分才會有 orphan warning |
| 弱前置 | `初中科學：混合物與分離的基礎概念` 不是節點 id | 視為外部標籤，不建邊、不阻擋，報告記 warning |
| target_grade | 全部 `"4"` | 以字串儲存；`validation_rule` 文字屬業務內容，系統不解析、不推導門檻 |
| mr_note | 全部 `""` | **發佈硬閘門**：4 條皆空時 `focusTreePublish` 回 `E_MR_NOTE_MISSING`；補齊 MR 後才可發佈 |
| 跨樹查重 | 僅比對同 subject + 同 exam_year 的其他樹 | 跨年份重複不告警；同年度重複才需人工裁決 |
| 多樹並存 | 同 subject 允許 `chem-2026` / `chem-2027` / … | 進度以 `treeId__nodeId` 隔離，互不影響 |

## 12. 決策記錄與待確認

已定案：

1. 同 subject **允許多棵樹**，以 `exam_year` 區分；`treeId = {subject}-{examYear}`。
2. 發佈時 `mr_note` **強制非空**，不提供關閉開關。
3. 提供管理員 `focusProgressReset` 介面：`dry-run` 預覽 → 級聯重置 → `audit_logs`。

仍待確認：

1. 首棵樹的 `exam_year` 與 `treeId`（暫以 `chem-2027` 為例）。
2. `archived` 樹的進度是否轉為唯讀（建議是，僅保留歷史查詢）。
3. 是否需要一次重置多個 uid（目前介面為單一使用者）。
