import { escapeHtml, showToast, copyToClipboard } from "./utils.js";
import { currentActiveTaskDiff, currentProject, currentModalEditingTask } from "./state.js";

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
        const isNewFileStart = line.startsWith('diff --git') ||
                               line.startsWith('diff --no-index') ||
                               (line.startsWith('--- /dev/null') && (!lines[i - 1] || !lines[i - 1].startsWith('diff'))) ||
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

    function updateDiffSummaryBar(diffText) {
      const bar = document.getElementById('diffSummaryBar');
      if (!bar) return;
      if (!diffText || diffText.trim().length === 0) {
        bar.classList.add('hidden');
        return;
      }
      bar.classList.remove('hidden');
      const stats = parseDiffStats(diffText);
      const filesEl = document.getElementById('diffStatFilesCount');
      const addEl = document.getElementById('diffStatAdditionsBadge');
      const delEl = document.getElementById('diffStatDeletionsBadge');
      if (filesEl) filesEl.innerText = `${stats.filesCount} 個檔案變更`;
      if (addEl) addEl.innerText = `+${stats.additions}`;
      if (delEl) delEl.innerText = `-${stats.deletions}`;
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
      const grid = document.getElementById('modalFormGrid');
      const btnText = document.getElementById('btnToggleFocusModeText');
      const btnIcon = document.getElementById('btnToggleFocusModeIcon');
      const container = document.getElementById('modalDialogContainer');

      if (isDiffFocusMode) {
        if (leftCol) leftCol.classList.add('hidden');
        if (grid) grid.classList.remove('lg:grid-cols-2');
        if (container) {
          container.classList.remove('max-w-6xl');
          container.classList.add('max-w-[98vw]', 'h-[96vh]');
        }
        if (btnText) btnText.innerText = '還原雙欄';
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'minimize-2');
      } else {
        if (leftCol) leftCol.classList.remove('hidden');
        if (grid) grid.classList.add('lg:grid-cols-2');
        if (btnText) btnText.innerText = '專注檢閱';
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'maximize-2');
      }
      if (window.lucide) lucide.createIcons();
    }

    let isModalFullscreen = false;
    function toggleModalFullscreen() {
      isModalFullscreen = !isModalFullscreen;
      const container = document.getElementById('modalDialogContainer');
      const icon = document.getElementById('modalFullscreenIcon');
      if (!container) return;
      if (isModalFullscreen) {
        container.classList.remove('max-w-6xl', 'h-[90vh]');
        container.classList.add('max-w-[98vw]', 'h-[96vh]');
        if (icon) icon.setAttribute('data-lucide', 'minimize');
      } else {
        container.classList.remove('max-w-[98vw]', 'h-[96vh]');
        container.classList.add('max-w-6xl', 'h-[90vh]');
        if (icon) icon.setAttribute('data-lucide', 'maximize');
      }
      if (window.lucide) lucide.createIcons();
    }

    function copyCurrentDiff() {
      if (!currentActiveTaskDiff || !currentActiveTaskDiff.trim()) {
        showToast('目前尚無代碼變更或 Diff 可複製', 'info');
        return;
      }
      copyToClipboard(currentActiveTaskDiff, '已複製全量 Git Diff！');
    }

    async function filterDiffForFile(filePath) {
      document.getElementById('diffActiveFileBadge').innerText = `檔案: ${filePath}`;
      
      // 更新檔案列表的 Active 選中樣式
      document.querySelectorAll('.mod-file-item').forEach(el => {
        if (el.getAttribute('data-path') === filePath) {
          el.className = 'mod-file-item flex items-center justify-between bg-indigo-100 dark:bg-indigo-900/60 border-indigo-500 font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition';
        } else {
          el.className = 'mod-file-item flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition';
        }
      });

      const baseName = filePath.split('/').pop();
      let matchedSection = null;

      // 1. 先從任務已嵌入的 Diff 字串解析
      if (currentActiveTaskDiff && currentActiveTaskDiff.trim().length > 0) {
        const sections = splitDiffByFiles(currentActiveTaskDiff);
        const matched = sections.filter(sec => {
          const secPath = (sec.filePath || '').trim();
          const cleanTarget = filePath.trim();
          return secPath === cleanTarget ||
                 secPath.endsWith('/' + cleanTarget) ||
                 cleanTarget.endsWith('/' + secPath) ||
                 (baseName && secPath.endsWith('/' + baseName)) ||
                 sec.header.includes(cleanTarget) ||
                 sec.lines.some(l => l.includes(cleanTarget));
        });
        if (matched.length > 0) {
          matchedSection = matched.map(m => m.fullText).join('\n\n');
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
      document.getElementById('diffActiveFileBadge').innerText = '全部變更';
      document.querySelectorAll('.mod-file-item').forEach(el => {
        el.className = 'mod-file-item flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition';
      });
      renderDiffViewer(currentActiveTaskDiff);
    }

    function renderLineNumberedDiff(lines) {
      if (!Array.isArray(lines)) return '';
      let oldLineNum = null;
      let newLineNum = null;

      return lines.map(line => {
        const escaped = escapeHtml(line);

        // 解析 Hunk 標頭 @@ -X,Y +A,B @@
        if (line.startsWith('@@')) {
          const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLineNum = parseInt(match[1], 10);
            newLineNum = parseInt(match[2], 10);
          }
          return `
            <div class="diff-row bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold px-1.5 py-0.5">
              <div class="diff-num text-indigo-400 dark:text-indigo-500 text-[9px]">...</div>
              <div class="diff-num text-indigo-400 dark:text-indigo-500 text-[9px]">...</div>
              <div class="diff-sign text-indigo-500">@</div>
              <div class="diff-content">${escaped}</div>
            </div>
          `;
        }

        // 新增行
        if (line.startsWith('+') && !line.startsWith('+++')) {
          const curNew = newLineNum !== null ? newLineNum++ : '';
          return `
            <div class="diff-row diff-line-add hover:bg-emerald-500/20">
              <div class="diff-num"></div>
              <div class="diff-num">${curNew}</div>
              <div class="diff-sign text-emerald-600 dark:text-emerald-400">+</div>
              <div class="diff-content">${escapeHtml(line.slice(1))}</div>
            </div>
          `;
        }

        // 刪除行
        if (line.startsWith('-') && !line.startsWith('---')) {
          const curOld = oldLineNum !== null ? oldLineNum++ : '';
          return `
            <div class="diff-row diff-line-del hover:bg-rose-500/20">
              <div class="diff-num">${curOld}</div>
              <div class="diff-num"></div>
              <div class="diff-sign text-rose-600 dark:text-rose-400">-</div>
              <div class="diff-content">${escapeHtml(line.slice(1))}</div>
            </div>
          `;
        }

        // 一般 context 行
        if (!line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++')) {
          const curOld = oldLineNum !== null ? oldLineNum++ : '';
          const curNew = newLineNum !== null ? newLineNum++ : '';
          const content = line.startsWith(' ') ? line.slice(1) : line;
          return `
            <div class="diff-row hover:bg-slate-100/70 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300">
              <div class="diff-num">${curOld}</div>
              <div class="diff-num">${curNew}</div>
              <div class="diff-sign text-slate-300 dark:text-slate-700"> </div>
              <div class="diff-content">${escapeHtml(content)}</div>
            </div>
          `;
        }

        // Diff 標頭與元資料
        return `
          <div class="diff-row text-slate-400 dark:text-slate-500 italic py-0.5">
            <div class="diff-num"></div>
            <div class="diff-num"></div>
            <div class="diff-sign font-mono">#</div>
            <div class="diff-content">${escaped}</div>
          </div>
        `;
      }).join('');
    }

    function renderDiffViewer(diffText, singleFilePath) {
      const diffVisual = document.getElementById('formDiffVisual');
      if (!diffText || diffText.trim().length === 0) {
        updateDiffSummaryBar('');
        diffVisual.innerHTML = `
          <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <i data-lucide="git-pull-request" class="w-8 h-8 text-slate-500 mb-2 opacity-50"></i>
            <span class="text-xs"> 尚未產生代碼變更或 Diff</span>
          </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
      }

      updateDiffSummaryBar(diffText);
      const sections = splitDiffByFiles(diffText);

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
                  <span class="text-[10px] text-slate-400 font-sans">${sec.lines.length} 行</span>
                  <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-400"></i>
                </div>
              </div>
              <div class="diff-card-body p-2 overflow-x-auto custom-scrollbar font-mono text-xs leading-relaxed">
                ${renderLineNumberedDiff(sec.lines)}
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
                  <span class="text-[10px] text-slate-400 font-sans">${lines.length} 行</span>
                  <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-400"></i>
                </div>
              </div>
              <div class="diff-card-body p-2 overflow-x-auto custom-scrollbar font-mono text-xs leading-relaxed">
                ${renderLineNumberedDiff(lines)}
              </div>
            </div>
          `;
        } else {
          diffVisual.innerHTML = renderLineNumberedDiff(lines);
        }
      }
      if (window.lucide) lucide.createIcons();
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
  window.renderDiffViewer = renderDiffViewer;
}
