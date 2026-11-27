import { KANBAN_STATUSES } from "./constants.js";
import {
  projects, tasks, archivedTasks, archivedTasksCount, settings, projectGitStatus, currentProject, currentBranch, projectBranchesMap, groupByBranch, currentActiveTaskDiff,
  currentTaskDependencies, currentModalEditingTask, selectedFirstLaunchPath, expandedProjectId,
  setProjects, setTasks, setArchivedTasks, setArchivedTasksCount, setSettings, setProjectGitStatus, setCurrentProject,
  setCurrentBranch, setProjectBranchesMap, setGroupByBranch,
  setCurrentActiveTaskDiff, setCurrentTaskDependencies, setCurrentModalEditingTask,
  setSelectedFirstLaunchPath, setExpandedProjectId
} from "./state.js";
import {
  loadProjectBranches, selectProjectAndBranch, renderProjectBranchTree,
  renderContextualHeaderActions, toggleBranchGroupView, openCreateBranchPopover,
  closeCreateBranchPopover, submitNewBranch
} from "./branchNavigator.js";
import {
  escapeHtml, autoResizeTextarea, resetTextareaHeight, formatDuration,
  showToast, withButtonLoading, copyPrompt, copySessionId, openExternalUrl
} from "./utils.js";
import {
  normalizeStatus, getStatusLabel, renderMetrics, filterByStage,
  renderKanban, handleCardKeyDown, initSortable
} from "./kanban.js";
import {
  extractFilePathFromDiffSection, parseFileStatusFromLines, parseDiffStats,
  splitDiffByFiles, updateDiffSummaryBar, toggleCollapseAllDiffs,
  toggleSingleDiffCard, toggleDiffFocusMode, toggleModalFullscreen,
  copyCurrentDiff, filterDiffForFile, showAllDiffs, renderLineNumberedDiff,
  renderDiffViewer
} from "./diffViewer.js";
import { switchLogViewTab, renderExecutionReport, switchPlanViewTab, renderExecutionPlan } from "./executionReport.js";
import {
  setFormProject, updateConfirmationGateForProject, clearFormProject,
  updateProjectClearButtonVisibility, showProjectAutocomplete, hideProjectAutocomplete,
  toggleProjectAutocomplete, onProjectAutocompleteInput, renderProjectAutocompleteList,
  updateDependencyOptions, addDependencyFromSelect, removeDependency,
  renderDependencyChips, initSelect2Dropdown, toggleSelect2Dropdown,
  onSelect2Search, onSelect2KeyDown, select2ToggleOption, select2AddTag,
  select2RemoveTag, syncSelect2ToHiddenInput, setSelect2Tags, renderSelect2Chips,
  insertFeedbackPreset, insertGrillMeDecision, switchModalWorkspaceTab,
  openModal, setModalFieldsReadOnly, updateModalLiveInProgressView,
  shouldShowReviewWorkspace, openModalForEdit, pollActiveTaskSliceInfo, renderModalSliceInfo,
  copyResumePromptFromModal, updateModalButtonState, openCommitModalFromTaskModal,
  saveTask, toggleFormRequiresConfirmation, confirmAndExecuteTask,
  approveTaskAsDone, rejectTaskWithFeedback, submitTaskForReview, quickApproveDone,
  openCommitModal, closeCommitModal, confirmCommitTask, commitTaskFromCard,
  archiveTaskFromCard, archiveCurrentTaskFromModal, openArchiveModal, closeArchiveModal,
  renderArchiveTasksList, toggleArchiveTaskSelect, toggleArchiveSelectAll,
  batchDeleteSelectedArchived, deleteAllArchivedTasks, batchRestoreSelectedArchived,
  restoreSingleArchivedTask, deleteSingleArchivedTask, promptTaskDeleteOrAbandon,
  closeActionConfirmModal, executeTaskActionConfirmed, deleteCurrentTask, closeModal
} from "./modal.js";

    let notifiedAttentionSignatures = new Set();
    let initializedAttentionBaseline = false;
    let lastDockBadgeCount = -1;
    let currentAttentionToastTaskId = '';
    let dismissedAttentionSignatures = new Set();

    function getTaskAttentionInfo(t) {
      if (!t || t.status !== 'in_progress') return null;
      const questions = Array.isArray(t.pendingQuestions) ? t.pendingQuestions.filter(q => q && q.question) : [];
      if (t.awaitingInput === true || questions.length > 0) {
        const count = questions.length || 1;
        const firstQ = questions[0]?.question || '請檢視待確認事項並拍板';
        return {
          needsAttention: true,
          kind: 'question',
          signature: `${t.id}:q:${JSON.stringify(questions)}`,
          title: `💬 [${t.id}] 有 ${count} 項問題待確認`,
          summary: `${t.title || ''} — ${firstQ}`
        };
      }
      if (t.requiresConfirmation && t.executionPlan && String(t.executionPlan).trim().length > 0) {
        return {
          needsAttention: true,
          kind: 'plan',
          signature: `${t.id}:plan:${String(t.executionPlan).trim().slice(0, 120)}`,
          title: `📋 [${t.id}] 執行計劃待確認`,
          summary: t.title || '請審閱執行計劃並確認開始實作'
        };
      }
      return null;
    }

    function showAttentionToastForItem(item) {
      if (!item || !item.task || !item.info) return;
      const box = document.getElementById('attentionToast');
      const titleEl = document.getElementById('attentionToastTitle');
      const bodyEl = document.getElementById('attentionToastBody');
      if (!box) return;
      currentAttentionToastTaskId = item.task.id;
      if (titleEl) titleEl.innerText = item.info.title;
      if (bodyEl) bodyEl.innerText = item.info.summary;
      box.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    function notifyNativeSystemAlert(item) {
      if (!item || !item.task || !item.info) return;
      const payload = {
        taskId: item.task.id,
        title: item.info.title,
        body: item.info.summary
      };
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.notifyUserAttention) {
          window.webkit.messageHandlers.notifyUserAttention.postMessage(payload);
        }
      } catch (e) {}

      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const n = new Notification(payload.title, { body: payload.body });
          n.onclick = () => {
            window.focus();
            openTaskFromNativeNotification(payload.taskId);
          };
        }
      } catch (e) {}
    }

    function syncPendingAttentionState(tasksList = tasks) {
      const list = Array.isArray(tasksList) ? tasksList : [];
      const pendingItems = list
        .map(t => ({ task: t, info: getTaskAttentionInfo(t) }))
        .filter(x => x.info);

      const btn = document.getElementById('headerPendingAttentionBtn');
      const btnText = document.getElementById('headerPendingAttentionText');
      if (btn) {
        btn.classList.toggle('hidden', pendingItems.length === 0);
        btn.classList.toggle('inline-flex', pendingItems.length > 0);
      }
      if (btnText && pendingItems.length > 0) {
        btnText.innerText = `💬 ${pendingItems.length} 待確認`;
      }

      if (typeof document !== 'undefined') {
        document.title = pendingItems.length > 0
          ? `(💬 ${pendingItems.length} 待確認) Task Dashboard`
          : 'Task Dashboard';
      }

      if (pendingItems.length !== lastDockBadgeCount) {
        lastDockBadgeCount = pendingItems.length;
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.updateDockBadge) {
            window.webkit.messageHandlers.updateDockBadge.postMessage({ count: pendingItems.length });
          }
        } catch (e) {}
      }

      const activeSignatures = new Set(pendingItems.map(x => x.info.signature));
      for (const sig of [...notifiedAttentionSignatures]) {
        if (!activeSignatures.has(sig)) notifiedAttentionSignatures.delete(sig);
      }
      for (const sig of [...dismissedAttentionSignatures]) {
        if (!activeSignatures.has(sig)) dismissedAttentionSignatures.delete(sig);
      }

      if (!initializedAttentionBaseline) {
        initializedAttentionBaseline = true;
        pendingItems.forEach(item => notifiedAttentionSignatures.add(item.info.signature));
      } else {
        pendingItems.forEach(item => {
          if (!notifiedAttentionSignatures.has(item.info.signature)) {
            notifiedAttentionSignatures.add(item.info.signature);
            notifyNativeSystemAlert(item);
          }
        });
      }

      const visibleToastItem = pendingItems.find(item => !dismissedAttentionSignatures.has(item.info.signature));
      if (visibleToastItem) {
        showAttentionToastForItem(visibleToastItem);
      } else {
        const box = document.getElementById('attentionToast');
        if (box) box.classList.add('hidden');
        currentAttentionToastTaskId = '';
      }
    }

    function openNextPendingAttentionTask() {
      const list = Array.isArray(tasks) ? tasks : [];
      const first = list.find(t => Boolean(getTaskAttentionInfo(t)));
      if (first) {
        openModalForEdit(first.id);
      } else {
        showToast('目前沒有待確認的任務');
      }
    }

    function openAttentionToastTask() {
      if (currentAttentionToastTaskId) {
        openModalForEdit(currentAttentionToastTaskId);
      } else {
        openNextPendingAttentionTask();
      }
    }

    function dismissAttentionToast() {
      const list = Array.isArray(tasks) ? tasks : [];
      const target = list.find(t => t.id === currentAttentionToastTaskId);
      const info = target ? getTaskAttentionInfo(target) : null;
      if (info) dismissedAttentionSignatures.add(info.signature);
      const box = document.getElementById('attentionToast');
      if (box) box.classList.add('hidden');
    }

    function openTaskFromNativeNotification(taskId) {
      if (taskId) {
        openModalForEdit(taskId);
      } else {
        openNextPendingAttentionTask();
      }
    }

    const macTitlebarEl = document.getElementById('macTitlebar');
    if (macTitlebarEl) {
      macTitlebarEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, select, a, textarea, option, label')) return;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dragWindow) {
          window.webkit.messageHandlers.dragWindow.postMessage('drag');
        }
      });

      macTitlebarEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, input, select, a, textarea, option, label')) return;
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zoomWindow) {
          window.webkit.messageHandlers.zoomWindow.postMessage('zoom');
        }
      });
    }

    function openFirstLaunchModal() {
      setSelectedFirstLaunchPath(settings.dataDirectoryPath || settings.defaultDataDir || '');
      updateFirstLaunchModalUI();
      const modal = document.getElementById('firstLaunchModal');
      if (modal) modal.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    function closeFirstLaunchModal() {
      const modal = document.getElementById('firstLaunchModal');
      if (modal) modal.classList.add('hidden');
    }

    function updateFirstLaunchModalUI() {
      const display = document.getElementById('firstLaunchPathDisplay');
      if (display) {
        display.innerText = selectedFirstLaunchPath || settings.defaultDataDir || '載入中...';
      }
      const badge = document.getElementById('firstLaunchStatusBadge');
      if (badge) {
        if (selectedFirstLaunchPath) {
          badge.innerText = '已選定';
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900';
        } else {
          badge.innerText = '待確認';
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900';
        }
      }
    }

    async function chooseFirstLaunchFolderNative(event) {
      const btn = event ? event.currentTarget : null;
      await withButtonLoading(btn, '選擇中...', async () => {
        try {
          showToast('請在彈出的 macOS 原生視窗中選擇放置目錄...');
          const res = await fetch('/api/settings/choose-config-dir', { method: 'POST' });
          const data = await res.json();
          if (data && data.success && data.path) {
            setSelectedFirstLaunchPath(data.path);
            if (data.settings) setSettings(data.settings);
            updateFirstLaunchModalUI();
            showToast(`已選定目錄：${data.path}`);
          }
        } catch (err) {
          console.error('Failed to choose first launch folder:', err);
        }
      });
    }

    function useFirstLaunchDefaultFolder(event) {
      setSelectedFirstLaunchPath(settings.defaultDataDir || '');
      updateFirstLaunchModalUI();
      showToast('已切換為專案預設資料夾');
    }

    async function confirmFirstLaunchSetup(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnConfirmFirstLaunch');
      await withButtonLoading(btn, '初始化中...', async () => {
        const pathToUse = selectedFirstLaunchPath || settings.defaultDataDir;
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataDirectoryPath: pathToUse,
              initialized: true
            })
          });
          const updated = await res.json();
          setSettings(updated);
          showToast('初始化成功！已建立資料庫與設定檔');
          closeFirstLaunchModal();
          await loadData();
        } catch (err) {
          showToast(`初始化失敗: ${err.message}`);
        }
      });
    }

    let apiFailStreak = 0;
    let isLoadingData = false;
    let loadDataPollCount = 0;

    async function loadData(forceFull = false) {
      if (typeof isLoadingData !== 'undefined' && isLoadingData) {
        if (forceFull) {
          await new Promise(r => setTimeout(r, 100));
          return loadData(true);
        }
        return;
      }
      if (typeof isLoadingData !== 'undefined') isLoadingData = true;
      try {
        const pollCount = (typeof loadDataPollCount !== 'undefined') ? (++loadDataPollCount) : 1;
        const isFullFetch = forceFull === true || (pollCount % 5 === 1);
        const cacheBuster = '?t=' + Date.now();

        let projRes, taskRes, setRes, gitRes;
        if (isFullFetch) {
          [projRes, taskRes, setRes, gitRes] = await Promise.all([
            fetch('/api/projects' + cacheBuster, { cache: 'no-store' }),
            fetch('/api/tasks' + cacheBuster, { cache: 'no-store' }),
            fetch('/api/settings' + cacheBuster, { cache: 'no-store' }),
            fetch('/api/git/projects-status' + cacheBuster, { cache: 'no-store' }).catch(() => ({ json: () => ({}) }))
          ]);
        } else {
          taskRes = await fetch('/api/tasks' + cacheBuster, { cache: 'no-store' });
        }

        if (!taskRes || !taskRes.ok || (projRes && !projRes.ok)) {
          apiFailStreak++;
          renderCliAgentBadge();
          console.warn('API returned non-OK status, skipping data refresh');
          return;
        }
        apiFailStreak = 0;

        const newTasks = await taskRes.json();
        if (Array.isArray(newTasks)) {
          setTasks(newTasks);
        }

        if (isFullFetch && projRes && setRes) {
          const newProjects = await projRes.json();
          const newSettings = await setRes.json();

          if (Array.isArray(newProjects)) {
            setProjects(newProjects);
          }
          if (newSettings && typeof newSettings === 'object') {
            setSettings(newSettings);
            const effectiveFontSize = newSettings.fontSize || localStorage.getItem('fontSize') || 'small';
            localStorage.setItem('fontSize', effectiveFontSize);
            applyFontSize(effectiveFontSize);
          }
          try {
            if (gitRes && typeof gitRes.json === 'function') {
              setProjectGitStatus(await gitRes.json());
            }
          } catch (e) {
            setProjectGitStatus({});
          }
        }
        
        const cliEl = document.getElementById('settingEnableCliAgent');
        const autoEl = document.getElementById('settingAutoTrigger');
        const autoCommitEl = document.getElementById('settingAutoCommitGen');
        const cliCmdEl = document.getElementById('settingCliCommand');
        if (cliEl) cliEl.checked = !!settings.enableCliAgent;
        if (autoEl) autoEl.checked = settings.autoTriggerOnInProgress !== false;
        if (autoCommitEl) autoCommitEl.checked = settings.autoCommitGen !== false;
        if (cliCmdEl && !cliCmdEl.value) cliCmdEl.value = settings.cliCommand || 'hermes';
        renderCliAgentBadge();

        const pathDisplay = document.getElementById('settingConfigPathDisplay');
        if (pathDisplay) {
          pathDisplay.innerText = settings.dataDirectoryPath || settings.defaultDataDir || '預設專案 data 目錄';
        }
        updateAiPromptDisplay();

        // 首次啟動檢查：若尚未初始化或未指定目錄，彈出引導初始化視窗
        if (!settings.initialized && (!settings.dataDirectoryPath || settings.dataDirectoryPath === '')) {
          openFirstLaunchModal();
        }

        // 更新封存庫徽章數量 (優先從 X-Archived-Count 回應標頭讀取)
        const archivedHeader = (taskRes.headers && typeof taskRes.headers.get === 'function')
          ? taskRes.headers.get('X-Archived-Count')
          : null;
        let archivedCount = (archivedHeader !== null && archivedHeader !== '') ? parseInt(archivedHeader, 10) : NaN;
        if (isNaN(archivedCount)) {
          archivedCount = (typeof archivedTasks !== 'undefined' && archivedTasks.length)
            ? archivedTasks.length
            : (Array.isArray(tasks) ? tasks.filter(t => t.status === 'archived').length : 0);
        }
        if (typeof setArchivedTasksCount === 'function') {
          setArchivedTasksCount(archivedCount);
        }
        const archiveBadge = document.getElementById('headerArchiveCountBadge');
        if (archiveBadge) archiveBadge.innerText = archivedCount;

        renderSidebarProjects();
        renderProjectBanner();
        renderContextualHeaderActions();
        renderKanban();
        renderMetrics();
        if (typeof syncPendingAttentionState === 'function') syncPendingAttentionState(tasks);
        if (Array.isArray(projects)) {
          projects.forEach(p => {
            if (p && p.id && !projectBranchesMap[p.id]) {
              loadProjectBranches(p.id, false).then(() => {
                renderSidebarProjects();
                renderContextualHeaderActions();
              });
            }
          });
        }

        // 若當前有開啟中且處於 in_progress 的任務 Modal，即時平滑同步最新日誌與變更檔案
        const modalEl = document.getElementById('taskModal');
        const currentTaskIdInForm = document.getElementById('formTaskId')?.value;
        if (modalEl && !modalEl.classList.contains('hidden') && currentModalEditingTask && currentTaskIdInForm === currentModalEditingTask.id) {
          const freshTask = tasks.find(t => t.id === currentModalEditingTask.id);
          if (freshTask && freshTask.status === 'in_progress') {
            setCurrentModalEditingTask(freshTask);
            updateModalLiveInProgressView(freshTask);
            pollActiveTaskSliceInfo(freshTask);
          }
        }
      } catch (err) {
        apiFailStreak++;
        renderCliAgentBadge();
        console.error('Failed to load dashboard data:', err);
      } finally {
        if (typeof isLoadingData !== 'undefined') {
          isLoadingData = false;
        }
      }
    }

    function renderCliAgentBadge() {
      const isCli = !!settings.enableCliAgent;
      const cmd = settings.cliCommand || 'hermes';
      const isOffline = apiFailStreak >= 2;
      const activeSentinels = Array.isArray(settings.activeSentinels) ? settings.activeSentinels : [];

      const modeText = document.getElementById('headerEngineModeText');
      const offlineBadge = document.getElementById('headerEngineOfflineBadge');
      const engineBtn = document.getElementById('headerEngineBtn');

      if (modeText) {
        modeText.innerText = isCli
          ? 'CLI'
          : (activeSentinels.length > 0 ? `Desktop AI · ${activeSentinels.length} 哨兵` : 'Desktop AI');
      }
      if (offlineBadge) {
        offlineBadge.classList.toggle('hidden', !isOffline);
        offlineBadge.classList.toggle('inline-flex', isOffline);
      }
      if (engineBtn) {
        const sentinelDesc = activeSentinels.length > 0
          ? `Desktop AI 哨兵 (${activeSentinels.map(s => `${s.targetAgent || 'all'}:PID ${s.pid}`).join(', ')})`
          : 'Desktop AI 哨兵（目前無活躍哨兵）';
        engineBtn.title = isOffline
          ? '後端服務無回應，請確認伺服器是否運作 · 點擊開啟設定'
          : `自動化開工引擎設定（目前模式：${isCli ? `CLI · ${cmd}` : sentinelDesc}）`;
      }
    }

    let currentDesktopAgentTarget = 'antigravity';
    let currentDesktopTierFilter = 'all';

    function updateToggleGroupStyles(ids, activeKey, prefix) {
      ids.forEach(t => {
        const btn = document.getElementById(`${prefix}_${t}`);
        if (!btn) return;
        if (t === activeKey) {
          btn.className = 'flex-1 py-1 px-1.5 rounded-md text-center transition bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-xs font-bold';
        } else {
          btn.className = 'flex-1 py-1 px-1.5 rounded-md text-center transition text-slate-600 dark:text-slate-400 hover:text-purple-600 font-medium';
        }
      });
    }

    function selectDesktopAgentTarget(target) {
      currentDesktopAgentTarget = target;
      updateToggleGroupStyles(['universal', 'antigravity', 'claude', 'codex', 'copilot'], target, 'btnAgentTarget');
      updateAiPromptDisplay();
    }

    function selectDesktopTierFilter(tierFilter) {
      currentDesktopTierFilter = tierFilter || 'all';
      updateToggleGroupStyles(['all', 'fast', 'heavy'], currentDesktopTierFilter, 'btnTierFilter');
      updateAiPromptDisplay();
    }

    function updateAiPromptDisplay() {
      const configDir = (settings.dataDirectoryPath || settings.defaultDataDir || '~/Library/Application Support/TaskDashboard').replace(/\/+$/, '');
      const gateScriptPath = `${configDir}/watch-task-gate.js`;

      const targetAdapterMap = {
        antigravity: {
          nativeOrchestrator: 'Orchestrator (Plan→Execute 原生雙階段)',
          fastExecutor: 'flash Subagent (Workspace: "inherit")',
          directExecutor: 'Hydrogen / Fast 直行模式',
          verifier: 'pro Verifier (Model: "pro", Workspace: "inherit")',
          subagentMechanism: 'invoke_subagent'
        },
        claude: {
          nativeOrchestrator: 'Claude Plan Mode (Plan→Act)',
          fastExecutor: 'Haiku Subagent (claude-3-5-haiku)',
          directExecutor: 'Haiku / Sonnet 單線程直行',
          verifier: 'Opus / Thinking Verifier (claude-3-opus)',
          subagentMechanism: 'Task Tool'
        },
        codex: {
          nativeOrchestrator: 'Codex Plan→Act 雙階段',
          fastExecutor: 'Worker Subagent (gpt-4o-mini)',
          directExecutor: 'Codex Mini 單線程直行',
          verifier: 'Reasoner Verifier (o1 / o3-mini)',
          subagentMechanism: 'Swarm / Handoff'
        },
        copilot: {
          nativeOrchestrator: 'Copilot Plan→Agent 雙階段',
          fastExecutor: 'Copilot Subagent (Fast / Default Agent Mode)',
          directExecutor: 'Copilot Fast 單線程直行',
          verifier: 'Copilot Verifier (OpenAI o1 Reasoning Mode)',
          subagentMechanism: 'Agent Mode'
        },
        universal: {
          nativeOrchestrator: 'Native Plan→Execute 原生雙階段模式',
          fastExecutor: 'Executor Subagent (Fast / 輕量檔位)',
          directExecutor: 'Fast Direct 輕量直行模式',
          verifier: 'Verifier Subagent (Reasoning / 深度推理檔位)',
          subagentMechanism: 'Subagent Tool'
        }
      };
      const adapter = targetAdapterMap[currentDesktopAgentTarget] || targetAdapterMap.universal;

      const sharedInstructions = `

【待命與開工原則】：
1. 背景執行上述指令；喚醒後依哨兵輸出的【執行策略】、【Code Graph】與【Skills】執行。
2. 若為 ${adapter.nativeOrchestrator}：非需確認任務，Planning 階段嚴禁讀檔，0 讀碼第 1 步直接 exit_plan_mode 交棒內建執行階段（${adapter.directExecutor}）。
3. 交付：完成後以結構化 JSON 呼叫 PUT http://localhost:3030/api/tasks/<id> 推進 review（或回寫 executionPlan 進入待確認），隨即重啟背景哨兵待命。`;

      const tierFlag = currentDesktopTierFilter === 'fast'
        ? ' --tier=micro,standard'
        : (currentDesktopTierFilter === 'heavy' ? ' --tier=heavy' : '');

      let promptText = '';
      if (currentDesktopAgentTarget === 'antigravity') {
        promptText = `在背景執行指令啟動哨兵待命 (0 Token，專屬認領 Antigravity 任務)：
node "${gateScriptPath}" --agent=antigravity${tierFlag}${sharedInstructions}`;
      } else if (currentDesktopAgentTarget === 'claude') {
        promptText = `使用 bash/execute_command 背景啟動哨兵待命 (0 Token，專屬認領 Claude 任務)：
node "${gateScriptPath}" --agent=claude${tierFlag}${sharedInstructions}`;
      } else if (currentDesktopAgentTarget === 'codex') {
        promptText = `在終端背景執行指令啟動哨兵待命 (0 Token，專屬認領 Codex 任務)：
node "${gateScriptPath}" --agent=codex${tierFlag}${sharedInstructions}`;
      } else if (currentDesktopAgentTarget === 'copilot') {
        promptText = `在終端背景執行指令啟動哨兵待命 (0 Token，專屬認領 Copilot 任務)：
node "${gateScriptPath}" --agent=copilot${tierFlag}${sharedInstructions}`;
      } else {
        // universal
        promptText = `在終端工具背景執行以下指令啟動哨兵待命 (0 Token，通用認領所有任務)：
node "${gateScriptPath}"${tierFlag}${sharedInstructions}`;
      }

      const promptEl = document.getElementById('aiPromptTextDisplay');
      if (promptEl) {
        promptEl.innerText = promptText;
      }
      return promptText;
    }

    function copyAiInspectionPrompt() {
      const promptText = updateAiPromptDisplay();
      const agentLabels = {
        universal: '通用跨平台',
        antigravity: 'Antigravity (run_command)',
        claude: 'Claude (bash)',
        codex: 'Codex / Cursor',
        copilot: 'GitHub Copilot'
      };
      const label = agentLabels[currentDesktopAgentTarget] || 'Desktop AI';
      navigator.clipboard.writeText(promptText).then(() => {
        showToast(`已複製【${label}】哨兵待命 Prompt！`);
      }).catch(() => {
        showToast('複製失敗，請手動選取文字');
      });
    }

    // Helper for managing button loading and disabled states

    async function chooseFolderNative(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnChooseProjectFolder');
      await withButtonLoading(btn, '選擇中...', async () => {
        try {
          showToast('請在彈出的 macOS 原生視窗中選擇專案資料夾...');
          const res = await fetch('/api/projects/choose-folder', { method: 'POST' });
          const data = await res.json();
          if (data && data.success && data.project) {
            closeAddProjectModal();
            showToast(`已成功引入專案：${data.project.name}`);
            await loadData();
            filterByProject(data.project.id);
          }
        } catch (err) {
          console.error('Failed to choose folder:', err);
        }
      });
    }

    async function chooseConfigDirNative(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnChooseConfigDir');
      await withButtonLoading(btn, '選擇中...', async () => {
        try {
          showToast('請在彈出的 macOS 原生視窗中選擇 Config 與資料庫資料夾...');
          const res = await fetch('/api/settings/choose-config-dir', { method: 'POST' });
          const data = await res.json();
          if (data && data.success && data.path) {
            if (data.settings) {
              setSettings(data.settings);
            } else {
              setSettings({ ...settings, dataDirectoryPath: data.path });
            }
            const pathDisplay = document.getElementById('settingConfigPathDisplay');
            if (pathDisplay) pathDisplay.innerText = data.path;
            updateAiPromptDisplay();
            showToast(`已變更 Config 放置目錄至：${data.path} 並建立資料庫檔案`);
            await loadData();
          }
        } catch (err) {
          console.error('Failed to choose config directory:', err);
        }
      });
    }

    async function toggleCliAgent(enabled) {
      setSettings({ ...settings, enableCliAgent: enabled });
      const cliCmdEl = document.getElementById('settingCliCommand');
      const cliCmd = (cliCmdEl ? cliCmdEl.value.trim() : '') || settings.cliCommand || 'hermes';
      const autoTriggerEl = document.getElementById('settingAutoTrigger');
      const autoTrigger = autoTriggerEl ? autoTriggerEl.checked : (settings.autoTriggerOnInProgress !== false);

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enableCliAgent: enabled,
            cliCommand: cliCmd,
            autoTriggerOnInProgress: autoTrigger,
            dataDirectoryPath: settings.dataDirectoryPath
          })
        });
        const updated = await res.json();
        setSettings(updated);
        
        // 同步 UI 狀態
        renderCliAgentBadge();
        
        showToast(enabled ? ` CLI Agent 自動開工已啟用 (${settings.cliCommand || 'hermes'})！` : ' Desktop AI 輪巡模式已啟用');
      } catch (err) {
        console.error('Failed to update settings:', err);
        showToast(`設定變更失敗: ${err.message}`);
      }
    }

    let currentAutomationMode = 'cli';

    function selectAutomationMode(mode, triggerSave = true) {
      const normalizedMode = (mode === 'antigravity' || mode === 'desktop_ai') ? 'desktop_ai' : 'cli';
      currentAutomationMode = normalizedMode;
      const tabCli = document.getElementById('tabBtnCli');
      const tabDesktop = document.getElementById('tabBtnDesktopAi');
      const panelCli = document.getElementById('panelCliMode');
      const panelDesktop = document.getElementById('panelDesktopAiMode');

      if (!tabCli || !tabDesktop || !panelCli || !panelDesktop) return;

      if (normalizedMode === 'cli') {
        tabCli.className = 'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200 dark:border-slate-700 transition';
        tabDesktop.className = 'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
        panelCli.classList.remove('hidden');
        panelDesktop.classList.add('hidden');
        if (triggerSave && !settings.enableCliAgent) {
          toggleCliAgent(true);
        }
      } else {
        tabDesktop.className = 'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm border border-slate-200 dark:border-slate-700 transition';
        tabCli.className = 'flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
        panelDesktop.classList.remove('hidden');
        panelCli.classList.add('hidden');
        updateAiPromptDisplay();
        if (triggerSave && settings.enableCliAgent) {
          toggleCliAgent(false);
        }
      }
      if (window.lucide) lucide.createIcons();
    }

    function toggleEnginePopover(e) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const popover = document.getElementById('enginePopover');
      if (!popover) return;
      if (popover.classList.contains('hidden')) {
        openEnginePopover();
      } else {
        closeEnginePopover();
      }
    }

    function openEnginePopover() {
      const popover = document.getElementById('enginePopover');
      if (!popover) return;
      const cliCmdEl = document.getElementById('settingCliCommand');
      if (cliCmdEl) cliCmdEl.value = settings.cliCommand || 'hermes';
      const autoEl = document.getElementById('settingAutoTrigger');
      if (autoEl) autoEl.checked = settings.autoTriggerOnInProgress !== false;
      const autoCommitEl = document.getElementById('settingAutoCommitGen');
      if (autoCommitEl) autoCommitEl.checked = settings.autoCommitGen !== false;
      updateAiPromptDisplay();
      selectAutomationMode(settings.enableCliAgent ? 'cli' : 'antigravity', false);
      popover.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    function closeEnginePopover() {
      const popover = document.getElementById('enginePopover');
      if (popover) popover.classList.add('hidden');
    }

    async function saveCliEngineSettings(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnSaveCliSettings');
      await withButtonLoading(btn, '儲存中...', async () => {
        const cliCmdEl = document.getElementById('settingCliCommand');
        const cliCmd = (cliCmdEl ? cliCmdEl.value.trim() : '') || settings.cliCommand || 'hermes';
        const autoEl = document.getElementById('settingAutoTrigger');
        const autoTrigger = autoEl ? autoEl.checked : (settings.autoTriggerOnInProgress !== false);
        const autoCommitEl = document.getElementById('settingAutoCommitGen');
        const autoCommitGen = autoCommitEl ? autoCommitEl.checked : true;
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enableCliAgent: true,
              cliCommand: cliCmd,
              autoTriggerOnInProgress: autoTrigger,
              autoCommitGen: autoCommitGen,
              dataDirectoryPath: settings.dataDirectoryPath,
              fontSize: localStorage.getItem('fontSize') || (settings && settings.fontSize) || 'small',
              initialized: true
            })
          });
          const updated = await res.json();
          setSettings(updated);
          renderCliAgentBadge();
          showToast('CLI 開工引擎設定已成功儲存！');
        } catch (err) {
          showToast(`儲存失敗: ${err.message}`);
        }
      });
    }

    let _azdoPatFormVisible = false;

    function renderGitAccountsSettings(data) {
      const container = document.getElementById('gitAccountsSettingsContainer');
      const badge = document.getElementById('settingsGitConnectedBadge');
      if (!container) return;

      if (!data) {
        if (badge) badge.textContent = '偵測失敗';
        container.innerHTML = `<div class="text-rose-600 dark:text-rose-400">無法讀取本機 Git 帳號狀態，請稍後重試。</div>`;
        return;
      }

      const ghAccounts = (data.github && Array.isArray(data.github.accounts)) ? data.github.accounts : [];
      const forkMissing = (data.github && Array.isArray(data.github.forkMissingAccounts)) ? data.github.forkMissingAccounts : [];
      const azdoOrgs = (data.azureDevOps && Array.isArray(data.azureDevOps.orgs)) ? data.azureDevOps.orgs : [];
      const totalConnected = Number(data.totalConnected || 0);
      const pending = data.pendingGithubLogin && data.pendingGithubLogin.active ? data.pendingGithubLogin : null;
      const ident = data.globalIdentity || {};
      const tools = data.tools || {};

      if (badge) {
        badge.textContent = `已連線 ${totalConnected} 個帳號/組織`;
        badge.className = totalConnected > 0
          ? 'text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold'
          : 'text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold';
      }

      const identText = ident.name || ident.email
        ? `${escapeHtml(ident.name || '(未設名稱)')}${ident.email ? ` <${escapeHtml(ident.email)}>` : ''}`
        : '尚未設定 git global user.name / email';

      const ghRows = ghAccounts.length > 0
        ? ghAccounts.map(acc => {
            const safeUser = escapeHtml(acc.username);
            const attrUser = escapeHtml(acc.username).replace(/'/g, "\\'");
            return `
              <div class="flex items-center justify-between gap-2 py-1 px-2 rounded-lg bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80">
                <div class="min-w-0 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full ${acc.active ? 'bg-emerald-500' : 'bg-slate-400'} flex-shrink-0"></span>
                  <span class="font-mono font-semibold text-slate-800 dark:text-slate-100 truncate">${safeUser}</span>
                  ${acc.active ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold">預設</span>` : ''}
                </div>
                ${!acc.active ? `
                  <button type="button" onclick="switchGithubAccountFromSettings('${attrUser}')" class="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-slate-700 dark:text-slate-200 font-medium cursor-pointer flex-shrink-0">設為預設</button>
                ` : `<span class="text-[10px] text-slate-400 font-mono flex-shrink-0">${escapeHtml(acc.protocol || 'https')}</span>`}
              </div>
            `;
          }).join('')
        : `<div class="text-[11px] text-slate-500 dark:text-slate-400 py-1">尚未登入任何 GitHub CLI 帳號${tools.gh ? '，點擊右側按鈕即可免終端機一鍵登入。' : '（請先安裝 gh：brew install gh）。'}</div>`;

      const pendingBox = pending ? `
        <div class="rounded-lg p-2.5 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 space-y-1.5">
          <div class="font-semibold text-indigo-800 dark:text-indigo-200">等待 GitHub 瀏覽器授權中...</div>
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-sm font-bold tracking-wider text-indigo-700 dark:text-indigo-300 select-all">${escapeHtml(pending.deviceCode)}</span>
            <div class="flex items-center gap-1.5">
              <button type="button" onclick="copyGithubDeviceCode('${escapeHtml(pending.deviceCode)}')" class="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer">複製驗證碼</button>
              <a href="${escapeHtml(pending.verificationUri || 'https://github.com/login/device')}" target="_blank" rel="noopener noreferrer" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold no-underline">前往授權 ↗</a>
            </div>
          </div>
        </div>
      ` : '';

      const forkHint = forkMissing.length > 0
        ? `<div class="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-2 py-1">Fork 偵測到尚未在 gh 登入之帳號：<span class="font-mono font-semibold">${forkMissing.map(escapeHtml).join(', ')}</span></div>`
        : '';

      const azdoRows = azdoOrgs.length > 0
        ? azdoOrgs.map(item => {
            const sourceTags = [];
            if (item.hasKeychainPat) sourceTags.push('Keychain ✓');
            if (item.hasRepoPat) sourceTags.push('Repo PAT ✓');
            if (item.hasEnvPat) sourceTags.push('Env ✓');
            const statusText = sourceTags.length > 0 ? sourceTags.join(' · ') : '未設定 PAT';
            return `
              <div class="flex items-center justify-between gap-2 py-1 px-2 rounded-lg bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80">
                <div class="min-w-0 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full ${item.ready ? 'bg-emerald-500' : 'bg-amber-500'} flex-shrink-0"></span>
                  <span class="font-mono font-semibold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(item.org)}</span>
                  <span class="text-[10px] text-slate-400">(${item.projectCount} 專案)</span>
                </div>
                <span class="text-[10px] font-medium ${item.ready ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-400'} flex-shrink-0">${escapeHtml(statusText)}</span>
              </div>
            `;
          }).join('')
        : `<div class="text-[11px] text-slate-500 dark:text-slate-400 py-1">目前受管專案中無 Azure DevOps 組織。</div>`;

      const azdoForm = _azdoPatFormVisible ? `
        <div class="rounded-lg p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
          <div class="text-[10px] text-slate-500 dark:text-slate-400">PAT 驗證通過後會安全存於 macOS Keychain，絕不以明文寫入設定檔。</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <input type="text" id="settingAzdoOrgInput" placeholder="組織名稱（如 FET-IDTT）" class="h-7 px-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono focus:outline-none">
            <input type="password" id="settingAzdoPatInput" placeholder="Azure DevOps PAT" class="h-7 px-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono focus:outline-none">
          </div>
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" onclick="toggleAzdoPatForm(false)" class="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium cursor-pointer">取消</button>
            <button type="button" id="btnSaveAzdoPat" onclick="saveAzdoPatFromSettings(event)" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold cursor-pointer">驗證並存入 Keychain</button>
          </div>
        </div>
      ` : '';

      container.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 pb-1.5 border-b border-slate-200/70 dark:border-slate-700/70">
          <span class="truncate" title="${identText}">本機身分：<span class="font-mono text-slate-700 dark:text-slate-200">${identText}</span></span>
          <span class="font-mono flex-shrink-0">git ${tools.git ? '✓' : '✕'} · gh ${tools.gh ? '✓' : '✕'} · ssh ${tools.hasSshKey ? '✓' : '—'}</span>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-700 dark:text-slate-200">GitHub (${ghAccounts.length} 個帳號)</span>
            <button type="button" id="btnStartGithubLogin" onclick="startGithubLoginFromSettings(event)" class="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer">＋ 登入 GitHub 帳號</button>
          </div>
          ${pendingBox}
          <div class="space-y-1">${ghRows}</div>
          ${forkHint}
        </div>

        <div class="space-y-1.5 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-700 dark:text-slate-200">Azure DevOps (${azdoOrgs.length} 個組織)</span>
            <button type="button" onclick="toggleAzdoPatForm()" class="text-[10px] px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer">＋ 設定組織 PAT</button>
          </div>
          ${azdoForm}
          <div class="space-y-1">${azdoRows}</div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }

    async function loadGitAccountsSettings() {
      const container = document.getElementById('gitAccountsSettingsContainer');
      if (container && !container.innerHTML.trim()) {
        container.innerHTML = `<div class="text-slate-400">正在掃描本機 Git 帳號...</div>`;
      }
      try {
        const res = await fetch('/api/git/accounts');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderGitAccountsSettings(data);
        return data;
      } catch (err) {
        renderGitAccountsSettings(null);
        return null;
      }
    }

    function copyGithubDeviceCode(code) {
      if (!code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).catch(() => {});
      }
      showToast(`已複製一次性驗證碼：${code}`);
    }

    async function startGithubLoginFromSettings(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnStartGithubLogin');
      await withButtonLoading(btn, '取得驗證碼...', async () => {
        try {
          const res = await fetch('/api/git/accounts/github/login', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || `啟動登入失敗 (HTTP ${res.status})`);
          }
          if (data.deviceCode && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(data.deviceCode).catch(() => {});
          }
          showToast(`驗證碼 ${data.deviceCode} 已複製，請於瀏覽器完成授權`);
          await loadGitAccountsSettings();
        } catch (err) {
          showToast(`GitHub 登入啟動失敗：${err.message || '未知錯誤'}`);
        }
      });
    }

    async function switchGithubAccountFromSettings(username) {
      if (!username) return;
      try {
        const res = await fetch('/api/git/accounts/github/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || `切換失敗 (HTTP ${res.status})`);
        }
        showToast(`已將預設 GitHub 帳號切換為 ${username}`);
        if (data.accounts) {
          renderGitAccountsSettings(data.accounts);
        } else {
          await loadGitAccountsSettings();
        }
      } catch (err) {
        showToast(`切換 GitHub 帳號失敗：${err.message || '未知錯誤'}`);
      }
    }

    function toggleAzdoPatForm(forceState) {
      _azdoPatFormVisible = typeof forceState === 'boolean' ? forceState : !_azdoPatFormVisible;
      loadGitAccountsSettings();
    }

    async function saveAzdoPatFromSettings(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnSaveAzdoPat');
      const org = (document.getElementById('settingAzdoOrgInput')?.value || '').trim();
      const pat = (document.getElementById('settingAzdoPatInput')?.value || '').trim();
      if (!org || !pat) {
        showToast('請輸入 Azure DevOps 組織名稱與 PAT');
        return;
      }
      await withButtonLoading(btn, '驗證中...', async () => {
        try {
          const res = await fetch('/api/git/accounts/azdo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ org, pat })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || `驗證失敗 (HTTP ${res.status})`);
          }
          _azdoPatFormVisible = false;
          showToast(`組織 ${org} 的 PAT 已驗證並安全存入 macOS Keychain！`);
          if (data.accounts) {
            renderGitAccountsSettings(data.accounts);
          } else {
            await loadGitAccountsSettings();
          }
        } catch (err) {
          showToast(`Azure DevOps PAT 設定失敗：${err.message || '未知錯誤'}`);
        }
      });
    }

    function openSettingsModal() {
      updateThemeButtons();
      updateFontSizeButtons();
      const pathDisplay = document.getElementById('settingConfigPathDisplay');
      if (pathDisplay) {
        pathDisplay.innerText = settings.dataDirectoryPath || settings.defaultDataDir || '預設專案 data 目錄';
      }
      const plainLangEl = document.getElementById('settingPlainLanguageWithTerms');
      if (plainLangEl) {
        plainLangEl.checked = !settings || settings.plainLanguageWithTerms !== false;
      }
      document.getElementById('settingsModal').classList.remove('hidden');
      loadGitAccountsSettings();
      if (window.lucide) lucide.createIcons();
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').classList.add('hidden');
    }

    async function saveSettingsFromModal(event) {
      const btn = event ? event.currentTarget : document.getElementById('btnSaveSettings');
      await withButtonLoading(btn, '儲存中...', async () => {
        const cliCmdEl = document.getElementById('settingCliCommand');
        const cliCmd = (cliCmdEl ? cliCmdEl.value.trim() : '') || settings.cliCommand || 'hermes';
        const autoEl = document.getElementById('settingAutoTrigger');
        const autoTrigger = autoEl ? autoEl.checked : (settings.autoTriggerOnInProgress !== false);
        const plainLangEl = document.getElementById('settingPlainLanguageWithTerms');
        const plainLanguageWithTerms = plainLangEl ? plainLangEl.checked : (!settings || settings.plainLanguageWithTerms !== false);
        const enableAgent = !!settings.enableCliAgent;
        
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enableCliAgent: enableAgent,
              cliCommand: cliCmd,
              autoTriggerOnInProgress: autoTrigger,
              plainLanguageWithTerms,
              dataDirectoryPath: settings.dataDirectoryPath,
              fontSize: localStorage.getItem('fontSize') || (settings && settings.fontSize) || 'small',
              initialized: true
            })
          });
          const updated = await res.json();
          setSettings(updated);
          renderCliAgentBadge();
          showToast('系統設定已成功儲存！');
          closeSettingsModal();
          await loadData();
        } catch (err) {
          showToast(`儲存失敗: ${err.message}`);
        }
      });
    }


    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebarBackdrop');
      sidebar.classList.toggle('-translate-x-full');
      backdrop.classList.toggle('hidden');
    }

    function closeSidebar() {
      document.getElementById('sidebar').classList.add('-translate-x-full');
      document.getElementById('sidebarBackdrop').classList.add('hidden');
    }

    function toggleProjectExpand(projId, event) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (!projId || projId === 'ALL') {
        setExpandedProjectId(null);
      } else {
        setExpandedProjectId(expandedProjectId === projId ? null : projId);
      }
      renderSidebarProjects();
    }

    function filterByProject(projId) {
      const targetProj = projId || 'ALL';
      if (targetProj === 'ALL') {
        setExpandedProjectId(null);
      } else {
        const isAlreadyRootAndExpanded = currentProject === targetProj && (!currentBranch || currentBranch === 'ALL') && expandedProjectId === targetProj;
        setExpandedProjectId(isAlreadyRootAndExpanded ? null : targetProj);
      }
      setCurrentProject(targetProj);
      setCurrentBranch('ALL');
      renderSidebarProjects();
      renderProjectBanner();
      renderContextualHeaderActions();
      renderKanban();
      renderMetrics();
      closeSidebar();
      if (targetProj !== 'ALL') {
        loadProjectBranches(targetProj, false).then(() => {
          renderSidebarProjects();
          renderContextualHeaderActions();
        });
      }
    }

    async function deleteProject(projId, index, e) {
      if (e) e.stopPropagation();
      const proj = projects[index] || projects.find(p => p.id === projId);
      const projName = proj ? proj.name : projId;
      
      if (!confirm(`確定要取消追蹤專案 "${projName}" 嗎？\n（此操作僅從 Task Dashboard 移除追蹤，不會刪除您電腦中的實體資料夾）`)) {
        return;
      }

      try {
        const res = await fetch('/api/projects/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: projId, index: index })
        });
        const data = await res.json();
        if (data && data.success) {
          showToast(`已取消追蹤專案：${projName}`);
          if (currentProject === projId) {
            setCurrentProject('ALL');
            setCurrentBranch('ALL');
          }
          await loadData();
        } else {
          showToast(`取消追蹤失敗: ${data.error || '未知錯誤'}`);
        }
      } catch (err) {
        console.error('Failed to untrack project:', err);
        showToast('取消追蹤失敗');
      }
    }

    function renderSidebarProjects() {
      const listEl = document.getElementById('projectSidebarList');
      const search = (document.getElementById('projectSearchInput').value || '').toLowerCase();
      
      let filtered = projects;
      if (search) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(search) || p.id.toLowerCase().includes(search));
      }

      document.getElementById('sidebarProjectCount').innerText = `${projects.length} 個本機專案`;

      let html = `
        <button type="button" onclick="filterByProject('ALL')" class="w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] leading-snug tracking-[-0.01em] flex items-center justify-between transition cursor-pointer ${currentProject === 'ALL' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold' : 'bg-[var(--card)] text-slate-900 dark:text-slate-100 border border-[var(--border)] font-semibold hover:border-[var(--primary)]'}">
          <span>全部專案</span>
          <span class="font-mono px-1.5 py-0 rounded-full text-[10px] ${currentProject === 'ALL' ? 'bg-black/15 text-white' : 'bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)]'}">${tasks.filter(t => normalizeStatus(t.status) !== 'archived').length}</span>
        </button>
      `;

      projects.forEach((p, idx) => {
        if (search && !p.name.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) return;
        
        const isProjOnly = currentProject === p.id && (!currentBranch || currentBranch === 'ALL');
        const isExpanded = expandedProjectId === p.id;
        const taskCount = tasks.filter(t => t.project === p.id && normalizeStatus(t.status) !== 'archived').length;
        const colorClass = p.color === 'purple' ? 'bg-purple-500' :
                           p.color === 'blue' ? 'bg-blue-500' :
                           p.color === 'emerald' ? 'bg-emerald-500' :
                           p.color === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';
        const deleteBtnClass = isProjOnly
          ? 'hidden group-hover/proj:flex focus:flex p-0.5 rounded bg-black/20 hover:bg-rose-600 text-white transition items-center justify-center'
          : 'hidden group-hover/proj:flex focus:flex p-0.5 text-[var(--muted-foreground)] hover:text-rose-500 hover:bg-rose-500/10 rounded transition items-center justify-center';
        const expandBtnClass = isProjOnly
          ? 'p-0.5 rounded hover:bg-black/20 text-white/90 hover:text-white transition flex items-center justify-center flex-shrink-0'
          : 'p-0.5 rounded hover:bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition flex items-center justify-center flex-shrink-0';

        html += `
          <div class="p-1 rounded-lg bg-[var(--card)] border border-[var(--border)] space-y-0.5">
            <div onclick="filterByProject('${p.id}')" class="group/proj px-1.5 py-1 rounded-md flex items-center justify-between cursor-pointer transition ${isProjOnly ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold' : 'hover:bg-[var(--background)] text-slate-900 dark:text-slate-100 font-semibold'}">
              <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                <button type="button" onclick="toggleProjectExpand('${p.id}', event)" aria-expanded="${isExpanded}" title="${isExpanded ? '收合分支列表' : '展開分支列表'}" class="${expandBtnClass}">
                  <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" class="w-3 h-3 pointer-events-none"></i>
                </button>
                <span class="w-1.5 h-1.5 rounded-full ${colorClass} flex-shrink-0"></span>
                <span class="text-[12px] font-semibold leading-snug tracking-[-0.01em] truncate">${escapeHtml(p.name)}</span>
              </div>
              <div class="flex items-center gap-0.5 flex-shrink-0">
                <span class="font-mono text-[10px] px-1 py-0 rounded ${isProjOnly ? 'bg-black/15 text-white' : 'bg-[var(--background)] text-[var(--muted-foreground)]'}">${taskCount}</span>
                <button onclick="deleteProject('${p.id}', ${idx}, event)" title="取消追蹤此專案" class="${deleteBtnClass}">
                  <i data-lucide="trash-2" class="w-2.5 h-2.5 pointer-events-none"></i>
                </button>
              </div>
            </div>
            ${isExpanded ? renderProjectBranchTree(p) : ''}
          </div>
        `;
      });

      listEl.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    }

    async function initProjectHarnessFromUI(projectId) {
      const targetProjId = projectId || currentProject;
      if (!targetProjId || targetProjId === 'ALL') {
        showToast('請先選擇特定專案以初始化 Harness', true);
        return;
      }
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(targetProjId)}/init-harness`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(`已成功為專案【${targetProjId}】建立 Harness 品質閘門與切片藍圖！`);
          await fetchProjects();
          await fetchTasks();
        } else {
          showToast(`初始化失敗: ${data.error || '未知錯誤'}`, true);
        }
      } catch (err) {
        showToast(`初始化異常: ${err.message}`, true);
      }
    }

    async function toggleProjectRequirePrFromUI(projectId) {
      const targetProjId = projectId || currentProject;
      if (!targetProjId || targetProjId === 'ALL') return;
      const proj = projects.find(p => p.id === targetProjId);
      if (!proj) return;
      const nextRequirePr = !Boolean(proj.requirePr);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(targetProjId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirePr: nextRequirePr })
        });
        const updated = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(updated.error || `HTTP ${res.status}`);
        proj.requirePr = Boolean(updated.requirePr);
        renderProjectBanner();
        if (typeof window !== 'undefined') {
          window.renderKanban?.();
        }
        showToast(proj.requirePr
          ? `已為「${proj.name}」啟用強制走 PR 流程（非預設分支停用本地合併）`
          : `已關閉「${proj.name}」的強制 PR 流程`);
      } catch (err) {
        showToast(`更新專案 PR 策略失敗：${err.message || '未知錯誤'}`);
      }
    }

    function renderProjectBanner() {
      const banner = document.getElementById('projectBanner');
      const headerTitle = document.getElementById('headerCurrentProjectName');
      const bannerPath = document.getElementById('bannerPath');
      const harnessBtn = document.getElementById('bannerHarnessBtn');
      const requirePrBtn = document.getElementById('bannerRequirePrBtn');
      const requirePrText = document.getElementById('bannerRequirePrText');

      if (currentProject === 'ALL') {
        if (banner) banner.classList.add('hidden');
        if (bannerPath) {
          bannerPath.innerText = '';
          bannerPath.title = '';
          bannerPath.classList.add('hidden');
        }
        if (harnessBtn) harnessBtn.classList.add('hidden');
        if (requirePrBtn) {
          requirePrBtn.classList.add('hidden');
          requirePrBtn.classList.remove('flex');
        }
        if (headerTitle) headerTitle.innerText = '全部專案';
        renderContextualHeaderActions();
        return;
      }

      const proj = projects.find(p => p.id === currentProject);
      if (!proj) {
        if (banner) banner.classList.add('hidden');
        if (bannerPath) {
          bannerPath.innerText = '';
          bannerPath.title = '';
          bannerPath.classList.add('hidden');
        }
        if (harnessBtn) harnessBtn.classList.add('hidden');
        if (requirePrBtn) {
          requirePrBtn.classList.add('hidden');
          requirePrBtn.classList.remove('flex');
        }
        if (headerTitle) headerTitle.innerText = currentProject;
        renderContextualHeaderActions();
        return;
      }

      if (banner) banner.classList.remove('hidden');
      if (headerTitle) headerTitle.innerText = proj.name;
      const bTitle = document.getElementById('bannerTitle');
      if (bTitle) bTitle.innerText = proj.name;
      if (bannerPath) {
        const pathStr = proj.path || proj.name || proj.id;
        bannerPath.innerText = pathStr;
        bannerPath.title = pathStr;
        bannerPath.classList.remove('hidden');
      }
      if (harnessBtn) {
        const hasHarness = proj.harness && proj.harness.hasHarness;
        if (!hasHarness) {
          harnessBtn.classList.remove('hidden');
          harnessBtn.classList.add('flex');
        } else {
          harnessBtn.classList.add('hidden');
          harnessBtn.classList.remove('flex');
        }
      }
      if (requirePrBtn) {
        const isReqPr = Boolean(proj.requirePr);
        requirePrBtn.classList.remove('hidden');
        requirePrBtn.classList.add('flex');
        requirePrBtn.className = isReqPr
          ? 'text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 px-2 py-0.5 rounded-full font-semibold transition flex items-center gap-1 flex-shrink-0 cursor-pointer shadow-xs'
          : 'text-[10px] bg-slate-500/10 hover:bg-slate-500/20 text-slate-600 dark:text-slate-300 border border-slate-400/30 px-2 py-0.5 rounded-full font-medium transition flex items-center gap-1 flex-shrink-0 cursor-pointer';
        requirePrBtn.title = isReqPr
          ? '此專案已啟用「強制走 PR 流程」（非預設分支停用本地合併回主幹），點擊切換'
          : '點擊為此專案啟用「強制走 PR 流程」（非預設分支以開立 PR 為主，停用本地合併）';
        if (requirePrText) {
          requirePrText.textContent = isReqPr ? 'PR 必走 ✓' : 'PR 流程';
        }
      }
      renderContextualHeaderActions();
      if (window.lucide) lucide.createIcons();
    }


    function openAddProjectModal(event, defaultTab = 'clone') {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      const modal = document.getElementById('addProjectModal');
      if (!modal) {
        chooseFolderNative(event);
        return;
      }
      const errBox = document.getElementById('cloneProjectErrorBox');
      if (errBox) { errBox.classList.add('hidden'); errBox.textContent = ''; }
      const urlInput = document.getElementById('cloneRepoUrlInput');
      const folderInput = document.getElementById('cloneFolderNameInput');
      const branchInput = document.getElementById('cloneBranchInput');
      const reqPrEl = document.getElementById('cloneRequirePrCheckbox');
      if (urlInput) urlInput.value = '';
      if (folderInput) folderInput.value = '';
      if (branchInput) branchInput.value = '';
      if (reqPrEl) reqPrEl.checked = false;
      switchAddProjectTab(defaultTab);
      updateClonePreviewFromUrl();
      modal.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
      if (defaultTab === 'clone') setTimeout(() => urlInput?.focus(), 20);
    }

    function closeAddProjectModal() {
      document.getElementById('addProjectModal')?.classList.add('hidden');
    }

    function switchAddProjectTab(tab = 'clone') {
      const isClone = tab !== 'local';
      const clonePane = document.getElementById('addProjClonePane');
      const localPane = document.getElementById('addProjLocalPane');
      const tabClone = document.getElementById('addProjTabClone');
      const tabLocal = document.getElementById('addProjTabLocal');
      if (clonePane) clonePane.classList.toggle('hidden', !isClone);
      if (localPane) localPane.classList.toggle('hidden', isClone);
      const activeCls = 'py-1.5 px-3 rounded-lg font-semibold transition cursor-pointer bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs';
      const idleCls = 'py-1.5 px-3 rounded-lg font-semibold transition cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white';
      if (tabClone) tabClone.className = isClone ? activeCls : idleCls;
      if (tabLocal) tabLocal.className = !isClone ? activeCls : idleCls;
    }

    function updateClonePreviewFromUrl() {
      const url = (document.getElementById('cloneRepoUrlInput')?.value || '').trim();
      const parentDir = (document.getElementById('cloneParentDirInput')?.value || '~/projects').trim().replace(/\/+$/, '');
      const folderInput = document.getElementById('cloneFolderNameInput');
      const previewEl = document.getElementById('cloneTargetPathPreview');
      const badgeEl = document.getElementById('cloneProviderBadge');
      const reqPrEl = document.getElementById('cloneRequirePrCheckbox');

      let derivedFolder = '';
      if (url) {
        const cleanUrl = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
        const seg = cleanUrl.split(/[/:]/).filter(Boolean).pop() || '';
        derivedFolder = decodeURIComponent(seg).replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-');
      }

      const explicitFolder = (folderInput?.value || '').trim();
      const finalFolder = explicitFolder || derivedFolder;
      if (folderInput && !explicitFolder && derivedFolder) {
        folderInput.placeholder = derivedFolder;
      }
      if (previewEl) {
        previewEl.textContent = finalFolder ? `${parentDir}/${finalFolder}` : `${parentDir}/`;
      }

      if (badgeEl) {
        if (/dev\.azure\.com|visualstudio\.com/i.test(url)) {
          badgeEl.textContent = 'Azure DevOps';
          badgeEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300';
          if (reqPrEl && !reqPrEl.dataset.userTouched) reqPrEl.checked = true;
        } else if (/github\.com/i.test(url)) {
          badgeEl.textContent = 'GitHub';
          badgeEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300';
        } else if (url) {
          badgeEl.textContent = 'Git Remote';
          badgeEl.className = 'text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-300';
        } else {
          badgeEl.className = 'hidden text-[10px] px-1.5 py-0.5 rounded-full font-semibold';
        }
      }
    }

    async function chooseCloneParentDirNative(event) {
      const btn = event ? event.currentTarget : null;
      await withButtonLoading(btn, '選擇中...', async () => {
        try {
          const res = await fetch('/api/projects/choose-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectOnly: true, prompt: '請選擇要 Clone 專案的存放父目錄' })
          });
          const data = await res.json().catch(() => ({}));
          if (data && data.success && data.path) {
            const parentInput = document.getElementById('cloneParentDirInput');
            if (parentInput) parentInput.value = data.path;
            updateClonePreviewFromUrl();
          }
        } catch (err) {
          showToast(`選擇父目錄失敗：${err.message || '未知錯誤'}`);
        }
      });
    }

    async function submitCloneProject(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      const repoUrl = (document.getElementById('cloneRepoUrlInput')?.value || '').trim();
      const parentDir = (document.getElementById('cloneParentDirInput')?.value || '~/projects').trim();
      const folderName = (document.getElementById('cloneFolderNameInput')?.value || '').trim();
      const branch = (document.getElementById('cloneBranchInput')?.value || '').trim();
      const requirePr = Boolean(document.getElementById('cloneRequirePrCheckbox')?.checked);
      const errBox = document.getElementById('cloneProjectErrorBox');
      const btn = document.getElementById('btnSubmitCloneProject');

      if (errBox) { errBox.classList.add('hidden'); errBox.textContent = ''; }
      if (!repoUrl) {
        if (errBox) { errBox.textContent = '請輸入 Git Repository URL'; errBox.classList.remove('hidden'); }
        return;
      }

      await withButtonLoading(btn, 'Clone 中...', async () => {
        try {
          const res = await fetch('/api/projects/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoUrl, parentDir, folderName, branch, requirePr })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || `Clone 失敗 (HTTP ${res.status})`);
          }
          closeAddProjectModal();
          showToast(`已成功 Clone 並加入專案：${data.project?.name || folderName}`);
          await loadData();
          if (data.project && data.project.id) {
            filterByProject(data.project.id);
          }
        } catch (err) {
          if (errBox) {
            errBox.textContent = err.message || 'Clone 失敗';
            errBox.classList.remove('hidden');
          }
          showToast(`Clone 失敗：${err.message || '未知錯誤'}`);
        }
      });
    }

    function openNewProjectModal() {
      document.getElementById('projectModal')?.classList.remove('hidden');
    }

    function closeProjectModal() {
      document.getElementById('projectModal')?.classList.add('hidden');
    }

    async function saveNewProject(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveProject');
      await withButtonLoading(btn, '加入中...', async () => {
        const id = document.getElementById('newProjId').value.trim();
        const name = document.getElementById('newProjName').value.trim() || id;
        const customPath = document.getElementById('newProjPath').value.trim();

        try {
          await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, path: customPath })
          });
          showToast(`已新增專案：${name}`);
          closeProjectModal();
          await loadData();
          filterByProject(id);
        } catch (err) {
          console.error('Failed to add project:', err);
          showToast(`新增專案失敗: ${err.message}`);
        }
      });
    }

    function triggerExecutionNow() {
      const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
      if (inProgressTasks.length === 0) {
        showToast('目前沒有進行中的任務，請先將卡片拖入「進行中」！');
        return;
      }

      const taskSummaries = inProgressTasks.map(t => {
        const proj = projects.find(p => p.id === t.project);
        const projText = proj ? `【${proj.name}】` : '';
        const harnessCmd = (proj && proj.harness && proj.harness.command) ? proj.harness.command : 'npm run harness:check || npm test';
        return `• [${t.id}] ${projText} ${t.title}\n  專案目錄: ${(proj && proj.path) || t.projectPath || t.project}\n  Harness 指令: ${harnessCmd}\n  需求: ${t.description || '無'}`;
      }).join('\n\n');

      const batchPrompt = `【進行中任務開工 - 3-Phase Gate】\n請依序實作以下任務（Pre-Flight 驗證 ➔ 最小範圍實作補測試 ➔ 收集全量 diff 產出 commitMessage 推入 review）：\n\n${taskSummaries}`;
      navigator.clipboard.writeText(batchPrompt);

      showToast(`已複製 ${inProgressTasks.length} 個進行中任務 Harness 派工指令！貼入對話即可立即開工。`);
    }


    function setAppTheme(mode) {
      changeTheme(mode);
      updateThemeButtons(mode);
    }

    function updateThemeButtons(mode) {
      const cur = mode || localStorage.getItem('theme') || 'system';
      ['system', 'light', 'dark'].forEach(m => {
        const btn = document.getElementById(`themeBtn${m.charAt(0).toUpperCase() + m.slice(1)}`);
        if (btn) {
          if (m === cur) {
            btn.className = 'flex flex-col items-center justify-center p-2 rounded-xl border-2 border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold transition text-[11px] gap-1 shadow-sm';
          } else {
            btn.className = 'flex flex-col items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-indigo-500 transition text-[11px] font-medium gap-1 text-slate-700 dark:text-slate-300';
          }
        }
      });
    }

    function changeTheme(mode) {
      localStorage.setItem('theme', mode);
      applyTheme(mode);
      updateThemeButtons(mode);
      showToast(`主題已切換為：${mode === 'system' ? '跟隨系統' : mode === 'dark' ? '暗黑模式' : '明亮模式'}`);
    }

    function applyTheme(mode) {
      const theme = mode || localStorage.getItem('theme') || 'system';
      const html = document.documentElement;
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      if (theme === 'dark' || (theme === 'system' && systemDark)) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }

      const selectEl = document.getElementById('settingThemeSelect');
      if (selectEl) selectEl.value = theme;
    }

    function initTheme() {
      applyTheme(localStorage.getItem('theme') || 'system');
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((localStorage.getItem('theme') || 'system') === 'system') {
          applyTheme('system');
        }
      });
    }

    function setAppFontSize(size) {
      const fontSizeToSet = size || 'small';
      localStorage.setItem('fontSize', fontSizeToSet);
      if (typeof settings !== 'undefined' && settings && typeof settings === 'object') {
        settings.fontSize = fontSizeToSet;
      }
      applyFontSize(fontSizeToSet);
      updateFontSizeButtons(fontSizeToSet);
      if (typeof fetch === 'function') {
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fontSize: fontSizeToSet })
        }).catch(() => {});
      }
      showToast(`字級大小已切換為：${fontSizeToSet === 'large' ? '大 (+4px)' : fontSizeToSet === 'medium' ? '中 (+2px)' : '小 (預設)'}`);
    }

    function updateFontSizeButtons(size) {
      const cur = size || localStorage.getItem('fontSize') || (typeof settings !== 'undefined' && settings && settings.fontSize) || 'small';
      ['small', 'medium', 'large'].forEach(s => {
        const btn = document.getElementById(`fontSizeBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
        if (btn) {
          if (s === cur) {
            btn.className = 'flex flex-col items-center justify-center p-2 rounded-xl border-2 border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold transition text-[11px] gap-1 shadow-sm';
          } else {
            btn.className = 'flex flex-col items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-indigo-500 transition text-[11px] font-medium gap-1 text-slate-700 dark:text-slate-300';
          }
        }
      });
    }

    function applyFontSize(size) {
      const fs = size || localStorage.getItem('fontSize') || (typeof settings !== 'undefined' && settings && settings.fontSize) || 'small';
      const html = document.documentElement;
      // 統一增加 2px 字級：小 16px、中 18px、大 20px
      if (fs === 'large') {
        html.style.fontSize = '20px';
      } else if (fs === 'medium') {
        html.style.fontSize = '18px';
      } else {
        html.style.fontSize = '16px';
      }
      updateFontSizeButtons(fs);
    }

    function initFontSize() {
      applyFontSize(localStorage.getItem('fontSize') || (typeof settings !== 'undefined' && settings && settings.fontSize) || 'small');
    }

    function openHelpModal() {
      const modal = document.getElementById('helpModal');
      if (modal) {
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
      }
    }

    function closeHelpModal() {
      const modal = document.getElementById('helpModal');
      if (modal) modal.classList.add('hidden');
    }


    async function restartAndReloadPage(event) {
      if (event) event.stopPropagation();
      const targetBtn = event ? event.currentTarget : null;
      await withButtonLoading(targetBtn, '重啟中...', async () => {
        showToast('正在重啟後端服務並重新整理...');

        // 優先透過 macOS 原生外殼重啟 Node 與釋放埠口
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.restartServer) {
          window.webkit.messageHandlers.restartServer.postMessage({});
          return;
        }

        // Web 瀏覽器環境發出 API 重啟指令
        try {
          await fetch('/api/server/restart', { method: 'POST' });
        } catch (_) {}

        setTimeout(() => {
          window.location.reload(true);
        }, 1200);
      });
    }

    async function fetchInspectionStatus(showNotice = false) {
      try {
        const res = await fetch('/api/inspect?t=' + Date.now(), { cache: 'no-store' });
        const data = await res.json();
        
        if (data && data.inspectedAt && showNotice) {
          showToast(`專案同步完成 (${data.inspectedAt})`);
        }
      } catch (err) {
        console.error('Inspection check failed:', err);
      }
    }

    async function triggerManualInspect() {
      await fetchInspectionStatus(true);
      await loadData();
    }

    document.getElementById('searchInput')?.addEventListener('input', renderKanban);
    document.getElementById('priorityFilter')?.addEventListener('change', renderKanban);
    document.getElementById('projectSearchInput').addEventListener('input', renderSidebarProjects);
    document.getElementById('formExecutionPlan')?.addEventListener('input', () => {
      if (typeof updateModalButtonState === 'function') updateModalButtonState();
    });

    document.addEventListener('click', (e) => {
      const container = document.getElementById('select2Container');
      const dropdown = document.getElementById('select2Dropdown');
      if (container && dropdown && !container.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
      const projInput = document.getElementById('formProjectInput');
      const projDropdownBtn = document.getElementById('formProjectDropdownBtn');
      const projClearBtn = document.getElementById('formProjectClearBtn');
      const projDropdown = document.getElementById('formProjectDropdown');
      if (
        projInput &&
        projDropdown &&
        !projInput.contains(e.target) &&
        !projDropdown.contains(e.target) &&
        !(projDropdownBtn && projDropdownBtn.contains(e.target)) &&
        !(projClearBtn && projClearBtn.contains(e.target))
      ) {
        projDropdown.classList.add('hidden');
      }
      const engineContainer = document.getElementById('engineDropdownContainer');
      const enginePopover = document.getElementById('enginePopover');
      if (engineContainer && enginePopover && !engineContainer.contains(e.target)) {
        enginePopover.classList.add('hidden');
      }
    });

    // 防止滑鼠滾輪誤觸 Select 下拉選單
    document.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('wheel', e => e.target.blur());
    });

    function initApp() {
      initTheme();
      initFontSize();
      loadData();
      initSortable();
      fetchInspectionStatus(false);
      setInterval(loadData, 3000);
      setInterval(() => fetchInspectionStatus(false), 120000);

      // SSE webhook: 監聽 CLI Agent 狀態變更事件
      const evtSource = new EventSource('/api/events');
      evtSource.addEventListener('task-update', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] task-update:', data.taskId, data.status);
        loadData(); // 即時刷新任務列表
      });
      evtSource.addEventListener('task-question', (e) => {
        let data = {};
        try { data = JSON.parse(e.data); } catch (_) {}
        console.log('[SSE] task-question:', data.taskId, data.count);
        const item = {
          task: { id: data.taskId, title: data.title || '' },
          info: {
            needsAttention: true,
            kind: 'question',
            signature: `${data.taskId}:sse:${data.count || 1}:${data.firstQuestion || ''}`,
            title: `💬 [${data.taskId}] 有 ${data.count || 1} 項問題待確認`,
            summary: `${data.title || ''} — ${data.firstQuestion || '請點擊立即回答'}`
          }
        };
        notifiedAttentionSignatures.add(item.info.signature);
        showAttentionToastForItem(item);
        notifyNativeSystemAlert(item);
        loadData(true);
      });
      evtSource.addEventListener('task-complete', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] task-complete:', data.taskId);
        showToast(`任務 ${data.taskId} CLI Agent 執行完成，已推進至 Review！`);
        loadData();
      });
      evtSource.addEventListener('task-error', (e) => {
        const data = JSON.parse(e.data);
        console.error('[SSE] task-error:', data.taskId, data.error);
        showToast(`任務 ${data.taskId} CLI Agent 執行失敗，正在重試...`);
        loadData();
      });
      evtSource.addEventListener('git-accounts-updated', (e) => {
        let data = {};
        try { data = JSON.parse(e.data); } catch (_) {}
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal && !settingsModal.classList.contains('hidden')) {
          loadGitAccountsSettings();
        }
        if (data.provider === 'github' && data.success) {
          showToast('GitHub 帳號授權完成，已自動更新連線清單！');
        }
      });
      evtSource.onerror = (err) => {
        console.error('[SSE] 連線錯誤，5秒後自動重連:', err);
      };
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initApp);
      } else {
        initApp();
      }
    }

export {
  openFirstLaunchModal,
  closeFirstLaunchModal,
  updateFirstLaunchModalUI,
  chooseFirstLaunchFolderNative,
  useFirstLaunchDefaultFolder,
  confirmFirstLaunchSetup,
  loadData,
  renderCliAgentBadge,
  selectDesktopAgentTarget,
  selectDesktopTierFilter,
  updateAiPromptDisplay,
  copyAiInspectionPrompt,
  chooseFolderNative,
  chooseConfigDirNative,
  toggleCliAgent,
  selectAutomationMode,
  toggleEnginePopover,
  openEnginePopover,
  closeEnginePopover,
  saveCliEngineSettings,
  openSettingsModal,
  closeSettingsModal,
  saveSettingsFromModal,
  loadGitAccountsSettings,
  startGithubLoginFromSettings,
  switchGithubAccountFromSettings,
  toggleAzdoPatForm,
  saveAzdoPatFromSettings,
  copyGithubDeviceCode,
  toggleSidebar,
  closeSidebar,
  toggleProjectExpand,
  filterByProject,
  deleteProject,
  renderSidebarProjects,
  initProjectHarnessFromUI,
  toggleProjectRequirePrFromUI,
  renderProjectBanner,
  openAddProjectModal,
  closeAddProjectModal,
  switchAddProjectTab,
  updateClonePreviewFromUrl,
  chooseCloneParentDirNative,
  submitCloneProject,
  openNewProjectModal,
  closeProjectModal,
  saveNewProject,
  triggerExecutionNow,
  setAppTheme,
  updateThemeButtons,
  changeTheme,
  applyTheme,
  initTheme,
  setAppFontSize,
  updateFontSizeButtons,
  applyFontSize,
  initFontSize,
  openHelpModal,
  closeHelpModal,
  restartAndReloadPage,
  fetchInspectionStatus,
  triggerManualInspect,
  loadProjectBranches,
  selectProjectAndBranch,
  renderProjectBranchTree,
  renderContextualHeaderActions,
  toggleBranchGroupView,
  openCreateBranchPopover,
  closeCreateBranchPopover,
  submitNewBranch,
  openNextPendingAttentionTask,
  openAttentionToastTask,
  dismissAttentionToast,
  openTaskFromNativeNotification
};

if (typeof window !== "undefined") {
  window.openFirstLaunchModal = openFirstLaunchModal;
  window.closeFirstLaunchModal = closeFirstLaunchModal;
  window.updateFirstLaunchModalUI = updateFirstLaunchModalUI;
  window.chooseFirstLaunchFolderNative = chooseFirstLaunchFolderNative;
  window.useFirstLaunchDefaultFolder = useFirstLaunchDefaultFolder;
  window.confirmFirstLaunchSetup = confirmFirstLaunchSetup;
  window.loadData = loadData;
  window.renderCliAgentBadge = renderCliAgentBadge;
  window.selectDesktopAgentTarget = selectDesktopAgentTarget;
  window.selectDesktopTierFilter = selectDesktopTierFilter;
  window.updateAiPromptDisplay = updateAiPromptDisplay;
  window.copyAiInspectionPrompt = copyAiInspectionPrompt;
  window.chooseFolderNative = chooseFolderNative;
  window.chooseConfigDirNative = chooseConfigDirNative;
  window.toggleCliAgent = toggleCliAgent;
  window.selectAutomationMode = selectAutomationMode;
  window.toggleEnginePopover = toggleEnginePopover;
  window.openEnginePopover = openEnginePopover;
  window.closeEnginePopover = closeEnginePopover;
  window.saveCliEngineSettings = saveCliEngineSettings;
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.saveSettingsFromModal = saveSettingsFromModal;
  window.loadGitAccountsSettings = loadGitAccountsSettings;
  window.startGithubLoginFromSettings = startGithubLoginFromSettings;
  window.switchGithubAccountFromSettings = switchGithubAccountFromSettings;
  window.toggleAzdoPatForm = toggleAzdoPatForm;
  window.saveAzdoPatFromSettings = saveAzdoPatFromSettings;
  window.copyGithubDeviceCode = copyGithubDeviceCode;
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.toggleProjectExpand = toggleProjectExpand;
  window.filterByProject = filterByProject;
  window.deleteProject = deleteProject;
  window.renderSidebarProjects = renderSidebarProjects;
  window.initProjectHarnessFromUI = initProjectHarnessFromUI;
  window.toggleProjectRequirePrFromUI = toggleProjectRequirePrFromUI;
  window.renderProjectBanner = renderProjectBanner;
  window.openAddProjectModal = openAddProjectModal;
  window.closeAddProjectModal = closeAddProjectModal;
  window.switchAddProjectTab = switchAddProjectTab;
  window.updateClonePreviewFromUrl = updateClonePreviewFromUrl;
  window.chooseCloneParentDirNative = chooseCloneParentDirNative;
  window.submitCloneProject = submitCloneProject;
  window.openNewProjectModal = openNewProjectModal;
  window.closeProjectModal = closeProjectModal;
  window.saveNewProject = saveNewProject;
  window.triggerExecutionNow = triggerExecutionNow;
  window.setAppTheme = setAppTheme;
  window.updateThemeButtons = updateThemeButtons;
  window.changeTheme = changeTheme;
  window.applyTheme = applyTheme;
  window.initTheme = initTheme;
  window.setAppFontSize = setAppFontSize;
  window.updateFontSizeButtons = updateFontSizeButtons;
  window.applyFontSize = applyFontSize;
  window.initFontSize = initFontSize;
  window.openHelpModal = openHelpModal;
  window.closeHelpModal = closeHelpModal;
  window.restartAndReloadPage = restartAndReloadPage;
  window.fetchInspectionStatus = fetchInspectionStatus;
  window.triggerManualInspect = triggerManualInspect;
  window.loadProjectBranches = loadProjectBranches;
  window.selectProjectAndBranch = selectProjectAndBranch;
  window.renderProjectBranchTree = renderProjectBranchTree;
  window.renderContextualHeaderActions = renderContextualHeaderActions;
  window.toggleBranchGroupView = toggleBranchGroupView;
  window.openCreateBranchPopover = openCreateBranchPopover;
  window.closeCreateBranchPopover = closeCreateBranchPopover;
  window.submitNewBranch = submitNewBranch;
  window.openNextPendingAttentionTask = openNextPendingAttentionTask;
  window.openAttentionToastTask = openAttentionToastTask;
  window.dismissAttentionToast = dismissAttentionToast;
  window.openTaskFromNativeNotification = openTaskFromNativeNotification;
}
