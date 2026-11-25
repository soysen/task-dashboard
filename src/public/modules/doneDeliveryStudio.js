import {
  projects,
  tasks,
  projectBranchesMap,
  isOpenedFromArchive,
  currentModalEditingTask
} from "./state.js";
import { escapeHtml, showToast, withButtonLoading, openExternalUrl } from "./utils.js";
import { loadData } from "./app.js";

let _activeDeliveryTaskId = null;
let _deliveryState = null;

function buildLocalDeliveryFallbackPolicy(task) {
  const projList = Array.isArray(projects) ? projects : [];
  const proj = projList.find(p => p && p.id === (task && task.project));
  const combinedId = [task && task.project, proj && proj.id, proj && proj.name]
    .map(v => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  const branchSnapshot = (projectBranchesMap && task && task.project && projectBranchesMap[task.project]) || {};
  const availableBranches = Array.isArray(branchSnapshot.branches)
    ? Array.from(new Set(branchSnapshot.branches.map(b => b && b.name ? String(b.name).trim() : "").filter(Boolean)))
    : [];

  const repoDefaultBranch = String(
    branchSnapshot.defaultBranch ||
    (availableBranches.includes("main") ? "main" : (availableBranches.includes("master") ? "master" : (branchSnapshot.currentCheckoutBranch || "main")))
  ).trim() || "main";

  const sourceBranch = String(
    (task && task.gitLanding && task.gitLanding.landedBranch) ||
    (task && task.branchName) ||
    (task && task.targetBranch) ||
    (task && task.baseBranch) ||
    branchSnapshot.currentCheckoutBranch ||
    repoDefaultBranch ||
    "main"
  ).trim();

  if (/(mobile[-_]?inline|digital[-_]?f2e|eservice[-_]?f2e|service-mobilecircle-inline-page|fetnet-digital-f2e|fetnet-eservice-f2e)/i.test(combinedId)) {
    const isEservice = /eservice[-_]?f2e/i.test(combinedId);
    const defaultMergeTarget = isEservice
      ? (availableBranches.includes("new_dev") ? "new_dev" : "develop")
      : "develop";
    return {
      category: "staging_merge_master_pr",
      allowMergePush: true,
      allowPrPush: true,
      defaultAction: "merge_push",
      defaultMergeTarget,
      defaultPrTarget: "master",
      archiveDefaults: { merge_push: false, pr_push: true },
      availableBranches,
      defaultSourceBranch: sourceBranch,
      sourceBranch,
      provider: ""
    };
  }

  if (/(tool-static-web|tool-static-portal)/i.test(combinedId)) {
    return {
      category: "staging_pr",
      allowMergePush: false,
      allowPrPush: true,
      defaultAction: "pr_push",
      defaultMergeTarget: "master",
      defaultPrTarget: "master",
      archiveDefaults: { merge_push: true, pr_push: true },
      availableBranches,
      defaultSourceBranch: sourceBranch,
      sourceBranch,
      provider: ""
    };
  }

  if (/(plan-to-build|task-dashboard)/i.test(combinedId)) {
    const targetMain = (availableBranches.length === 0 || availableBranches.includes("main"))
      ? "main"
      : repoDefaultBranch;
    return {
      category: "direct_merge_push",
      allowMergePush: true,
      allowPrPush: false,
      defaultAction: "merge_push",
      defaultMergeTarget: targetMain,
      defaultPrTarget: targetMain,
      archiveDefaults: { merge_push: true, pr_push: true },
      availableBranches,
      defaultSourceBranch: sourceBranch,
      sourceBranch,
      provider: ""
    };
  }

  return {
    category: "default",
    allowMergePush: true,
    allowPrPush: true,
    defaultAction: "merge_push",
    defaultMergeTarget: repoDefaultBranch,
    defaultPrTarget: repoDefaultBranch,
    archiveDefaults: { merge_push: true, pr_push: true },
    availableBranches,
    defaultSourceBranch: sourceBranch,
    sourceBranch,
    provider: ""
  };
}

function buildBranchOptionsHtml(branches, selectedBranch) {
  const list = Array.isArray(branches) ? [...branches] : [];
  const cleanSelected = String(selectedBranch || "").trim();
  if (cleanSelected && !list.includes(cleanSelected)) {
    list.push(cleanSelected);
  }
  if (list.length === 0) {
    return '<option value="">（無可用分支）</option>';
  }
  return list
    .map(b => `<option value="${escapeHtml(b)}"${b === cleanSelected ? " selected" : ""}>${escapeHtml(b)}</option>`)
    .join("");
}

function setDoneDeliveryErrorBox(message) {
  const box = document.getElementById("doneDeliveryErrorBox");
  if (!box) return;
  if (!message) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="flex items-start justify-between gap-2 text-xs text-rose-800 dark:text-rose-200">
      <div class="flex items-start gap-2 min-w-0 flex-1">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5"></i>
        <pre class="whitespace-pre-wrap break-words font-mono text-[11px] flex-1 min-w-0">${escapeHtml(message)}</pre>
      </div>
      <button type="button" onclick="document.getElementById('doneDeliveryErrorBox')?.classList.add('hidden')" class="text-rose-400 hover:text-rose-700 p-0.5 cursor-pointer">✕</button>
    </div>
  `;
  if (typeof window !== "undefined" && window.lucide) window.lucide.createIcons();
}

function renderDoneDeliveryPanel() {
  const panel = document.getElementById("doneDeliveryStudioPanel");
  if (!panel || !_deliveryState) return;

  const {
    task,
    policy,
    mode,
    sourceBranch,
    targetBranch,
    strategy,
    deleteSourceBranch,
    archiveAfter,
    optionsExpanded,
    loadingOptions
  } = _deliveryState;

  const branches = Array.isArray(policy.availableBranches) ? policy.availableBranches : [];
  const allowMerge = policy.allowMergePush !== false;
  const allowPr = policy.allowPrPush !== false;
  const showModeToggle = allowMerge && allowPr;
  const isMergeMode = mode === "merge_push";
  const showMergeOptions = isMergeMode && sourceBranch && targetBranch && sourceBranch !== targetBranch;
  const existingPrUrl = String((task && ((task.gitLanding && task.gitLanding.prUrl) || task.prUrl)) || "").trim();
  const isPushed = Boolean(task && task.gitLanding && task.gitLanding.pushedRemote);

  let modeControlHtml = "";
  if (showModeToggle) {
    const mergeActiveCls = isMergeMode
      ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-xs font-bold"
      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium";
    const prActiveCls = !isMergeMode
      ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs font-bold"
      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium";
    modeControlHtml = `
      <div class="inline-flex items-center p-0.5 rounded-lg bg-slate-200/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
        <button type="button" id="btnDoneDeliveryModeMergePush" onclick="selectDoneDeliveryMode('merge_push')" class="px-2.5 py-1 rounded-md transition cursor-pointer ${mergeActiveCls}">合併並 Push</button>
        <button type="button" id="btnDoneDeliveryModePrPush" onclick="selectDoneDeliveryMode('pr_push')" class="px-2.5 py-1 rounded-md transition cursor-pointer ${prActiveCls}">Push 並開 PR</button>
      </div>
    `;
  } else if (policy.category === "staging_pr" || (!allowMerge && allowPr)) {
    modeControlHtml = `
      <span id="doneDeliveryModeBadge" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
        <i data-lucide="git-pull-request" class="w-3.5 h-3.5"></i>
        <span>Push 並開 PR</span>
      </span>
    `;
  } else {
    modeControlHtml = `
      <span id="doneDeliveryModeBadge" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
        <i data-lucide="git-merge" class="w-3.5 h-3.5"></i>
        <span>合併回主幹並 Push</span>
      </span>
    `;
  }

  const submitLabel = isMergeMode
    ? (sourceBranch && targetBranch && sourceBranch === targetBranch ? `Push ⎇ ${escapeHtml(targetBranch)}` : `合併並 Push 至 ⎇ ${escapeHtml(targetBranch)}`)
    : `Push 並開啟 PR (→ ${escapeHtml(targetBranch)})`;

  panel.innerHTML = `
    <div class="border-t border-slate-200 dark:border-slate-700 bg-sky-50/50 dark:bg-slate-900/95 px-5 py-3 space-y-2.5 flex-shrink-0">
      <div id="doneDeliveryErrorBox" class="hidden rounded-xl p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60"></div>

      <div id="doneDeliveryOptionsDrawer" class="${optionsExpanded ? "" : "hidden "}rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 flex flex-wrap items-center gap-4 text-xs">
        <div id="doneDeliveryStrategyWrapper" class="${showMergeOptions ? "flex" : "hidden"} items-center gap-2">
          <label for="doneDeliveryStrategy" class="text-slate-600 dark:text-slate-300 font-medium">合併策略</label>
          <select id="doneDeliveryStrategy" onchange="onDoneDeliveryBranchChange()" class="h-7 px-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100">
            <option value="merge"${strategy === "merge" ? " selected" : ""}>Merge (--no-ff)</option>
            <option value="squash"${strategy === "squash" ? " selected" : ""}>Squash</option>
            <option value="rebase"${strategy === "rebase" ? " selected" : ""}>Rebase</option>
          </select>
        </div>
        <label id="doneDeliveryDeleteSourceWrapper" class="${showMergeOptions ? "inline-flex" : "hidden"} items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" id="doneDeliveryDeleteSource"${deleteSourceBranch ? " checked" : ""} onchange="onDoneDeliveryBranchChange()" class="rounded border-slate-300 text-sky-600 w-3.5 h-3.5 cursor-pointer">
          <span>合併後刪除本地來源分支</span>
        </label>
        <span class="text-[11px] text-slate-400">
          ${loadingOptions ? "正在同步遠端分支策略..." : `專案交付策略：${escapeHtml(policy.category || "default")}`}
        </span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2 min-w-0">
          ${modeControlHtml}
          <div class="flex items-center gap-1.5 text-xs">
            <span class="text-slate-500 dark:text-slate-400 font-medium">來源</span>
            <select id="doneDeliverySourceBranch" onchange="onDoneDeliveryBranchChange()" class="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 max-w-[170px]">
              ${buildBranchOptionsHtml(branches, sourceBranch)}
            </select>
            <span class="text-slate-400 font-bold">→</span>
            <span class="text-slate-500 dark:text-slate-400 font-medium">目標</span>
            <select id="doneDeliveryTargetBranch" onchange="onDoneDeliveryBranchChange()" class="h-8 px-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 max-w-[170px]">
              ${buildBranchOptionsHtml(branches, targetBranch)}
            </select>
          </div>
          <button type="button" id="btnToggleDoneDeliveryOptions" onclick="toggleDoneDeliveryOptions()" class="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition cursor-pointer">
            ${optionsExpanded ? "收合進階 ▾" : "進階選項 ▴"}
          </button>
          ${isPushed ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">已推遠端</span>' : ""}
        </div>

        <div class="flex flex-wrap items-center gap-2.5 ml-auto">
          <label class="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" id="doneDeliveryArchiveAfter"${archiveAfter ? " checked" : ""} onchange="onDoneDeliveryBranchChange()" class="rounded border-slate-300 text-sky-600 w-3.5 h-3.5 cursor-pointer">
            <span>交付後自動封存</span>
          </label>
          ${existingPrUrl ? `
            <button type="button" id="btnDoneDeliveryOpenExistingPr" onclick="openExternalUrl('${escapeHtml(existingPrUrl)}', event)" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 transition cursor-pointer flex items-center gap-1">
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
              <span>開啟已建立 PR</span>
            </button>
          ` : ""}
          <button type="button" id="btnDoneDeliverSubmit" onclick="submitDoneDelivery(event)" class="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--primary)] hover:opacity-95 text-[var(--primary-foreground)] shadow-sm transition cursor-pointer flex items-center gap-1.5">
            <i data-lucide="${isMergeMode ? "upload-cloud" : "git-pull-request"}" class="w-3.5 h-3.5"></i>
            <span>${submitLabel}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  if (typeof window !== "undefined" && window.lucide) window.lucide.createIcons();
}

function initDoneDeliveryPanel(task) {
  const panel = document.getElementById("doneDeliveryStudioPanel");
  if (!panel) return;

  const specPaneVisible = Boolean(
    typeof document !== "undefined" &&
    document.getElementById("modalSpecPane") &&
    !document.getElementById("modalSpecPane").classList.contains("hidden")
  );
  const isDoneDeliverable = Boolean(task && task.status === "done" && !isOpenedFromArchive && !specPaneVisible);

  if (!isDoneDeliverable) {
    if (!task || task.status !== "done" || isOpenedFromArchive) {
      _activeDeliveryTaskId = null;
      _deliveryState = null;
      panel.innerHTML = "";
    }
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const isSameTask = _activeDeliveryTaskId === task.id && _deliveryState && panel.innerHTML.trim().length > 0;
  if (isSameTask) {
    _deliveryState.task = task;
    return;
  }

  _activeDeliveryTaskId = task.id;
  const fallback = buildLocalDeliveryFallbackPolicy(task);
  const initialMode = fallback.defaultAction || "merge_push";
  const initialTarget = initialMode === "pr_push" ? fallback.defaultPrTarget : fallback.defaultMergeTarget;
  const initialArchive = Boolean(fallback.archiveDefaults && fallback.archiveDefaults[initialMode]);

  _deliveryState = {
    task,
    policy: fallback,
    mode: initialMode,
    sourceBranch: fallback.sourceBranch,
    targetBranch: initialTarget,
    strategy: "merge",
    deleteSourceBranch: false,
    archiveAfter: initialArchive,
    optionsExpanded: false,
    loadingOptions: true,
    userModified: false
  };

  renderDoneDeliveryPanel();

  if (typeof fetch === "function") {
    fetch(`/api/tasks/${encodeURIComponent(task.id)}/delivery-options`)
      .then(res => (res && res.ok ? res.json() : null))
      .then(data => {
        if (!data || !data.success || _activeDeliveryTaskId !== task.id || !_deliveryState) return;
        _deliveryState.policy = data;
        _deliveryState.loadingOptions = false;
        if (data.gitLanding) {
          _deliveryState.task = { ..._deliveryState.task, gitLanding: data.gitLanding };
        }
        if (!_deliveryState.userModified) {
          const nextMode = data.defaultAction || _deliveryState.mode;
          _deliveryState.mode = nextMode;
          _deliveryState.sourceBranch = data.sourceBranch || _deliveryState.sourceBranch;
          _deliveryState.targetBranch = nextMode === "pr_push"
            ? (data.defaultPrTarget || _deliveryState.targetBranch)
            : (data.defaultMergeTarget || _deliveryState.targetBranch);
          _deliveryState.archiveAfter = Boolean(data.archiveDefaults && data.archiveDefaults[nextMode]);
        }
        renderDoneDeliveryPanel();
      })
      .catch(() => {
        if (_activeDeliveryTaskId === task.id && _deliveryState) {
          _deliveryState.loadingOptions = false;
          renderDoneDeliveryPanel();
        }
      });
  }
}

function selectDoneDeliveryMode(mode) {
  if (!_deliveryState) return;
  const nextMode = mode === "pr_push" ? "pr_push" : "merge_push";
  const policy = _deliveryState.policy || {};
  if (nextMode === "merge_push" && policy.allowMergePush === false) return;
  if (nextMode === "pr_push" && policy.allowPrPush === false) return;

  _deliveryState.userModified = true;
  _deliveryState.mode = nextMode;
  _deliveryState.targetBranch = nextMode === "pr_push"
    ? (policy.defaultPrTarget || _deliveryState.targetBranch)
    : (policy.defaultMergeTarget || _deliveryState.targetBranch);
  _deliveryState.archiveAfter = Boolean(policy.archiveDefaults && policy.archiveDefaults[nextMode]);
  renderDoneDeliveryPanel();
}

function toggleDoneDeliveryOptions(forceState) {
  if (!_deliveryState) return;
  _deliveryState.optionsExpanded = typeof forceState === "boolean" ? forceState : !_deliveryState.optionsExpanded;
  const drawer = document.getElementById("doneDeliveryOptionsDrawer");
  const btn = document.getElementById("btnToggleDoneDeliveryOptions");
  if (drawer) drawer.classList.toggle("hidden", !_deliveryState.optionsExpanded);
  if (btn) btn.textContent = _deliveryState.optionsExpanded ? "收合進階 ▾" : "進階選項 ▴";
}

function onDoneDeliveryBranchChange() {
  if (!_deliveryState) return;
  _deliveryState.userModified = true;
  const srcEl = document.getElementById("doneDeliverySourceBranch");
  const tgtEl = document.getElementById("doneDeliveryTargetBranch");
  const stratEl = document.getElementById("doneDeliveryStrategy");
  const delEl = document.getElementById("doneDeliveryDeleteSource");
  const archEl = document.getElementById("doneDeliveryArchiveAfter");

  if (srcEl) _deliveryState.sourceBranch = srcEl.value;
  if (tgtEl) _deliveryState.targetBranch = tgtEl.value;
  if (stratEl) _deliveryState.strategy = stratEl.value;
  if (delEl) _deliveryState.deleteSourceBranch = Boolean(delEl.checked);
  if (archEl) _deliveryState.archiveAfter = Boolean(archEl.checked);

  renderDoneDeliveryPanel();
}

async function submitDoneDelivery(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  const taskId = _activeDeliveryTaskId || document.getElementById("formTaskId")?.value || "";
  if (!taskId || !_deliveryState) return;

  const mode = _deliveryState.mode || "merge_push";
  const sourceBranch = String(document.getElementById("doneDeliverySourceBranch")?.value || _deliveryState.sourceBranch || "").trim();
  const targetBranch = String(document.getElementById("doneDeliveryTargetBranch")?.value || _deliveryState.targetBranch || "").trim();
  const strategy = String(document.getElementById("doneDeliveryStrategy")?.value || _deliveryState.strategy || "merge").trim();
  const deleteSourceBranch = Boolean(document.getElementById("doneDeliveryDeleteSource")?.checked);
  const archiveAfter = Boolean(document.getElementById("doneDeliveryArchiveAfter")?.checked);

  if (!sourceBranch || !targetBranch) {
    setDoneDeliveryErrorBox("請先選擇來源分支與目標分支");
    return;
  }

  setDoneDeliveryErrorBox("");
  const submitBtn = document.getElementById("btnDoneDeliverSubmit");
  const loadingText = mode === "pr_push" ? "推送並開 PR 中..." : "合併並推送中...";

  await withButtonLoading(submitBtn, loadingText, async () => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          sourceBranch,
          targetBranch,
          strategy,
          deleteSourceBranch,
          archiveAfter
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const errMsg = data.error || data.message || `交付失敗 (HTTP ${res.status})`;
        setDoneDeliveryErrorBox(errMsg);
        showToast(`交付失敗：${errMsg}`);
        return;
      }

      if (data.prUrl) {
        openExternalUrl(data.prUrl);
      }

      const successMsg = mode === "pr_push"
        ? `已推送 ${sourceBranch} 並開啟 PR 頁面！`
        : `已合併並推送至 ${targetBranch}！`;
      showToast(successMsg);

      if (data.archived) {
        if (typeof window !== "undefined" && typeof window.closeModal === "function") {
          window.closeModal();
        }
      } else if (_deliveryState) {
        _deliveryState.task = data.task || {
          ...(_deliveryState.task || {}),
          gitLanding: {
            ...((_deliveryState.task && _deliveryState.task.gitLanding) || {}),
            pushedRemote: true,
            prUrl: data.prUrl || ""
          },
          prUrl: data.prUrl || (_deliveryState.task && _deliveryState.task.prUrl) || ""
        };
        renderDoneDeliveryPanel();
      }

      if (typeof loadData === "function") {
        await loadData();
      }
    } catch (err) {
      const errMsg = (err && err.message) || "網路或伺服器錯誤";
      setDoneDeliveryErrorBox(errMsg);
      showToast(`交付失敗：${errMsg}`);
    }
  });
}

export {
  initDoneDeliveryPanel,
  selectDoneDeliveryMode,
  submitDoneDelivery,
  toggleDoneDeliveryOptions,
  onDoneDeliveryBranchChange,
  buildLocalDeliveryFallbackPolicy
};

if (typeof window !== "undefined") {
  window.initDoneDeliveryPanel = initDoneDeliveryPanel;
  window.selectDoneDeliveryMode = selectDoneDeliveryMode;
  window.submitDoneDelivery = submitDoneDelivery;
  window.toggleDoneDeliveryOptions = toggleDoneDeliveryOptions;
  window.onDoneDeliveryBranchChange = onDoneDeliveryBranchChange;
}
