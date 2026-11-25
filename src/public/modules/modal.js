import { projects, tasks, archivedTasks, archivedTasksCount, settings, projectGitStatus, currentProject, currentBranch, currentTaskDependencies, currentActiveTaskDiff, currentModalEditingTask, selectedArchivedTaskIds, isOpenedFromArchive, setTasks, setArchivedTasks, setArchivedTasksCount, setCurrentModalEditingTask, setCurrentTaskDependencies, setCurrentActiveTaskDiff, setIsOpenedFromArchive } from "./state.js";
import { escapeHtml, autoResizeTextarea, resetTextareaHeight, formatDuration, showToast, withButtonLoading, copyPrompt, copySessionId, copyToClipboard, normalizeLogText } from "./utils.js";
import { renderKanban, renderMetrics } from "./kanban.js";
import { renderDiffViewer, parseDiffStats, filterDiffForFile, showAllDiffs, splitDiffByFiles } from "./diffViewer.js";
import { renderExecutionReport, renderExecutionPlan, switchPlanViewTab } from "./executionReport.js";
import { loadData } from "./app.js";
import { setIsCurrentModalReadOnly, setFormProject, updateConfirmationGateForProject, clearFormProject, updateProjectClearButtonVisibility, showProjectAutocomplete, hideProjectAutocomplete, toggleProjectAutocomplete, onProjectAutocompleteInput, renderProjectAutocompleteList, updateDependencyOptions, addDependencyFromSelect, removeDependency, renderDependencyChips, initSelect2Dropdown, toggleSelect2Dropdown, onSelect2Search, onSelect2KeyDown, select2ToggleOption, select2AddTag, select2RemoveTag, syncSelect2ToHiddenInput, setSelect2Tags, renderSelect2Chips, insertFeedbackPreset, insertGrillMeDecision, onFormProjectChangeLoadBranches, selectWorkspaceMode, toggleQuickBranchBox, quickCreateBranchInline, updateInPlaceDirtyWarning } from "./modalFormEditor.js";
import { renderContextualHeaderActions } from "./branchNavigator.js";
import { selectedArchiveTaskIds, loadArchivedTasks, openArchiveModal, closeArchiveModal, renderArchiveTasksList, toggleArchiveTaskSelect, toggleArchiveSelectAll, batchDeleteSelectedArchived, deleteAllArchivedTasks, batchRestoreSelectedArchived, restoreSingleArchivedTask, deleteSingleArchivedTask } from "./modalArchive.js";
import { initReviewLandPanel } from "./reviewLandStudio.js";
import { initDoneDeliveryPanel } from "./doneDeliveryStudio.js";

    function isDiffVisibleStatus(status) {
      return ['review', 'pending_review', 'done', 'archived'].includes(status);
    }

    function resolveModifiedFileEntries(task) {
      if (!task) return [];
      if (Array.isArray(task.modifiedFiles) && task.modifiedFiles.length > 0) {
        const seen = new Set();
        const entries = [];
        for (const f of task.modifiedFiles) {
          const filePath = (typeof f === 'string' ? f : (f && f.path ? f.path : '')).trim();
          if (!filePath || seen.has(filePath)) continue;
          seen.add(filePath);
          const description = (typeof f === 'object' && f && f.description) ? String(f.description) : '';
          entries.push({ path: filePath, description });
        }
        if (entries.length > 0) return entries;
      }
      if (task.diff && typeof task.diff === 'string' && task.diff.trim().length > 0) {
        const sections = splitDiffByFiles(task.diff);
        const seen = new Set();
        const entries = [];
        for (const sec of sections) {
          const filePath = (sec.filePath || '').trim();
          if (!filePath || seen.has(filePath)) continue;
          seen.add(filePath);
          entries.push({ path: filePath, description: '' });
        }
        return entries;
      }
      return [];
    }

    function renderModifiedFilesList(task, modFilesList) {
      const resolvedFiles = resolveModifiedFileEntries(task);
      if (!modFilesList) return resolvedFiles;
      if (resolvedFiles.length > 0) {
        const stats = parseDiffStats(task.diff || '');
        modFilesList.innerHTML = resolvedFiles.map(({ path: filePath, description: desc }) => {
          const lastSlashIdx = filePath.lastIndexOf('/');
          const fileName = lastSlashIdx >= 0 ? filePath.slice(lastSlashIdx + 1) : filePath;
          const dirPath = lastSlashIdx > 0 ? filePath.slice(0, lastSlashIdx) : '';
          const fStat = (stats.filesMap && (stats.filesMap[filePath] || stats.filesMap[fileName])) || { status: 'M', additions: 0, deletions: 0 };
          const status = fStat.status || 'M';
          const statusBadge = status === 'A'
            ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex-shrink-0">A</span>'
            : (status === 'D'
              ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex-shrink-0">D</span>'
              : '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 flex-shrink-0">M</span>');
          const linesStat = (fStat.additions > 0 || fStat.deletions > 0)
            ? `<span class="text-[10px] font-mono flex items-center gap-1 flex-shrink-0"><span class="text-emerald-600 font-bold">+${fStat.additions}</span><span class="text-rose-600 font-bold">-${fStat.deletions}</span></span>`
            : '';
          const dirPathHtml = dirPath
            ? `<div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5 pl-5">${escapeHtml(dirPath)}</div>`
            : '';
          const descHtml = desc
            ? `<div class="text-slate-500 dark:text-slate-400 text-[10px] truncate mt-0.5 pl-5">${escapeHtml(desc)}</div>`
            : '';

          return `
            <div data-path="${escapeHtml(filePath)}" onclick="filterDiffForFile('${escapeHtml(filePath)}')" class="mod-file-item flex items-center justify-between gap-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition">
              <div class="min-w-0 flex-1" title="${escapeHtml(filePath)}">
                <div class="flex items-center gap-1.5 min-w-0">
                  ${statusBadge}
                  <span class="text-indigo-600 dark:text-indigo-300 font-semibold truncate text-xs font-mono">${escapeHtml(fileName)}</span>
                </div>
                ${dirPathHtml}
                ${descHtml}
              </div>
              ${linesStat ? `<div class="flex items-center gap-1.5 flex-shrink-0">${linesStat}</div>` : ''}
            </div>
          `;
        }).join('');
      } else {
        modFilesList.innerHTML = '<div class="text-center py-2 text-slate-400 text-xs italic"> 尚未有異動檔案紀錄</div>';
      }
      return resolvedFiles;
    }

    function applyModalTabButtonStyles(tabMap, activeKey) {
      const activeClasses = ['bg-white', 'dark:bg-slate-800', 'text-slate-900', 'dark:text-white', 'shadow-xs', 'font-semibold', 'border-slate-300/80', 'dark:border-slate-600'];
      const inactiveClasses = ['border-transparent', 'text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-slate-200', 'font-medium', 'hover:bg-white/40', 'dark:hover:bg-slate-800/40'];
      Object.entries(tabMap).forEach(([key, btn]) => {
        if (!btn) return;
        const isActive = key === activeKey;
        btn.setAttribute?.('aria-selected', String(isActive));
        activeClasses.forEach(cls => btn.classList?.toggle(cls, isActive));
        inactiveClasses.forEach(cls => btn.classList?.toggle(cls, !isActive));
      });
    }

    function applyModalWorkspaceColumns({ allowDiff, isDiff }) {
      const rightCol = document.getElementById('modalRightColumn');
      const leftCol = document.getElementById('modalLeftColumn');
      const formGrid = document.getElementById('modalFormGrid');

      if (formGrid?.classList) {
        if (typeof formGrid.classList.toggle === 'function') {
          formGrid.classList.toggle('lg:grid-cols-2', false);
          formGrid.classList.toggle('lg:grid-cols-12', allowDiff);
          formGrid.classList.toggle('grid-cols-1', !allowDiff);
        } else {
          formGrid.classList.remove?.('lg:grid-cols-2', allowDiff ? 'grid-cols-1' : 'lg:grid-cols-12');
        }
      }

      if (!allowDiff) {
        leftCol?.classList?.toggle('hidden', false);
        leftCol?.classList?.toggle('lg:col-span-5', false);
        leftCol?.classList?.toggle('lg:col-span-12', false);
        leftCol?.classList?.toggle('w-full', true);
        rightCol?.classList?.toggle('hidden', true);
        rightCol?.classList?.toggle('lg:col-span-7', false);
        rightCol?.classList?.toggle('lg:col-span-12', false);
        return;
      }

      leftCol?.classList?.toggle('hidden', isDiff);
      leftCol?.classList?.toggle('w-full', false);
      leftCol?.classList?.toggle('lg:col-span-5', false);
      leftCol?.classList?.toggle('lg:col-span-12', !isDiff);
      rightCol?.classList?.toggle('hidden', !isDiff);
      rightCol?.classList?.toggle('lg:col-span-7', false);
      rightCol?.classList?.toggle('lg:col-span-12', isDiff);
    }

    function switchModalWorkspaceTab(mode = 'review') {
      const reviewPane = document.getElementById('modalReviewPane');
      const specPane = document.getElementById('modalSpecPane');
      const contextSummary = document.getElementById('modalReviewContextSummary');
      const btnReview = document.getElementById('btnModalTabReview');
      const btnSpec = document.getElementById('btnModalTabSpec');
      const btnDiff = document.getElementById('btnModalTabDiff');
      const btnEditSpecShortcut = document.getElementById('btnModalEditSpecShortcut');
      const allowDiff = Boolean(currentModalEditingTask && isDiffVisibleStatus(currentModalEditingTask.status));

      btnSpec?.classList?.toggle('hidden', allowDiff);
      btnDiff?.classList?.toggle('hidden', !allowDiff);
      btnEditSpecShortcut?.classList?.toggle('hidden', allowDiff);

      const activeMode = allowDiff
        ? (mode === 'diff' ? 'diff' : 'review')
        : (mode === 'spec' ? 'spec' : 'review');
      const isReview = activeMode === 'review';
      const isSpec = activeMode === 'spec';
      const isDiff = activeMode === 'diff';

      specPane?.classList?.toggle('hidden', !isSpec);
      reviewPane?.classList?.toggle('hidden', !isReview);
      contextSummary?.classList?.toggle('hidden', !isReview || !currentModalEditingTask);

      applyModalWorkspaceColumns({ allowDiff, isDiff });

      if (currentModalEditingTask && typeof initReviewLandPanel === 'function') {
        initReviewLandPanel(isSpec || !allowDiff ? null : currentModalEditingTask);
      }
      if (currentModalEditingTask && typeof initDoneDeliveryPanel === 'function') {
        const isDoneDeliverState = Boolean(currentModalEditingTask.status === 'done' && !isOpenedFromArchive);
        initDoneDeliveryPanel(isSpec || !isDoneDeliverState ? null : currentModalEditingTask);
      }

      applyModalTabButtonStyles({ review: btnReview, spec: btnSpec, diff: btnDiff }, activeMode);

      if (currentModalEditingTask && currentModalEditingTask.status !== 'todo') {
        setTimeout(() => {
          if (isSpec) {
            autoResizeTextarea(document.getElementById('formDescription'), 72, 380);
          } else if (isReview) {
            autoResizeTextarea(document.getElementById('formExecutionPlan'), 60, 300);
            autoResizeTextarea(document.getElementById('formFeedback'), 48, 200);
          }
        }, 10);
      }
    }

    // Modal 邏輯 (支援 新增單欄 與 編輯雙欄)
    function openModal(initialData = {}) {
      setCurrentModalEditingTask(null);
      document.getElementById('taskForm').reset();
      document.getElementById('formTaskId').value = '';
      document.getElementById('formConversationId').value = '';
      const sessionBadge = document.getElementById('modalSessionBadge');
      if (sessionBadge) {
        sessionBadge.classList.add('hidden');
        sessionBadge.classList.remove('flex');
      }
      document.getElementById('formExecutionLog').value = '';
      const descEl = document.getElementById('formDescription');
      if (descEl) {
        descEl.rows = 8;
        resetTextareaHeight(descEl);
      }
      resetTextareaHeight(document.getElementById('formExecutionPlan'));
      resetTextareaHeight(document.getElementById('formFeedback'));
      document.getElementById('modalHeaderTitle').innerText = '新增任務';
      document.getElementById('modalPriorityBadge').innerText = 'P1';
      document.getElementById('modalPriorityBadge').className = 'px-2.5 py-0.5 rounded-md text-xs font-bold font-mono bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40';
      const btnDeleteNew = document.getElementById('btnDeleteTask');
      if (btnDeleteNew) btnDeleteNew.classList.add('hidden');
      const btnAbandonNew = document.getElementById('btnAbandonTask');
      if (btnAbandonNew) btnAbandonNew.classList.add('hidden');
      setCurrentTaskDependencies([]);

      if (initialData.status) {
        document.getElementById('formStatus').value = initialData.status;
      }
      const defaultProj = initialData.project !== undefined ? initialData.project : (currentProject !== 'ALL' ? currentProject : '');
      const activeBranch = (typeof currentBranch !== 'undefined') ? currentBranch : 'ALL';
      const defaultBranch = initialData.targetBranch !== undefined ? initialData.targetBranch : (activeBranch !== 'ALL' ? activeBranch : undefined);
      setFormProject(defaultProj, { targetBranch: defaultBranch });
      if (typeof selectWorkspaceMode === 'function') selectWorkspaceMode(initialData.workspaceMode || 'worktree');
      if (typeof toggleQuickBranchBox === 'function') toggleQuickBranchBox(false);

      document.getElementById('formAssignee').value = initialData.assignee || (settings.enableCliAgent ? 'CLI' : 'Antigravity');

      updateDependencyOptions('');
      setSelect2Tags([]);

      // 新增任務時：隱藏分頁切換器與審查回饋區塊，直接聚焦需求規格輸入
      const workspaceTabs = document.getElementById('modalLeftWorkspaceTabs');
      if (workspaceTabs) {
        workspaceTabs.classList.add('hidden');
        workspaceTabs.classList.remove('flex');
      }
      document.getElementById('modalLeftColumn')?.classList.remove('hidden');
      document.getElementById('btnModalTabSpec')?.classList.remove('hidden');
      document.getElementById('btnModalTabDiff')?.classList.add('hidden');
      document.getElementById('btnModalTabDiff')?.setAttribute('aria-selected', 'false');
      document.getElementById('btnModalEditSpecShortcut')?.classList.remove('hidden');
      document.getElementById('modalReviewContextSummary')?.classList.add('hidden');
      document.getElementById('modalSpecPane')?.classList.remove('hidden');
      document.getElementById('modalReviewPane')?.classList.add('hidden');
      document.getElementById('reviewFeedbackBox')?.classList.add('hidden');
      document.getElementById('formSliceInfoBox')?.classList.add('hidden');

      // 清空右欄 Diff 與 Modified Files
      document.getElementById('formModifiedFilesList').innerHTML = '<div class="text-center py-2 text-slate-400 text-xs italic"> 尚未有異動檔案紀錄</div>';
      document.getElementById('formDiffVisual').innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
          <i data-lucide="git-pull-request" class="w-8 h-8 text-slate-500 mb-2 opacity-50"></i>
          <span class="text-xs"> 尚未產生代碼變更或 Diff</span>
        </div>
      `;
      document.getElementById('formLogBox').classList.add('hidden');
      const logVisual = document.getElementById('formLogVisual');
      if (logVisual) logVisual.innerText = '';

      const reqConfirmEl = document.getElementById('formRequiresConfirmation');
      if (reqConfirmEl) reqConfirmEl.checked = !!initialData.requiresConfirmation;
      const execPlanEl = document.getElementById('formExecutionPlan');
      if (execPlanEl) execPlanEl.value = initialData.executionPlan || '';
      if (typeof renderExecutionPlan === 'function') renderExecutionPlan(initialData.executionPlan || '');
      if (typeof switchPlanViewTab === 'function') switchPlanViewTab('visual');
      toggleFormRequiresConfirmation(!!initialData.requiresConfirmation);

      setModalFieldsReadOnly(false);
      updateModalButtonState();

      document.getElementById('taskModal').classList.remove('hidden');
      if (typeof renderContextualHeaderActions === 'function') renderContextualHeaderActions();

      const btnRetro = document.getElementById('btnExtractRetro');
      if (btnRetro) {
        btnRetro.classList.add('hidden');
        btnRetro.classList.remove('inline-flex');
      }
      if (window.lucide) lucide.createIcons();
    }

    function setModalFieldsReadOnly(isReadOnly) {
      setIsCurrentModalReadOnly(isReadOnly);

      // 1. 進行中唯讀提示橫幅
      const notice = document.getElementById('modalInProgressNotice');
      if (notice) {
        if (isReadOnly) {
          notice.classList.remove('hidden');
          notice.classList.add('flex');
        } else {
          notice.classList.add('hidden');
          notice.classList.remove('flex');
        }
      }

      // 2. 所有文字與文字區塊欄位 readonly (若任務處於待確認狀態，執行計劃 formExecutionPlan、任務描述 formDescription 與審閱意見 formFeedback 允許使用者進行修改)
      const textInputs = ['formTitle', 'formProjectInput', 'select2Input'];
      textInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.readOnly = isReadOnly;
          if (isReadOnly) {
            el.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
          } else {
            el.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
          }
        }
      });

      const descInput = document.getElementById('formDescription');
      if (descInput) {
        const isPendingConfirm = !!currentModalEditingTask?.requiresConfirmation && currentModalEditingTask?.status === 'in_progress';
        const descReadOnly = isReadOnly && !isPendingConfirm;
        descInput.readOnly = descReadOnly;
        if (descReadOnly) {
          descInput.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        } else {
          descInput.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        }
      }

      const execPlanInput = document.getElementById('formExecutionPlan');
      if (execPlanInput) {
        const isPendingConfirm = !!currentModalEditingTask?.requiresConfirmation && currentModalEditingTask?.status === 'in_progress';
        const planReadOnly = isReadOnly && !isPendingConfirm;
        execPlanInput.readOnly = planReadOnly;
        if (planReadOnly) {
          execPlanInput.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        } else {
          execPlanInput.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        }
      }

      const feedbackInput = document.getElementById('formFeedback');
      if (feedbackInput) {
        const isPendingConfirm = !!currentModalEditingTask?.requiresConfirmation && currentModalEditingTask?.status === 'in_progress';
        const feedbackReadOnly = isReadOnly && !isPendingConfirm;
        feedbackInput.readOnly = feedbackReadOnly;
        if (feedbackReadOnly) {
          feedbackInput.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        } else {
          feedbackInput.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
        }
      }

      const reqConfirmEl = document.getElementById('formRequiresConfirmation');
      if (reqConfirmEl) {
        reqConfirmEl.disabled = isReadOnly;
      }

      // 3. 下拉選單欄位 (select 不支援 readOnly，改以 disabled 鎖定)
      const selects = ['formDependenciesSelect', 'formPriority', 'formStatus', 'formAssignee'];
      selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          if (id === 'formDependenciesSelect') {
            const currentFormProjId = document.getElementById('formProject') ? document.getElementById('formProject').value : '';
            const shouldDisable = isReadOnly || !currentFormProjId;
            el.disabled = shouldDisable;
            if (shouldDisable) {
              el.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
            } else {
              el.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
            }
          } else {
            el.disabled = isReadOnly;
            if (isReadOnly) {
              el.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
            } else {
              el.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
            }
          }
        }
      });

      // 4. 專案輔助按鈕
      const projClearBtn = document.getElementById('formProjectClearBtn');
      const projDropdownBtn = document.getElementById('formProjectDropdownBtn');
      if (projClearBtn && isReadOnly) {
        projClearBtn.classList.add('hidden', 'pointer-events-none');
      }
      if (projDropdownBtn) {
        if (isReadOnly) {
          projDropdownBtn.classList.add('pointer-events-none', 'opacity-40');
        } else {
          projDropdownBtn.classList.remove('pointer-events-none', 'opacity-40');
        }
      }

      // 5. Select2 標籤控制項
      const select2Box = document.getElementById('select2ControlBox');
      if (select2Box) {
        if (isReadOnly) {
          select2Box.classList.add('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'pointer-events-none');
        } else {
          select2Box.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'pointer-events-none');
        }
      }

      // 6. 依賴清單與標籤晶片按鈕重整
      renderDependencyChips();
      renderSelect2Chips();

      // 7. 執行紀錄與測試 Log 區塊
      const logBox = document.getElementById('formLogBox');
      const logVisual = document.getElementById('formLogVisual');
      const isPendingConfirm = !!currentModalEditingTask?.requiresConfirmation && currentModalEditingTask?.status === 'in_progress';
      if (logBox) {
        const hasLog = Boolean(currentModalEditingTask?.executionLog && currentModalEditingTask.executionLog.trim());
        if (hasLog && (!isReadOnly || isPendingConfirm)) {
          logBox.classList.remove('hidden');
          if (logVisual) logVisual.innerText = currentModalEditingTask.executionLog;
          if (typeof renderExecutionReport === 'function') renderExecutionReport(currentModalEditingTask);
        } else if (!hasLog) {
          logBox.classList.add('hidden');
        }
      }

      // 8. 儲存與刪除/放棄按鈕鎖定 (待確認任務保留儲存按鈕供更新執行計劃與回饋)
      const btnSubmit = document.getElementById('btnSubmitTask');
      const btnDelete = document.getElementById('btnDeleteTask');
      const btnAbandon = document.getElementById('btnAbandonTask');
      if (btnSubmit) {
        if (isReadOnly && !isPendingConfirm) {
          btnSubmit.classList.add('hidden');
        } else {
          btnSubmit.classList.remove('hidden');
        }
      }
      if (btnDelete) {
        btnDelete.classList.add('hidden');
      }
      if (btnAbandon) {
        const isBacklog = (currentModalEditingTask && currentModalEditingTask.status === 'backlog') || (document.getElementById('formStatus')?.value === 'backlog');
        if (isReadOnly || isBacklog || !currentModalEditingTask || !currentModalEditingTask.id) {
          btnAbandon.classList.add('hidden');
        } else {
          btnAbandon.classList.remove('hidden');
        }
      }
    }

    function updateModalLiveInProgressView(task) {
      if (!task || task.status !== 'in_progress') return;
      const currentTaskIdInForm = document.getElementById('formTaskId')?.value;
      if (!currentTaskIdInForm || currentTaskIdInForm !== task.id) return;

      renderModalSliceInfo(task);

      const modFilesList = document.getElementById('formModifiedFilesList');
      if (modFilesList) {
        if (task.liveStatus && Array.isArray(task.liveStatus.liveModifiedFiles) && task.liveStatus.liveModifiedFiles.length > 0) {
          modFilesList.innerHTML = task.liveStatus.liveModifiedFiles.map(filePath => `
            <div class="mod-file-item flex items-center justify-between bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 px-2.5 py-1.5 rounded-lg border border-amber-300/70 dark:border-amber-700/60 transition">
              <span class="text-amber-700 dark:text-amber-300 font-semibold truncate flex items-center gap-1.5 text-xs font-mono">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping flex-shrink-0"></span>
                 ${escapeHtml(filePath)}
              </span>
              <span class="text-[9px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 font-bold animate-pulse"> 即時變更中</span>
            </div>
          `).join('');
        } else if (task.modifiedFiles && task.modifiedFiles.length > 0) {
          modFilesList.innerHTML = task.modifiedFiles.map(f => {
            const filePath = typeof f === 'string' ? f : f.path;
            const desc = (typeof f === 'object' && f.description) ? f.description : '';
            return `
              <div data-path="${escapeHtml(filePath)}" onclick="filterDiffForFile('${escapeHtml(filePath)}')" class="mod-file-item flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition">
                <span class="text-indigo-600 dark:text-indigo-300 font-semibold truncate"> ${escapeHtml(filePath)}</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px] truncate max-w-xs">${escapeHtml(desc || '點擊查看 Diff')}</span>
              </div>
            `;
          }).join('');
        } else {
          modFilesList.innerHTML = '<div class="text-center py-3 text-slate-400 dark:text-slate-500 text-xs italic flex items-center justify-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span> 尚未偵測到檔案變更 (代碼分析中...)</div>';
        }
      }

      // 進行中任務若有執行紀錄，呈現執行紀錄；無則隱藏
      const logBox = document.getElementById('formLogBox');
      const logVisual = document.getElementById('formLogVisual');
      if (logBox) {
        if (task.executionLog && task.executionLog.trim()) {
          logBox.classList.remove('hidden');
          if (logVisual) logVisual.innerText = task.executionLog;
          if (typeof renderExecutionReport === 'function') renderExecutionReport(task);
        } else {
          logBox.classList.add('hidden');
        }
      }
    }

    function shouldShowReviewWorkspace(task) {
      if (!task) return false;
      if (task.status !== 'todo') return true;
      const safeNormalize = (typeof normalizeLogText === 'function') ? normalizeLogText : (v => typeof v === 'string' ? v : (v ? JSON.stringify(v) : ''));
      return !!(safeNormalize(task.executionLog).trim() || safeNormalize(task.feedback).trim() || safeNormalize(task.executionPlan).trim());
    }

    async function openModalForEdit(id, options = {}) {
      let task = tasks.find(t => t.id === id) || archivedTasks.find(t => t.id === id);
      if (!task) {
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}?t=${Date.now()}`);
          if (res.ok) {
            task = await res.json();
          }
        } catch (fetchErr) {
          console.warn('Failed to fetch task on demand for', id, fetchErr);
        }
      }
      if (!task) {
        if (typeof showToast === 'function') showToast(`找不到任務 ${id} 的詳細資訊`, true);
        return;
      }
      if (task.executionLog && typeof task.executionLog !== 'string') {
        task.executionLog = normalizeLogText(task.executionLog);
      }
      if (task.executionPlan && typeof task.executionPlan !== 'string') {
        task.executionPlan = normalizeLogText(task.executionPlan);
      }
      if (task.feedback && typeof task.feedback !== 'string') {
        task.feedback = normalizeLogText(task.feedback);
      }
      if (task.description && typeof task.description !== 'string') {
        task.description = normalizeLogText(task.description);
      }
      setCurrentModalEditingTask(task);

      if (isDiffVisibleStatus(task.status)) {
        if (task.diffPath) {
          fetch(`/api/tasks/${task.id}/diff?t=${Date.now()}`)
            .then(res => res.json())
            .then(data => {
              if (data && data.diff) {
                task.diff = data.diff;
                if (currentModalEditingTask && currentModalEditingTask.id === task.id) {
                  setCurrentActiveTaskDiff(data.diff);
                  const resolved = renderModifiedFilesList(task, document.getElementById('formModifiedFilesList'));
                  if (resolved.length > 0) {
                    filterDiffForFile(resolved[0].path);
                  } else {
                    renderDiffViewer(data.diff);
                  }
                }
              }
            })
            .catch(() => {});
        }
      } else {
        setCurrentActiveTaskDiff('');
        renderDiffViewer('');
        document.getElementById('modalRightColumn')?.classList.add('hidden');
      }

      const fromArchive = Boolean(options && options.fromArchive) || task.status === 'archived';
      setIsOpenedFromArchive(fromArchive);

      const btnBackToArchive = document.getElementById('btnBackToArchive');
      if (btnBackToArchive) {
        if (fromArchive) {
          btnBackToArchive.classList.remove('hidden');
          btnBackToArchive.classList.add('flex');
        } else {
          btnBackToArchive.classList.add('hidden');
          btnBackToArchive.classList.remove('flex');
        }
      }

      const modalArchivedBadge = document.getElementById('modalArchivedBadge');
      if (modalArchivedBadge) {
        if (task.status === 'archived' || fromArchive) {
          modalArchivedBadge.classList.remove('hidden');
          modalArchivedBadge.classList.add('flex');
        } else {
          modalArchivedBadge.classList.add('hidden');
          modalArchivedBadge.classList.remove('flex');
        }
      }

      const btnCancelTaskModal = document.getElementById('btnCancelTaskModal');
      if (btnCancelTaskModal) {
        btnCancelTaskModal.innerText = fromArchive ? '返回封存列表' : '取消';
      }

      document.getElementById('formTaskId').value = task.id;
      document.getElementById('formConversationId').value = task.conversationId || '';
      
      const sessionBadge = document.getElementById('modalSessionBadge');
      const sessionIdText = document.getElementById('modalSessionIdText');
      if (sessionBadge && sessionIdText) {
        if (task.conversationId) {
          sessionIdText.innerText = `Session: ${task.conversationId}`;
          sessionBadge.classList.remove('hidden');
          sessionBadge.classList.add('flex');
        } else {
          sessionBadge.classList.add('hidden');
          sessionBadge.classList.remove('flex');
        }
      }

      document.getElementById('modalHeaderTitle').innerText = `編輯任務：${task.id}`;
      document.getElementById('modalPriorityBadge').innerText = task.priority || 'P1';
      document.getElementById('modalPriorityBadge').className = `px-2.5 py-0.5 rounded-md text-xs font-bold font-mono ${
        task.priority === 'P0' ? 'bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/40' :
        task.priority === 'P1' ? 'bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40' : 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40'
      }`;

      document.getElementById('formTitle').value = task.title || '';
      setFormProject(task.project || '', { targetBranch: task.targetBranch || task.baseBranch || '' });
      if (typeof selectWorkspaceMode === 'function') selectWorkspaceMode(task.workspaceMode || 'worktree');
      if (typeof toggleQuickBranchBox === 'function') toggleQuickBranchBox(false);
      document.getElementById('formPriority').value = task.priority || 'P1';
      document.getElementById('formStatus').value = task.status || 'todo';
      document.getElementById('formAssignee').value = task.assignee || (settings.enableCliAgent ? 'CLI' : 'Antigravity');
      document.getElementById('formDescription').value = task.description || '';
      const normalizedFeedback = normalizeLogText(task.feedback);
      if (task.status === 'review' || task.status === 'done' || task.status === 'archived') {
        document.getElementById('formFeedback').value = '';
      } else {
        document.getElementById('formFeedback').value = normalizedFeedback;
      }

      const reqConfirmEl = document.getElementById('formRequiresConfirmation');
      if (reqConfirmEl) reqConfirmEl.checked = !!task.requiresConfirmation;
      const execPlanEl = document.getElementById('formExecutionPlan');
      const normalizedPlan = normalizeLogText(task.executionPlan);
      if (execPlanEl) execPlanEl.value = normalizedPlan;
      if (typeof renderExecutionPlan === 'function') renderExecutionPlan(normalizedPlan, task);
      if (typeof switchPlanViewTab === 'function') switchPlanViewTab('visual');
      toggleFormRequiresConfirmation(!!task.requiresConfirmation);

      // 設定 Select2 標籤
      setSelect2Tags(task.tags || []);

      // 依賴任務
      setCurrentTaskDependencies(Array.isArray(task.dependencies) ? [...task.dependencies] : []);
      updateDependencyOptions(task.id);

      // 根據任務狀態設定全域欄位唯讀 (進行中與封存任務欄位皆改為 readonly，避免中途異動)
      setModalFieldsReadOnly(task.status === 'in_progress' || task.status === 'archived');

      // 右欄：異動檔案清單 (可點選互動過濾 Diff)
      setCurrentActiveTaskDiff(task.diff || '');
      const modFilesList = document.getElementById('formModifiedFilesList');
      const logBox = document.getElementById('formLogBox');
      const logVisual = document.getElementById('formLogVisual');

      if (task.status === 'in_progress') {
        updateModalLiveInProgressView(task);
        // 主動向後端拉取最新動態切片與 agent-status 資訊，確保即時呈現最新切片進度
        fetch(`/api/tasks/${encodeURIComponent(task.id)}/slice-info?t=${Date.now()}`)
          .then(res => res.ok ? res.json() : null)
          .then(sliceInfo => {
            if (sliceInfo && Object.keys(sliceInfo).length > 0) {
              task.sliceInfo = sliceInfo;
              if (currentModalEditingTask && currentModalEditingTask.id === task.id) {
                renderModalSliceInfo(task);
                updateModalLiveInProgressView(task);
              }
            }
          })
          .catch(() => {});
      } else {
        renderModalSliceInfo(task);
        const resolvedFiles = renderModifiedFilesList(task, modFilesList);

        // 執行紀錄 (自然完整展開，不加內部滾軸)
        if (task.executionLog) {
          logBox.classList.remove('hidden');
          logVisual.innerText = task.executionLog;
          renderExecutionReport(task);
        } else {
          fetch(`/api/tasks/${encodeURIComponent(task.id)}/log?t=${Date.now()}`)
            .then(res => res.ok ? res.text() : '')
            .then(logText => {
              if (logText && logText.trim() && currentModalEditingTask && currentModalEditingTask.id === task.id) {
                task.executionLog = logText;
                logBox.classList.remove('hidden');
                logVisual.innerText = logText;
                renderExecutionReport(task);
              } else if (!task.executionLog) {
                logBox.classList.add('hidden');
              }
            })
            .catch(() => {
              if (!task.executionLog) logBox.classList.add('hidden');
            });
        }

        // 右欄：Git Diff 檢視器 (僅審核/已完成/封存狀態呈現；預設僅顯示第一個選中檔案)
        if (isDiffVisibleStatus(task.status)) {
          if (resolvedFiles.length > 0) {
            filterDiffForFile(resolvedFiles[0].path);
          } else if (task.diff && task.diff.trim().length > 0) {
            renderDiffViewer(task.diff);
          } else {
            renderDiffViewer('');
          }
        } else {
          setCurrentActiveTaskDiff('');
          renderDiffViewer('');
          document.getElementById('modalRightColumn')?.classList.add('hidden');
        }
      }



      const btnDeleteEdit = document.getElementById('btnDeleteTask');
      if (btnDeleteEdit) btnDeleteEdit.classList.add('hidden');
      const btnAbandonEdit = document.getElementById('btnAbandonTask');
      if (btnAbandonEdit) {
        if (task.status === 'backlog') {
          btnAbandonEdit.classList.add('hidden');
        } else {
          btnAbandonEdit.classList.remove('hidden');
        }
      }

      // 填充 IA 審核上下文摘要 (Compact Context Summary) 並根據任務階段預設切換分頁
      const projObj = projects.find(p => p.id === task.project);
      const projLabel = projObj ? projObj.name : (task.project || 'Default');
      const metaProjEl = document.getElementById('modalReviewMetaProject');
      if (metaProjEl) metaProjEl.innerText = projLabel;
      const metaAssigneeEl = document.getElementById('modalReviewMetaAssignee');
      if (metaAssigneeEl) metaAssigneeEl.innerText = `Agent: ${task.assignedAgent || task.assignee || 'Unassigned'}`;
      const metaTitleEl = document.getElementById('modalReviewMetaTitle');
      if (metaTitleEl) metaTitleEl.innerText = task.title || '';
      const rawDesc = (task.description || '').trim();
      const firstDescLine = rawDesc ? rawDesc.split('\n').find(l => l.trim().length > 0) || '點擊展開原始需求描述...' : '（無詳細需求描述）';
      const descPreviewEl = document.getElementById('modalReviewDescPreviewLine');
      if (descPreviewEl) descPreviewEl.innerText = `原始需求：${firstDescLine}`;
      const descFullEl = document.getElementById('modalReviewDescFullText');
      if (descFullEl) descFullEl.innerText = rawDesc || '（無詳細需求描述）';

      // 全新待處理 (todo) 任務比照新增任務，直接聚焦需求規格；
      // 被退回的 todo 任務 (CLI 失敗重置 / Auto-Reconcile / 退回重做) 仍保留執行歷史，必須可檢視審核與執行成果
      const showReviewWorkspace = shouldShowReviewWorkspace(task);
      const workspaceTabs = document.getElementById('modalLeftWorkspaceTabs');
      if (workspaceTabs) {
        workspaceTabs.classList.toggle('hidden', !showReviewWorkspace);
        workspaceTabs.classList.toggle('flex', showReviewWorkspace);
      }
      if (!showReviewWorkspace) {
        document.getElementById('modalLeftColumn')?.classList.remove('hidden');
        document.getElementById('btnModalTabSpec')?.classList.remove('hidden');
        document.getElementById('btnModalTabDiff')?.classList.add('hidden');
        document.getElementById('btnModalTabDiff')?.setAttribute('aria-selected', 'false');
        document.getElementById('btnModalEditSpecShortcut')?.classList.remove('hidden');
        document.getElementById('modalReviewContextSummary')?.classList.add('hidden');
        document.getElementById('modalSpecPane')?.classList.remove('hidden');
        document.getElementById('modalReviewPane')?.classList.add('hidden');
        document.getElementById('reviewFeedbackBox')?.classList.add('hidden');
        document.getElementById('formSliceInfoBox')?.classList.add('hidden');
      } else {
        const reviewDot = document.getElementById('modalTabReviewStatusDot');
        if (reviewDot) {
          const needsReviewAttention = task.status === 'review' || (task.status === 'in_progress' && !!task.requiresConfirmation && !!normalizeLogText(task.executionPlan).trim());
          reviewDot.classList.toggle('hidden', !needsReviewAttention);
        }
        switchModalWorkspaceTab('review');
      }

      updateModalButtonState();
      if (typeof initReviewLandPanel === 'function') {
        initReviewLandPanel(isDiffVisibleStatus(task.status) ? task : null);
      }
      if (typeof initDoneDeliveryPanel === 'function') {
        initDoneDeliveryPanel(task.status === 'done' && !isOpenedFromArchive ? task : null);
      }

      document.getElementById('taskModal').classList.remove('hidden');
      if (typeof renderContextualHeaderActions === 'function') renderContextualHeaderActions();

      const btnRetro = document.getElementById('btnExtractRetro');
      if (btnRetro) {
        const hasFeedbackHistory = normalizeLogText(task.description).includes('--- 【歷次審查意見 / Feedback 記錄】 ---');
        const hasMultiFixRounds = Number(task.fixRoundCount || 0) >= 2 || Boolean(task.needsHuman);
        const showRetro = hasFeedbackHistory || hasMultiFixRounds;
        btnRetro.classList.toggle('hidden', !showRetro);
        btnRetro.classList.toggle('inline-flex', showRetro);
      }

      // 規範：在“進行中”之後的任務 (非 todo / 新增)，textarea 高度根據內容動態調整，避免內容較少時佔據大片無效空白
      const descEl = document.getElementById('formDescription');
      const planEl = document.getElementById('formExecutionPlan');
      const fbEl = document.getElementById('formFeedback');

      if (task.status !== 'todo') {
        setTimeout(() => {
          autoResizeTextarea(descEl, 72, 380);
          autoResizeTextarea(planEl, 60, 300);
          autoResizeTextarea(fbEl, 48, 200);
        }, 10);
      } else {
        if (descEl) {
          descEl.rows = 12;
          resetTextareaHeight(descEl);
        }
        resetTextareaHeight(planEl);
        resetTextareaHeight(fbEl);
      }

      if (window.lucide) lucide.createIcons();
    }

    let isSlicePolling = false;
    let lastSlicePollTime = 0;

    async function pollActiveTaskSliceInfo(task) {
      if (!task || task.status !== 'in_progress' || isSlicePolling) return;
      const now = Date.now();
      if (now - lastSlicePollTime < 2000) return; // 至少間隔 2 秒防抖

      isSlicePolling = true;
      lastSlicePollTime = now;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/slice-info?t=${now}`, { cache: 'no-store' });
        if (res.ok) {
          const sliceInfo = await res.json();
          if (sliceInfo && Object.keys(sliceInfo).length > 0) {
            task.sliceInfo = sliceInfo;
            if (currentModalEditingTask && currentModalEditingTask.id === task.id) {
              renderModalSliceInfo(task);
            }
          }
        }
      } catch (err) {
        // 靜默處理本機 network/I/O 異常，不阻斷 UI
      } finally {
        isSlicePolling = false;
      }
    }

    function renderModalSliceInfo(task) {
      const box = document.getElementById('formSliceInfoBox');
      if (!box) return;

      // 嚴格規定：
      // 1. 待審核 (review) 或已完成 (done) 畫面中僅保留執行紀錄與測試 log，工作切片只在進行中任務顯示
      // 2. 若任務處於「待確認」狀態（requiresConfirmation && status === in_progress），此時尚未確認執行計劃，隱藏工作切片，聚焦於執行計劃的審閱與確認
      const isPendingConfirm = !!task.requiresConfirmation && task.status === 'in_progress';
      if (!task || task.status !== 'in_progress' || isPendingConfirm) {
        box.classList.add('hidden');
        return;
      }

      const sliceInfo = task.sliceInfo;
      if (!sliceInfo || (!sliceInfo.hasWorklog && (!sliceInfo.slices || sliceInfo.slices.length === 0) && !sliceInfo.currentSliceGoal && !sliceInfo.currentStep && !sliceInfo.planTitle)) {
        box.classList.add('hidden');
        return;
      }

      box.classList.remove('hidden');

      // 1. Plan Title & Badge
      const planBadge = document.getElementById('sliceInfoPlanBadge');
      if (planBadge) {
        if (sliceInfo.planTitle || sliceInfo.planFile) {
          planBadge.innerText = sliceInfo.planTitle || sliceInfo.planFile;
          planBadge.classList.remove('hidden');
        } else {
          planBadge.classList.add('hidden');
        }
      }

      // 2. Route Badge
      const routeBadge = document.getElementById('sliceInfoRouteBadge');
      const routeText = document.getElementById('sliceInfoRouteText');
      if (routeBadge && routeText) {
        if (sliceInfo.route && sliceInfo.route !== 'none') {
          routeText.innerText = sliceInfo.route;
          routeBadge.classList.remove('hidden');
          routeBadge.classList.add('flex');
        } else {
          routeBadge.classList.add('hidden');
          routeBadge.classList.remove('flex');
        }
      }

      // 3. Resume Button
      const resumeBtn = document.getElementById('btnCopyResumePrompt');
      if (resumeBtn) {
        resumeBtn.classList.remove('hidden');
        resumeBtn.classList.add('flex');
        resumeBtn.dataset.resume = sliceInfo.resumeEntry || '';
      }

      // 4. Goal & In/Out Scope
      const goalContent = document.getElementById('sliceGoalContent');
      const goalLabel = document.getElementById('sliceGoalLabel');
      const goalSection = document.getElementById('sliceGoalSection');
      if (goalContent) {
        const goal = (sliceInfo.currentSliceGoal && sliceInfo.currentSliceGoal !== 'N/A')
          ? sliceInfo.currentSliceGoal
          : (sliceInfo.planTitle ? `藍圖主目標：${sliceInfo.planTitle}` : (sliceInfo.activeTask && sliceInfo.activeTask.goal && sliceInfo.activeTask.goal !== 'N/A' ? sliceInfo.activeTask.goal : ''));
        if (goal) {
          goalContent.innerText = goal;
          goalSection.classList.remove('hidden');
          if (goalLabel) {
            goalLabel.innerText = (task.status === 'in_progress' ? '🎯 本輪切片目標' : '📌 切片目標紀錄');
          }
        } else {
          goalSection.classList.add('hidden');
        }
      }

      const inOutScope = document.getElementById('sliceInOutScope');
      const inOutScopeText = document.getElementById('sliceInOutScopeText');
      if (inOutScope && inOutScopeText) {
        if (sliceInfo.inOutScope) {
          inOutScopeText.innerText = sliceInfo.inOutScope;
          inOutScope.classList.remove('hidden');
        } else {
          inOutScope.classList.add('hidden');
        }
      }

      // 5. Execution Tracking: CurrentStep & Evidence
      const trackingSection = document.getElementById('sliceTrackingSection');
      const currentStepBox = document.getElementById('sliceCurrentStepBox');
      const currentStepText = document.getElementById('sliceCurrentStepText');
      const evidenceBox = document.getElementById('sliceEvidenceBox');
      const evidenceText = document.getElementById('sliceEvidenceText');

      let hasTracking = false;
      if (currentStepBox && currentStepText) {
        if (sliceInfo.currentStep) {
          currentStepText.innerText = sliceInfo.currentStep;
          currentStepBox.classList.remove('hidden');
          hasTracking = true;
        } else {
          currentStepBox.classList.add('hidden');
        }
      }

      if (evidenceBox && evidenceText) {
        if (sliceInfo.evidence) {
          evidenceText.innerText = sliceInfo.evidence;
          evidenceBox.classList.remove('hidden');
          hasTracking = true;
        } else {
          evidenceBox.classList.add('hidden');
        }
      }

      if (trackingSection) {
        if (hasTracking) trackingSection.classList.remove('hidden');
        else trackingSection.classList.add('hidden');
      }

      // 6. Build Plan Slices List
      const planListSection = document.getElementById('slicePlanListSection');
      const sliceCountText = document.getElementById('sliceCountText');
      const sliceContainer = document.getElementById('sliceListContainer');

      if (planListSection && sliceContainer) {
        if (Array.isArray(sliceInfo.slices) && sliceInfo.slices.length > 0) {
          planListSection.classList.remove('hidden');
          const completedSlices = sliceInfo.slices.filter(s => s.status && s.status.includes('已完成')).length;
          const percent = sliceInfo.slices.length > 0
            ? Math.round((completedSlices / sliceInfo.slices.length) * 100)
            : 0;
          if (sliceCountText) {
            sliceCountText.innerText = `${completedSlices}/${sliceInfo.slices.length} 已完成 (${percent}%)`;
          }
          const progressFill = document.getElementById('slicePlanProgressBarFill');
          if (progressFill) {
            progressFill.style.width = `${percent}%`;
          }

          sliceContainer.innerHTML = sliceInfo.slices.map((slice, idx) => {
            const isDone = slice.status && slice.status.includes('已完成');
            const isActive = slice.status && (slice.status.includes('進行中') || slice.status.includes('Active'));
            const isBlocked = slice.status && slice.status.includes('阻塞');

            const statusClass = isDone
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
              : isActive
              ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40 animate-pulse'
              : isBlocked
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
              : 'bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700';

            return `
              <div class="p-2 bg-white dark:bg-slate-900/90 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1 text-xs">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 truncate">
                    <span class="text-[10px] font-mono px-1.5 py-0.2 rounded border ${statusClass}">
                      ${escapeHtml(slice.status || '未開始')}
                    </span>
                    <span class="font-bold text-slate-800 dark:text-slate-200 truncate">${escapeHtml(slice.title || `切片 ${idx + 1}`)}</span>
                  </div>
                  ${slice.route && slice.route !== 'none' ? `
                    <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                      ${escapeHtml(slice.route)}
                    </span>
                  ` : ''}
                </div>
                ${slice.goal || slice.description ? `
                  <p class="text-[11px] text-slate-600 dark:text-slate-400 leading-tight">
                    ${escapeHtml(slice.goal || slice.description)}
                  </p>
                ` : ''}
                ${slice.boundary ? `
                  <div class="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 px-1.5 py-0.5 rounded border border-slate-200/60 dark:border-slate-800">
                    <strong>邊界:</strong> ${escapeHtml(slice.boundary)}
                  </div>
                ` : ''}
                ${slice.verification ? `
                  <div class="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    <strong>驗證:</strong> ${escapeHtml(slice.verification)}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('');
        } else {
          planListSection.classList.add('hidden');
        }
      }

      if (window.lucide) lucide.createIcons();
    }

    function copyResumePromptFromModal(event) {
      if (event) event.stopPropagation();
      const btn = document.getElementById('btnCopyResumePrompt');
      const resume = btn ? btn.dataset.resume : '';
      if (!resume) return;

      const projectPath = currentModalEditingTask?.projectPath || '';
      const prompt = `請檢閱當前專案工作切片狀態並繼續執行：\n專案路徑: ${projectPath}\n恢復指令: ${resume}\n請遵循 AGENTS.md 進行漸進式實作。`;
      copyToClipboard(prompt, '已複製 Agent 恢復接續指令！');
    }


    function updateModalButtonState() {
      const status = document.getElementById('formStatus')?.value || 'todo';
      const taskId = document.getElementById('formTaskId')?.value || '';
      const btnApprove = document.getElementById('btnApproveTask');
      const btnReject = document.getElementById('btnRejectTask');
      const btnSubmit = document.getElementById('btnSubmitTask');
      const reviewFeedbackBox = document.getElementById('reviewFeedbackBox');
      const rightCol = document.getElementById('modalRightColumn');
      const dialogEl = document.getElementById('modalDialogContainer');
      const formGrid = document.getElementById('modalFormGrid');
      const leftCol = document.getElementById('modalLeftColumn');

      // 待處理、進行中、待人工協助或新增任務時：隱藏審查回饋、異動檔案與 Git Diff，左側欄位 100% 滿版展開
      const isSimpleMode = (status === 'todo' || status === 'in_progress' || status === 'needs_human' || !taskId);

      if (isSimpleMode) {
        if (reviewFeedbackBox) reviewFeedbackBox.classList.add('hidden');
        if (formGrid) {
          formGrid.className = 'grid grid-cols-1 gap-5 flex-1 min-h-0 p-5 overflow-hidden';
        }
        if (leftCol) {
          leftCol.className = 'flex-1 overflow-y-auto pl-1 pr-2 overflow-x-hidden min-w-0 space-y-4 custom-scrollbar w-full';
        }
        applyModalWorkspaceColumns({ allowDiff: false, isDiff: false });
        if (dialogEl) {
          dialogEl.className = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100 transition-all';
        }
      } else {
        const allowDiff = Boolean(taskId && isDiffVisibleStatus(status));
        const btnDiff = document.getElementById('btnModalTabDiff');
        const reviewPane = document.getElementById('modalReviewPane');
        const isDiffTabActive = allowDiff && (
          btnDiff?.getAttribute?.('aria-selected') === 'true' ||
          (!rightCol?.classList?.contains('hidden') && Boolean(reviewPane?.classList?.contains('hidden')))
        );
        const hasExistingFb = Boolean((document.getElementById('formFeedback')?.value || '').trim());
        const isArchivedReadonly = Boolean(isOpenedFromArchive || status === 'archived');
        if (reviewFeedbackBox) {
          // 待審核狀態預設收起意見欄（點擊「請 AI 再修改」時才展開），避免閱讀報告前先看到大片空白輸入框；已封存任務亦隱藏
          if (status === 'review' && !hasExistingFb) {
            reviewFeedbackBox.classList.add('hidden');
          } else if (isArchivedReadonly && !hasExistingFb) {
            reviewFeedbackBox.classList.add('hidden');
          } else if (status !== 'review' && !isArchivedReadonly && hasExistingFb) {
            reviewFeedbackBox.classList.remove('hidden');
          } else if (status !== 'in_progress') {
            reviewFeedbackBox.classList.add('hidden');
          }
          const fbLabel = document.getElementById('reviewFeedbackLabelText');
          if (fbLabel) fbLabel.innerText = '需要 AI 修改的地方';
          const fbNotice = document.getElementById('reviewFeedbackNotice');
          if (fbNotice) fbNotice.innerText = '送出後自動喚醒 AI 修改';
          const fbInput = document.getElementById('formFeedback');
          if (fbInput) fbInput.placeholder = '請輸入希望 AI 調整的細節，輸入完點擊下方「請 AI 再修改」即可送出...';
        }
        if (formGrid) {
          formGrid.className = 'grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 p-4 sm:p-5 overflow-hidden';
        }
        if (leftCol) {
          leftCol.className = `flex-1 overflow-y-auto pl-1 pr-2 overflow-x-hidden min-w-0 space-y-3.5 custom-scrollbar ${allowDiff ? (isDiffTabActive ? 'hidden' : 'lg:col-span-12') : 'w-full'}`;
        }
        applyModalWorkspaceColumns({ allowDiff, isDiff: isDiffTabActive });
        if (dialogEl) {
          dialogEl.className = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100 transition-all';
        }
      }

      const btnArchiveModal = document.getElementById('btnArchiveTaskModal');
      const btnCommitModal = document.getElementById('btnCommitTaskModal');
      if (btnCommitModal) btnCommitModal.classList.add('hidden');
      const btnMergeWorktree = document.getElementById('btnMergeWorktreeModal');
      if (btnMergeWorktree) btnMergeWorktree.classList.add('hidden');
      const btnLandTask = document.getElementById('btnLandTask');
      if (btnLandTask) btnLandTask.classList.add('hidden');

      const isReviewLandState = Boolean(taskId && (status === 'review' || status === 'pending_review'));
      if (typeof initReviewLandPanel === 'function') {
        const activeTask = (currentModalEditingTask && currentModalEditingTask.id === taskId)
          ? currentModalEditingTask
          : (tasks.find(t => t.id === taskId) || null);
        initReviewLandPanel(isReviewLandState ? { ...(activeTask || {}), id: taskId, status } : null);
      }

      const isDoneDeliverState = Boolean(taskId && status === 'done' && !isOpenedFromArchive);
      if (typeof initDoneDeliveryPanel === 'function') {
        const activeDoneTask = (currentModalEditingTask && currentModalEditingTask.id === taskId)
          ? currentModalEditingTask
          : (tasks.find(t => t.id === taskId) || null);
        initDoneDeliveryPanel(isDoneDeliverState ? { ...(activeDoneTask || {}), id: taskId, status } : null);
      }

      const btnConfirmAndExecute = document.getElementById('btnConfirmAndExecute');
      const modalConfirmBadge = document.getElementById('modalConfirmationBadge');
      const reqConfirmWrapper = document.getElementById('formRequiresConfirmationWrapper');
      const isReqConfirmChecked = !!document.getElementById('formRequiresConfirmation')?.checked;
      const currentExecPlan = (document.getElementById('formExecutionPlan')?.value || '').trim();
      const hasExecutionPlan = currentExecPlan.length > 0;
      const isPendingConfirmation = isReqConfirmChecked && status === 'in_progress' && !!taskId && hasExecutionPlan;

      // 規範：新增任務 (!taskId) 或「待處理」狀態 (status === 'todo') 的任務，顯示「需確認後再執行」的 checkbox；其餘非待處理既有任務隱藏
      if (reqConfirmWrapper) {
        if (!taskId || status === 'todo') {
          reqConfirmWrapper.classList.remove('hidden');
          reqConfirmWrapper.classList.add('flex');
        } else {
          reqConfirmWrapper.classList.add('hidden');
          reqConfirmWrapper.classList.remove('flex');
        }
      }

      // 嚴格規範：待處理 (todo) 或非進行中任務不需顯示執行計劃欄位；進行中且勾選需確認時顯示（若無計劃則提示規劃中，有了才進入待確認）
      const planBox = document.getElementById('formExecutionPlanBox');
      const planBadge = document.getElementById('formExecutionPlanBadge');
      const planNotice = document.getElementById('formExecutionPlanNotice');
      const grillMeBanner = document.getElementById('grillMeBanner');
      const currentProjectVal = document.getElementById('formProject')?.value || 'task-dashboard';
      const proj = (Array.isArray(projects) ? projects : []).find(p => p.id === currentProjectVal);
      const projSkills = (proj && Array.isArray(proj.skills)) ? proj.skills : [];
      const hasGrillMeSkill = projSkills.some(s => (s.id === 'grill-me' || s.label === 'grill-me'));

      if (grillMeBanner) {
        if (hasGrillMeSkill && isReqConfirmChecked && status === 'in_progress' && !!taskId) {
          grillMeBanner.classList.remove('hidden');
        } else {
          grillMeBanner.classList.add('hidden');
        }
      }

      if (planBox) {
        if (isReqConfirmChecked && status === 'in_progress' && !!taskId) {
          planBox.classList.remove('hidden');
          if (typeof renderExecutionPlan === 'function') renderExecutionPlan(currentExecPlan, currentModalEditingTask);
          if (hasExecutionPlan) {
            // 開放待確認狀態的審閱意見輸入欄位
            if (reviewFeedbackBox) {
              reviewFeedbackBox.classList.remove('hidden');
              const fbLabel = document.getElementById('reviewFeedbackLabelText');
              if (fbLabel) fbLabel.innerText = '執行計劃審閱意見 (Plan Feedback)';
              const fbNotice = document.getElementById('reviewFeedbackNotice');
              if (fbNotice) fbNotice.innerText = '確認並執行時自動附帶';
              const fbInput = document.getElementById('formFeedback');
              if (fbInput) {
                fbInput.placeholder = '如對執行計劃有調整意見、補充邊界或修改指示，請在此輸入...（點選「確認並執行」將一併傳送）';
                fbInput.readOnly = false;
                fbInput.classList.remove('bg-slate-100/90', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'text-slate-600', 'dark:text-slate-300');
              }
            }
            if (planBadge) {
              if (hasGrillMeSkill) {
                planBadge.innerText = '🔥 Grill-Me 待確認';
                planBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-300 border border-orange-300/60 dark:border-orange-700/60';
              } else {
                planBadge.innerText = '待確認';
                planBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60';
              }
            }
            if (planNotice) {
              if (hasGrillMeSkill) {
                planNotice.innerText = '此專案具備 Grill-Me 邊界確認機制，請檢視下列執行計劃或套用決策標籤，點選「確認並執行」。';
              } else {
                planNotice.innerText = '此任務設定為「需確認後再執行」，請檢視下列執行計劃並點選「確認並執行」。';
              }
            }
          } else {
            if (planBadge) {
              planBadge.innerText = hasGrillMeSkill ? '🔥 Grill-Me 邊界規劃中' : '規劃中 (尚未產出計劃)';
              planBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-300/60 dark:border-blue-700/60';
            }
            if (planNotice) {
              planNotice.innerText = hasGrillMeSkill ? '此專案具備 Grill-Me 機制，AI / 負責人尚未產出邊界質詢與執行計劃。' : '此任務設定為「需確認後再執行」，AI / 負責人尚未產出執行計劃。待執行計劃填寫完成後方可進行確認。';
            }
          }
        } else {
          planBox.classList.add('hidden');
        }
      }

      if (modalConfirmBadge) {
        if (isPendingConfirmation) {
          modalConfirmBadge.classList.remove('hidden');
          modalConfirmBadge.classList.add('flex');
        } else {
          modalConfirmBadge.classList.add('hidden');
          modalConfirmBadge.classList.remove('flex');
        }
      }

      const planLabelIcon = document.getElementById('formExecutionPlanLabelIcon');
      const planLabelText = document.getElementById('formExecutionPlanLabelText');
      if (planLabelText) {
        planLabelText.innerText = hasGrillMeSkill ? 'Grill-Me 邊界確認與執行計劃' : '完整執行計劃 (Execution Plan)';
      }
      if (planLabelIcon) {
        planLabelIcon.setAttribute('data-lucide', hasGrillMeSkill ? 'flame' : 'clipboard-check');
        planLabelIcon.setAttribute('class', hasGrillMeSkill ? 'w-3.5 h-3.5 text-orange-500' : 'w-3.5 h-3.5 text-amber-500');
      }

      if (btnConfirmAndExecute) {
        if (isPendingConfirmation) {
          btnConfirmAndExecute.classList.remove('hidden');
          const btnIcon = document.getElementById('btnConfirmAndExecuteIcon');
          const btnText = document.getElementById('btnConfirmAndExecuteText');
          if (hasGrillMeSkill) {
            if (btnIcon) btnIcon.setAttribute('data-lucide', 'flame');
            if (btnText) btnText.innerText = '確認邊界並執行';
            btnConfirmAndExecute.className = 'bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-md shadow-orange-500/25 transition flex items-center gap-1.5';
            btnConfirmAndExecute.title = '確認 Grill-Me 邊界決策與執行計劃，授權開始執行';
          } else {
            if (btnIcon) btnIcon.setAttribute('data-lucide', 'play-circle');
            if (btnText) btnText.innerText = '確認並執行';
            btnConfirmAndExecute.className = 'bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-md shadow-amber-500/25 transition flex items-center gap-1.5';
            btnConfirmAndExecute.title = '確認執行計劃並立即啟動任務執行';
          }
          if (window.lucide) lucide.createIcons();
        } else {
          btnConfirmAndExecute.classList.add('hidden');
        }
      }

      const isArchivedView = Boolean(isOpenedFromArchive || status === 'archived');
      if (isArchivedView) {
        btnApprove?.classList.add('hidden');
        btnReject?.classList.add('hidden');
        btnArchiveModal?.classList.add('hidden');
        btnSubmit?.classList.add('hidden');
        document.getElementById('btnAbandonTask')?.classList.add('hidden');
      } else if (status === 'review') {
        btnSubmit?.classList.remove('hidden');
        btnApprove?.classList.add('hidden');
        btnReject?.classList.remove('hidden');
        btnArchiveModal?.classList.add('hidden');
        if (btnSubmit) {
          btnSubmit.innerHTML = '儲存規格變更';
          btnSubmit.className = 'bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow-md shadow-indigo-500/25 transition';
        }
      } else if (status === 'done') {
        btnSubmit?.classList.remove('hidden');
        btnApprove?.classList.add('hidden');
        btnReject?.classList.add('hidden');
        btnArchiveModal?.classList.remove('hidden');
        if (btnSubmit) {
          btnSubmit.innerHTML = '儲存變更';
          btnSubmit.className = 'bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow-md shadow-indigo-500/25 transition';
        }
      } else {
        btnSubmit?.classList.remove('hidden');
        btnApprove?.classList.add('hidden');
        btnReject?.classList.add('hidden');
        btnArchiveModal?.classList.add('hidden');
        if (btnSubmit) {
          btnSubmit.innerHTML = '儲存變更';
          btnSubmit.className = 'bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow-md shadow-indigo-500/25 transition';
        }
      }

      // 進行中任務欄位鎖定唯讀與隱藏日誌
      if (status === 'in_progress' && taskId) {
        setModalFieldsReadOnly(true);
      } else if (status !== 'in_progress') {
        setModalFieldsReadOnly(false);
      }

      // 規範：在“進行中”之後的任務 (非 todo / 新增)，textarea 高度根據內容動態調整，避免內容較少時佔據大片無效空白
      if (taskId && status !== 'todo') {
        const descEl = document.getElementById('formDescription');
        const planEl = document.getElementById('formExecutionPlan');
        const fbEl = document.getElementById('formFeedback');
        setTimeout(() => {
          autoResizeTextarea(descEl, 72, 380);
          autoResizeTextarea(planEl, 60, 300);
          autoResizeTextarea(fbEl, 48, 200);
        }, 10);
      }

      if (window.lucide) lucide.createIcons();
    }

    function openCommitModalFromTaskModal(event) {
      if (event) event.stopPropagation();
      const taskId = document.getElementById('formTaskId').value;
      if (taskId) {
        openCommitModal(taskId, event);
      }
    }

    async function mergeWorktreeFromTaskModal(event, confirmOneWayMerge = false) {
      if (event) event.stopPropagation();
      const taskId = document.getElementById('formTaskId').value;
      if (!taskId) return;
      const btn = document.getElementById('btnMergeWorktreeModal');
      await withButtonLoading(btn, '合併中...', async () => {
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmOneWayMerge })
          });
          const data = await res.json().catch(() => ({}));
          if (data && data.requiresConfirmation && !confirmOneWayMerge) {
            const ok = window.confirm(data.error || 'One-Way 高風險任務確認本地 Squash 合併？');
            if (ok) {
              await mergeWorktreeFromTaskModal(null, true);
            }
            return;
          }
          if (!res.ok) {
            throw new Error(data.error || `合併失敗 (${res.status})`);
          }
          if (data.action === 'pr_pushed') {
            showToast(`已推分支 ${data.branchName} 並準備 PR${data.prUrl ? `: ${data.prUrl}` : ''}`);
          } else {
            showToast(`任務 ${taskId} 已安全合併至 ${data.baseBranch || '來源分支'} 並封存！`);
          }
          closeModal();
          await loadData();
        } catch (err) {
          showToast(`Worktree 合併失敗: ${err.message}`);
          await loadData();
        }
      });
    }

    async function saveTask(e) {
      e.preventDefault();
      const btnSubmit = document.getElementById('btnSubmitTask');
      const btnDelete = document.getElementById('btnDeleteTask');
      const btnAbandon = document.getElementById('btnAbandonTask');
      const btnApprove = document.getElementById('btnApproveTask');
      const btnReject = document.getElementById('btnRejectTask');
      const btnArchive = document.getElementById('btnArchiveTaskModal');

      const otherButtons = [btnDelete, btnAbandon, btnApprove, btnReject, btnArchive].filter(Boolean);
      otherButtons.forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'pointer-events-none'); });

      await withButtonLoading(btnSubmit, '儲存中...', async () => {
        const id = document.getElementById('formTaskId').value;
        const title = document.getElementById('formTitle').value.trim();
        const project = document.getElementById('formProject').value.trim();
        const priority = document.getElementById('formPriority').value;
        const status = document.getElementById('formStatus').value;
        const assignee = document.getElementById('formAssignee').value.trim() || 'Antigravity';
        const tags = document.getElementById('formTags').value.split(',').map(s => s.trim()).filter(Boolean);
        const description = document.getElementById('formDescription').value.trim();
        const feedback = document.getElementById('formFeedback').value.trim();
        const conversationId = (document.getElementById('formConversationId')?.value || '').trim();
        const requiresConfirmation = !!document.getElementById('formRequiresConfirmation')?.checked;
        const executionPlan = (document.getElementById('formExecutionPlan')?.value || '').trim();
        const targetBranch = (document.getElementById('formTargetBranch')?.value || '').trim();
        const workspaceMode = (document.getElementById('formWorkspaceMode')?.value || 'worktree').trim() || 'worktree';

        const taskData = {
          title,
          project,
          priority,
          status,
          assignee,
          assignedAgent: assignee,
          tags,
          dependencies: currentTaskDependencies,
          description,
          feedback,
          conversationId,
          requiresConfirmation,
          executionPlan,
          targetBranch,
          baseBranch: targetBranch,
          workspaceMode,
          ...(currentModalEditingTask && (currentModalEditingTask.status === 'needs_human' || currentModalEditingTask.needsHuman) && status !== 'needs_human' ? { resetCircuitBreaker: true } : {})
        };

        try {
          if (id) {
            await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(taskData)
            });
            showToast(`任務 ${id} 已成功更新！`);
          } else {
            const res = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(taskData)
            });
            const created = await res.json();
            showToast(`成功建立新任務 ${created.id}！`);
          }
          closeModal();
          await loadData();
        } catch (err) {
          console.error('Failed to save task:', err);
          showToast(`儲存失敗: ${err.message}`);
        }
      });

      otherButtons.forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'pointer-events-none'); });
    }

    function toggleFormRequiresConfirmation(checked) {
      updateModalButtonState();
    }

    async function confirmAndExecuteTask(event) {
      const id = document.getElementById('formTaskId').value;
      if (!id) return;
      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const btnConfirm = document.getElementById('btnConfirmAndExecute');
      if (btnConfirm?.disabled) return;
      const btnSubmit = document.getElementById('btnSubmitTask');
      [btnSubmit].filter(Boolean).forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'pointer-events-none'); });

      await withButtonLoading(btnConfirm, '啟動中...', async () => {
        try {
          const nowIso = new Date().toISOString();
          const formFeedback = (document.getElementById('formFeedback')?.value || '').trim();
          const feedbackMsg = formFeedback ? `\n💬 [審閱意見] ${formFeedback}\n` : '';
          const confirmLog = '\n[' + nowIso + '] ✅ [Confirmation Gate] 使用者已審閱並確認執行計劃，正式授權進入實作階段！' + feedbackMsg + '----------------------------------------\n';
          const toText = (typeof normalizeLogText === 'function') ? normalizeLogText : (v => typeof v === 'string' ? v : (v ? JSON.stringify(v) : ''));
          const newExecutionLog = (toText(task.executionLog) || '') + confirmLog;
          const formExecPlan = (document.getElementById('formExecutionPlan')?.value || '').trim();
          const currentPlan = formExecPlan || toText(task.executionPlan) || '';

          // 讀取可能由使用者直接在欄位修改的最新描述
          const formDesc = document.getElementById('formDescription')?.value;
          let newDescription = (formDesc !== undefined ? formDesc : (task.description || '')).trim();

          // 若有填寫審閱意見，格式化追加至描述並附帶「最高優先級覆蓋宣告」
          if (formFeedback) {
            const timeStr = nowIso.replace('T', ' ').slice(0, 19);
            const formattedLines = formFeedback.split('\n')
              .map(l => l.trim())
              .filter(Boolean)
              .map(l => l.startsWith('- ') ? l : `- ${l}`)
              .join('\n');
            const sectionHeader = '--- 【執行計劃確認意見 / 最新需求覆蓋】 ---';
            const directive = '> ⚠️ 【最高優先級覆蓋規範】：本區塊為使用者審閱執行計劃後的最新授權指示。若與上方舊有需求存在矛盾、衝突或規格調整，一律以本區塊最新指示為準並覆蓋舊有描述！';

            if (!newDescription.includes(sectionHeader)) {
              newDescription = `${newDescription}\n\n${sectionHeader}\n[${timeStr}]\n${directive}\n${formattedLines}`.trim();
            } else {
              newDescription = `${newDescription}\n\n[${timeStr}]\n${directive}\n${formattedLines}`.trim();
            }
          }

          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...task,
              claimedBy: null,
              claimedAt: null,
              requiresConfirmation: false,
              confirmExecution: true,
              executionPlan: currentPlan,
              executionLog: newExecutionLog,
              description: newDescription,
              feedback: '',
              status: 'in_progress',
              updatedAt: nowIso
            })
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }
          const updatedTask = await res.json();
          if (!updatedTask || updatedTask.id !== id || updatedTask.status !== 'in_progress' || updatedTask.requiresConfirmation !== false) {
            throw new Error('伺服器未回傳已確認的任務狀態，請重新載入後檢查。');
          }
          const idx = tasks.findIndex(t => t.id === id);
          if (idx !== -1) tasks[idx] = updatedTask;

          closeModal();
          renderKanban();
          renderMetrics();
          showToast(`已確認任務 ${id} 執行計劃，開始執行！`);
          await loadData();
        } catch (err) {
          console.error('Failed to confirm and execute task:', err);
          showToast(`確認執行失敗: ${err.message}`);
        }
      });

      [btnSubmit].filter(Boolean).forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'pointer-events-none'); });
    }

    async function approveTaskAsDone(event) {
      const id = document.getElementById('formTaskId').value;
      if (!id) return;
      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const btnApprove = document.getElementById('btnApproveTask');
      const btnReject = document.getElementById('btnRejectTask');
      const btnSubmit = document.getElementById('btnSubmitTask');
      [btnReject, btnSubmit].filter(Boolean).forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'pointer-events-none'); });

      await withButtonLoading(btnApprove, '驗收中...', async () => {
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...task,
              status: 'done',
              updatedAt: new Date().toISOString()
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }

          showToast(`任務 ${id} 驗收通過！已成功結案移入「已完成」。`);
          closeModal();
          await loadData();
        } catch (err) {
          console.error('Failed to approve task:', err);
          showToast(`驗收失敗: ${err.message}`);
        }
      });

      [btnReject, btnSubmit].filter(Boolean).forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'pointer-events-none'); });
    }

    async function rejectTaskWithFeedback(event) {
      const id = document.getElementById('formTaskId').value;
      if (!id) return;
      const feedback = document.getElementById('formFeedback').value.trim();

      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const btnReject = document.getElementById('btnRejectTask');
      const btnApprove = document.getElementById('btnApproveTask');
      const btnSubmit = document.getElementById('btnSubmitTask');
      [btnApprove, btnSubmit].filter(Boolean).forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'pointer-events-none'); });

      await withButtonLoading(btnReject, '退回中...', async () => {
        const configDir = (settings.dataDirectoryPath || settings.defaultDataDir || 'data').replace(/\/+$/, '');
        const tasksFilePath = `${configDir}/tasks.json`;
        const notifyPrompt = `【任務退回重做】[${task.id}] ${task.title}
• 審查意見: ${feedback || '請根據最新需求調整與修復'}
• 結案規範: 修復並驗證後寫回 ${tasksFilePath}（status: review，填寫 modifiedFiles, diff, executionLog，feedback 歸入 description 並清空）。
• 執行紀錄: 必須包含實際檢閱檔案、診斷證據、修改原因，以及驗證命令、工作目錄、退出碼與完整可用 stdout/stderr；區分摘要與執行細節，不得只回報「工作完成／測試通過」或宣稱未執行的檢查已通過，敏感憑證不得寫入日誌。`;

        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(notifyPrompt);
          }
        } catch (_) {}

        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...task,
              status: 'in_progress',
              feedback: feedback,
              modifiedFiles: [],
              diff: '',
              diffPath: '',
              updatedAt: new Date().toISOString()
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }
          const updatedTask = await res.json().catch(() => null);
          if (updatedTask) {
            const idx = tasks.findIndex(t => t.id === id);
            if (idx !== -1) tasks[idx] = updatedTask;
          }

          showToast(`已將 ${id} 退回「進行中」，並將完整修復指令複製到剪貼簿！`);
          closeModal();
          await loadData();
        } catch (err) {
          console.error('Failed to reject task:', err);
          showToast(`退回失敗: ${err.message}`);
        }
      });

      [btnApprove, btnSubmit].filter(Boolean).forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'pointer-events-none'); });
    }

    async function submitTaskForReview(id, event) {
      if (event) event.stopPropagation();
      const targetBtn = event ? event.currentTarget : null;
      await withButtonLoading(targetBtn, '送審中...', async () => {
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/submit-review`, {
            method: 'POST'
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }
          showToast(`任務 ${id} 已推進至待審查，並已同步 Git 異動！`);
          await loadData();
        } catch (err) {
          console.error('Failed to submit task for review:', err);
          showToast(`送審失敗: ${err.message}`);
        }
      });
    }

    async function quickApproveDone(id, event) {
      if (event) event.stopPropagation();
      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const targetBtn = event ? event.currentTarget : null;
      await withButtonLoading(targetBtn, '結案中...', async () => {
        try {
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...task,
              status: 'done',
              updatedAt: new Date().toISOString()
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }

          showToast(`任務 ${id} 驗收通過！已成功結案。`);
          await loadData();
        } catch (err) {
          showToast(`驗收失敗: ${err.message}`);
        }
      });
    }


    function openCommitModal(id, event) {
      if (event) event.stopPropagation();
      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const proj = projects.find(p => p.id === task.project);
      const projName = proj ? proj.name : (task.project || '預設專案');
      const projSkills = (proj && Array.isArray(proj.skills)) ? proj.skills : (task.projectSkills || []);
      const commitSkill = projSkills.find(s => 
        (s.id && (s.id.includes('commit') || s.id.includes('git-workflow') || s.id.includes('versioning'))) ||
        (s.label && (s.label.includes('commit') || s.label.includes('git-workflow'))) ||
        (s.desc && /commit|conventional/i.test(s.desc))
      );

      document.getElementById('commitTaskId').value = task.id;
      document.getElementById('commitModalSubtitle').innerText = `${task.id} · ${projName}`;

      // 優先使用 Agent 依據 Diff 產出之 commitMessage
      let subject = '';
      let bodyText = '';
      const isLegacyDesc = task.commitMessage && task.description && task.commitMessage.body && task.commitMessage.body.trim() === task.description.trim();
      const hasBoilerplateBody = task.commitMessage && task.commitMessage.body && (
        task.commitMessage.body.includes('後端服務邏輯調校與開工引擎強化') ||
        task.commitMessage.body.includes('前端面板視圖與彈窗互動優化') ||
        task.commitMessage.body.includes('補齊自動化測試與規範檢核腳本') ||
        task.commitMessage.body.includes('程式碼與架構規範檢驗通過') ||
        task.commitMessage.body.includes('模組功能實作與異動更新')
      );

      if (task.commitMessage && task.commitMessage.subject && !isLegacyDesc && !hasBoilerplateBody) {
        subject = task.commitMessage.subject;
        bodyText = task.commitMessage.body || '';
      } else {
        // 1. 決定 Type
        let type = '';
        if (Array.isArray(task.tags)) {
          const found = task.tags.find(t => ['feat', 'fix', 'refactor', 'style', 'perf', 'test', 'docs', 'chore', 'revert'].includes(t.toLowerCase().trim()));
          if (found) type = found.toLowerCase().trim();
        }
        if (!type) {
          const rawTitle = task.title || '';
          if (/修復|修正|fix|error|bug|錯/i.test(rawTitle)) type = 'fix';
          else if (/優化|改善|提升|perf|optimize/i.test(rawTitle)) type = 'perf';
          else if (/重構|refactor/i.test(rawTitle)) type = 'refactor';
          else if (/樣式|style|版面|排版|css|scss/i.test(rawTitle)) type = 'style';
          else if (/文件|doc|readme/i.test(rawTitle)) type = 'docs';
          else if (/測試|test/i.test(rawTitle)) type = 'test';
          else type = 'feat';
        }

        let cleanTitle = (task.title || 'Update task').replace(/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i, '').trim();

        // 2. 決定 Scope (依專案 Skill 建議 scope)
        let scope = '';
        const descLower = ((task.description || '') + ' ' + (task.title || '') + ' ' + (task.modifiedFiles || []).map(f => typeof f === 'string' ? f : (f && f.path) ? f.path : '').join(' ')).toLowerCase();
        if (descLower.includes('src/native') || descLower.includes('.m') || descLower.includes('webkit')) scope = 'native';
        else if (descLower.includes('server.js') || descLower.includes('src/server') || descLower.includes('後端') || descLower.includes('api')) scope = 'server';
        else if (descLower.includes('index.html') || descLower.includes('src/public') || descLower.includes('樣式') || descLower.includes('畫面') || descLower.includes('按鈕') || descLower.includes('彈窗') || descLower.includes('ui')) scope = 'ui';
        else if (descLower.includes('harness') || descLower.includes('test_server.sh') || descLower.includes('scripts/test')) scope = 'harness';
        else if (descLower.includes('.github/skills') || descLower.includes('skill.md')) scope = 'skills';
        else if (descLower.includes('order-management') || descLower.includes('訂單') || descLower.includes('order')) scope = 'order';
        else if (descLower.includes('router') || descLower.includes('路由')) scope = 'router';
        else if (descLower.includes('store') || descLower.includes('狀態')) scope = 'store';
        else if (descLower.includes('build') || descLower.includes('打包') || descLower.includes('腳本')) scope = 'build';

        subject = scope ? `${type}(${scope}): ${cleanTitle}` : `${type}: ${cleanTitle}`;
        bodyText = ''; // 絕不可帶入 task.description，應留空或由 diff 智慧分析填入
      }

      document.getElementById('commitSubjectInput').value = subject;
      document.getElementById('commitBodyInput').value = bodyText;

      const errorBox = document.getElementById('commitErrorBox');
      const errorText = document.getElementById('commitErrorText');
      if (errorBox) errorBox.classList.add('hidden');
      if (errorText) errorText.textContent = '';

      // 若尚未有 Agent 生成的 commitMessage、為舊版複製內容、或含有舊版罐頭字串，自動非同步向後端獲取依據 diff 分析的實質 commit 內容
      if (!task.commitMessage || !task.commitMessage.subject || isLegacyDesc || hasBoilerplateBody) {
        fetch(`/api/tasks/${encodeURIComponent(task.id)}/generate-commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: false })
        }).then(r => r.ok ? r.json() : null).then(data => {
          if (data) {
            if (document.getElementById('commitTaskId').value === task.id) {
              if (data.subject) document.getElementById('commitSubjectInput').value = data.subject;
              if (data.body) document.getElementById('commitBodyInput').value = data.body;
            }
            task.commitMessage = { subject: data.subject, body: data.body };
          }
        }).catch(() => {});
      }

      document.getElementById('commitModal').classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    async function regenerateCommitMessage() {
      const taskId = document.getElementById('commitTaskId').value;
      if (!taskId) return;
      const btn = document.getElementById('btnRegenCommit');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50');
      }
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/generate-commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true })
        });
        if (res.ok) {
          const data = await res.json();
          if (document.getElementById('commitTaskId').value === taskId) {
            if (data.subject) document.getElementById('commitSubjectInput').value = data.subject;
            if (data.body) document.getElementById('commitBodyInput').value = data.body;
          }
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            task.commitMessage = { subject: data.subject, body: data.body };
          }
        }
      } catch (e) {
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
        }
      }
    }

    function closeCommitModal() {
      const errorBox = document.getElementById('commitErrorBox');
      const errorText = document.getElementById('commitErrorText');
      if (errorBox) errorBox.classList.add('hidden');
      if (errorText) errorText.textContent = '';
      document.getElementById('commitModal').classList.add('hidden');
    }

    async function confirmCommitTask() {
      const taskId = document.getElementById('commitTaskId').value;
      const subject = document.getElementById('commitSubjectInput').value.trim();
      const body = document.getElementById('commitBodyInput').value.trim();

      if (!subject) {
        showToast('請輸入 Commit 標題');
        return;
      }

      const submitBtn = document.getElementById('commitSubmitBtn');
      const errorBox = document.getElementById('commitErrorBox');
      const errorText = document.getElementById('commitErrorText');
      if (errorBox) errorBox.classList.add('hidden');
      if (errorText) errorText.textContent = '';

      await withButtonLoading(submitBtn, '提交中...', async () => {
        try {
          showToast(`正在提交 Commit 並封存任務...`);
          const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customSubject: subject, customBody: body })
          });
          const result = await res.json();
          if (!res.ok || !result.success || result.isCommitted === false) {
            const errMsg = result.error || result.message || 'Commit 執行失敗';
            if (errorText) errorText.textContent = errMsg;
            if (errorBox) {
              errorBox.classList.remove('hidden');
              if (window.lucide) lucide.createIcons();
            }
            showToast('Commit 遭到 pre-commit 阻斷，請檢視失敗原因');
            return;
          }

          const arcIds = (result.archivedTaskIds && result.archivedTaskIds.length > 0)
            ? result.archivedTaskIds
            : [taskId];
          const arcMsg = arcIds.length > 0
            ? `，已將 ${arcIds.length} 個已完成任務移入封存庫 `
            : '';
          showToast(`[${taskId}] Commit 成功！${result.message || ''}${arcMsg}`);

          // 立即更新前端任務狀態 (將封存任務移出看板)，畫面即時同步無需等待手動 reload
          const arcSet = new Set(arcIds);
          setTasks(tasks.filter(t => !arcSet.has(t.id)));
          if (typeof setArchivedTasksCount === 'function') {
            setArchivedTasksCount((archivedTasksCount || 0) + arcIds.length);
          }
          const archiveBadge = document.getElementById('headerArchiveCountBadge');
          if (archiveBadge) archiveBadge.innerText = (archivedTasksCount || 0);

          closeCommitModal();
          closeModal();
          renderKanban();
          renderMetrics();
          await loadData(true);
        } catch (err) {
          if (errorText) errorText.textContent = err.message;
          if (errorBox) {
            errorBox.classList.remove('hidden');
            if (window.lucide) lucide.createIcons();
          }
          showToast(`Commit 失敗: ${err.message}`);
        }
      });
    }

    async function autoFixCommitErrorWithAgent() {
      const taskId = document.getElementById('commitTaskId').value;
      if (!taskId) return;
      const errorText = document.getElementById('commitErrorText');
      const errMsg = (errorText && errorText.textContent) ? errorText.textContent.trim() : 'Pre-commit 驗證失敗';

      const feedbackMsg = `Commit 遭到 Pre-Commit 阻斷，請排查並修復以下錯誤，重新驗證通過後交付：\n\n${errMsg}`;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'in_progress',
            feedback: feedbackMsg
          })
        });
        if (res.ok) {
          showToast(`已將 Pre-commit 錯誤注入 Feedback 並喚醒 Agent 自動修復！`);
          closeCommitModal();
          if (typeof loadData === 'function') {
            await loadData();
          }
        } else {
          showToast(`退回 Agent 失敗，請手動退回重做`);
        }
      } catch (e) {
        showToast(`網路請求失敗: ${e.message}`);
      }
    }

    function commitTaskFromCard(id, event) {
      openCommitModal(id, event);
    }

    async function archiveTaskFromCard(id, event) {
      if (event) event.stopPropagation();
      const task = tasks.find(t => t.id === id);
      if (!task) return;

      const targetBtn = event ? event.currentTarget : null;
      await withButtonLoading(targetBtn, '封存中...', async () => {
        task.status = 'archived';
        task.updatedAt = new Date().toISOString();

        try {
          await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
          });
          showToast(`任務 ${id} 已成功移入封存庫！`);
          await loadData();
        } catch (err) {
          showToast(`封存失敗: ${err.message}`);
        }
      });
    }

    async function archiveCurrentTaskFromModal(event) {
      const id = document.getElementById('formTaskId').value;
      if (!id) return;
      const btnArchive = document.getElementById('btnArchiveTaskModal');
      await withButtonLoading(btnArchive, '封存中...', async () => {
        await archiveTaskFromCard(id);
        closeModal();
      });
    }

    let currentPendingAction = null; // { taskId, actionType: 'delete' | 'abandon', task: ... }

    async function promptTaskDeleteOrAbandon(id, actionType = 'delete', event) {
      if (event) {
        event.stopPropagation();
      }
      if (!id) return;
      const task = tasks.find(t => t.id === id) || archivedTasks.find(t => t.id === id);
      if (!task) return;

      currentPendingAction = {
        taskId: id,
        actionType,
        task
      };

      const modalEl = document.getElementById('taskActionConfirmModal');
      const titleEl = document.getElementById('actionModalTitle');
      const subEl = document.getElementById('actionModalSubtitle');
      const iconWrap = document.getElementById('actionModalIconWrapper');
      const submitBtn = document.getElementById('btnActionConfirmSubmit');
      const submitText = document.getElementById('actionConfirmSubmitText');
      const reasonWrap = document.getElementById('actionModalReasonWrapper');
      const reasonInput = document.getElementById('actionModalReasonInput');
      const discardCb = document.getElementById('actionModalDiscardCheckbox');

      if (reasonInput) reasonInput.value = '';
      if (discardCb) discardCb.checked = true;

      document.getElementById('actionModalTaskId').innerText = task.id;
      document.getElementById('actionModalTaskTitle').innerText = task.title || '';
      document.getElementById('actionModalDescription').innerText = task.description || '(無詳細描述)';

      titleEl.innerText = '放棄任務確認';
      iconWrap.className = 'w-8 h-8 rounded-lg flex items-center justify-center bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400';
      iconWrap.innerHTML = '<i data-lucide="ban" class="w-4 h-4"></i>';
      submitBtn.className = 'px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md transition flex items-center gap-1.5';
      submitText.innerText = '確認放棄並刪除';
      if (reasonWrap) reasonWrap.classList.add('hidden');

      // 檢查 Git Diff
      const gitSection = document.getElementById('actionModalGitSection');
      const noGitSection = document.getElementById('actionModalNoGitSection');
      const diffBadge = document.getElementById('actionModalDiffBadge');
      const diffFileList = document.getElementById('actionModalDiffFileList');

      gitSection.classList.remove('hidden');
      noGitSection.classList.add('hidden');
      diffBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
      diffBadge.innerText = '檢查工作區中...';
      diffFileList.innerHTML = '<div class="text-slate-400 italic">正在掃描工作區 Git 異動...</div>';

      modalEl.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();

      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/git-status`);
        if (res.ok) {
          const gitData = await res.json();
          if (gitData.hasDiff && gitData.files && gitData.files.length > 0) {
            gitSection.classList.remove('hidden');
            noGitSection.classList.add('hidden');
            subEl.innerText = '此任務專案有未提交之工作區異動，請確認是否要同時捨棄變更 (git discard changes) 並自看板刪除此任務。';
            diffBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-700';
            diffBadge.innerText = `${gitData.files.length} 個未提交異動檔案`;
            diffFileList.innerHTML = gitData.files.map(f => `
              <div class="flex items-center gap-1.5 py-0.5 border-b border-amber-100/60 dark:border-amber-900/30 last:border-0 truncate">
                <i data-lucide="file-diff" class="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0"></i>
                <span class="truncate">${escapeHtml(f)}</span>
              </div>
            `).join('');
          } else {
            gitSection.classList.add('hidden');
            noGitSection.classList.remove('hidden');
            subEl.innerText = '專案工作區無未提交之代碼變更。確認後將自看板刪除此任務。';
          }
        } else {
          gitSection.classList.add('hidden');
          noGitSection.classList.remove('hidden');
          subEl.innerText = '專案工作區無未提交之代碼變更。確認後將自看板刪除此任務。';
        }
      } catch (err) {
        gitSection.classList.add('hidden');
        noGitSection.classList.remove('hidden');
        subEl.innerText = '專案工作區無未提交之代碼變更。確認後將自看板刪除此任務。';
      }

      if (window.lucide) lucide.createIcons();
    }

    function closeActionConfirmModal() {
      currentPendingAction = null;
      document.getElementById('taskActionConfirmModal').classList.add('hidden');
    }

    async function executeTaskActionConfirmed() {
      if (!currentPendingAction) return;
      const { taskId, actionType } = currentPendingAction;
      const submitBtn = document.getElementById('btnActionConfirmSubmit');
      const discardCb = document.getElementById('actionModalDiscardCheckbox');
      const shouldDiscard = !!(discardCb && discardCb.checked);
      const reasonInput = document.getElementById('actionModalReasonInput');
      const reason = reasonInput ? reasonInput.value.trim() : '';

      await withButtonLoading(submitBtn, '處理中...', async () => {
        try {
          // 支援 /abandon 與 DELETE 統一流程：若有 git diff 且確認捨棄則 discard 並刪除任務；無 diff 則直接刪除任務
          const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discardChanges: shouldDiscard })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `伺服器回應 ${res.status}`);
          }
          const resData = await res.json().catch(() => ({}));
          let msg = `已放棄並刪除任務 ${taskId}`;
          if (resData.discardOutput) msg += ` (${resData.discardOutput})`;
          showToast(msg);

          closeActionConfirmModal();
          closeModal();
          selectedArchiveTaskIds.delete(taskId);
          await loadData();
          if (!document.getElementById('archiveModal').classList.contains('hidden')) {
            await loadArchivedTasks();
            renderArchiveTasksList();
          }
        } catch (err) {
          console.error('Failed to execute task action:', err);
          showToast(`操作失敗: ${err.message}`);
        }
      });
    }

    async function deleteCurrentTask(event) {
      const id = document.getElementById('formTaskId').value;
      if (!id) return;
      promptTaskDeleteOrAbandon(id, 'delete', event);
    }

    function closeModal() {
      if (typeof setCurrentModalEditingTask === 'function') {
        setCurrentModalEditingTask(null);
      }
      try { currentModalEditingTask = null; } catch (_) {}
      document.getElementById('taskModal').classList.add('hidden');
      if (typeof renderContextualHeaderActions === 'function') renderContextualHeaderActions();

      const btnBackToArchive = document.getElementById('btnBackToArchive');
      if (btnBackToArchive) {
        btnBackToArchive.classList.add('hidden');
        btnBackToArchive.classList.remove('flex');
      }
      const modalArchivedBadge = document.getElementById('modalArchivedBadge');
      if (modalArchivedBadge) {
        modalArchivedBadge.classList.add('hidden');
        modalArchivedBadge.classList.remove('flex');
      }
      const btnCancelTaskModal = document.getElementById('btnCancelTaskModal');
      if (btnCancelTaskModal) {
        btnCancelTaskModal.innerText = '取消';
      }

      if (typeof setIsOpenedFromArchive === 'function') {
        setIsOpenedFromArchive(false);
      }

      const descEl = document.getElementById('formDescription');
      if (descEl) {
        descEl.rows = 8;
        resetTextareaHeight(descEl);
      }
      resetTextareaHeight(document.getElementById('formExecutionPlan'));
      resetTextareaHeight(document.getElementById('formFeedback'));
    }

    function extractRetroPrompt(event) {
      if (event) event.stopPropagation();
      const taskId = document.getElementById('formTaskId')?.value;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const proj = projects.find(p => p.id === task.project);
      const projName = proj ? proj.name : (task.project || '未指定專案');
      const projPath = (proj && proj.path) ? proj.path : (task.projectPath || `~/projects/${task.project}/`);

      const desc = task.description || '';
      let feedbackHistory = '（無歷次審查意見）';
      if (desc.includes('--- 【歷次審查意見 / Feedback 記錄】 ---')) {
        feedbackHistory = desc.split('--- 【歷次審查意見 / Feedback 記錄】 ---')[1].trim();
      }

      const files = (task.modifiedFiles && task.modifiedFiles.length > 0)
        ? task.modifiedFiles.map(f => typeof f === 'string' ? f : (f.path || f)).join(', ')
        : '（無明細）';
      const fixRounds = Number(task.fixRoundCount || 0);
      const todayStr = new Date().toISOString().slice(0, 10);

      const prompt = `【/retro 經驗沉澱與 LESSONS 熱區升格淘汰】
• 目標專案: ${projName} (${projPath})
• 任務 ID: [${task.id}] ${task.title} (退回輪次: ${fixRounds})
• 異動檔案: ${files}

【歷次審查退回原因 / 踩坑歷史】：
${feedbackHistory}

【提煉與升格淘汰規則】：
1. 優先提煉 1 行高頻避坑規則寫入 \`docs/LESSONS.md\`（格式：\`- [${todayStr}] 教訓與避坑規則\`，嚴格維持總行數 <= 30 行）。
2. 同類教訓升格淘汰：若同類教訓於 \`docs/LESSONS.md\` 或歷次退回已出現 >= 2 次，**強制升格**至 \`scripts/harness_check.sh\` 確定性檢查或 \`AGENTS.md\` 永久規則，並從 \`docs/LESSONS.md\` 移除該行（保持熱區精簡）。
3. 深度長篇復盤如有需要僅追加至 \`docs/RETROSPECTIVE.md\`，不刪除既有歷史紀錄。
請提出具體修改並執行驗證 (npm run harness:check)。`;

      copyToClipboard(prompt, '已複製 /retro 規範提煉提示詞！');
    }

export {
  setFormProject,
  updateConfirmationGateForProject,
  clearFormProject,
  updateProjectClearButtonVisibility,
  showProjectAutocomplete,
  hideProjectAutocomplete,
  toggleProjectAutocomplete,
  onProjectAutocompleteInput,
  renderProjectAutocompleteList,
  updateDependencyOptions,
  addDependencyFromSelect,
  removeDependency,
  renderDependencyChips,
  initSelect2Dropdown,
  toggleSelect2Dropdown,
  onSelect2Search,
  onSelect2KeyDown,
  select2ToggleOption,
  select2AddTag,
  select2RemoveTag,
  syncSelect2ToHiddenInput,
  setSelect2Tags,
  renderSelect2Chips,
  insertFeedbackPreset,
  insertGrillMeDecision,
  onFormProjectChangeLoadBranches,
  selectWorkspaceMode,
  toggleQuickBranchBox,
  quickCreateBranchInline,
  updateInPlaceDirtyWarning,
  switchModalWorkspaceTab,
  openModal,
  setModalFieldsReadOnly,
  updateModalLiveInProgressView,
  shouldShowReviewWorkspace,
  openModalForEdit,
  pollActiveTaskSliceInfo,
  renderModalSliceInfo,
  copyResumePromptFromModal,
  updateModalButtonState,
  openCommitModalFromTaskModal,
  saveTask,
  toggleFormRequiresConfirmation,
  confirmAndExecuteTask,
  approveTaskAsDone,
  rejectTaskWithFeedback,
  submitTaskForReview,
  quickApproveDone,
  openCommitModal,
  closeCommitModal,
  regenerateCommitMessage,
  confirmCommitTask,
  commitTaskFromCard,
  archiveTaskFromCard,
  archiveCurrentTaskFromModal,
  loadArchivedTasks,
  openArchiveModal,
  closeArchiveModal,
  renderArchiveTasksList,
  toggleArchiveTaskSelect,
  toggleArchiveSelectAll,
  batchDeleteSelectedArchived,
  deleteAllArchivedTasks,
  batchRestoreSelectedArchived,
  restoreSingleArchivedTask,
  deleteSingleArchivedTask,
  promptTaskDeleteOrAbandon,
  closeActionConfirmModal,
  executeTaskActionConfirmed,
  deleteCurrentTask,
  extractRetroPrompt,
  mergeWorktreeFromTaskModal,
  closeModal
};

if (typeof window !== "undefined") {
  window.setFormProject = setFormProject;
  window.updateConfirmationGateForProject = updateConfirmationGateForProject;
  window.clearFormProject = clearFormProject;
  window.updateProjectClearButtonVisibility = updateProjectClearButtonVisibility;
  window.showProjectAutocomplete = showProjectAutocomplete;
  window.hideProjectAutocomplete = hideProjectAutocomplete;
  window.toggleProjectAutocomplete = toggleProjectAutocomplete;
  window.onProjectAutocompleteInput = onProjectAutocompleteInput;
  window.renderProjectAutocompleteList = renderProjectAutocompleteList;
  window.updateDependencyOptions = updateDependencyOptions;
  window.addDependencyFromSelect = addDependencyFromSelect;
  window.removeDependency = removeDependency;
  window.renderDependencyChips = renderDependencyChips;
  window.initSelect2Dropdown = initSelect2Dropdown;
  window.toggleSelect2Dropdown = toggleSelect2Dropdown;
  window.onSelect2Search = onSelect2Search;
  window.onSelect2KeyDown = onSelect2KeyDown;
  window.select2ToggleOption = select2ToggleOption;
  window.select2AddTag = select2AddTag;
  window.select2RemoveTag = select2RemoveTag;
  window.syncSelect2ToHiddenInput = syncSelect2ToHiddenInput;
  window.setSelect2Tags = setSelect2Tags;
  window.renderSelect2Chips = renderSelect2Chips;
  window.insertFeedbackPreset = insertFeedbackPreset;
  window.insertGrillMeDecision = insertGrillMeDecision;
  window.onFormProjectChangeLoadBranches = onFormProjectChangeLoadBranches;
  window.selectWorkspaceMode = selectWorkspaceMode;
  window.toggleQuickBranchBox = toggleQuickBranchBox;
  window.quickCreateBranchInline = quickCreateBranchInline;
  window.updateInPlaceDirtyWarning = updateInPlaceDirtyWarning;
  window.switchModalWorkspaceTab = switchModalWorkspaceTab;
  window.openModal = openModal;
  window.setModalFieldsReadOnly = setModalFieldsReadOnly;
  window.updateModalLiveInProgressView = updateModalLiveInProgressView;
  window.shouldShowReviewWorkspace = shouldShowReviewWorkspace;
  window.openModalForEdit = openModalForEdit;
  window.pollActiveTaskSliceInfo = pollActiveTaskSliceInfo;
  window.renderModalSliceInfo = renderModalSliceInfo;
  window.copyResumePromptFromModal = copyResumePromptFromModal;
  window.updateModalButtonState = updateModalButtonState;
  window.openCommitModalFromTaskModal = openCommitModalFromTaskModal;
  window.mergeWorktreeFromTaskModal = mergeWorktreeFromTaskModal;
  window.saveTask = saveTask;
  window.toggleFormRequiresConfirmation = toggleFormRequiresConfirmation;
  window.confirmAndExecuteTask = confirmAndExecuteTask;
  window.approveTaskAsDone = approveTaskAsDone;
  window.rejectTaskWithFeedback = rejectTaskWithFeedback;
  window.submitTaskForReview = submitTaskForReview;
  window.quickApproveDone = quickApproveDone;
  window.openCommitModal = openCommitModal;
  window.closeCommitModal = closeCommitModal;
  window.regenerateCommitMessage = regenerateCommitMessage;
  window.confirmCommitTask = confirmCommitTask;
  window.autoFixCommitErrorWithAgent = autoFixCommitErrorWithAgent;
  window.commitTaskFromCard = commitTaskFromCard;
  window.archiveTaskFromCard = archiveTaskFromCard;
  window.archiveCurrentTaskFromModal = archiveCurrentTaskFromModal;
  window.loadArchivedTasks = loadArchivedTasks;
  window.openArchiveModal = openArchiveModal;
  window.closeArchiveModal = closeArchiveModal;
  window.renderArchiveTasksList = renderArchiveTasksList;
  window.toggleArchiveTaskSelect = toggleArchiveTaskSelect;
  window.toggleArchiveSelectAll = toggleArchiveSelectAll;
  window.batchDeleteSelectedArchived = batchDeleteSelectedArchived;
  window.deleteAllArchivedTasks = deleteAllArchivedTasks;
  window.batchRestoreSelectedArchived = batchRestoreSelectedArchived;
  window.restoreSingleArchivedTask = restoreSingleArchivedTask;
  window.deleteSingleArchivedTask = deleteSingleArchivedTask;
  window.promptTaskDeleteOrAbandon = promptTaskDeleteOrAbandon;
  window.closeActionConfirmModal = closeActionConfirmModal;
  window.executeTaskActionConfirmed = executeTaskActionConfirmed;
  window.deleteCurrentTask = deleteCurrentTask;
  window.extractRetroPrompt = extractRetroPrompt;
  window.closeModal = closeModal;
}
