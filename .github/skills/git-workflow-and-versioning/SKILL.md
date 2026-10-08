---
name: git-workflow-and-versioning
description: "遵循 Conventional Commit 格式化標準並自動推導 scope (server, ui, native, harness)。使用時機：產出 Commit 訊息、提交代碼變更、版本推導或整合驗證時觸發。"
argument-hint: "Git commit operations, conventional commit formatting, scope determination"
user-invocable: true
freedom: low
models-tested: [flash, sonnet, opus]
---

# Git Workflow & Versioning Specification

## 目錄
1. [硬性規則 (Must)](#硬性規則-must)
2. [適用時機與豁免規則](#適用時機與豁免規則)
3. [提交訊息規範 (Conventional Commits)](#提交訊息規範-conventional-commits)
4. [模組 Scopes 推導標準](#模組-scopes-推導標準)
5. [多輪 Feedback 與任務主軸保護](#多輪-feedback-與任務主軸保護)
6. [Commit 驗證流程](#commit-驗證流程)
7. [完成前檢核](#完成前檢核)

## 硬性規則 (Must)
1. **[MUST] 主旨鎖定核心任務主軸**：Commit Message 主旨（Subject）必須鎖定任務原始核心目標，嚴禁退化為最後一次微調或 Feedback 描述。
2. **[MUST] 嚴格 Conventional Commit 結構**：格式必須為 `<type>(<scope>): <subject>`，且 scope 必須自專案模組清單中精準推導。
3. **[MUST] 內文綜合全量異動**：Body 必須條列式綜合成型，涵蓋該任務全量修改範疇與歷次 Feedback 的修訂成果。
4. **[MUST] 零破壞與綠燈底線**：在產生 commitMessage 或進行 git commit 前，必須通過 `npm test` 與 `npm run harness:check`。

## 適用時機與豁免規則
- **適用時機**：任務進入 Phase 3 驗收交付、使用者點擊 Request Commit Gen、產出 Commit Message 寫回 tasks.json 時。
- **豁免規則**：純研究分析或非代碼變更任務，無需產出 Git Commit 訊息。

## 提交訊息規範 (Conventional Commits)

```text
<type>(<scope>): <subject>

<body>
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

## 模組 Scopes 推導標準

| Scope | 適用目錄 / 模組 |
| :--- | :--- |
| `native` | `src/native/main.m` (Cocoa / WebKit 外殼) |
| `server` | `src/server/server.js` (後端 API、排程、CLI 派發) |
| `ui` | `src/public/index.html` (前端面板、Select2 標籤、Diff 檢視) |
| `harness` | `HARNESS.md`, `scripts/harness_check.sh`, `scripts/test_server.sh` |
| `skills` | `.github/skills/*` 技能包 |
| `build` | `package.json`, `scripts/build_app.sh`, `scripts/install_to_desktop.sh` |

### 自動推導範例
- `feat(skills): 建立專案專屬 .github 技能包`
- `fix(server): 修正輪巡狀態競爭與過早推進 review 問題`
- `feat(ui): 升級 Select2 標籤下拉支援專案 .github 技能`
- `chore(native): 重新編譯 macOS App 並更新至桌面`

## 多輪 Feedback 與任務主軸保護

當任務歷經多輪審查回饋（Review Feedback）修訂時：
1. **主旨 (Subject) 鎖定核心主軸**：Commit Message 的主旨必須嚴格以任務原始核心目標為主導，維持完整的業務語意（例如 `feat(ui): 5GSA device list dialog 調整`）。
2. **禁止局部退化**：嚴禁讓 Commit 主旨退化為最後單一一次 Feedback 的微調描述（例如錯誤主旨：`style: 按鈕靠左`）。
3. **內文 (Body) 綜合全量異動**：內文條列式說明應涵蓋該任務的全量修改範疇，並綜合歸納歷次 Feedback 的修正成果。

## Commit 驗證流程
1. `git status` 確認暫存區與工作區狀態。
2. 執行 `npm test` 與 `npm run harness:check` 確認無任何錯誤。
3. 產生標準訊息物件 `{ subject, body }` 寫回 tasks.json。

## 完成前檢核
- [ ] Commit 主旨符合 `<type>(<scope>): <subject>` 格式且精確鎖定核心主軸。
- [ ] 內文 (Body) 完整摘要全量檔案變更與 Feedback 改進。
- [ ] 本地測試與 Harness 檢核 100% PASS。
- [ ] 無遺漏未追蹤檔案或臨時除錯代碼。
