# Git 分支規則

## 分支模型

| 類型 | 分支 | 角色 |
|---|---|---|
| 長期 | `main` | 正式環境,永遠保持「可上線」狀態。Vercel 跟著 `main` 自動部署到正式站。 |
| 短期 | `feat/*`、`fix/*`、`chore/*` | 開發單一功能或修一個 bug,做完合併進 `main` 後刪除。 |

**核心規則：不直接在 `main` 上開發。** 所有變更都先在短期分支完成、驗證,再合併。

## 分支命名

- `feat/簡短描述` — 新功能(例:`feat/sync-code`)
- `fix/簡短描述` — 修 bug(例:`fix/quiz-skip`)
- `chore/簡短描述` — 雜項/設定/重構(例:`chore/upgrade-nuxt`)

## 標準流程

```
git switch -c feat/xxx          # 從 main 開短期分支
# ...開發 + commit...
git push -u origin feat/xxx     # push → Vercel 自動建 preview 網址
# 在 preview 網址測試
# GitHub 開 PR → 確認 preview OK → 合併進 main
git switch main && git pull     # 同步合併後的 main
git branch -d feat/xxx          # 刪掉本機短期分支
```

## 合併方式

優先用 **PR(Pull Request)**,即使單人開發:
- 每個分支 push 後,Vercel 自動產生 preview 部署,可在合併前實測
- PR 留下變更紀錄,日後可回顧
- 合併到 `main` 才會觸發正式站更新

## 環境對應

- `main` → 正式站 `https://dojo-three-alpha.vercel.app/`
- 其他分支 → Vercel 各自的 preview 網址(不影響正式站)

## 注意

- `main` 必須隨時可上線 —— 沒測過、會壞的東西不要進 `main`
- 短期分支保持「短」:一個分支只做一件事,做完就合併刪除,不要長期累積
- 危險操作(force push、reset --hard、刪遠端分支)動手前先確認
