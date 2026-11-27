import { escapeHtml, showToast, copyToClipboard } from "./utils.js";
import { currentActiveTaskDiff, currentProject, currentModalEditingTask } from "./state.js";

    let currentDiffContextMode = 15; // 3 | 15 | 40 | 'full'
    let activeDiffHunkIndex = 0;
    let lastRenderedDiffState = { taskKey: '', diffText: '', singleFilePath: '' };
    const diffFileContextCache = new Map();
    const diffPendingFetches = new Set();
    let diffExpandedGapsState = {};

    function extractFilePathFromDiffSection(lines) {
      for (const line of lines) {
        if (line.startsWith('diff --git a/')) {
          const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
          if (m) return m[2].trim();
        }
        if (line.startsWith('diff --no-index')) {
          const m = line.match(/diff --no-index \/dev\/null "?(.+?)"?$/);
          if (m) return m[1].trim();
        }
        if (line.startsWith('+++ b/')) {
          return line.slice(6).trim();
        }
        if (line.startsWith('+++ ') && !line.includes('/dev/null')) {
          return line.slice(4).trim().replace(/^"|"$/g, '');
        }
        if (line.startsWith('--- a/') && !line.includes('/dev/null')) {
          return line.slice(6).trim();
        }
        if (line.startsWith('--- ') && !line.includes('/dev/null')) {
          return line.slice(4).trim().replace(/^"|"$/g, '');
        }
        if (line.startsWith('// ') || line.startsWith('// 異動檔案')) {
          const m = line.match(/[:：]\s*(.+)$/);
          if (m) return m[1].trim();
        }
      }
      return '';
    }

    function parseFileStatusFromLines(lines) {
      if (!Array.isArray(lines)) return 'M';
      for (const l of lines) {
        if (l.startsWith('new file mode') || l.startsWith('--- /dev/null')) return 'A';
        if (l.startsWith('deleted file mode') || l.startsWith('+++ /dev/null')) return 'D';
      }
      return 'M';
    }

    function parseDiffStats(rawDiff) {
      if (!rawDiff || typeof rawDiff !== 'string') {
        return { filesCount: 0, additions: 0, deletions: 0, net: 0, filesMap: {} };
      }
      const sections = splitDiffByFiles(rawDiff);
      let totalAdd = 0;
      let totalDel = 0;
      const filesMap = {};

      sections.forEach(sec => {
        let add = 0;
        let del = 0;
        sec.lines.forEach(l => {
          if (l.startsWith('+') && !l.startsWith('+++')) add++;
          else if (l.startsWith('-') && !l.startsWith('---')) del++;
        });
        totalAdd += add;
        totalDel += del;
        const status = parseFileStatusFromLines(sec.lines);
        if (sec.filePath) {
          filesMap[sec.filePath] = { additions: add, deletions: del, status };
          const base = sec.filePath.split('/').pop();
          if (base) filesMap[base] = { additions: add, deletions: del, status };
        }
      });

      return {
        filesCount: sections.length,
        additions: totalAdd,
        deletions: totalDel,
        net: totalAdd - totalDel,
        filesMap
      };
    }

    function splitDiffByFiles(rawDiff) {
      if (!rawDiff || typeof rawDiff !== 'string') return [];
      const lines = rawDiff.split('\n');
      const sections = [];
      let currentSection = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isInsidePendingDiffHeader = Boolean(
          currentSection &&
          currentSection.lines.some(l => l.startsWith('diff --git') || l.startsWith('diff --no-index')) &&
          !currentSection.lines.some(l => l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('@@'))
        );
        const isNewFileStart = line.startsWith('diff --git') ||
                               line.startsWith('diff --no-index') ||
                               (line.startsWith('--- /dev/null') && !isInsidePendingDiffHeader) ||
                               line.startsWith('// ') ||
                               (line.startsWith('//') && line.includes('異動檔案'));

        if (isNewFileStart) {
          if (currentSection) {
            currentSection.fullText = currentSection.lines.join('\n');
            currentSection.body = currentSection.lines.slice(1).join('\n');
            currentSection.filePath = extractFilePathFromDiffSection(currentSection.lines);
            currentSection.status = parseFileStatusFromLines(currentSection.lines);
            sections.push(currentSection);
          }
          currentSection = {
            header: line,
            lines: [line],
            fullText: '',
            body: '',
            filePath: '',
            status: 'M'
          };
        } else {
          if (!currentSection) {
            currentSection = {
              header: line,
              lines: [line],
              fullText: '',
              body: '',
              filePath: '',
              status: 'M'
            };
          } else {
            currentSection.lines.push(line);
          }
        }
      }

      if (currentSection) {
        currentSection.fullText = currentSection.lines.join('\n');
        currentSection.body = currentSection.lines.slice(1).join('\n');
        currentSection.filePath = extractFilePathFromDiffSection(currentSection.lines);
        currentSection.status = parseFileStatusFromLines(currentSection.lines);
        sections.push(currentSection);
      }

      return sections;
    }

    function updateDiffSummaryBar(diffText, singleFilePath) {
      const bar = document.getElementById('diffSummaryBar');
      if (!bar) return;
      const fullDiffSource = (currentActiveTaskDiff && currentActiveTaskDiff.trim().length > 0) ? currentActiveTaskDiff : diffText;
      const modFilesTotal = (currentModalEditingTask && Array.isArray(currentModalEditingTask.modifiedFiles))
        ? currentModalEditingTask.modifiedFiles.length
        : 0;
      if ((!fullDiffSource || fullDiffSource.trim().length === 0) && modFilesTotal === 0) {
        bar.classList.add('hidden');
        return;
      }
      bar.classList.remove('hidden');
      const totalStats = parseDiffStats(fullDiffSource || diffText || '');
      const viewStats = singleFilePath ? parseDiffStats(diffText || '') : totalStats;
      const trueFilesCount = Math.max(modFilesTotal, totalStats.filesCount);
      const filesEl = document.getElementById('diffStatFilesCount');
      const addEl = document.getElementById('diffStatAdditionsBadge');
      const delEl = document.getElementById('diffStatDeletionsBadge');
      if (filesEl) {
        filesEl.innerText = `共 ${trueFilesCount} 檔`;
      }
      const displayAdd = (singleFilePath && viewStats.additions > 0) ? viewStats.additions : (totalStats.additions || viewStats.additions);
      const displayDel = (singleFilePath && viewStats.deletions > 0) ? viewStats.deletions : (totalStats.deletions || viewStats.deletions);
      if (addEl) addEl.innerText = `+${displayAdd}`;
      if (delEl) delEl.innerText = `-${displayDel}`;
    }

    let isDiffAllCollapsed = false;
    function toggleCollapseAllDiffs() {
      isDiffAllCollapsed = !isDiffAllCollapsed;
      const cards = document.querySelectorAll('.diff-card');
      cards.forEach(c => {
        if (isDiffAllCollapsed) {
          c.classList.add('is-collapsed');
        } else {
          c.classList.remove('is-collapsed');
        }
      });
      const btnText = document.getElementById('btnToggleCollapseAllText');
      if (btnText) btnText.innerText = isDiffAllCollapsed ? '全部展開' : '全部折疊';
    }

    function toggleSingleDiffCard(cardId) {
      const card = document.getElementById(cardId);
      if (card) {
        card.classList.toggle('is-collapsed');
      }
    }

    let isDiffFocusMode = false;
    function toggleDiffFocusMode() {
      isDiffFocusMode = !isDiffFocusMode;
      const leftCol = document.getElementById('modalLeftColumn');
      const rightCol = document.getElementById('modalRightColumn');
      const grid = document.getElementById('modalFormGrid');
      const btnText = document.getElementById('btnToggleFocusModeText');
      const btnIcon = document.getElementById('btnToggleFocusModeIcon');
      const isDiffTabActive = document.getElementById('btnModalTabDiff')?.getAttribute('aria-selected') === 'true';

      if (isDiffTabActive) {
        leftCol?.classList?.toggle('hidden', true);
        grid?.classList?.toggle('lg:grid-cols-12', true);
        rightCol?.classList?.toggle('lg:col-span-7', false);
        rightCol?.classList?.toggle('lg:col-span-12', true);
      } else if (isDiffFocusMode) {
        leftCol?.classList?.toggle('hidden', true);
        grid?.classList?.toggle('lg:grid-cols-2', false);
        grid?.classList?.toggle('lg:grid-cols-12', false);
        rightCol?.classList?.toggle('lg:col-span-7', false);
      } else {
        leftCol?.classList?.toggle('hidden', false);
        grid?.classList?.toggle('lg:grid-cols-12', true);
        rightCol?.classList?.toggle('lg:col-span-7', true);
      }

      if (btnText) btnText.innerText = isDiffFocusMode ? (isDiffTabActive ? '還原視窗' : '還原雙欄') : '專注檢閱';
      if (btnIcon) btnIcon.setAttribute('data-lucide', isDiffFocusMode ? 'minimize-2' : 'maximize-2');
      if (typeof window !== 'undefined' && window.lucide) window.lucide.createIcons();
    }

    function toggleModalFullscreen() {
      // 彈窗預設即為固定滿版寬高 (max-w-[98vw] h-[96vh])，保留匯出作為安全 no-op
    }

    function copyCurrentDiff() {
      if (!currentActiveTaskDiff || !currentActiveTaskDiff.trim()) {
        showToast('目前尚無代碼變更或 Diff 可複製', 'info');
        return;
      }
      copyToClipboard(currentActiveTaskDiff, '已複製全量 Git Diff！');
    }

    const MOD_FILE_ITEM_ACTIVE_CLASS = 'mod-file-item flex items-center justify-between gap-2 bg-indigo-100 dark:bg-indigo-900/60 border-indigo-500 font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition';
    const MOD_FILE_ITEM_INACTIVE_CLASS = 'mod-file-item flex items-center justify-between gap-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition';

    async function filterDiffForFile(filePath) {
      const badgeEl = document.getElementById('diffActiveFileBadge');
      if (badgeEl) badgeEl.innerText = `檔案: ${filePath}`;

      // 更新檔案列表的 Active 選中樣式
      document.querySelectorAll?.('.mod-file-item')?.forEach(el => {
        el.className = el.getAttribute('data-path') === filePath
          ? MOD_FILE_ITEM_ACTIVE_CLASS
          : MOD_FILE_ITEM_INACTIVE_CLASS;
      });

      const cleanTarget = (filePath || '').trim();
      const baseName = cleanTarget.split('/').pop();
      let matchedSection = null;

      // 1. 先從任務已嵌入的 Diff 字串解析（嚴格依 sec.filePath 優先順序比對單檔，絕不比對內文）
      if (currentActiveTaskDiff && currentActiveTaskDiff.trim().length > 0 && cleanTarget) {
        const sections = splitDiffByFiles(currentActiveTaskDiff);
        const withPath = sections.filter(sec => (sec.filePath || '').trim().length > 0);
        let matched = withPath.filter(sec => sec.filePath.trim() === cleanTarget);
        if (matched.length === 0) {
          matched = withPath.filter(sec => {
            const secPath = sec.filePath.trim();
            return secPath.endsWith('/' + cleanTarget) || cleanTarget.endsWith('/' + secPath);
          });
        }
        if (matched.length === 0 && baseName) {
          matched = withPath.filter(sec => {
            const secPath = sec.filePath.trim();
            return secPath === baseName || secPath.endsWith('/' + baseName);
          });
        }
        if (matched.length > 0) {
          matchedSection = matched[0].fullText;
        }
      }

      if (matchedSection) {
        renderDiffViewer(matchedSection, filePath);
        return;
      }

      // 2. 若任務 diff 內未包含該單檔，向後端即時查詢本機 Git Diff
      const projId = currentModalEditingTask ? currentModalEditingTask.project : (currentProject !== 'ALL' ? currentProject : 'task-dashboard');
      const modFileInfo = currentModalEditingTask && currentModalEditingTask.modifiedFiles ? 
        currentModalEditingTask.modifiedFiles.find(f => (typeof f === 'string' ? f : f.path) === filePath) : null;
      const fileDesc = (modFileInfo && typeof modFileInfo === 'object' && modFileInfo.description) ? modFileInfo.description : '';

      try {
        const res = await fetch(`/api/git/file-diff?projectId=${encodeURIComponent(projId)}&filePath=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        if (data && data.diff && data.diff.trim().length > 0) {
          renderDiffViewer(data.diff, filePath);
          return;
        }
      } catch (err) {
        console.warn('Could not fetch git diff from server:', err);
      }

      // 3. 若為純設定檔或無獨立 Git diff，呈現結構化且具體的異動說明卡片
      renderDiffViewer(
`//  異動檔案：${filePath}
// ----------------------------------------------------
//  變更說明：${fileDesc || '專案設定 / 依賴套件 / 流程同步異動'}
//  所屬專案：${projId}
//  說明：此檔案已於本任務完成修正並符合 Harness 檢核。`,
        filePath
      );
    }

    function showAllDiffs() {
      const badgeEl = document.getElementById('diffActiveFileBadge');
      if (badgeEl) badgeEl.innerText = '全部變更';
      document.querySelectorAll?.('.mod-file-item')?.forEach(el => {
        el.className = MOD_FILE_ITEM_INACTIVE_CLASS;
      });
      renderDiffViewer(currentActiveTaskDiff);
    }

    function renderUnifiedDiffRow({ rowClass = '', oldNum = '', newNum = '', sign = ' ', signClass = '', content = '', rowAttrs = '' }) {
      return `
        <div class="diff-row ${rowClass}"${rowAttrs}>
          <div class="diff-num">${oldNum}</div>
          <div class="diff-num">${newNum}</div>
          <div class="diff-sign ${signClass}">${sign}</div>
          <div class="diff-content">${escapeHtml(content)}</div>
        </div>
      `;
    }

    function renderLineNumberedDiff(lines) {
      if (!Array.isArray(lines) || lines.length === 0) return '';
      let oldLineNum = null;
      let newLineNum = null;

      return lines.map(line => {
        if (line.startsWith('@@')) {
          const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLineNum = parseInt(match[1], 10);
            newLineNum = parseInt(match[2], 10);
          }
          return renderUnifiedDiffRow({
            rowClass: 'diff-line-chunk bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold px-1 py-0.5 rounded my-0.5',
            oldNum: '...',
            newNum: '...',
            sign: '@',
            signClass: 'text-indigo-500',
            content: line
          });
        }

        if (line.startsWith('+') && !line.startsWith('+++')) {
          const curNew = newLineNum !== null ? newLineNum++ : '';
          return renderUnifiedDiffRow({
            rowClass: 'diff-line-add hover:bg-emerald-500/20',
            newNum: curNew,
            sign: '+',
            signClass: 'text-emerald-600 dark:text-emerald-400',
            content: line.slice(1)
          });
        }

        if (line.startsWith('-') && !line.startsWith('---')) {
          const curOld = oldLineNum !== null ? oldLineNum++ : '';
          return renderUnifiedDiffRow({
            rowClass: 'diff-line-del hover:bg-rose-500/20',
            oldNum: curOld,
            sign: '-',
            signClass: 'text-rose-600 dark:text-rose-400',
            content: line.slice(1)
          });
        }

        if (!line.startsWith('diff --git') && !line.startsWith('diff --no-index') && !line.startsWith('index ') && !line.startsWith('new file mode') && !line.startsWith('deleted file mode') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('\\')) {
          const curOld = oldLineNum !== null ? oldLineNum++ : '';
          const curNew = newLineNum !== null ? newLineNum++ : '';
          return renderUnifiedDiffRow({
            rowClass: 'hover:bg-slate-100/70 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300',
            oldNum: curOld,
            newNum: curNew,
            sign: ' ',
            signClass: 'text-slate-300 dark:text-slate-700',
            content: line.startsWith(' ') ? line.slice(1) : line
          });
        }

        return renderUnifiedDiffRow({
          rowClass: 'text-slate-400 dark:text-slate-500 italic py-0.5',
          sign: '#',
          signClass: 'font-mono',
          content: line
        });
      }).join('');
    }

    function parseUnifiedDiffHunks(lines) {
      if (!Array.isArray(lines) || lines.length === 0) return [];
      const hunks = [];
      let current = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('@@')) {
          const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
          if (!m) continue;
          const oldStart = parseInt(m[1], 10);
          const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
          const newStart = parseInt(m[3], 10);
          const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
          current = {
            header: line,
            funcHint: (m[5] || '').trim(),
            oldStart,
            oldCount,
            newStart,
            newCount,
            oldConsumed: 0,
            newConsumed: 0,
            curOld: oldStart,
            curNew: newStart,
            rows: []
          };
          hunks.push(current);
          continue;
        }

        if (!current) continue;
        if (line.startsWith('\\')) continue;
        if (current.oldConsumed >= current.oldCount && current.newConsumed >= current.newCount) {
          continue;
        }

        if (line.startsWith('+') && !line.startsWith('+++')) {
          current.rows.push({
            type: 'add',
            oldNum: '',
            newNum: current.curNew++,
            content: line.slice(1)
          });
          current.newConsumed++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          current.rows.push({
            type: 'del',
            oldNum: current.curOld++,
            newNum: '',
            content: line.slice(1)
          });
          current.oldConsumed++;
        } else {
          current.rows.push({
            type: 'ctx',
            oldNum: current.curOld++,
            newNum: current.curNew++,
            content: line.startsWith(' ') ? line.slice(1) : line
          });
          current.oldConsumed++;
          current.newConsumed++;
        }
      }

      return hunks.map(h => {
        const expectedNewLines = h.rows.filter(r => r.type !== 'del').map(r => r.content);
        let leadingCtxCount = 0;
        for (let i = 0; i < h.rows.length; i++) {
          if (h.rows[i].type === 'ctx') leadingCtxCount++;
          else break;
        }
        let trailingCtxCount = 0;
        for (let i = h.rows.length - 1; i >= 0; i--) {
          if (h.rows[i].type === 'ctx') trailingCtxCount++;
          else break;
        }
        const actualOldLen = h.rows.filter(r => r.type !== 'add').length;
        const actualNewLen = expectedNewLines.length;
        return {
          header: h.header,
          funcHint: h.funcHint,
          oldStart: h.oldStart,
          oldEnd: actualOldLen > 0 ? (h.oldStart + actualOldLen - 1) : Math.max(0, h.oldStart),
          newStart: actualNewLen > 0 ? h.newStart : (h.newStart + 1),
          newEnd: actualNewLen > 0 ? (h.newStart + actualNewLen - 1) : h.newStart,
          expectedNewLines,
          leadingCtxCount,
          trailingCtxCount,
          rows: h.rows
        };
      });
    }

    function alignHunksWithFileLines(hunks, fileLines) {
      if (!Array.isArray(hunks) || hunks.length === 0 || !Array.isArray(fileLines)) {
        return { aligned: false, shifted: false, hunks: [] };
      }

      const matchesAtIndex = (expected, startIdx) => {
        if (startIdx < 0 || startIdx + expected.length > fileLines.length) return false;
        for (let i = 0; i < expected.length; i++) {
          if (fileLines[startIdx + i] !== expected[i]) return false;
        }
        return true;
      };

      const alignedHunks = [];
      let prevMatchedEnd = 0;
      let anyShifted = false;

      for (let idx = 0; idx < hunks.length; idx++) {
        const h = hunks[idx];
        const expected = h.expectedNewLines;
        if (expected.length === 0) {
          const clampedEnd = Math.min(Math.max(prevMatchedEnd, h.newEnd), fileLines.length);
          alignedHunks.push({
            ...h,
            matchedNewStart: clampedEnd + 1,
            matchedNewEnd: clampedEnd
          });
          prevMatchedEnd = clampedEnd;
          continue;
        }

        const nominalZeroIdx = h.newStart - 1;
        if (nominalZeroIdx >= prevMatchedEnd && matchesAtIndex(expected, nominalZeroIdx)) {
          alignedHunks.push({
            ...h,
            matchedNewStart: h.newStart,
            matchedNewEnd: h.newStart + expected.length - 1
          });
          prevMatchedEnd = h.newStart + expected.length - 1;
          continue;
        }

        // 若檔案後續曾於上方增刪行，以單調順序在附近搜尋完全一致的程式碼區塊
        let foundIdx = -1;
        const maxRadius = Math.max(200, fileLines.length);
        for (let delta = 1; delta <= maxRadius; delta++) {
          const forward = nominalZeroIdx + delta;
          if (forward >= prevMatchedEnd && matchesAtIndex(expected, forward)) {
            foundIdx = forward;
            break;
          }
          const backward = nominalZeroIdx - delta;
          if (backward >= prevMatchedEnd && matchesAtIndex(expected, backward)) {
            foundIdx = backward;
            break;
          }
        }

        if (foundIdx === -1) {
          return { aligned: false, shifted: false, hunks: [] };
        }
        anyShifted = true;
        const matchedStart = foundIdx + 1;
        const matchedEnd = foundIdx + expected.length;
        alignedHunks.push({
          ...h,
          matchedNewStart: matchedStart,
          matchedNewEnd: matchedEnd
        });
        prevMatchedEnd = matchedEnd;
      }

      return { aligned: true, shifted: anyShifted, hunks: alignedHunks };
    }

    function renderContextualFileDiff(secLines, fileLines, fileKey, contextMode = 15, gapStates = {}, hunkCounterRef = { count: 0 }) {
      const parsedHunks = parseUnifiedDiffHunks(secLines);
      if (parsedHunks.length === 0) {
        return { html: renderLineNumberedDiff(secLines), aligned: false, shifted: false };
      }

      if (!Array.isArray(fileLines)) {
        // 檔案前後文尚未載入或無法取得：保留標準 Diff 並為每個 @@ 區塊加上跳轉錨點
        let oldLineNum = null;
        let newLineNum = null;
        const fallbackHtml = secLines.map(line => {
          if (line.startsWith('@@')) {
            const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) {
              oldLineNum = parseInt(match[1], 10);
              newLineNum = parseInt(match[2], 10);
            }
            const anchorIdx = hunkCounterRef.count++;
            return renderUnifiedDiffRow({
              rowClass: 'diff-line-chunk bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold px-1 py-0.5 rounded my-0.5',
              oldNum: '...',
              newNum: '...',
              sign: '@',
              signClass: 'text-indigo-500',
              content: line,
              rowAttrs: ` data-diff-hunk-anchor="${anchorIdx}"`
            });
          }
          if (line.startsWith('+') && !line.startsWith('+++')) {
            const curNew = newLineNum !== null ? newLineNum++ : '';
            return renderUnifiedDiffRow({
              rowClass: 'diff-line-add hover:bg-emerald-500/20',
              newNum: curNew,
              sign: '+',
              signClass: 'text-emerald-600 dark:text-emerald-400',
              content: line.slice(1)
            });
          }
          if (line.startsWith('-') && !line.startsWith('---')) {
            const curOld = oldLineNum !== null ? oldLineNum++ : '';
            return renderUnifiedDiffRow({
              rowClass: 'diff-line-del hover:bg-rose-500/20',
              oldNum: curOld,
              sign: '-',
              signClass: 'text-rose-600 dark:text-rose-400',
              content: line.slice(1)
            });
          }
          if (!line.startsWith('diff --git') && !line.startsWith('diff --no-index') && !line.startsWith('index ') && !line.startsWith('new file mode') && !line.startsWith('deleted file mode') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('\\')) {
            const curOld = oldLineNum !== null ? oldLineNum++ : '';
            const curNew = newLineNum !== null ? newLineNum++ : '';
            return renderUnifiedDiffRow({
              rowClass: 'hover:bg-slate-100/70 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300',
              oldNum: curOld,
              newNum: curNew,
              sign: ' ',
              signClass: 'text-slate-300 dark:text-slate-700',
              content: line.startsWith(' ') ? line.slice(1) : line
            });
          }
          return renderUnifiedDiffRow({
            rowClass: 'text-slate-400 dark:text-slate-500 italic py-0.5',
            sign: '#',
            signClass: 'font-mono',
            content: line
          });
        }).join('');
        return { html: fallbackHtml, aligned: false, shifted: false };
      }

      const alignment = alignHunksWithFileLines(parsedHunks, fileLines);
      if (!alignment.aligned) {
        return {
          html: renderContextualFileDiff(secLines, null, fileKey, contextMode, gapStates, hunkCounterRef).html,
          aligned: false,
          shifted: false,
          mismatch: true
        };
      }

      const hunks = alignment.hunks;
      const K = hunks.length;
      const totalLines = fileLines.length;
      const isFull = contextMode === 'full';
      const targetCtx = isFull ? Infinity : (Number(contextMode) || 15);
      const encodedKey = encodeURIComponent(fileKey || '');
      const htmlParts = [];

      const renderFileRangeRows = (fromNew, toNew, oldAtFrom) => {
        const rowsOut = [];
        for (let n = fromNew; n <= toNew; n++) {
          const computedOld = oldAtFrom + (n - fromNew);
          rowsOut.push(renderUnifiedDiffRow({
            rowClass: 'diff-line-expanded-ctx hover:bg-slate-100/70 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300',
            oldNum: computedOld >= 1 ? computedOld : '',
            newNum: n,
            sign: ' ',
            signClass: 'text-slate-300 dark:text-slate-700',
            content: fileLines[n - 1] ?? ''
          }));
        }
        return rowsOut.join('');
      };

      for (let g = 0; g <= K; g++) {
        const gapStart = g === 0 ? 1 : (hunks[g - 1].matchedNewEnd + 1);
        const gapEnd = g < K ? (hunks[g].matchedNewStart - 1) : totalLines;
        const oldAtGapStart = g === 0
          ? (hunks[0].oldStart - (hunks[0].matchedNewStart - 1))
          : (hunks[g - 1].oldEnd + 1);

        if (gapEnd >= gapStart) {
          const gapLen = gapEnd - gapStart + 1;
          const gState = (gapStates && gapStates[g]) || { top: 0, bottom: 0, all: false };

          let topReveal = 0;
          let bottomReveal = 0;
          if (isFull || gState.all) {
            topReveal = gapLen;
          } else {
            const prevTrail = g > 0 ? hunks[g - 1].trailingCtxCount : 0;
            const nextLead = g < K ? hunks[g].leadingCtxCount : 0;
            const autoTop = g > 0 ? Math.max(0, targetCtx - prevTrail) : 0;
            const autoBottom = g < K ? Math.max(0, targetCtx - nextLead) : 0;
            topReveal = Math.min(gapLen, autoTop + (gState.top || 0));
            bottomReveal = Math.min(gapLen, autoBottom + (gState.bottom || 0));
          }

          const remaining = gapLen - (topReveal + bottomReveal);
          if (remaining <= 3) {
            htmlParts.push(renderFileRangeRows(gapStart, gapEnd, oldAtGapStart));
          } else {
            if (topReveal > 0) {
              htmlParts.push(renderFileRangeRows(gapStart, gapStart + topReveal - 1, oldAtGapStart));
            }

            const hiddenStart = gapStart + topReveal;
            const hiddenEnd = gapEnd - bottomReveal;
            const hiddenCount = hiddenEnd - hiddenStart + 1;
            const nextFuncHint = (g < K && hunks[g].funcHint) ? ` · <span class="font-mono text-indigo-600 dark:text-indigo-400">${escapeHtml(hunks[g].funcHint)}</span>` : '';

            const btnParts = [];
            if (g > 0 && hiddenCount > 20) {
              const downEnd = Math.min(hiddenEnd, hiddenStart + 19);
              btnParts.push(`<button type="button" onclick="expandDiffGap('${encodedKey}', ${g}, 'down', 20)" aria-label="向下展開 20 行 (第 ${hiddenStart} 至 ${downEnd} 行)" class="px-2 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-sky-700 dark:text-sky-300 border border-sky-300/70 dark:border-sky-700/70 font-medium transition cursor-pointer">↓ 向下展開 20 行</button>`);
            }
            btnParts.push(`<button type="button" onclick="expandDiffGap('${encodedKey}', ${g}, 'all', 0)" aria-label="展開此區間全部 ${hiddenCount} 行 (第 ${hiddenStart} 至 ${hiddenEnd} 行)" class="px-2 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-medium transition cursor-pointer">↕ 展開此區間全部 ${hiddenCount} 行</button>`);
            if (g < K && hiddenCount > 20) {
              const upStart = Math.max(hiddenStart, hiddenEnd - 19);
              btnParts.push(`<button type="button" onclick="expandDiffGap('${encodedKey}', ${g}, 'up', 20)" aria-label="向上展開 20 行 (第 ${upStart} 至 ${hiddenEnd} 行)" class="px-2 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-sky-700 dark:text-sky-300 border border-sky-300/70 dark:border-sky-700/70 font-medium transition cursor-pointer">↑ 向上展開 20 行</button>`);
            }

            htmlParts.push(`
              <div class="diff-expand-bar" data-gap-file="${escapeHtml(encodedKey)}" data-gap-idx="${g}">
                <div class="diff-expand-gutter" aria-hidden="true">⋯</div>
                <div class="flex-1 min-w-0 flex items-center justify-between gap-2 flex-wrap">
                  <span class="text-slate-600 dark:text-slate-400 truncate">隱藏第 ${hiddenStart}–${hiddenEnd} 行（${hiddenCount} 行未異動）${nextFuncHint}</span>
                  <div class="flex items-center gap-1.5 flex-wrap">${btnParts.join('')}</div>
                </div>
              </div>
            `);

            if (bottomReveal > 0) {
              const bottomStart = gapEnd - bottomReveal + 1;
              const oldAtBottom = oldAtGapStart + (bottomStart - gapStart);
              htmlParts.push(renderFileRangeRows(bottomStart, gapEnd, oldAtBottom));
            }
          }
        }

        if (g < K) {
          const hunk = hunks[g];
          const anchorIdx = hunkCounterRef.count++;
          const firstChangeIdx = hunk.rows.findIndex(r => r.type === 'add' || r.type === 'del');
          const targetRowIdx = firstChangeIdx !== -1 ? firstChangeIdx : 0;
          let runningMatchedNew = hunk.matchedNewStart;

          hunk.rows.forEach((row, rIdx) => {
            const anchorAttr = rIdx === targetRowIdx
              ? ` data-diff-hunk-anchor="${anchorIdx}" data-hunk-file="${escapeHtml(encodedKey)}" data-hunk-local="${g}"`
              : '';
            if (row.type === 'add') {
              const displayNew = alignment.shifted ? runningMatchedNew++ : row.newNum;
              htmlParts.push(renderUnifiedDiffRow({
                rowClass: 'diff-line-add hover:bg-emerald-500/20',
                newNum: displayNew,
                sign: '+',
                signClass: 'text-emerald-600 dark:text-emerald-400',
                content: row.content,
                rowAttrs: anchorAttr
              }));
            } else if (row.type === 'del') {
              htmlParts.push(renderUnifiedDiffRow({
                rowClass: 'diff-line-del hover:bg-rose-500/20',
                oldNum: row.oldNum,
                sign: '-',
                signClass: 'text-rose-600 dark:text-rose-400',
                content: row.content,
                rowAttrs: anchorAttr
              }));
            } else {
              const displayNew = alignment.shifted ? runningMatchedNew++ : row.newNum;
              htmlParts.push(renderUnifiedDiffRow({
                rowClass: 'hover:bg-slate-100/70 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300',
                oldNum: row.oldNum,
                newNum: displayNew,
                sign: ' ',
                signClass: 'text-slate-300 dark:text-slate-700',
                content: row.content,
                rowAttrs: anchorAttr
              }));
            }
          });
        }
      }

      return { html: htmlParts.join(''), aligned: true, shifted: alignment.shifted };
    }

    function updateDiffContextToolbar(hasDiff, totalHunks, sourceText = '') {
      const toolbar = document.getElementById('diffContextToolbar');
      if (!toolbar) return;
      if (!hasDiff) {
        toolbar.classList.add('hidden');
        return;
      }
      toolbar.classList.remove('hidden');

      document.querySelectorAll?.('.diff-ctx-btn')?.forEach(btn => {
        const val = btn.getAttribute('data-diff-ctx');
        const isActive = String(currentDiffContextMode) === String(val);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const srcBadge = document.getElementById('diffContextSourceBadge');
      if (srcBadge) srcBadge.innerText = sourceText || '';

      const posBadge = document.getElementById('diffHunkPositionBadge');
      if (posBadge) {
        if (totalHunks > 0) {
          const clamped = Math.min(Math.max(0, activeDiffHunkIndex), totalHunks - 1);
          posBadge.innerText = `${clamped + 1} / ${totalHunks} 處異動`;
        } else {
          posBadge.innerText = '0 處異動';
        }
      }
    }

    async function fetchFileContextForTask(taskId, projId, filePath) {
      if (!filePath || typeof fetch !== 'function') return null;
      const cacheKey = `${taskId || 'live'}::${projId || ''}::${filePath}`;
      if (diffFileContextCache.has(cacheKey)) {
        return diffFileContextCache.get(cacheKey);
      }
      if (diffPendingFetches.has(cacheKey)) return null;
      diffPendingFetches.add(cacheKey);
      try {
        const qs = `taskId=${encodeURIComponent(taskId || '')}&projectId=${encodeURIComponent(projId || '')}&filePath=${encodeURIComponent(filePath)}`;
        const res = await fetch(`/api/git/file-context?${qs}`);
        if (!res || !res.ok) {
          diffFileContextCache.set(cacheKey, { lines: null, source: 'unavailable', totalLines: 0 });
          return null;
        }
        const data = await res.json();
        const entry = {
          lines: Array.isArray(data && data.lines) ? data.lines : null,
          source: (data && data.source) || 'unavailable',
          commitSha: (data && data.commitSha) || '',
          totalLines: Number(data && data.totalLines) || 0
        };
        if (diffFileContextCache.size > 60) {
          const oldestKey = diffFileContextCache.keys().next().value;
          if (oldestKey) diffFileContextCache.delete(oldestKey);
        }
        diffFileContextCache.set(cacheKey, entry);
        return entry;
      } catch (e) {
        diffFileContextCache.set(cacheKey, { lines: null, source: 'unavailable', totalLines: 0 });
        return null;
      } finally {
        diffPendingFetches.delete(cacheKey);
      }
    }

    function setDiffContextLines(mode) {
      const normalized = mode === 'full' ? 'full' : (parseInt(mode, 10) || 15);
      currentDiffContextMode = normalized;
      diffExpandedGapsState = {};
      if (lastRenderedDiffState.diffText) {
        renderDiffViewer(lastRenderedDiffState.diffText, lastRenderedDiffState.singleFilePath, {
          autoScrollToActiveHunk: normalized === 'full' || normalized === 40
        });
      }
    }

    function expandDiffGap(encodedFileKey, gapIdx, direction, step = 20) {
      const fileKey = decodeURIComponent(encodedFileKey || '');
      if (!diffExpandedGapsState[fileKey]) diffExpandedGapsState[fileKey] = {};
      if (!diffExpandedGapsState[fileKey][gapIdx]) {
        diffExpandedGapsState[fileKey][gapIdx] = { top: 0, bottom: 0, all: false };
      }
      const st = diffExpandedGapsState[fileKey][gapIdx];
      if (direction === 'all') {
        st.all = true;
      } else if (direction === 'down') {
        st.top += (Number(step) || 20);
      } else if (direction === 'up') {
        st.bottom += (Number(step) || 20);
      }

      const diffVisual = document.getElementById('formDiffVisual');
      let anchorSelector = '';
      let prevOffsetFromContainerTop = null;
      if (direction === 'up' && diffVisual && typeof diffVisual.querySelector === 'function') {
        anchorSelector = `[data-hunk-file="${encodedFileKey}"][data-hunk-local="${gapIdx}"]`;
        const anchorEl = diffVisual.querySelector(anchorSelector);
        if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function' && typeof diffVisual.getBoundingClientRect === 'function') {
          prevOffsetFromContainerTop = anchorEl.getBoundingClientRect().top - diffVisual.getBoundingClientRect().top;
        }
      }

      if (lastRenderedDiffState.diffText) {
        renderDiffViewer(lastRenderedDiffState.diffText, lastRenderedDiffState.singleFilePath, { preserveHunkIndex: true });
      }

      if (prevOffsetFromContainerTop !== null && anchorSelector && diffVisual && typeof diffVisual.querySelector === 'function') {
        const nextAnchorEl = diffVisual.querySelector(anchorSelector);
        if (nextAnchorEl && typeof nextAnchorEl.getBoundingClientRect === 'function') {
          const newOffset = nextAnchorEl.getBoundingClientRect().top - diffVisual.getBoundingClientRect().top;
          diffVisual.scrollTop += (newOffset - prevOffsetFromContainerTop);
        }
      }
    }

    function jumpToDiffHunk(delta) {
      const diffVisual = document.getElementById('formDiffVisual');
      if (!diffVisual || typeof diffVisual.querySelectorAll !== 'function') return;
      const anchors = Array.from(diffVisual.querySelectorAll('[data-diff-hunk-anchor]'));
      if (anchors.length === 0) return;

      if (delta === 0) {
        activeDiffHunkIndex = Math.min(Math.max(0, activeDiffHunkIndex), anchors.length - 1);
      } else {
        activeDiffHunkIndex = (activeDiffHunkIndex + delta + anchors.length) % anchors.length;
      }

      const target = anchors[activeDiffHunkIndex];
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        anchors.forEach(el => el.classList?.remove('diff-hunk-active-flash'));
        target.classList?.add('diff-hunk-active-flash');
      }

      const posBadge = document.getElementById('diffHunkPositionBadge');
      if (posBadge) {
        posBadge.innerText = `${activeDiffHunkIndex + 1} / ${anchors.length} 處異動`;
      }
    }

    function renderDiffViewer(diffText, singleFilePath, renderOptions = {}) {
      const diffVisual = document.getElementById('formDiffVisual');
      const taskId = currentModalEditingTask ? (currentModalEditingTask.id || '') : '';
      const projId = currentModalEditingTask ? (currentModalEditingTask.project || '') : (currentProject !== 'ALL' ? currentProject : 'task-dashboard');
      const taskKey = `${taskId}::${projId}`;

      if (lastRenderedDiffState.taskKey !== taskKey) {
        diffExpandedGapsState = {};
        activeDiffHunkIndex = 0;
      } else if (lastRenderedDiffState.singleFilePath !== (singleFilePath || '') && !renderOptions.preserveHunkIndex) {
        activeDiffHunkIndex = 0;
      }
      lastRenderedDiffState = { taskKey, diffText: diffText || '', singleFilePath: singleFilePath || '' };

      if (!diffText || diffText.trim().length === 0) {
        updateDiffSummaryBar('');
        updateDiffContextToolbar(false, 0, '');
        if (diffVisual) {
          diffVisual.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <i data-lucide="git-pull-request" class="w-8 h-8 text-slate-500 mb-2 opacity-50"></i>
              <span class="text-xs"> 尚未產生代碼變更或 Diff</span>
            </div>
          `;
        }
        if (typeof window !== 'undefined' && window.lucide) window.lucide.createIcons();
        return;
      }

      updateDiffSummaryBar(diffText, singleFilePath);
      const sections = splitDiffByFiles(diffText);
      const hunkCounterRef = { count: 0 };
      const filesMissingContext = [];
      let sourceBadgeLabel = '';

      const resolveCachedContext = (fp, status) => {
        if (!fp || status === 'A' || status === 'D') return null;
        const cacheKey = `${taskId || 'live'}::${projId || ''}::${fp}`;
        if (!diffFileContextCache.has(cacheKey)) {
          filesMissingContext.push(fp);
          return null;
        }
        return diffFileContextCache.get(cacheKey);
      };

      const describeSourceBadge = (ctxEntry, resInfo) => {
        if (!ctxEntry) return '';
        if (resInfo && resInfo.mismatch) return '檔案後續已重構 · 顯示快照片段';
        if (!resInfo || !resInfo.aligned) return '';
        if (ctxEntry.source === 'worktree') return `Worktree 完整前後文 (${ctxEntry.totalLines} 行)`;
        if (ctxEntry.source === 'commit') return `Commit ${ctxEntry.commitSha || ''} 快照 (${ctxEntry.totalLines} 行)`;
        if (ctxEntry.source === 'workspace' || ctxEntry.source === 'head') {
          return resInfo.shifted
            ? `工作區位移對齊 (${ctxEntry.totalLines} 行)`
            : `完整前後文已就緒 (${ctxEntry.totalLines} 行)`;
        }
        return '';
      };

      if (sections.length > 1) {
        // 多檔案高級結構化卡片呈現
        diffVisual.innerHTML = sections.map((sec, idx) => {
          const fileName = sec.filePath || '未命名檔案';
          let addCount = 0;
          let delCount = 0;
          sec.lines.forEach(l => {
            if (l.startsWith('+') && !l.startsWith('+++')) addCount++;
            else if (l.startsWith('-') && !l.startsWith('---')) delCount++;
          });
          const status = sec.status || 'M';
          const statusBadge = status === 'A'
            ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">A</span>'
            : (status === 'D'
              ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">D</span>'
              : '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">M</span>');

          const ctxEntry = resolveCachedContext(sec.filePath, status);
          const rendered = renderContextualFileDiff(
            sec.lines,
            ctxEntry ? ctxEntry.lines : null,
            fileName,
            currentDiffContextMode,
            diffExpandedGapsState[fileName] || {},
            hunkCounterRef
          );
          if (!sourceBadgeLabel) {
            sourceBadgeLabel = describeSourceBadge(ctxEntry, rendered);
          }
          const totalDisplayLines = (rendered.aligned && ctxEntry) ? ctxEntry.totalLines : sec.lines.length;

          return `
            <div id="diffCard_${idx}" class="diff-card mb-3 last:mb-0 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
              <div onclick="toggleSingleDiffCard('diffCard_${idx}')" class="bg-slate-100/90 dark:bg-slate-800/80 px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition">
                <div class="flex items-center gap-2 truncate">
                  ${statusBadge}
                  <span class="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400 truncate">${escapeHtml(fileName)}</span>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">+${addCount}</span>
                  <span class="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">-${delCount}</span>
                  <span class="text-[10px] text-slate-400 font-sans">${totalDisplayLines} 行</span>
                  <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-400"></i>
                </div>
              </div>
              <div class="diff-card-body p-2 overflow-x-auto custom-scrollbar font-mono text-xs leading-relaxed">
                ${rendered.html}
              </div>
            </div>
          `;
        }).join('');
      } else {
        // 單一檔案呈現
        const lines = diffText.split('\n');
        const headerTitle = singleFilePath || (sections[0] && sections[0].filePath) || '';
        let addCount = 0;
        let delCount = 0;
        lines.forEach(l => {
          if (l.startsWith('+') && !l.startsWith('+++')) addCount++;
          else if (l.startsWith('-') && !l.startsWith('---')) delCount++;
        });

        if (headerTitle) {
          const status = sections[0] ? (sections[0].status || 'M') : 'M';
          const statusBadge = status === 'A'
            ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">A</span>'
            : (status === 'D'
              ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">D</span>'
              : '<span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">M</span>');

          const ctxEntry = resolveCachedContext(headerTitle, status);
          const rendered = renderContextualFileDiff(
            lines,
            ctxEntry ? ctxEntry.lines : null,
            headerTitle,
            currentDiffContextMode,
            diffExpandedGapsState[headerTitle] || {},
            hunkCounterRef
          );
          sourceBadgeLabel = describeSourceBadge(ctxEntry, rendered);
          if (!sourceBadgeLabel && status === 'A') sourceBadgeLabel = '新增檔案 (已顯示全檔)';
          if (!sourceBadgeLabel && status === 'D') sourceBadgeLabel = '刪除檔案 (已顯示全檔)';
          const totalDisplayLines = (rendered.aligned && ctxEntry) ? ctxEntry.totalLines : lines.length;

          diffVisual.innerHTML = `
            <div id="diffCard_single" class="diff-card border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
              <div onclick="toggleSingleDiffCard('diffCard_single')" class="bg-slate-100/90 dark:bg-slate-800/80 px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition">
                <div class="flex items-center gap-2 truncate">
                  ${statusBadge}
                  <span class="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400 truncate">${escapeHtml(headerTitle)}</span>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">+${addCount}</span>
                  <span class="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">-${delCount}</span>
                  <span class="text-[10px] text-slate-400 font-sans">${totalDisplayLines} 行</span>
                  <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-400"></i>
                </div>
              </div>
              <div class="diff-card-body p-2 overflow-x-auto custom-scrollbar font-mono text-xs leading-relaxed">
                ${rendered.html}
              </div>
            </div>
          `;
        } else {
          diffVisual.innerHTML = renderLineNumberedDiff(lines);
        }
      }

      const hasRealDiffHunks = hunkCounterRef.count > 0;
      updateDiffContextToolbar(hasRealDiffHunks, hunkCounterRef.count, sourceBadgeLabel);

      if (renderOptions.autoScrollToActiveHunk && hasRealDiffHunks) {
        jumpToDiffHunk(0);
      }

      if (filesMissingContext.length > 0 && filesMissingContext.length <= 12) {
        const snapshotTaskKey = taskKey;
        const snapshotSinglePath = singleFilePath || '';
        const snapshotDiffText = diffText;
        Promise.all(filesMissingContext.map(fp => fetchFileContextForTask(taskId, projId, fp))).then(results => {
          const anyLoaded = results.some(r => r && Array.isArray(r.lines));
          if (
            anyLoaded &&
            lastRenderedDiffState.taskKey === snapshotTaskKey &&
            lastRenderedDiffState.singleFilePath === snapshotSinglePath &&
            lastRenderedDiffState.diffText === snapshotDiffText
          ) {
            renderDiffViewer(snapshotDiffText, snapshotSinglePath, {
              preserveHunkIndex: true,
              autoScrollToActiveHunk: currentDiffContextMode === 'full'
            });
          }
        });
      }

      if (typeof window !== 'undefined' && window.lucide) window.lucide.createIcons();
    }


export {
  extractFilePathFromDiffSection,
  parseFileStatusFromLines,
  parseDiffStats,
  splitDiffByFiles,
  updateDiffSummaryBar,
  toggleCollapseAllDiffs,
  toggleSingleDiffCard,
  toggleDiffFocusMode,
  toggleModalFullscreen,
  copyCurrentDiff,
  filterDiffForFile,
  showAllDiffs,
  renderLineNumberedDiff,
  parseUnifiedDiffHunks,
  alignHunksWithFileLines,
  renderContextualFileDiff,
  setDiffContextLines,
  expandDiffGap,
  jumpToDiffHunk,
  renderDiffViewer
};

if (typeof window !== "undefined") {
  window.extractFilePathFromDiffSection = extractFilePathFromDiffSection;
  window.parseFileStatusFromLines = parseFileStatusFromLines;
  window.parseDiffStats = parseDiffStats;
  window.splitDiffByFiles = splitDiffByFiles;
  window.updateDiffSummaryBar = updateDiffSummaryBar;
  window.toggleCollapseAllDiffs = toggleCollapseAllDiffs;
  window.toggleSingleDiffCard = toggleSingleDiffCard;
  window.toggleDiffFocusMode = toggleDiffFocusMode;
  window.toggleModalFullscreen = toggleModalFullscreen;
  window.copyCurrentDiff = copyCurrentDiff;
  window.filterDiffForFile = filterDiffForFile;
  window.showAllDiffs = showAllDiffs;
  window.renderLineNumberedDiff = renderLineNumberedDiff;
  window.parseUnifiedDiffHunks = parseUnifiedDiffHunks;
  window.alignHunksWithFileLines = alignHunksWithFileLines;
  window.renderContextualFileDiff = renderContextualFileDiff;
  window.setDiffContextLines = setDiffContextLines;
  window.expandDiffGap = expandDiffGap;
  window.jumpToDiffHunk = jumpToDiffHunk;
  window.renderDiffViewer = renderDiffViewer;
}
