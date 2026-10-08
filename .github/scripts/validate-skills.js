#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const skillsDir = path.join(root, '.github', 'skills');

const usageHeadings = [
  '## 使用時機',
  '## 適用時機',
  '## When to Use',
  '## Skill 選擇指南',
  '## Core Principles',
  '## 適用時機與豁免規則',
  '## 適用時機與流程'
];

const evidenceMarkers = [
  '驗證',
  '驗收',
  '測試',
  '檢查清單',
  '輸出',
  '報告',
  '安全守則',
  '參考資源',
  'Handoff',
  'Evidence',
  '完成前檢核'
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function parseFrontmatter(content, filePath) {
  if (!content.startsWith('---\n')) {
    fail(`${filePath} is missing YAML frontmatter`);
    return {};
  }

  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    fail(`${filePath} has unterminated YAML frontmatter`);
    return {};
  }

  const fields = {};
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^"|"$/g, '').trim();
  }
  return fields;
}

if (!fs.existsSync(skillsDir)) {
  fail('.github/skills does not exist');
} else {
  let count = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      fail(`${entry.name} is missing SKILL.md`);
      continue;
    }

    const relPath = path.relative(root, skillPath);
    const content = fs.readFileSync(skillPath, 'utf8');
    const lines = content.split('\n');
    const frontmatter = parseFrontmatter(content, relPath);

    if (frontmatter.name !== entry.name) {
      fail(`${relPath} frontmatter name must match directory name (${entry.name})`);
    }

    if (!frontmatter.description) {
      fail(`${relPath} is missing description`);
    }

    if (!/Use when|使用時機|觸發關鍵字|觸發|情境|規範|指導/.test(frontmatter.description || '')) {
      fail(`${relPath} description must include usage triggers`);
    }

    // 1. Freedom 分級檢查 (low | medium | high)
    if (!['low', 'medium', 'high'].includes(frontmatter.freedom)) {
      fail(`${relPath} must specify valid freedom in frontmatter (low | medium | high)`);
    }

    // 2. Models-tested 檢查
    if (!frontmatter['models-tested']) {
      fail(`${relPath} must specify models-tested in frontmatter`);
    }

    // 3. TOC 目錄檢查 (超過 40 行必備目錄)
    if (lines.length > 40 && !content.includes('## 目錄')) {
      fail(`${relPath} (length: ${lines.length}) must include '## 目錄' (TOC)`);
    }

    // 4. Must 硬性規則檢查（必須存在且在前 40 行之內）
    const mustIndex = lines.findIndex(l => l.includes('## 硬性規則 (Must)'));
    if (mustIndex === -1) {
      fail(`${relPath} must include '## 硬性規則 (Must)' section`);
    } else if (mustIndex > 40) {
      fail(`${relPath} '## 硬性規則 (Must)' must be placed within first 40 lines (found at line ${mustIndex + 1})`);
    }

    // 5. 完成前檢核清單檢查
    if (!content.includes('## 完成前檢核')) {
      fail(`${relPath} must include '## 完成前檢核' checklist at end`);
    }
    const checkboxes = content.match(/- \[[ x]\]/g) || [];
    if (checkboxes.length < 2) {
      fail(`${relPath} must contain at least 2 verification checkboxes`);
    }

    // 6. 內部 References / Assets 檔案存在性檢查
    const internalLinks = content.matchAll(/\]\(((\.\/references\/|\.\/assets\/)[^)]+)\)/g);
    for (const linkMatch of internalLinks) {
      const relTarget = linkMatch[1];
      const absTarget = path.resolve(skillDir, relTarget);
      if (!fs.existsSync(absTarget)) {
        fail(`${relPath} contains broken link: ${relTarget} (target does not exist)`);
      }
    }

    if (!usageHeadings.some(heading => content.includes(heading))) {
      fail(`${relPath} is missing a usage section`);
    }

    const h2Count = content.match(/^##\s+/gm)?.length ?? 0;
    if (h2Count < 2) {
      fail(`${relPath} must contain at least two workflow sections`);
    }

    if (!evidenceMarkers.some(marker => content.includes(marker))) {
      fail(`${relPath} is missing output, safety, or verification guidance`);
    }
    count++;
  }
  if (!process.exitCode) {
    console.log(`✅ Skill validation passed for ${count} modern skills in .github/skills`);
  }
}
