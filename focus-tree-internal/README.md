# Chemistry 國策樹（內部完整版）

嚴格依照 `chem_focus_tree.final.json`（`chem-focus-tree-3.1.0`，LOCKED，sha256 `7a7da0c2…`）渲染，不新增、不改寫任何節點、前置、權重或評分內容。

## 為什麼資料在 Firestore

定稿 JSON 含 **CONFIDENTIAL** 的 2024 HKEAA Marking Scheme 節點（`CHEM-MS*`）。GitHub Pages 是公開靜態站，若把 JSON 打包進 `dist`，任何人下載 JS 就能取得機密內容。

因此：

- **GitHub Pages 只托管網站外殼**，不含任何國策資料。
- 樹資料存於 `internal_focus_trees/chem_3_1_0`，只有 `internal_access/{uid}.active == true` 的帳號可讀。
- `internal_focus_progress/{uid}` 只允許本人讀寫。
- 無 Cloud Functions，完全相容 **Spark**：載入 2 次讀取、切換狀態 1 次寫入。

## 資料模型

```text
internal_focus_trees/chem_3_1_0
  schema_version, status, node_count
  payload_json: 完整定稿 JSON（原始字串，避免 Firestore 欄位名限制）
  source_sha256, imported_at

internal_access/{uid}
  active: true

internal_focus_progress/{uid}
  tree_id: "chem-focus-tree-3.1.0"
  statuses: { "CHEM-P1-T01": "completed", ... }
  updated_at: serverTimestamp
```

狀態：`not_started` / `in_progress` / `completed`。

## 進度計算

- **官方加權完成度**：只採官方公佈的 Paper 1 60、Paper 2 20、SBA 20，分母 100。
  - `completed = 1`、`in_progress = 0.5`、`not_started = 0`。
  - `CHEM-ROOT` 的 100 是總量，不重複計入。
- 其餘 33 個節點 `weight = null`，**不參與加權**，只顯示完成數（課題 12、選修 3、SBA 1）。
- 不補任何權重、不改前置；31 個 root 維持 root。

## 前置與 OR

- 只使用 JSON 的 `prerequisites`；全部 `completed` 才解鎖。
- Spark 沒有 Functions，前置檢查在**前端**執行；Firestore Rules 只保證「只能寫自己的進度」，不驗證圖結構。這是 Spark 的取捨。
- 「三選二」無 schema 表達（G08），UI 只提示，不強制。

## 國策圖標欄目

- 頂部 tab：**國策**（18 個主題圖標）／**樹狀圖**（37 節點）。
- 圖標已從提供的 6×3 拼圖裁切、去背，存放於 `public/icons/topics/`。
- 中英雙語標籤在 `src/data/topicIcons.ts`，與節點的對應是**展示層設定**，不改動定稿資料。
- 已綁定：Topic I–XV、Paper 2、SBA-01 等。
- 待綁定：`化學基礎概念`、`計量分析基礎`，因定稿沒有單一官方節點，UI 明確標示而不強行對應。

## 本機啟動

```bash
cd focus-tree-internal
cp .env.example .env.local   # 或沿用 root .env.local 的六個值
npm install --legacy-peer-deps
npm run dev                  # http://localhost:5173
```

## App Check

專案已使用 reCAPTCHA Enterprise。若 Console 對 **Firestore** 開啟 enforcement，必須設定：

```text
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=6L...
```

本機若被網域限制擋住，可設 `VITE_APPCHECK_DEBUG_TOKEN` 並把 token 加入 App Check allowlist。

## 部署 Rules

內部集合的規則已合併在專案根 `firestore.rules`（`hasInternalAccess`、`internal_focus_trees`、`internal_focus_progress`）。

```bash
cd ..
firebase deploy --only firestore:rules
```

> 不要部署 `focus-tree-internal` 內任何獨立 rules 檔；Firestore 每個專案只有一份規則。

## Seed 定稿 JSON

```bash
cd focus-tree-internal
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
GCLOUD_PROJECT=dsefinalcount \
npm run seed -- seed/chem_focus_tree.final.json <你的uid>
npm run seed -- --dry-run   # 只驗證 JSON 與 sha256，不寫入
```

- 第二個參數會建立 `internal_access/{uid}`；其他內部人員在 Console 手動加。
- seed 會拒絕非 `LOCKED` 或沒有 `nodes` 的 JSON；`firebase-admin` 優先從 `functions/node_modules` 解析，請先在 `functions` 執行過 `npm install`。
- 寫入前後請比對終端輸出的 `sha256` 是否等於 lock 檔。

## 部署 GitHub Pages

1. repo → Settings → Pages → Source: GitHub Actions。
2. 設定 Secrets：`VITE_FIREBASE_*` 六個值。
3. push 到 `main`，workflow `pages.yml` 會 typecheck / build / deploy。
4. Firebase Auth → Settings → Authorized domains 加入 `<user>.github.io`。

`base: './'` 與單頁 App，不需要 404 fallback。

## 測試清單

### 本地

- [ ] `npm run typecheck` 通過
- [ ] `npm run build` 產出 `dist`
- [ ] 未登入時只看到登入頁，Network 沒有 Firestore 樹資料
- [ ] seed 後 `internal_focus_trees` 的 `source_sha256` 與 lock 一致
- [ ] 樹載入 37 節點、6 個分組、MS 分組標示機密

### 權限

- [ ] 無 `internal_access` 的帳號登入 → 顯示「沒有內部存取權限」，讀不到樹
- [ ] A 用戶不能讀 B 的 `internal_focus_progress`
- [ ] 未登入直接讀 `internal_focus_trees` → permission denied
- [ ] 前端不能寫 `internal_focus_trees` / `internal_access`

### 同步

- [ ] 兩個瀏覽器同一帳號，切換狀態後另一端即時更新（onSnapshot）
- [ ] 離線改狀態 → 恢復網絡後寫入
- [ ] 重新整理後狀態保留

### 進度與解鎖

- [ ] 初始加權 0%
- [ ] 只把 `CHEM-P1` 設 completed → 加權 60%
- [ ] `CHEM-ROOT` 在 P1/P2/SBA 未全完成前鎖定
- [ ] `CHEM-P1-T04` 在 T03 未完成前鎖定
- [ ] 鎖定節點只能維持「未開始」，不能設進行中／完成
- [ ] 課題完成數 12、選修 3、SBA 1 各自獨立計算

### Debug / Advisor

- [ ] `?debug=1` 或右下 DEBUG 開啟面板
- [ ] Debug 顯示 sha256、release、每個節點的前置判定與 raw statuses
- [ ] 點節點時 `focus-tree:node-selected` 事件帶完整 node
- [ ] `window.__focusTreeAdvisor.onNodeSelected` 可接到同一物件

## 已知限制（不自行修正）

1. 33 個節點 weight 為 null，官方加權只覆蓋三個模塊。
2. 31 個 root 是定稿資料現狀，非 UI bug。
3. 三選二 OR 無法表達。
4. Paper 1 Section A 答案鍵與 Q8 缺口（G01/G02）維持。
5. MS 節點僅限內部；不得截圖外流或提供給學生。
