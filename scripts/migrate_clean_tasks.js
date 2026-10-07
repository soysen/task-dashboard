#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const baseDir = process.env.TASK_DASHBOARD_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/TaskDashboard');
const tasksFile = path.join(baseDir, 'tasks.json');
const diffDir = path.join(baseDir, 'diffs');

if (!fs.existsSync(tasksFile)) {
  console.log('tasks.json 不存在，略過遷移:', tasksFile);
  process.exit(0);
}

if (!fs.existsSync(diffDir)) {
  fs.mkdirSync(diffDir, { recursive: true });
}

// 建立安全備份
const backupFile = `${tasksFile}.bak-${Date.now()}`;
fs.copyFileSync(tasksFile, backupFile);
console.log('✅ 已建立 tasks.json 安全備份:', backupFile);

const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
let savedDiffBytes = 0;
let strippedFieldCount = 0;

const cleaned = tasks.map(t => {
  // 1. 剔除暫態裝飾欄位
  const { projectPath, projectDocs, projectSkills, projectHarness, sliceInfo, liveStatus, ...rest } = t;
  if ('projectPath' in t || 'sliceInfo' in t || 'liveStatus' in t || 'projectSkills' in t) {
    strippedFieldCount++;
  }

  // 2. 補齊與正規化 planStatus 欄位
  if (rest.requiresConfirmation) {
    if (!rest.planStatus) {
      if (rest.status === 'review' || rest.status === 'done' || rest.status === 'archived') {
        rest.planStatus = 'approved';
      } else if (rest.executionPlan && rest.executionPlan.trim()) {
        rest.planStatus = 'drafted';
      } else {
        rest.planStatus = 'none';
      }
    }
  } else {
    rest.planStatus = rest.planStatus || 'none';
  }

  // 3. 抽離過大的 Diff (>2KB) 至獨立 diffs/<taskId>.diff 檔案
  if (rest.diff && typeof rest.diff === 'string' && rest.diff.length > 2048) {
    const diffFile = path.join(diffDir, `${rest.id}.diff`);
    fs.writeFileSync(diffFile, rest.diff, 'utf8');
    savedDiffBytes += rest.diff.length;
    rest.diffPath = `diffs/${rest.id}.diff`;
    rest.diff = rest.diff.slice(0, 1500) + '\n\n... (全量完整 Diff 已抽離至 ' + rest.diffPath + ' 檔案保存)';
  }

  return rest;
});

// 原子性覆寫寫入
const tmpFile = `${tasksFile}.${process.pid}.tmp`;
fs.writeFileSync(tmpFile, JSON.stringify(cleaned, null, 2), 'utf8');
fs.renameSync(tmpFile, tasksFile);

const afterSize = fs.statSync(tasksFile).size;
console.log('✅ 資料庫清理遷移完成！');
console.log(`- 總任務數: ${cleaned.length}`);
console.log(`- 剔除暫態裝飾欄位任務數: ${strippedFieldCount}`);
console.log(`- 抽離 Diff 節省空間: ${(savedDiffBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`- 遷移後 tasks.json 大小: ${(afterSize / 1024).toFixed(1)} KB`);
