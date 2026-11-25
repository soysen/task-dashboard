import { KANBAN_STATUSES } from "./constants.js";
import { tasks, projects, currentProject, currentBranch, groupByBranch, projectBranchesMap, settings, projectGitStatus } from "./state.js";
import { escapeHtml, formatDuration, showToast, copyPrompt, copySessionId, normalizeLogText } from "./utils.js";
import {
  openModal, openModalForEdit, updateModalButtonState, quickApproveDone,
  commitTaskFromCard, archiveTaskFromCard, closeArchiveModal, promptTaskDeleteOrAbandon,
  closeModal
} from "./modal.js";
import {
  chooseFolderNative, closeEnginePopover, closeSettingsModal, toggleSidebar,
  closeSidebar, closeProjectModal, openHelpModal, closeHelpModal
} from "./app.js";

    function normalizeStatus(rawStatus) {
      if (!rawStatus) return 'todo';
      const s = String(rawStatus).toLowerCase().trim();
      if (['in_progress', 'inprogress', 'running', 'active', 'doing'].includes(s)) return 'in_progress';
      if (['review', 'in_review', 'under_review', 'verify', 'testing'].includes(s)) return 'review';
      if (['done', 'completed', 'finished', 'closed', 'resolved'].includes(s)) return 'done';
      if (['archived', 'archive', 'archived_done', 'archivedone'].includes(s)) return 'archived';
      return 'todo'; // 任何 pending, backlog, blocked, open 或非預設狀態皆統一歸入 todo
    }

    function renderMetrics() {
      let filtered = tasks.filter(t => normalizeStatus(t.status) !== 'archived');
      if (currentProject !== 'ALL') {
        filtered = filtered.filter(t => t.project === currentProject);
        if (typeof currentBranch !== 'undefined' && currentBranch && currentBranch !== 'ALL') {
          filtered = filtered.filter(t => (t.targetBranch || t.baseBranch || '') === currentBranch);
        }
      }

      const totalEl = document.getElementById('stat-total');
      if (totalEl) totalEl.innerText = filtered.length;
      document.getElementById('stat-todo').innerText = filtered.filter(t => normalizeStatus(t.status) === 'todo').length;
      document.getElementById('stat-in_progress').innerText = filtered.filter(t => normalizeStatus(t.status) === 'in_progress').length;
      document.getElementById('stat-review').innerText = filtered.filter(t => normalizeStatus(t.status) === 'review').length;
      document.getElementById('stat-done').innerText = filtered.filter(t => normalizeStatus(t.status) === 'done').length;
    }

    function filterByStage(stage = 'ALL') {
      const prevStage = window.currentStageFilter || 'ALL';
      window.currentStageFilter = (prevStage === stage && stage !== 'ALL') ? 'ALL' : stage;
      const activeStage = window.currentStageFilter;
      const stages = ['ALL', 'todo', 'in_progress', 'review', 'done'];
      stages.forEach(st => {
        const pill = document.getElementById(`stage-pill-${st}`);
        if (pill) {
          const isActive = activeStage === st;
          pill.setAttribute('aria-pressed', String(isActive));
          pill.classList.toggle('ring-2', isActive);
          pill.classList.toggle('ring-sky-500', isActive);
          pill.classList.toggle('dark:ring-sky-400', isActive);
        }
        if (st !== 'ALL') {
          const colWrapper = document.getElementById(`col-wrapper-${st}`);
          if (colWrapper) {
            colWrapper.classList.toggle('hidden', activeStage !== 'ALL' && activeStage !== st);
          }
        }
      });
      renderKanban();
    }

    function getTaskSliceProgress(t) {
      if (!t) return null;
      if (t.sliceInfo?.slices && t.sliceInfo.slices.length > 0) {
        const total = t.sliceInfo.slices.length;
        const completed = t.sliceInfo.slices.filter(s => s.status && (s.status.includes('已完成') || s.status === 'done')).length;
        const activeIdx = t.sliceInfo.slices.findIndex(s => s.status && (s.status.includes('進行中') || s.status === 'in_progress'));
        const currentNum = activeIdx !== -1 ? activeIdx + 1 : Math.min(completed + 1, total);
        return { currentNum, total, completed };
      }
      const safeNormalize = (typeof normalizeLogText === 'function') ? normalizeLogText : (v => typeof v === 'string' ? v : (v ? JSON.stringify(v) : ''));
      const planText = safeNormalize(t.executionPlan);
      if (planText) {
        const matches = [...planText.matchAll(/(?:^|\n)\s*[-*]\s*(?:\[([ xX-])\]\s*)?Slice\s*(\d+)/gi)];
        if (matches.length > 0) {
          const total = matches.length;
          const completed = matches.filter(m => m[1] && m[1].toLowerCase() === 'x').length;
          const currentNum = Math.min(completed + 1, total);
          return { currentNum, total, completed };
        }
      }
      return null;
    }

    function renderKanban() {
      const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
      const priority = document.getElementById('priorityFilter')?.value || 'ALL';

      let filtered = tasks.filter(t => normalizeStatus(t.status) !== 'archived');
      if (currentProject !== 'ALL') {
        filtered = filtered.filter(t => t.project === currentProject);
        if (typeof currentBranch !== 'undefined' && currentBranch && currentBranch !== 'ALL') {
          filtered = filtered.filter(t => (t.targetBranch || t.baseBranch || '') === currentBranch);
        }
      }
      if (priority !== 'ALL') {
        filtered = filtered.filter(t => t.priority === priority);
      }
      if (search) {
        filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || 
          (t.description && t.description.toLowerCase().includes(search)) ||
          (t.tags && t.tags.some(tag => tag.toLowerCase().includes(search))) ||
          t.id.toLowerCase().includes(search)
        );
      }

      // 找出各專案最新的一筆 Done 任務
      const newestDoneTaskIdByProject = {};
      const allDoneTasks = tasks.filter(t => normalizeStatus(t.status) === 'done');
      allDoneTasks.forEach(t => {
        const projKey = t.project || 'default';
        const cur = newestDoneTaskIdByProject[projKey];
        const tTime = new Date(t.updatedAt || t.createdAt || 0).getTime();
        if (!cur || tTime > cur.time) {
          newestDoneTaskIdByProject[projKey] = { id: t.id, time: tTime };
        }
      });

      const statuses = typeof KANBAN_STATUSES !== 'undefined' ? KANBAN_STATUSES : ['todo', 'in_progress', 'review', 'done'];
      const emptyStateHints = {
        todo: '點擊右上角「新增任務」建立需求並指派 Agent',
        in_progress: '將任務拖曳至此欄，自動喚醒哨兵或 CLI 開工',
        review: 'AI 完成實作與測試後將自動推入此處供審閱 Diff',
        done: '驗收通過之任務可於此一鍵提交 Git Commit 與封存'
      };

      const mainBoardEl = document.getElementById('kanbanMainBoard');
      const swimlanesEl = document.getElementById('branchSwimlanesContainer');
      const useBranchSwimlanes = (
        typeof groupByBranch !== 'undefined' && groupByBranch &&
        currentProject !== 'ALL' && (!currentBranch || currentBranch === 'ALL')
      );

      if (mainBoardEl && typeof mainBoardEl.classList?.toggle === 'function' && swimlanesEl && typeof swimlanesEl.classList?.toggle === 'function') {
        mainBoardEl.classList.toggle('hidden', useBranchSwimlanes);
        swimlanesEl.classList.toggle('hidden', !useBranchSwimlanes);
      }

      if (useBranchSwimlanes && swimlanesEl) {
        const branchData = (typeof projectBranchesMap !== 'undefined' ? projectBranchesMap[currentProject] : null) || {};
        const defaultBranch = String(branchData.defaultBranch || 'main').trim();
        const branchNames = Array.isArray(branchData.branches) ? branchData.branches.map(b => b.name) : [];
        const laneSet = new Set(branchNames);
        filtered.forEach(t => {
          const bName = (t.targetBranch || t.baseBranch || '').trim() || '未指定分支';
          laneSet.add(bName);
        });
        const colsMeta = [
          { key: 'todo', label: '待處理' },
          { key: 'in_progress', label: '進行中' },
          { key: 'review', label: '待審核' },
          { key: 'done', label: '已提交' }
        ];
        statuses.forEach(st => {
          const badgeEl = document.getElementById(`badge-${st}`);
          if (badgeEl) badgeEl.innerText = filtered.filter(t => normalizeStatus(t.status) === st).length;
        });
        swimlanesEl.innerHTML = Array.from(laneSet).map(bName => {
          const laneTasks = filtered.filter(t => ((t.targetBranch || t.baseBranch || '').trim() || '未指定分支') === bName);
          const canMerge = bName !== '未指定分支' && bName !== defaultBranch && laneTasks.some(t => normalizeStatus(t.status) === 'done');
          const safeProj = escapeHtml(currentProject).replace(/'/g, "\\'");
          const safeBranch = escapeHtml(bName).replace(/'/g, "\\'");
          const safeDefault = escapeHtml(defaultBranch).replace(/'/g, "\\'");
          return `
            <div class="p-3 rounded-2xl td-surface-well space-y-2.5">
              <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/80">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-bold font-mono text-slate-900 dark:text-white">⎇ ${escapeHtml(bName)}</span>
                  <span class="text-slate-500 dark:text-slate-400">${laneTasks.length} 張任務</span>
                </div>
                <div class="flex items-center gap-2">
                  ${canMerge ? `<button type="button" onclick="openMergeBranchModal('${safeProj}', '${safeBranch}', '${safeDefault}')" class="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer transition">合併回 ${escapeHtml(defaultBranch)}</button>` : ''}
                  ${bName !== '未指定分支' ? `<button type="button" onclick="openModal({ status: 'todo', project: '${safeProj}', targetBranch: '${safeBranch}' })" class="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-500 font-semibold cursor-pointer transition">＋ 新增</button>` : ''}
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                ${colsMeta.map(c => {
                  const sub = laneTasks.filter(t => normalizeStatus(t.status) === c.key);
                  return `
                    <div class="space-y-2">
                      <div class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${c.label} (${sub.length})</div>
                      ${sub.length ? sub.map(t => `<div onclick="openModalForEdit('${t.id}')" class="p-2.5 rounded-xl td-surface-card cursor-pointer space-y-1 text-xs hover:border-sky-500 transition"><div class="flex items-center justify-between text-[10px] text-slate-500 font-mono"><span>${escapeHtml(t.id)}</span><span>${t.workspaceMode === 'branch_stream' ? '接續同分支' : t.workspaceMode === 'in_place' ? '直接改目前資料夾' : '獨立工作區'}</span></div><div class="font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">${escapeHtml(t.title)}</div></div>`).join('') : '<div class="p-2 text-[10px] text-slate-400 italic">無任務</div>'}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('') || '<div class="p-8 text-center text-xs text-slate-400">目前無分支任務</div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      statuses.forEach(st => {
        const colEl = document.getElementById(`col-${st}`);
        const badgeEl = document.getElementById(`badge-${st}`);
        let colTasks = filtered.filter(t => normalizeStatus(t.status) === st);

        // 已完成任務：由新到舊排列 (updatedAt/createdAt 降序)
        if (st === 'done') {
          colTasks.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        }

        badgeEl.innerText = colTasks.length;

        if (colTasks.length === 0) {
          colEl.innerHTML = `<div class="text-center py-7 px-3 text-xs text-slate-500 dark:text-slate-400 rounded-lg space-y-1"><div class="font-medium text-slate-600 dark:text-slate-300">無任務卡片</div><div class="text-[11px] text-slate-400 dark:text-slate-400 leading-relaxed">${emptyStateHints[st] || ''}</div></div>`;
          return;
        }

        const renderCardHtml = (t) => {
          const proj = projects.find(p => p.id === t.project);
          const projName = proj ? proj.name : (t.project || '未指定專案');
          const priorityColor = t.priority === 'P0' ? 'bg-rose-100/90 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300' :
                                t.priority === 'P1' ? 'bg-amber-100/90 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300' :
                                t.priority === 'P2' ? 'bg-slate-200/80 dark:bg-slate-700/90 text-slate-700 dark:text-slate-200' : 'bg-slate-200/70 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300';
          
          const isInProgress = t.status === 'in_progress';
          const isReviewStatus = t.status === 'review';
          const isDoneStatus = t.status === 'done';
          const isNeedsHuman = t.status === 'needs_human' || t.needsHuman === true;
          const projSkills = (t.projectSkills && Array.isArray(t.projectSkills)) ? t.projectSkills : (proj && Array.isArray(proj.skills) ? proj.skills : []);
          const hasGrillMe = projSkills.some(s => (s.id === 'grill-me' || s.label === 'grill-me'));
          const isPendingConfirm = (t.status === 'in_progress' && t.requiresConfirmation);

          return `
            <div data-id="${t.id}" tabindex="0" role="button" aria-label="${escapeHtml(t.title)}" onclick="openModalForEdit('${t.id}')" onkeydown="handleCardKeyDown(event, '${t.id}')" class="kanban-card p-3 rounded-xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] shadow-xs transition-all cursor-pointer group space-y-2 relative focus:outline-none">
              <div class="flex items-start justify-between gap-1.5">
                <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${priorityColor} font-mono whitespace-nowrap flex-shrink-0">${t.priority || 'P1'}</span>
                  ${(t.status === "in_progress" && t.requiresConfirmation && t.executionPlan && t.executionPlan.trim()) ? (hasGrillMe ? `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100/90 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 font-mono flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="此專案具備 Grill-Me 邊界確認機制，點擊彈窗審閱與處理">
                      🔥 Grill-Me 待確認
                    </span>
                  ` : `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100/90 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-mono flex items-center gap-0.5 whitespace-nowrap flex-shrink-0">
                      待確認
                    </span>
                  `) : (t.status === "in_progress" && t.requiresConfirmation) ? `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100/90 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 font-mono flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="此任務需確認後再執行，目前等待擬定執行計劃">
                      待擬定計劃
                    </span>
                  ` : ''}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-mono truncate max-w-[115px] whitespace-nowrap" title="${escapeHtml(projName)}">
                     ${escapeHtml(projName)}
                  </span>
                  ${isNeedsHuman ? `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100/90 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 font-mono flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="單卡連續失敗或退回達 ${t.fixRoundCount || 2} 輪，已熔斷暫停自動喚醒，請由人類接手">
                      🛑 需人類接手
                    </span>
                  ` : ''}
                  ${t.riskDoor === 'one-way' ? `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 font-mono whitespace-nowrap flex-shrink-0" title="${escapeHtml((t.riskReasons || []).join('; ') || '單向門高風險：不可逆或跨模組重大變更')}">
                      🚨 單向門
                    </span>
                  ` : (t.riskDoor === 'two-way' ? `
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 font-mono whitespace-nowrap flex-shrink-0" title="雙向門可逆變更：局部元件或低風險異動">
                      🚪 雙向門
                    </span>
                  ` : '')}
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  ${t.status !== 'backlog' ? `
                  <button onclick="promptTaskDeleteOrAbandon('${t.id}', 'abandon', event)" title="放棄任務 (可選還原 Git 變更)" class="opacity-0 group-hover:opacity-80 hover:!opacity-100 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                    <i data-lucide="ban" class="w-3 h-3"></i>
                  </button>
                  ` : ''}
                  <button onclick="copyPrompt('${t.id}', event)" title="複製 AI 指令" class="opacity-70 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                    <i data-lucide="copy" class="w-3 h-3"></i>
                  </button>
                </div>
              </div>

              <h4 class="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition leading-snug">
                ${escapeHtml(t.title)}
              </h4>

              ${t.description ? `<p class="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">${escapeHtml(t.description)}</p>` : ''}

              ${(t.targetBranch || t.baseBranch) ? `
                <div class="flex items-center gap-1.5 pt-0.5">
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/70 text-[10px] font-mono text-indigo-700 dark:text-indigo-300 max-w-full truncate" title="目標分支: ${escapeHtml(t.targetBranch || t.baseBranch)}">
                    <span>⎇</span>
                    <span class="truncate">${escapeHtml(t.targetBranch || t.baseBranch)}</span>
                  </span>
                </div>
              ` : ''}

              ${isPendingConfirm ? `
                <!-- 待確認內容與邊界質詢摘要卡片 (支援 Grill-Me 專案) -->
                <div class="p-2 rounded-lg shadow-xs ${hasGrillMe ? 'bg-orange-50/90 dark:bg-orange-950/35 text-orange-950 dark:text-orange-200' : 'bg-amber-50/90 dark:bg-amber-950/35 text-amber-950 dark:text-amber-200'} space-y-1 text-[11px]">
                  <div class="flex items-center justify-between gap-1.5 font-semibold text-[10px]">
                    <span class="flex items-center gap-1 min-w-0 truncate ${hasGrillMe ? 'text-orange-700 dark:text-orange-400' : 'text-amber-800 dark:text-amber-300'}">
                      <i data-lucide="${hasGrillMe ? 'flame' : 'clipboard-check'}" class="w-3 h-3 flex-shrink-0 ${hasGrillMe ? 'text-orange-500' : 'text-amber-600'}"></i>
                      <span class="truncate">${hasGrillMe ? 'Grill-Me 邊界質詢內容' : '需確認執行內容'}</span>
                    </span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded font-mono font-normal whitespace-nowrap flex-shrink-0 ${hasGrillMe ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'}">點擊審閱計劃</span>
                  </div>
                  <p class="text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed font-mono">
                    ${escapeHtml(t.executionPlan ? normalizeLogText(t.executionPlan).replace(/^#+\s+/gm, '').trim() : (hasGrillMe ? '此專案具備 Grill-Me 機制，等待邊界確認與執行計劃...' : '等待擬定執行計劃...'))}
                  </p>
                </div>
              ` : ''}

              ${isInProgress ? `
                <div class="space-y-1.5 pt-0.5">
                  <!-- AI 輪巡中 / CLI 執行中 / 排隊等待中 + 當前工作切片 (無框線色塊分層) -->
                  <div class="td-surface-panel rounded-lg p-2 space-y-1.5 text-[10px] text-slate-700 dark:text-slate-200">
                    <div class="flex items-center justify-between gap-1.5">
                      <span class="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap min-w-0 truncate">
                        <span class="w-2 h-2 rounded-full ${t.queueState && t.queueState.blockedByTaskId ? 'bg-amber-500' : 'bg-sky-500'} flex-shrink-0"></span>
                        <span class="truncate">${(t.queueState && t.queueState.blockedByTaskId) ? '排隊等待中' : (settings.enableCliAgent ? ` CLI (${settings.cliCommand || 'hermes'}) 執行中` : ` AI 輪巡中`)}</span>
                      </span>
                      <div class="flex items-center gap-1 flex-shrink-0">
                        ${(t.queueState && t.queueState.blockedByTaskId) ? `
                          <span class="text-[9px] font-semibold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded-full border border-amber-300/70 dark:border-amber-700/60 flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="前一張任務提交後會自動接手開工">
                            ⏳ 等待 ${escapeHtml(t.queueState.blockedByTaskId)} 完成中
                          </span>
                        ` : ''}
                        ${t.liveStatus?.isStalled ? `
                          <span class="text-[9px] font-mono font-semibold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="超過 10 分鐘無新 worklog/進度更新，請檢視執行狀況">
                            ⚠️ 切片推進緩慢
                          </span>
                        ` : ''}
                        ${settings.enableCliAgent ? `
                        <span class="text-[9px] font-mono text-slate-600 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-800 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0">
                           ${formatDuration(t.liveStatus?.elapsedSeconds || 0)}
                        </span>
                        ` : ''}
                        ${(() => {
                          const prog = getTaskSliceProgress(t);
                          if (!prog) return '';
                          return `
                            <span class="text-[9px] font-mono font-semibold text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-800/60 whitespace-nowrap flex-shrink-0" title="切片進度: 第 ${prog.currentNum} 切片 / 共 ${prog.total} 切片 (${prog.completed} 已完成)">
                              切片 ${prog.currentNum}/${prog.total}
                            </span>
                          `;
                        })()}
                      </div>
                    </div>

                    ${(t.sliceInfo?.currentSliceGoal || t.sliceInfo?.currentStep || (t.status === 'in_progress' && (t.description || t.title))) ? `
                      <div class="text-[10px] space-y-1 pt-0.5">
                        <div class="flex items-center gap-1 text-slate-600 dark:text-slate-300 truncate" title="${escapeHtml((t.sliceInfo?.currentSliceGoal && t.sliceInfo.currentSliceGoal !== 'N/A') ? t.sliceInfo.currentSliceGoal : (t.sliceInfo?.currentStep || t.description || t.title || ''))}">
                          <i data-lucide="target" class="w-3 h-3 text-slate-400 flex-shrink-0"></i>
                          <span class="truncate">${escapeHtml((t.sliceInfo?.currentSliceGoal && t.sliceInfo.currentSliceGoal !== 'N/A') ? t.sliceInfo.currentSliceGoal : (t.sliceInfo?.currentStep || t.description || t.title || ''))}</span>
                        </div>
                        ${(() => {
                          const prog = getTaskSliceProgress(t);
                          if (!prog || prog.total === 0) return '';
                          const percent = Math.round((prog.completed / prog.total) * 100);
                          return `
                            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1 overflow-hidden" title="完成率: ${percent}% (${prog.completed}/${prog.total})">
                              <div class="bg-sky-600 dark:bg-sky-400 h-1 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
                            </div>
                          `;
                        })()}
                      </div>
                    ` : ''}
                  </div>

                  ${t.liveStatus?.currentAction ? `
                    <div class="bg-slate-900 dark:bg-slate-950 text-amber-200 rounded-md px-2 py-1 font-mono text-[10px] flex items-center gap-1.5 overflow-hidden shadow-xs" title="${escapeHtml(t.liveStatus.currentAction)}">
                      <span class="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"></span>
                      <span class="truncate font-sans text-amber-200">
                        ${escapeHtml(t.liveStatus.currentAction)}
                      </span>
                    </div>
                  ` : ''}

                  ${t.liveStatus?.liveModifiedFiles && t.liveStatus.liveModifiedFiles.length > 0 ? `
                    <div class="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-300 font-mono td-surface-panel px-2 py-1 rounded-md">
                      <i data-lucide="file-edit" class="w-3 h-3 text-slate-500 flex-shrink-0"></i>
                      <span class="truncate"> 即時異動 ${t.liveStatus.liveModifiedFiles.length} 個檔案</span>
                    </div>
                  ` : ''}
                </div>
              ` : ''}

              <!-- 依賴任務徽章 (點擊可直接打開關聯任務) -->
              ${t.dependencies && t.dependencies.length > 0 ? `
                <div class="flex flex-wrap gap-1">
                  ${t.dependencies.map(dep => `
                    <span onclick="event.stopPropagation(); openModalForEdit('${dep}')" class="text-[9px] bg-slate-100 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 px-1.5 py-0.5 rounded font-mono hover:underline whitespace-nowrap flex-shrink-0 cursor-pointer" title="點擊檢視前置任務 ${dep}"> 依賴 ${escapeHtml(dep)}
                    </span>
                  `).join('')}
                </div>
              ` : ''}

              ${isReviewStatus ? `
                <div class="bg-amber-50/90 dark:bg-amber-950/35 rounded-lg p-1.5 flex items-center justify-between gap-1.5 text-[10px] text-amber-900 dark:text-amber-200 shadow-xs">
                  <span class="flex items-center gap-1 font-semibold whitespace-nowrap min-w-0 truncate">
                    <i data-lucide="eye" class="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0"></i>
                    <span class="truncate">${(t.modifiedFiles && t.modifiedFiles.length) ? `${t.modifiedFiles.length} 檔案 · ` : ''}含 Diff 異動</span>
                  </span>
                  <button onclick="event.stopPropagation(); openModalForEdit('${t.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded font-semibold flex items-center gap-1 transition shadow-xs whitespace-nowrap flex-shrink-0">
                    <i data-lucide="git-pull-request" class="w-3 h-3 flex-shrink-0"></i> 查看並提交
                  </button>
                </div>
              ` : ''}

              ${t.status === 'done' ? (() => {
                const landingSha = t.gitLanding && t.gitLanding.commitSha ? String(t.gitLanding.commitSha).slice(0, 7) : '';
                const landedBranch = (t.gitLanding && t.gitLanding.landedBranch) || t.targetBranch || t.baseBranch || '';
                const pushedRemote = Boolean(t.gitLanding && t.gitLanding.pushedRemote);
                const prUrl = (t.gitLanding && t.gitLanding.prUrl) || t.prUrl || '';
                const defaultBranch = (projectBranchesMap && projectBranchesMap[t.project] && projectBranchesMap[t.project].defaultBranch) || 'main';
                const projObj = (projects || []).find(p => p.id === t.project);
                const requirePr = Boolean(projObj && projObj.requirePr);
                const canCreatePr = Boolean(t.project && landedBranch && (prUrl || landedBranch !== defaultBranch));
                const canPush = Boolean(t.project && landedBranch);
                const prBtnHtml = canCreatePr ? `
                        <button type="button" onclick="openCreatePrForTask('${t.id}', event)" class="bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded font-medium flex items-center gap-1 transition whitespace-nowrap flex-shrink-0" title="${prUrl ? '開啟 Pull Request' : `開立 ${escapeHtml(landedBranch)} → ${escapeHtml(defaultBranch)} PR`}">
                          <i data-lucide="git-pull-request" class="w-3 h-3 flex-shrink-0"></i> ${prUrl ? 'PR ↗' : (requirePr ? '送 PR' : '開 PR')}
                        </button>
                      ` : '';
                const pushBtnHtml = canPush ? `
                        <button type="button" onclick="pushTaskBranchFromCard('${t.id}', event)" class="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded font-medium flex items-center gap-1 transition whitespace-nowrap flex-shrink-0" title="推送分支 ${escapeHtml(landedBranch)} 至遠端">
                          <i data-lucide="upload-cloud" class="w-3 h-3 flex-shrink-0"></i> ${pushedRemote ? '重推' : '推送'}
                        </button>
                      ` : '';

                return `
                  <div class="td-surface-panel rounded-lg p-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-700 dark:text-slate-200">
                    <span class="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400 min-w-0 truncate">
                      <i data-lucide="check-circle-2" class="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0"></i>
                      <span class="truncate">${landingSha ? `✓ 已提交 ${escapeHtml(landingSha)}` : '已完成'}</span>
                      ${landedBranch ? `<span class="px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-[9px] truncate">⎇ ${escapeHtml(landedBranch)}</span>` : ''}
                      ${pushedRemote ? `<span class="px-1 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium text-[9px] whitespace-nowrap flex-shrink-0">已推送</span>` : ''}
                    </span>
                    <div class="flex items-center gap-1 flex-shrink-0">
                      ${requirePr ? `${prBtnHtml}${pushBtnHtml}` : `${pushBtnHtml}${prBtnHtml}`}
                      <button onclick="archiveTaskFromCard('${t.id}', event)" class="bg-slate-200/90 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded font-medium flex items-center gap-1 transition whitespace-nowrap flex-shrink-0" title="手動將此任務移入封存庫">
                        <i data-lucide="archive" class="w-3 h-3 text-slate-500 dark:text-slate-300 flex-shrink-0"></i> 封存
                      </button>
                    </div>
                  </div>
                `;
              })() : ''}

              ${t.tags && t.tags.length > 0 ? `
                <div class="flex flex-wrap gap-1 pt-0.5">
                  ${t.tags.map(tag => {
                    const tagClass = tag === 'feat' ? 'bg-slate-100 dark:bg-slate-700/80 text-sky-700 dark:text-sky-300 font-medium' :
                                     tag === 'fix' ? 'bg-slate-100 dark:bg-slate-700/80 text-rose-600 dark:text-rose-400 font-medium' :
                                     'bg-slate-100/90 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300';
                    return `<span class="text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 ${tagClass}">#${escapeHtml(tag)}</span>`;
                  }).join('')}
                </div>
              ` : ''}

              <div class="pt-1.5 border-t border-transparent flex items-center justify-between gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="flex items-center gap-1 whitespace-nowrap">
                    ${(t.assignee === 'CLI' || (t.assignee && t.assignee.includes('CLI'))) ? `
                      <i data-lucide="terminal" class="w-3 h-3 text-slate-500 flex-shrink-0"></i>
                      <span class="font-semibold text-slate-700 dark:text-slate-300 font-mono"> CLI</span>
                    ` : (t.assignee === 'Antigravity' || !t.assignee) ? `
                      <i data-lucide="sparkles" class="w-3 h-3 text-slate-400 flex-shrink-0"></i>
                      <span>${escapeHtml(t.assignee || 'Antigravity')}</span>
                    ` : `
                      <i data-lucide="user" class="w-3 h-3 text-slate-400 dark:text-slate-500 flex-shrink-0"></i>
                      <span>${escapeHtml(t.assignee)}</span>
                    `}
                  </span>
                  ${t.conversationId ? `
                    <span onclick="copySessionId('${escapeHtml(t.conversationId)}', event)" class="font-mono text-[9px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/80 hover:bg-slate-200 dark:hover:bg-slate-600 px-1.5 py-0.5 rounded transition cursor-pointer flex items-center gap-0.5 whitespace-nowrap flex-shrink-0" title="點擊複製 Hermes Session ID: ${escapeHtml(t.conversationId)}">
                      <i data-lucide="hash" class="w-2.5 h-2.5 text-slate-400 flex-shrink-0"></i>
                      <span>${escapeHtml(t.conversationId.length > 14 ? t.conversationId.slice(-8) : t.conversationId)}</span>
                    </span>
                  ` : ''}
                </div>
                <span class="text-slate-600 dark:text-slate-300 font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400 transition whitespace-nowrap flex-shrink-0">${isReviewStatus ? '審閱驗收 →' : isPendingConfirm ? (t.executionPlan && t.executionPlan.trim() ? '審閱計劃 →' : '擬定計劃 →') : '開啟詳情'}</span>
              </div>
            </div>
          `;
        };

        if (typeof groupByBranch !== 'undefined' && groupByBranch) {
          const branchGroups = new Map();
          colTasks.forEach(t => {
            const branchKey = (t.targetBranch || t.baseBranch || '').trim() || '未指定分支';
            if (!branchGroups.has(branchKey)) branchGroups.set(branchKey, []);
            branchGroups.get(branchKey).push(t);
          });
          const sortedKeys = Array.from(branchGroups.keys()).sort((a, b) => {
            if (a === '未指定分支') return 1;
            if (b === '未指定分支') return -1;
            return a.localeCompare(b);
          });
          colEl.innerHTML = sortedKeys.map(branchKey => {
            const groupTasks = branchGroups.get(branchKey);
            return `
              <div class="mb-2.5">
                <div class="flex items-center justify-between px-2 py-1 mb-1.5 rounded-lg bg-slate-200/70 dark:bg-slate-800/80 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  <span class="flex items-center gap-1 truncate font-mono">⎇ ${escapeHtml(branchKey)}</span>
                  <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">${groupTasks.length}</span>
                </div>
                <div class="space-y-2.5">${groupTasks.map(renderCardHtml).join('')}</div>
              </div>
            `;
          }).join('');
        } else {
          colEl.innerHTML = colTasks.map(renderCardHtml).join('');
        }
      });

      if (window.lucide) lucide.createIcons();
    }


    function getStatusLabel(s) {
      const map = {
        todo: '待處理',
        in_progress: '進行中',
        review: '待驗收',
        done: '已完成'
      };
      return map[s] || s;
    }

    async function handleCardKeyDown(event, taskId) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModalForEdit(taskId);
        return;
      }
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const statuses = KANBAN_STATUSES;
      const curIdx = statuses.indexOf(normalizeStatus(task.status));
      if (curIdx === -1) return;

      let targetStatus = null;
      if (event.key === 'ArrowRight' && curIdx < statuses.length - 1) {
        event.preventDefault();
        targetStatus = statuses[curIdx + 1];
      } else if (event.key === 'ArrowLeft' && curIdx > 0) {
        event.preventDefault();
        targetStatus = statuses[curIdx - 1];
      } else if (['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        targetStatus = statuses[parseInt(event.key, 10) - 1];
      }

      if (targetStatus && targetStatus !== task.status) {
        task.status = targetStatus;
        task.updatedAt = new Date().toISOString();
        try {
          await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...task, forceReview: true })
          });
          renderKanban();
          renderMetrics();
          showToast(`任務 ${taskId} 狀態已切換為：${getStatusLabel(targetStatus)}`);
          setTimeout(() => {
            const cardEl = document.querySelector(`.kanban-card[data-id="${taskId}"]`);
            if (cardEl) cardEl.focus();
          }, 80);
        } catch (e) {
          console.error('Failed to move task via keyboard:', e);
        }
      }
    }

    // 全域鍵盤操作與快捷鍵監聽器
    window.addEventListener('keydown', (e) => {
      // 1. Esc 依彈窗層級（Modal Stack）由上至下依序退棧關閉
      if (e.key === 'Escape') {
        const taskActionConfirmModal = document.getElementById('taskActionConfirmModal');
        if (taskActionConfirmModal && !taskActionConfirmModal.classList.contains('hidden')) {
          if (typeof closeTaskActionConfirmModal === 'function') closeTaskActionConfirmModal();
          return;
        }

        const commitModal = document.getElementById('commitModal');
        if (commitModal && !commitModal.classList.contains('hidden')) {
          if (typeof closeCommitModal === 'function') closeCommitModal();
          return;
        }

        const taskModal = document.getElementById('taskModal');
        if (taskModal && !taskModal.classList.contains('hidden')) {
          closeModal();
          return;
        }

        closeSettingsModal();
        closeProjectModal();
        closeHelpModal();
        closeArchiveModal();
        closeSidebar();
        closeEnginePopover();
        return;
      }

      // 2. 判斷是否有 Task Modal 開啟中
      const taskModal = document.getElementById('taskModal');
      const isTaskModalOpen = taskModal && !taskModal.classList.contains('hidden');

      if (isTaskModalOpen) {
        // Task Submit: Cmd+Enter 或 Ctrl+Enter 提交任務
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          const submitBtn = document.getElementById('btnSubmitTask');
          if (submitBtn) submitBtn.click();
          return;
        }

        // Alt+S: 快速切換 Task 狀態欄位 (循環切換)
        if (e.altKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          const statusSelect = document.getElementById('formStatus');
          if (statusSelect) {
            const statuses = KANBAN_STATUSES;
            const curIdx = statuses.indexOf(statusSelect.value);
            const nextStatus = statuses[(curIdx + 1) % statuses.length];
            statusSelect.value = nextStatus;
            updateModalButtonState();
            statusSelect.focus();
            showToast(`狀態欄位切換為：${getStatusLabel(nextStatus)}`);
          }
          return;
        }

        // Alt+1~4: 直接切換為指定狀態
        if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          const statusSelect = document.getElementById('formStatus');
          if (statusSelect) {
            const statuses = KANBAN_STATUSES;
            const nextStatus = statuses[parseInt(e.key, 10) - 1];
            statusSelect.value = nextStatus;
            updateModalButtonState();
            statusSelect.focus();
            showToast(`狀態欄位設為：${getStatusLabel(nextStatus)}`);
          }
          return;
        }
      }

      // 3. 檢查目前焦點是否在輸入框或文字區
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInputActive = activeTag === 'input' || activeTag === 'textarea';

      // 允許在輸入框內觸發的組合鍵
      if (isInputActive) {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          toggleSidebar();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          chooseFolderNative(e);
          return;
        }
        return;
      }

      // 4. 看板全域快捷鍵 (非文字輸入狀態)
      // 打開 / 收合專案列表: 'p' 或 Cmd/Ctrl + P
      if (e.key.toLowerCase() === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // 新增專案: Shift + P 或 Cmd/Ctrl + Shift + P
      if ((e.key.toLowerCase() === 'p' && e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        chooseFolderNative(e);
        return;
      }

      // 新增 Task: 'n'、'c' 或 Cmd/Ctrl + N
      if ((e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'c') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        openModal({ status: 'todo' });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openModal({ status: 'todo' });
        return;
      }

      // 開啟說明與快捷鍵清單: '?' 或 'F1'
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        openHelpModal();
        return;
      }

      // 快速鍵 1~4 聚焦對應欄位卡片
      if (['1', '2', '3', '4'].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const statuses = KANBAN_STATUSES;
        const targetCol = document.getElementById(`col-${statuses[parseInt(e.key, 10) - 1]}`);
        if (targetCol) {
          const firstCard = targetCol.querySelector('.kanban-card');
          if (firstCard) {
            e.preventDefault();
            firstCard.focus();
          }
        }
      }
    });

    function initSortable() {
      if (typeof Sortable === 'undefined') {
        setTimeout(initSortable, 200);
        return;
      }
      const cols = KANBAN_STATUSES;
      cols.forEach(st => {
        const el = document.getElementById(`col-${st}`);
        if (!el) return;
        new Sortable(el, {
          group: 'kanban',
          animation: 150,
          ghostClass: 'ghost-card',
          onEnd: async (evt) => {
            const taskId = evt.item.getAttribute('data-id');
            const toStatus = evt.to.getAttribute('data-status');
            const task = tasks.find(t => t.id === taskId);
            if (task && task.status !== toStatus) {
              task.status = toStatus;
              task.updatedAt = new Date().toISOString();
              try {
                const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...task, forceReview: true })
                });
                if (res.ok) {
                  const updatedTask = await res.json();
                  const idx = tasks.findIndex(t => t.id === taskId);
                  if (idx !== -1) {
                    tasks[idx] = updatedTask;
                  }
                }
                renderKanban();
                renderMetrics();
                if (toStatus === 'in_progress' && settings.enableCliAgent) {
                  showToast(`已將 ${taskId} 移至進行中，CLI Agent 正在執行...`);
                }
              } catch (err) {
                console.error('Failed to move task:', err);
              }
            }
          }
        });
      });
    }


export {
  normalizeStatus,
  getStatusLabel,
  renderMetrics,
  filterByStage,
  getTaskSliceProgress,
  renderKanban,
  handleCardKeyDown,
  initSortable
};

if (typeof window !== "undefined") {
  window.normalizeStatus = normalizeStatus;
  window.getStatusLabel = getStatusLabel;
  window.renderMetrics = renderMetrics;
  window.filterByStage = filterByStage;
  window.getTaskSliceProgress = getTaskSliceProgress;
  window.renderKanban = renderKanban;
  window.handleCardKeyDown = handleCardKeyDown;
  window.initSortable = initSortable;
}
