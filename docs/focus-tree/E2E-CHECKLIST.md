# chem-2027 部署與端到端驗收

> 目標：部署 → seed → App Check 驗證 → 補 mr_note → 第一次 publish → 學習者／管理員端到端測試。
> 本文件不產生任何 DSE 內容；mr_note 必須由業務提供的 Marking Report 填入。

## 0. 前置條件

- [ ] Firebase 專案為 Blaze（Functions v2）
- [ ] 已啟用 Google 登入
- [ ] 你的 uid 已寫入 `admins/{uid}`，`active: true`
- [ ] 已安裝 Firebase CLI（`firebase --version`）
- [ ] `focus-tree-web/.env.local` 已填 6 個 Firebase 值與 `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
- [ ] 本機有 ADC 或 service account，可執行 Admin SDK（seed 用）

先跑預檢：

```bash
cd /Users/JACKY/Documents/deepseek-harness/DSEFINALCOUNT
node scripts/preflight-focus-tree.mjs
```

目前預期：

- FAIL：`.env.local` 未建立 / Web env 未填
- WARN：fixture 的 4 條 mr_note 尚未補（也可在 admin UI 補）
- 其他 PASS

## 1. 建置與部署

```bash
cd functions
npm install                 # 需要 typescript / @types/node
npm run build:focus-tree
node --check index.js
cd ..
firebase use <project-id>
firebase deploy --only functions,firestore:rules
```

預期：

- Console → Functions 看到 `focusTreeValidate`、`focusTreeApprove`、`focusTreePublish`、`focusProgressGet/Set`、`focusProgressReset`、`focusAdminLookupUser`
- Firestore Rules 顯示已部署

若 Functions 未出現：`functions/index.js` 的 `require('./lib/focus-tree')` 找不到，通常是沒有 build。

## 2. Seed chem-2027

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
GCLOUD_PROJECT=<project-id> \
npm run seed:chem-2027
```

或已 `gcloud auth application-default login`：

```bash
GCLOUD_PROJECT=<project-id> npm run seed:chem-2027
```

預期：

- `focus_trees/chem-2027`：`status: "draft"`、`version: 0`、`node_count: 4`、`total_weight: 17`
- 4 個 nodes 子文件，13 欄位

Console 檢查一次即可，不要用 Console 手改 `status` 成 published，否則會繞過 validate / audit。

## 3. App Check 驗證

```bash
cd focus-tree-web
npm run dev      # http://localhost:5174
```

1. Google 登入。
2. 開 `/admin/focus-progress`。
3. Browser console 應出現 App Check debug token（dev 模式）。
4. DevTools → Network → 呼叫 `focusProgressGet` 的請求，Header 應有 `X-Firebase-AppCheck`。
5. Firebase Console → App Check → Requests，應看到 verified 請求。

若 callable 回 `app-check` 錯誤：

- Console 確認 App Check 是 **reCAPTCHA Enterprise**，且 site key 與 Web App 對應
- 確認 Cloud Functions 的 enforcement 狀態
- 本機可把 debug token 加到 App Check 的 debug token 清單

> 風險：若你對 **Firestore / Auth** 也開了 enforcement，現有 React 儀表板沒有 App Check 初始化，會直接壞掉。先只對 Cloud Functions enforcement，或同時補 React 端 App Check。

## 4. 補 mr_note

打開 `/admin/focus-publish`：

1. 選 `chem-2027`，會載入目前 4 節點 JSON。
2. 可先按「下載目前 JSON」離線編輯，再用「載入 JSON 檔」帶回；或直接在 textarea 改。
3. 把 4 條 `mr_note` 換成業務提供的 Marking Report 內容（≤5000 字）。
4. 不要改動其他 12 個欄位；不要新增欄位。
5. 按「驗證（dry-run）」。

預期：

- `errors` 為 0
- `warnings` 可能包含 `E_MR_NOTE_PENDING`（若還有空）與 `E_DUPLICATE_CROSS_TREE`（同年度重複時）
- `stats`：`nodeCount 4 / totalWeight 17 / maxDepth 3 / rootCount 1`
- `diff`：`unchanged 4`（若完全沒改）

若有 `E_ROOT_MISMATCH`，代表 `root_node_ids` 與推導不同；發佈時會自動更新，屬 warning。

## 5. 第一次 publish

1. 驗證通過後按「核准」。
2. 輸入完整 `chem-2027`。
3. 按「發佈」。

預期：

- 回傳 `version: 1`、`nodeCount: 4`、`totalWeight: 17`、`checksum`
- `focus_trees/chem-2027.status` → `published`
- `audit_logs` 新增一筆 `focus_tree.publish`
- `focus_tree_imports/{importId}.status` → `published`

常見錯誤：

| 錯誤 | 原因 |
| --- | --- |
| `E_MR_NOTE_MISSING` | 仍有 mr_note 空字串 |
| `E_NOT_APPROVED` | 未核准，或核准者與發佈者不同 |
| `E_VERSION_CONFLICT` | 版本被改過；重新載入頁面再 validate |
| `E_VALIDATION_FAILED` | 節點欄位或圖結構有錯，看 errors |
| `E_NODE_REMOVAL_UNSUPPORTED` | 刪掉了節點；本版不支援 |

## 6. 學習者端到端

用**非管理員**測試帳號（或同一帳號也可以，但建議分開）開：

```text
/focus/chem-2027
```

依序：

1. 初始：4 節點，完成度 0%，t01 可開始，t02–t04 鎖定。
2. 開 t01 → 標記掌握 → 完成度 `2 / 17 = 11.8%`。
3. t02 解鎖 → 開始學習 → 完成度 `(2 + 2.5) / 17 = 26.5%`。
4. t02 標記掌握 → `(2 + 5) / 17 = 41.2%`，t03 解鎖。
5. 重新整理頁面，進度仍在。
6. 直接呼叫 t03 的「開始學習」應被拒（前置 t02 已掌握則可；若要測錯誤，先用未掌握帳號測 t02）。

預期錯誤碼：`E_PREREQUISITE_NOT_MET`（details 列出缺哪個前置）。

## 7. 管理員批次重置

開 `/admin/focus-progress`：

1. 選 `chem-2027`。
2. 加入剛才的測試帳號 email。
3. 勾選 t01（級聯開著）。
4. 預覽。

預期：

- 受影響 2 份：t01、t02（級聯）
- 展開該使用者可見節點名稱、狀態、masteredAt

5. 輸入 `chem-2027` → 確認重置。
6. 學習者頁重新整理：完成度 0%，t02 回到鎖定。

## 8. 封存唯讀（可選，最後做）

目前沒有 archive API，只能在 Console 把 `status` 改成 `archived` 測：

1. 學習者頁應顯示「此年份已封存，進度僅供查閱」。
2. 標記進度應回 `E_TREE_ARCHIVED`。
3. 管理員重置頁應停用按鈕。
4. 測完把 status 改回 `published`（Console 手動，僅測試）。

## 9. 驗收簽核

- [ ] 7 個 callable 已部署
- [ ] `chem-2027` 為 published / v1
- [ ] App Check 請求 verified
- [ ] t01→t02 解鎖與加權百分比正確
- [ ] 批次重置級聯正確
- [ ] `audit_logs` 有 publish 與 reset 記錄
- [ ] 沒有把 service account key、`.env.local` 提交到 git
