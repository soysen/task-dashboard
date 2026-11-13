---
name: answer-me-with-html
description: "使用時機：產生結構清楚的 HTML 報告；Task Dashboard agent 收到複雜說明、比較、調查、計劃或明確 HTML 報告需求時觸發。"
argument-hint: "報告主題或任務識別碼"
user-invocable: true
freedom: high
models-tested: [flash, sonnet, opus]
---

# Task Dashboard HTML 報告

## 目錄
1. [使用時機](#使用時機)
2. [硬性規則 (Must)](#硬性規則-must)
3. [報告產出流程](#報告產出流程)
4. [完成前檢核](#完成前檢核)

## 使用時機

多項調查結果、系統流程說明、比較、實作計劃，或使用者明確要求 HTML 報告時使用。瑣碎答覆或使用者要求純文字時不產生報告。

## 硬性規則 (Must)

- 報告以繁體中文撰寫；技術名詞首次出現時附上英文名稱。
- 先閱讀相關 Markdown 文件；文件不足以回答時才檢查程式碼。
- 只呈現已查證資訊，不捏造行為、檔案路徑或測試結果。
- HTML 使用 `~/projects/answer-me-with-html` 的 CLI 產生；不得手寫 HTML、CSS 或 SVG。
- 以 `--no-open` 執行，並將產出的 HTML 絕對路徑納入交付。
- 本技能不取代 Task Dashboard 的 Confirmation Gate、SSOT 或結案 API 規範。

## 報告產出流程

1. 先查專案內相關 Markdown；必要時才查實作程式碼。
2. 以簡短 Markdown 整理結論、來源依據與需要的流程圖或比較表。
3. 使用 CLI 由標準輸入產生 HTML：

```bash
node "$HOME/projects/answer-me-with-html/skills/answer-me-with-html/scripts/am.mjs" render - --no-open <<'AM_EOF'
---
title: 報告標題
---
## 結論
以繁體中文寫入已查證的結論。
AM_EOF
```

4. 如 CLI 回報錯誤，修正 Markdown 後重試；只在成功產生後回報 HTML 檔案路徑。

## 完成前檢核

- [ ] 報告以繁體中文撰寫，首次出現的技術名詞附英文標註。
- [ ] 已先查 Markdown 文件，必要時才查程式碼。
- [ ] CLI 成功產生 HTML，交付包含輸出檔案路徑。
