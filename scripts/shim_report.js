#!/usr/bin/env node

/**
 * shim_report.js
 * 
 * 統計最近 30 個任務中各規則墊片 (Model Shim) 與安全門禁 (Domain Gate) 的觸發率。
 * 依據 docs/SHIMS.md 規範輸出追蹤報表，為定期汰除無效模型補丁提供客觀數據。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_HOME = process.env.HOME || os.homedir();
const DATA_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');
const EVENTS_FILE = path.join(DATA_DIR, 'task-events.jsonl');

// 定義追蹤的 Shim 清冊
const SHIM_DEFINITIONS = [
  {
    id: 'GATE-001',
    rule: 'validateExecutionLog 擋敷衍日誌與非 0 退出碼',
    type: 'Domain Gate',
    measurable: true,
    permanent: true,
    matcher: (e) => e.type === 'review_gate_rejected' || e.shimId === 'GATE-001'
  },
  {
    id: 'GATE-002',
    rule: 'Feedback 自癒清理 (healTasksFeedback)',
    type: 'Model Shim',
    measurable: true,
    permanent: false,
    matcher: (e) => e.shimId === 'GATE-002' || (e.type === 'shim_triggered' && e.action === 'healTasksFeedback')
  },
  {
    id: 'SHIM-001',
    rule: '>500 行禁整檔讀 (grep-n 切片檢索)',
    type: 'Model Shim',
    measurable: false,
    permanent: false
  },
  {
    id: 'SHIM-002',
    rule: '同區塊最多檢索 2 次避免迴圈',
    type: 'Model Shim',
    measurable: false,
    permanent: false
  }
];

function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try {
    const lines = fs.readFileSync(EVENTS_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    return lines.map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function generateReport() {
  const events = readEvents();

  // 1. 採集所有出現過的 taskId 並取最近 30 個不重複任務
  const seenTasks = [];
  // 由最新往最舊倒序尋找
  for (let i = events.length - 1; i >= 0; i--) {
    const tid = events[i].taskId;
    if (tid && !seenTasks.includes(tid)) {
      seenTasks.push(tid);
      if (seenTasks.length >= 30) break;
    }
  }

  const recentTaskSet = new Set(seenTasks);
  const sampleEvents = events.filter(e => recentTaskSet.has(e.taskId));

  console.log('================================================================================');
  console.log(`📊 Task Dashboard — 墊片與防禦門禁觸發率報表 (Shim & Gate Report)`);
  console.log(`• 資料來源: ${EVENTS_FILE}`);
  console.log(`• 分析樣本: 最近 ${seenTasks.length} 個任務 (共 ${sampleEvents.length} 筆事件，全部事件 ${events.length} 筆)`);
  console.log('================================================================================\n');

  console.log('| ID        | 規則描述                                 | 類型        | 觸發次數 (近 30 任務) | 處置建議                    |');
  console.log('| :-------- | :--------------------------------------- | :---------- | :-------------------- | :-------------------------- |');

  SHIM_DEFINITIONS.forEach(shim => {
    let countStr = '-';
    let recommendation = '';

    if (shim.measurable) {
      const hits = sampleEvents.filter(e => shim.matcher(e)).length;
      countStr = `${hits} 次`;
      if (shim.permanent) {
        recommendation = '永久保留 (Core Domain Gate)';
      } else if (hits === 0) {
        recommendation = '建議淘汰 (30 任務觸發 0 次)';
      } else {
        recommendation = `活躍使用中 (觸發 ${hits} 次)`;
      }
    } else {
      countStr = '質性量測';
      recommendation = '觀察 Feedback 是否再出現 loop';
    }

    const padId = shim.id.padEnd(9);
    const padRule = shim.rule.padEnd(40);
    const padType = shim.type.padEnd(11);
    const padCount = countStr.padEnd(21);
    console.log(`| ${padId} | ${padRule} | ${padType} | ${padCount} | ${recommendation} |`);
  });

  console.log('\n================================================================================');
  console.log('💡 減稅與汰除指南：');
  console.log('• [Domain Gate]：核心安全邊界，永久保留。');
  console.log('• [Model Shim]：針對舊模型劣勢的特定提示；連續 30 個任務未觸發且無 Feedback 反饋時，應立即從 Prompt 移除減稅。');
  console.log('================================================================================\n');
}

if (require.main === module) {
  try {
    generateReport();
    process.exit(0);
  } catch (err) {
    console.error('報表生成失敗:', err);
    process.exit(1);
  }
}

module.exports = {
  generateReport,
  readEvents,
  SHIM_DEFINITIONS
};
