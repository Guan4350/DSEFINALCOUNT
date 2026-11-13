# focus-tree-web — 國策樹 Vue 3 前端

配合 `functions/src/focus-tree/` 的 Callable Functions 使用。資料層與設計規格見
[`docs/focus-tree/ARCHITECTURE.md`](../docs/focus-tree/ARCHITECTURE.md)。

## 路由

| 路徑 | 用途 |
| --- | --- |
| `/focus/:treeId` | 學習者檢視樹、加權完成度、標記進度 |
| `/admin/focus-progress` | 管理員批次重置（email 查詢、dry-run、展開每人節點明細） |
| `/admin/focus-publish` | 管理員驗證 → 核准 → 發佈（mr_note 閘門、版本鎖） |

首棵樹：`chem-2027`。

## 啟動

```bash
cd focus-tree-web
cp .env.example .env.local   # 填入 Firebase Web 設定
npm install
npm run dev                  # http://localhost:5174
```

沒有 Firebase 設定時 `src/lib/firebase.ts` 會直接拋錯，避免半套初始化。

### App Check

若 Firebase 已啟用 App Check enforcement：

1. Console → App Check → 註冊 Web App（reCAPTCHA Enterprise），取得 site key。
2. 填入 `.env.local` 的 `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`。
3. 本機開發可設 `VITE_APPCHECK_DEBUG_TOKEN`（或留空，dev 模式會自動啟用 debug token 並印在 console）。

未填 site key 時，callable 會被 App Check 拒絕。

## 後端

```bash
cd functions
npm install                  # 取得 typescript / @types/node
npm run build:focus-tree     # functions/src/focus-tree -> functions/lib/focus-tree
firebase deploy --only functions
```

`functions/index.js` 會 require `lib/focus-tree` 並輸出七個 callable；若未 build，只記錄 warning，不影響既有 iCal 排程。

首次建樹（draft）：

```bash
cd functions
npm run seed:chem-2027       # 需 GOOGLE_APPLICATION_CREDENTIALS 或 Firestore emulator
```

`mr_note` 全為空，publish 會回 `E_MR_NOTE_MISSING`；補齊 4 條 MR 後才可發佈。

## 權限

- 學習者：讀 `published` / `archived` 樹與節點；進度只由 Cloud Functions 寫入。
- 管理員：`admins/{uid}.active == true`；可讀 draft，可呼叫 `focusProgressReset` / `focusAdminLookupUser`。
- `archived` 樹的進度唯讀：`focusProgressSet`、`focusProgressReset`、`focusTreePublish` 皆回 `E_TREE_ARCHIVED`。

## 發佈流程

1. 在 `/admin/focus-publish` 選樹，載入目前節點 JSON。
2. 補齊每條 `mr_note` 後按「驗證（dry-run）」，查看 errors / warnings / diff。
3. 校驗通過後按「核准」。
4. 輸入完整 treeId 確認，按「發佈」；版本 +1，寫入 audit_logs。

注意：目前不支援刪除節點（發佈會回 `E_NODE_REMOVAL_UNSUPPORTED`）；單次上限 400 節點。

## 驗證

```bash
npm run typecheck
npm run build
```
