#!/usr/bin/env node
/**
 * advance_test_slice.js
 * 用於模擬推進 TASK-006 的切片進度，驗證前端 0-Token 輪詢與即時視覺化
 * 使用方式：
 *   node scripts/advance_test_slice.js 1   # 切片 1/4 (0% 完成)
 *   node scripts/advance_test_slice.js 2   # 切片 2/4 (25% 完成)
 *   node scripts/advance_test_slice.js 3   # 切片 3/4 (50% 完成)
 *   node scripts/advance_test_slice.js 4   # 切片 4/4 (75% 完成)
 *   node scripts/advance_test_slice.js done # 4/4 全數完成 (100%)
 */

const fs = require('fs');
const path = require('path');

const targetArg = process.argv[2] || '1';
const planPath = path.join(__dirname, '../.github/harness/plan/task-006-build-plan.md');
const statusPath = path.join(__dirname, '../.github/worklog/agent-status.md');

if (!fs.existsSync(planPath)) {
  console.error('❌ 找不到 task-006-build-plan.md，請確認 TASK-006 已建立');
  process.exit(1);
}

const slices = [
  'Slice 1: 前端 loadData 輪詢循環整合 /api/tasks/:id/slice-info 動態更新彈窗切片',
  'Slice 2: 看板 in_progress 卡片整合切片計數視覺化標籤',
  'Slice 3: 輪詢快取防抖與本機 I/O 輕量化保護',
  'Slice 4: 測試腳本 scripts/test_ui_behavior.js 驗證與 Harness 規範合規'
];

let activeSliceNum = 1;
let isAllDone = false;

if (targetArg.toLowerCase() === 'done' || targetArg === '5') {
  isAllDone = true;
  activeSliceNum = 4;
} else {
  activeSliceNum = parseInt(targetArg, 10);
  if (isNaN(activeSliceNum) || activeSliceNum < 1 || activeSliceNum > 4) {
    console.error('請指定切片編號 1 ~ 4 或 done');
    process.exit(1);
  }
}

// 組合 Slices Markdown
const updatedSlicesSection = slices.map((s, idx) => {
  const num = idx + 1;
  if (isAllDone || num < activeSliceNum) {
    return `- [x] ${s}`;
  } else if (num === activeSliceNum) {
    return `- [-] ${s}`;
  } else {
    return `- [ ] ${s}`;
  }
}).join('\n');

// 寫入 build-plan.md
let planContent = fs.readFileSync(planPath, 'utf8');
planContent = planContent.replace(/## Slices[\s\S]*?(?=\n\n|$)/, `## Slices\n${updatedSlicesSection}`);
fs.writeFileSync(planPath, planContent, 'utf8');

// 同步更新 agent-status.md
if (fs.existsSync(statusPath)) {
  let statusContent = fs.readFileSync(statusPath, 'utf8');
  const stepText = isAllDone
    ? '所有切片已實作完成，準備推入 review 交付審查'
    : `正在執行：${slices[activeSliceNum - 1]}`;

  statusContent = statusContent.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (m, sec, nextH) => {
    return `## Execution Tracking\n\n- CurrentStep: ${stepText}\n- Evidence: 進行中\n- NextStep: 完成當前切片後推進\n\n` + nextH;
  });
  fs.writeFileSync(statusPath, statusContent, 'utf8');
}

const completedCount = isAllDone ? 4 : (activeSliceNum - 1);
const percent = Math.round((completedCount / 4) * 100);

console.log(`✅ 已切換切片狀態：`);
console.log(`   - 當前切片: ${isAllDone ? '已全數完成' : `第 ${activeSliceNum}/4 切片`}`);
console.log(`   - 完成進度: ${completedCount}/4 (${percent}%)`);
console.log(`   - 監聽端點: http://localhost:3030/api/tasks/TASK-006/slice-info`);
console.log(`   👉 請在 Task Dashboard 前端觀察看板卡片與彈窗內的即時更新 (約 2-3 秒輪詢同步)`);
