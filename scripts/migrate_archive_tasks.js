#!/usr/bin/env node
/**
 * migrate_archive_tasks.js
 * 將 tasks.json 中的 archived 任務抽出並獨立保存至 tasks-archived.json
 */
const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  if (process.env.TASK_DASHBOARD_DATA_DIR) {
    return path.resolve(process.env.TASK_DASHBOARD_DATA_DIR);
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const appSupport = path.join(homeDir, 'Library', 'Application Support', 'TaskDashboard');
  if (fs.existsSync(appSupport)) {
    return appSupport;
  }
  return path.join(__dirname, '..', 'data');
}

const dataDir = resolveDataDir();
const tasksFile = path.join(dataDir, 'tasks.json');
const archivedFile = path.join(dataDir, 'tasks-archived.json');
const backupFile = path.join(dataDir, `tasks.json.pre-archive-split-${Date.now()}`);

console.log('🚀 開始執行 Archived Tasks 分檔遷移...');
console.log('目標資料夾:', dataDir);

if (!fs.existsSync(tasksFile)) {
  console.log('⚠️ tasks.json 不存在，跳過遷移。');
  process.exit(0);
}

// 1. 備份原始 tasks.json
fs.copyFileSync(tasksFile, backupFile);
console.log(`✅ 已建立全量安全備份: ${backupFile}`);

// 2. 讀取並分類任務
const rawTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
const activeTasks = [];
const archivedTasks = [];

rawTasks.forEach(t => {
  if (t.status === 'archived') {
    archivedTasks.push(t);
  } else {
    activeTasks.push(t);
  }
});

console.log(`原始任務總數: ${rawTasks.length}`);
console.log(`  - 活躍任務 (熱資料): ${activeTasks.length}`);
console.log(`  - 封存任務 (冷資料): ${archivedTasks.length}`);

// 3. 處理 tasks-archived.json (合併現有若已存在)
let existingArchived = [];
if (fs.existsSync(archivedFile)) {
  try {
    existingArchived = JSON.parse(fs.readFileSync(archivedFile, 'utf8'));
  } catch (e) {
    existingArchived = [];
  }
}

const archivedMap = new Map();
existingArchived.forEach(t => archivedMap.set(t.id, t));
archivedTasks.forEach(t => archivedMap.set(t.id, t));
const finalArchived = Array.from(archivedMap.values());

// 依更新時間由新到舊排序
finalArchived.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

// 4. 寫回檔案 (原子安全寫入)
const tmpActive = `${tasksFile}.tmp`;
fs.writeFileSync(tmpActive, JSON.stringify(activeTasks, null, 2), 'utf8');
fs.renameSync(tmpActive, tasksFile);

const tmpArchived = `${archivedFile}.tmp`;
fs.writeFileSync(tmpArchived, JSON.stringify(finalArchived, null, 2), 'utf8');
fs.renameSync(tmpArchived, archivedFile);

const tasksStat = fs.statSync(tasksFile);
const archivedStat = fs.statSync(archivedFile);

console.log('🎉 遷移完成！');
console.log(`  - tasks.json (活躍): ${activeTasks.length} 筆, 大小: ${(tasksStat.size / 1024).toFixed(2)} KB`);
console.log(`  - tasks-archived.json (封存): ${finalArchived.length} 筆, 大小: ${(archivedStat.size / 1024).toFixed(2)} KB`);
