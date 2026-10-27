import { KANBAN_STATUSES } from "./constants.js";
import {
  projects, tasks, settings, projectGitStatus, currentProject, currentActiveTaskDiff,
  currentTaskDependencies, currentModalEditingTask, selectedFirstLaunchPath,
  setProjects, setTasks, setSettings, setProjectGitStatus, setCurrentProject,
  setCurrentActiveTaskDiff, setCurrentTaskDependencies, setCurrentModalEditingTask,
  setSelectedFirstLaunchPath
} from "./state.js";
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

    async function loadData() {
      try {
        const cacheBuster = '?t=' + Date.now();
        const [projRes, taskRes, setRes, gitRes] = await Promise.all([
          fetch('/api/projects' + cacheBuster, { cache: 'no-store' }),
          fetch('/api/tasks' + cacheBuster, { cache: 'no-store' }),
          fetch('/api/settings' + cacheBuster, { cache: 'no-store' }),
          fetch('/api/git/projects-status' + cacheBuster, { cache: 'no-store' }).catch(() => ({ json: () => ({}) }))
        ]);
        if (!projRes.ok || !taskRes.ok) {
          apiFailStreak++;
          renderCliAgentBadge();
          console.warn('API returned non-OK status, skipping data refresh');
          return;
        }
        apiFailStreak = 0;
        const newProjects = await projRes.json();
        const newTasks = await taskRes.json();
        const newSettings = await setRes.json();

        if (Array.isArray(newProjects) && (newProjects.length > 0 || projects.length === 0)) {
          setProjects(newProjects);
        }
        if (Array.isArray(newTasks) && (newTasks.length > 0 || tasks.length === 0)) {
          setTasks(newTasks);
        }
        if (newSettings && typeof newSettings === 'object') {
          setSettings(newSettings);
          const effectiveFontSize = newSettings.fontSize || localStorage.getItem('fontSize') || 'small';
          localStorage.setItem('fontSize', effectiveFontSize);
          applyFontSize(effectiveFontSize);
        }
        try {
          setProjectGitStatus(await gitRes.json());
        } catch (e) {
          setProjectGitStatus({});
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

        // 更新封存庫徽章數量
        const archivedCount = tasks.filter(t => t.status === 'archived').length;
        const archiveBadge = document.getElementById('headerArchiveCountBadge');
        if (archiveBadge) archiveBadge.innerText = archivedCount;

        renderSidebarProjects();
        renderProjectBanner();
        renderKanban();
        renderMetrics();

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

    function selectDesktopAgentTarget(target) {
      currentDesktopAgentTarget = target;
      const targets = ['universal', 'antigravity', 'claude', 'codex', 'copilot'];
      targets.forEach(t => {
        const btn = document.getElementById(`btnAgentTarget_${t}`);
        if (!btn) return;
        if (t === target) {
          btn.className = 'flex-1 py-1 px-1.5 rounded-md text-center transition bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-xs font-bold';
        } else {
          btn.className = 'flex-1 py-1 px-1.5 rounded-md text-center transition text-slate-600 dark:text-slate-400 hover:text-purple-600 font-medium';
        }
      });
      updateAiPromptDisplay();
    }

    function updateAiPromptDisplay() {
      const configDir = (settings.dataDirectoryPath || settings.defaultDataDir || '~/Library/Application Support/TaskDashboard').replace(/\/+$/, '');
      const gateScriptPath = `${configDir}/watch-task-gate.js`;

      let promptText = '';
      if (currentDesktopAgentTarget === 'antigravity') {
        promptText = `在背景執行指令啟動哨兵待命 (0 Token，專屬認領 Antigravity 任務)：
node "${gateScriptPath}" --agent=antigravity

【開工指示 (Reactive Wakeup)】：
1. 喚醒後依情境開工：
   • in_progress: 3-Phase Gate（優先滿足 Feedback；若勾選需確認且無執行計劃，首要任務為擬定執行計劃回寫 executionPlan 保持 in_progress 供確認；條件允許時自動啟用 Subagent [Workspace: "inherit"]：先以 flash 執行實作與測試，再以 pro 審核把關；通過後收集全量 diff，依核心主軸產出 commitMessage ({ subject, body })，回寫 tasks.json 推入 review，若有 feedback 歸入 description 並清空）。
   • requestCommitGen: 依工作區全量 diff 產出 commitMessage 寫回 tasks.json 並重置 flag。
2. 交付後（Subagent 雙階執行與審核皆完成並推入 review 後）再次背景執行上述 node 指令重新待命。`;
      } else if (currentDesktopAgentTarget === 'claude') {
        promptText = `使用 bash/execute_command 背景啟動哨兵待命 (0 Token，專屬認領 Claude 任務)：
node "${gateScriptPath}" --agent=claude

【開工指示 (Reactive Wakeup)】：
1. 喚醒後依情境開工：
   • in_progress: 優先處理 Feedback；若勾選需確認且無執行計劃，先擬定執行計劃回寫 executionPlan 保持 in_progress 供確認；條件允許時自動啟用 Subagent (Workspace: "inherit")：先用 flash 執行實作與測試、再用 pro 審核把關；收集全量 diff 產出 commitMessage ({ subject, body }) 寫回 tasks.json 推入 review (feedback 歸入 description 並清空)。
   • requestCommitGen: 依 diff 產出 commitMessage 寫回 tasks.json 並重置請求。
2. 交付後（雙階完成推入 review 後）再次背景執行上述 node 指令重新待命。`;
      } else if (currentDesktopAgentTarget === 'codex') {
        promptText = `在終端背景執行指令啟動哨兵待命 (0 Token，專屬認領 Codex 任務)：
node "${gateScriptPath}" --agent=codex

【開工指示 (Reactive Wakeup)】：
1. 喚醒後依情境開工：
   • in_progress: 優先處理 Feedback；若勾選需確認且無執行計劃，先擬定執行計劃回寫 executionPlan 保持 in_progress 供確認；條件允許時自動啟用 Subagent (Workspace: "inherit")：先用 flash 執行實作與測試、再用 pro 審核把關；收集全量 diff 產出 commitMessage 寫回 tasks.json 推入 review (feedback 歸入 description 並清空)。
   • requestCommitGen: 依 diff 產出 commitMessage 寫回 tasks.json 並重置請求。
2. 交付後（雙階完成推入 review 後）再次背景執行上述 node 指令重新待命。`;
      } else if (currentDesktopAgentTarget === 'copilot') {
        promptText = `在終端背景執行指令啟動哨兵待命 (0 Token，專屬認領 Copilot 任務)：
node "${gateScriptPath}" --agent=copilot

【開工指示 (Reactive Wakeup)】：
1. 喚醒後自主開工：
   • in_progress: 優先滿足 Feedback；若勾選需確認且無執行計劃，先擬定執行計劃回寫 executionPlan 保持 in_progress 供確認；條件允許時自動啟用 Subagent (Workspace: "inherit")：先用 flash 執行實作與測試、再用 pro 審核把關；收集全量 diff 產出 commitMessage 寫回 tasks.json 推入 review (feedback 歸入 description 並清空)。
   • requestCommitGen: 依 diff 產出 commitMessage 寫回 tasks.json 並重置請求。
2. 交付後（雙階完成推入 review 後）再次背景執行上述 node 指令重新待命。`;
      } else {
        // universal
        promptText = `在終端工具背景執行以下指令啟動哨兵待命 (0 Token，通用認領所有任務)：
node "${gateScriptPath}"

【開工指示 (Reactive Wakeup)】：
1. 喚醒後自主開工：
   • in_progress: 優先處理 Feedback；若勾選需確認且無執行計劃，先擬定執行計劃回寫 executionPlan 保持 in_progress 供確認；條件允許時自動啟用 Subagent (Workspace: "inherit")：先用 flash 執行實作與測試、再用 pro 審核把關；收集全量 diff 產出 commitMessage ({ subject, body }) 寫回 tasks.json 推入 review (feedback 歸入 description 並清空)。
   • requestCommitGen: 依 diff 產出 commitMessage 寫回 tasks.json 並重置 flag。
2. 交付後（雙階完成推入 review 後）再次背景執行上述 node 指令重新待命。`;
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
      renderSidebarProjects();
      renderProjectBanner();
      renderKanban();
      renderMetrics();
      closeSidebar();
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
        <div onclick="filterByProject('ALL')" class="p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition ${currentProject === 'ALL' ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-500/20' : 'hover:bg-slate-200/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'}">
          <div class="flex items-center gap-2">
            <i data-lucide="layout-grid" class="w-4 h-4"></i>
            <span class="text-xs"> 全部專案 (${tasks.filter(t => normalizeStatus(t.status) !== 'archived').length})</span>
          </div>
          ${currentProject === 'ALL' ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : ''}
        </div>
      `;

      projects.forEach((p, idx) => {
        if (search && !p.name.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) return;
        
        const isSelected = currentProject === p.id;
        const taskCount = tasks.filter(t => t.project === p.id && normalizeStatus(t.status) !== 'archived').length;
        const colorClass = p.color === 'purple' ? 'bg-purple-500' :
                           p.color === 'blue' ? 'bg-blue-500' :
                           p.color === 'emerald' ? 'bg-emerald-500' :
                           p.color === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';

        html += `
          <div onclick="filterByProject('${p.id}')" class="group/proj p-2 rounded-xl flex items-center justify-between cursor-pointer transition ${isSelected ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-500/20' : 'hover:bg-slate-200/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'}">
            <div class="flex items-center gap-2 truncate mr-2">
              <span class="w-2 h-2 rounded-full ${colorClass} flex-shrink-0"></span>
              <div class="truncate">
                <p class="text-xs font-medium truncate">${escapeHtml(p.name)}</p>
                <p class="text-[10px] ${isSelected ? 'text-indigo-100' : 'text-slate-400'} truncate font-mono">${escapeHtml(p.id)}</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}">${taskCount}</span>
              <button onclick="deleteProject('${p.id}', ${idx}, event)" title="取消追蹤此專案" class="opacity-0 group-hover/proj:opacity-100 p-1 text-slate-400 hover:text-rose-500 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded transition flex items-center justify-center">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
              </button>
            </div>
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
  triggerManualInspect
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
}
