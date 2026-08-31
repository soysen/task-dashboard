---
name: git-workflow-and-versioning
description: "遵循 Conventional Commit 格式化標準並自動推導 scope (server, ui, native, harness)。"
argument-hint: "Git commit operations, conventional commit formatting, scope determination"
user-invocable: true
---

# Git Workflow & Versioning Specification

## 1. 提交訊息規範 (Conventional Commits)

```text
<type>(<scope>): <subject>
```

### Types

| Type | 說明 |
| :--- | :--- |
| `feat` | 新增功能（如新 API、新 UI 元件、新 Skill 探索） |
| `fix` | 錯誤修復（如狀態競爭、死結、溢位、介面錯誤） |
| `refactor` | 代碼重構（未改變外部行為） |
| `perf` | 效能優化 |
| `style` | 樣式、排版、Tailwind/CSS 微調 |
| `docs` | 文檔修訂（AGENTS.md, README.md, SKILL.md 等） |
| `test` | 測試案例、Harness 腳本擴充 |
| `chore` | 建置腳本、相依套件、環境設定調整 |

### Scopes (針對 Task Dashboard 專案)

| Scope | 適用目錄 / 模組 |
| :--- | :--- |
| `native` | `src/native/main.m` (Cocoa / WebKit 外殼) |
| `server` | `src/server/server.js` (後端 API、排程、CLI 派發) |
| `ui` | `src/public/index.html` (前端面板、Select2 標籤、Diff 檢視) |
| `harness` | `HARNESS.md`, `scripts/harness_check.sh`, `scripts/test_server.sh` |
| `skills` | `.github/skills/*` 技能包 |
| `build` | `package.json`, `scripts/build_app.sh`, `scripts/install_to_desktop.sh` |

## 2. 自動推導範例 (Examples)

- `feat(skills): 建立專案專屬 .github 技能包`
- `fix(server): 修正輪巡狀態競爭與過早推進 review 問題`
- `feat(ui): 升級 Select2 標籤下拉支援專案 .github 技能`
- `chore(native): 重新編譯 macOS App 並更新至桌面`

## 3. Commit 驗證流程
1. `git status` 確認暫存區狀態。
2. 執行 `npm test` 與 `npm run harness:check` 確認無任何錯誤。
3. 產生標準訊息並完成提交。
