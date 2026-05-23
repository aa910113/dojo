# Git 分支規則

## 三層分支模型

```
feat/xxx  ──merge──►  dev  ──merge──►  main
(開發)              (測試站)          (正式站)
```

| 類型 | 分支 | 部署到 | 角色 |
|---|---|---|---|
| 長期 | `main` | 正式站 `dojo-three-alpha.vercel.app` | 真實使用者使用,永遠保持穩定可上線 |
| 長期 | `dev` | Vercel staging 網址 | 功能整合測試站,功能先在這驗證 |
| 短期 | `feat/*`、`fix/*`、`chore/*` | 各自 preview 網址 | 開發單一功能或修一個 bug,合併後刪除 |

**核心規則:**
- 不直接在 `main` 或 `dev` 上開發,所有變更都在短期分支完成
- 短期分支從 `dev` 開出,完成後合併回 `dev`
- 在 `dev`(staging)整合測試確認後,才把 `dev` 合併進 `main` 發布到正式站

## 分支命名

- `feat/簡短描述` — 新功能(例:`feat/sync-code`)
- `fix/簡短描述` — 修 bug(例:`fix/quiz-skip`)
- `chore/簡短描述` — 雜項/設定/重構(例:`chore/upgrade-nuxt`)

## 標準流程

```
# 1. 從 dev 開短期分支
git switch dev && git pull
git switch -c feat/xxx

# 2. 開發 + commit,然後 push
git push -u origin feat/xxx
#    → Vercel 自動建 preview 網址,可單獨測這個功能

# 3. 開 PR:base 設 dev ← compare 設 feat/xxx
#    確認 preview OK → 合併進 dev

# 4. 同步並刪掉短期分支
git switch dev && git pull
git branch -d feat/xxx

# 5. 發布:在 dev(staging)整合測試 OK 後,開 PR 把 dev 合併進 main
#    → main 更新 → 正式站部署
```

## 合併方式

一律用 **PR(Pull Request)**,即使單人開發:
- 每個分支 push 後 Vercel 自動產生部署,合併前可實測
- PR 留下變更紀錄,日後可回顧
- `feat/*` 的 PR base 是 `dev`;發布用的 PR base 是 `main`、compare 是 `dev`

## 環境對應

- `main` → 正式站 `https://dojo-three-alpha.vercel.app/`(真實使用者)
- `dev` → Vercel staging 網址(整合測試)
- 其他短期分支 → Vercel 各自 preview 網址(不影響正式站與 staging)

## 注意

- `main` 必須隨時可上線 —— 只接受從 `dev` 來、已在 staging 驗證過的變更
- 短期分支保持「短」:一個分支只做一件事,做完合併刪除
- 危險操作(force push、reset --hard、刪遠端分支)動手前先確認
