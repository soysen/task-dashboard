import { KANBAN_STATUSES } from "./constants.js";
import {
  projects, tasks, archivedTasks, archivedTasksCount, settings, projectGitStatus, currentProject, currentBranch, projectBranchesMap, groupByBranch, currentActiveTaskDiff,
  currentTaskDependencies, currentModalEditingTask, selectedFirstLaunchPath,
  setProjects, setTasks, setArchivedTasks, setArchivedTasksCount, setSettings, setProjectGitStatus, setCurrentProject,
  setCurrentBranch, setProjectBranchesMap, setGroupByBranch,
  setCurrentActiveTaskDiff, setCurrentTaskDependencies, setCurrentModalEditingTask,
  setSelectedFirstLaunchPath
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

      const modeText = document.getElementById('headerEngineModeText');
      const offlineBadge = document.getElementById('headerEngineOfflineBadge');
      const engineBtn = document.getElementById('headerEngineBtn');

      if (modeText) modeText.innerText = isCli ? 'CLI' : 'Desktop AI';
      if (offlineBadge) {
        offlineBadge.classList.toggle('hidden', !isOffline);
        offlineBadge.classList.toggle('inline-flex', isOffline);
      }
      if (engineBtn) {
        engineBtn.title = isOffline
          ? '後端服務無回應，請確認伺服器是否運作 · 點擊開啟設定'
          : `自動化開工引擎設定（目前模式：${isCli ? `CLI · ${cmd}` : 'Desktop AI 哨兵'}）`;
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

    function openSettingsModal() {
      updateThemeButtons();
      updateFontSizeButtons();
      const pathDisplay = document.getElementById('settingConfigPathDisplay');
      if (pathDisplay) {
        pathDisplay.innerText = settings.dataDirectoryPath || settings.defaultDataDir || '預設專案 data 目錄';
      }
      document.getElementById('settingsModal').classList.remove('hidden');
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
        const enableAgent = !!settings.enableCliAgent;
        
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enableCliAgent: enableAgent,
              cliCommand: cliCmd,
              autoTriggerOnInProgress: autoTrigger,
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

    function filterByProject(projId) {
      setCurrentProject(projId);
      setCurrentBranch('ALL');
      renderSidebarProjects();
      renderProjectBanner();
      renderKanban();
      renderMetrics();
      closeSidebar();
      if (projId && projId !== 'ALL') {
        loadProjectBranches(projId, false).then(() => {
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
        <button type="button" onclick="filterByProject('ALL')" class="w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${currentProject === 'ALL' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold' : 'bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] font-semibold hover:border-[var(--primary)]'}">
          <span>全部專案</span>
          <span class="font-mono px-2 py-0.5 rounded-full text-[11px] ${currentProject === 'ALL' ? 'bg-black/15 text-white' : 'bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)]'}">${tasks.filter(t => normalizeStatus(t.status) !== 'archived').length}</span>
        </button>
      `;

      projects.forEach((p, idx) => {
        if (search && !p.name.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) return;
        
        const isProjOnly = currentProject === p.id && (!currentBranch || currentBranch === 'ALL');
        const taskCount = tasks.filter(t => t.project === p.id && normalizeStatus(t.status) !== 'archived').length;
        const colorClass = p.color === 'purple' ? 'bg-purple-500' :
                           p.color === 'blue' ? 'bg-blue-500' :
                           p.color === 'emerald' ? 'bg-emerald-500' :
                           p.color === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';

        html += `
          <div class="p-2 rounded-xl bg-[var(--card)] border border-[var(--border)] space-y-1">
            <div onclick="filterByProject('${p.id}')" class="group/proj px-2 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition ${isProjOnly ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold' : 'hover:bg-[var(--background)] text-[var(--foreground)] font-bold'}">
              <div class="flex items-center gap-2 truncate mr-2">
                <span class="w-2 h-2 rounded-full ${colorClass} flex-shrink-0"></span>
                <span class="text-xs truncate">${escapeHtml(p.name)}</span>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <span class="font-mono text-xs px-1.5 py-0.5 rounded ${isProjOnly ? 'bg-black/15 text-white' : 'bg-[var(--background)] text-[var(--foreground)]'}">${taskCount}</span>
                <button onclick="deleteProject('${p.id}', ${idx}, event)" title="取消追蹤此專案" class="opacity-0 group-hover/proj:opacity-100 p-0.5 text-[var(--muted-foreground)] hover:text-rose-500 rounded transition flex items-center justify-center">
                  <i data-lucide="trash-2" class="w-3 h-3 pointer-events-none"></i>
                </button>
              </div>
            </div>
            ${renderProjectBranchTree(p)}
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

    function renderProjectBanner() {
      const banner = document.getElementById('projectBanner');
      const headerTitle = document.getElementById('headerCurrentProjectName');
      const bannerPath = document.getElementById('bannerPath');
      const harnessBtn = document.getElementById('bannerHarnessBtn');

      if (currentProject === 'ALL') {
        if (banner) banner.classList.add('hidden');
        if (bannerPath) {
          bannerPath.innerText = '';
          bannerPath.title = '';
          bannerPath.classList.add('hidden');
        }
        if (harnessBtn) harnessBtn.classList.add('hidden');
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
      renderContextualHeaderActions();
      if (window.lucide) lucide.createIcons();
    }


    function openNewProjectModal() {
      document.getElementById('projectModal').classList.remove('hidden');
    }

    function closeProjectModal() {
      document.getElementById('projectModal').classList.add('hidden');
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

    document.getElementById('searchInput').addEventListener('input', renderKanban);
    document.getElementById('priorityFilter').addEventListener('change', renderKanban);
    document.getElementById('projectSearchInput').addEventListener('input', renderSidebarProjects);
    document.getElementById('formExecutionPlan')?.addEventListener('input', () => {
      if (typeof updateModalButtonState === 'function') updateModalButtonState();
    });

    document.addEventListener('click', (e) => {
      const container = document.getElementById('select2Container');
      const dropdown = document.getElementById('select2Dropdown');
      if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
      const projInput = document.getElementById('formProjectInput');
      const projDropdown = document.getElementById('formProjectDropdown');
      if (projInput && projDropdown && !projInput.contains(e.target) && !projDropdown.contains(e.target)) {
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
  toggleSidebar,
  closeSidebar,
  filterByProject,
  deleteProject,
  renderSidebarProjects,
  initProjectHarnessFromUI,
  renderProjectBanner,
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
  submitNewBranch
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
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.filterByProject = filterByProject;
  window.deleteProject = deleteProject;
  window.renderSidebarProjects = renderSidebarProjects;
  window.initProjectHarnessFromUI = initProjectHarnessFromUI;
  window.renderProjectBanner = renderProjectBanner;
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
}
