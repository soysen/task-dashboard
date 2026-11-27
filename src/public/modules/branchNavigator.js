import {
  projects, tasks, currentProject, currentBranch, projectBranchesMap, groupByBranch, expandedProjectId,
  setCurrentProject, setCurrentBranch, setProjectBranchesMap, setGroupByBranch, setExpandedProjectId
} from "./state.js";
import { escapeHtml, showToast, openExternalUrl } from "./utils.js";

const loadingBranchProjects = new Set();
const loadingRemoteStatusKeys = new Set();
let branchRemoteStatusMap = {};
let popoverTargetProjectId = "";
let _gitSyncModalState = null;
let _lastPrConflictState = null;

async function loadBranchRemoteStatus(projectId, branchName, forceRefresh = false) {
  if (!projectId || projectId === "ALL" || !branchName || branchName === "ALL" || typeof fetch !== "function") {
    return null;
  }
  const key = `${projectId}::${branchName}`;
  if (!forceRefresh && branchRemoteStatusMap[key]) {
    return branchRemoteStatusMap[key];
  }
  if (loadingRemoteStatusKeys.has(key)) return null;

  loadingRemoteStatusKeys.add(key);
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/remote-status?branch=${encodeURIComponent(branchName)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    branchRemoteStatusMap[key] = data;
    renderContextualHeaderActions();
    return data;
  } catch (err) {
    console.warn("loadBranchRemoteStatus failed:", err);
    return null;
  } finally {
    loadingRemoteStatusKeys.delete(key);
  }
}

function escapeAttrJs(value) {
  return escapeHtml(
    String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ")
  );
}

async function loadProjectBranches(projectId, forceRefresh = false) {
  if (!projectId || projectId === "ALL") return null;
  loadingBranchProjects.add(projectId);
  try {
    const query = forceRefresh ? "?refresh=1" : "";
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches${query}`);
    if (!res.ok) return null;
    const data = await res.json();
    setProjectBranchesMap({ ...projectBranchesMap, [projectId]: data });
    return data;
  } catch (err) {
    console.warn("loadProjectBranches failed:", err);
    return null;
  } finally {
    loadingBranchProjects.delete(projectId);
  }
}

function selectProjectAndBranch(projectId, branchName = "ALL", event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  const targetProject = projectId || "ALL";
  const targetBranch = targetProject === "ALL" ? "ALL" : (branchName || "ALL");

  setCurrentProject(targetProject);
  setCurrentBranch(targetBranch);
  setExpandedProjectId(targetProject === "ALL" ? null : targetProject);
  if (targetBranch !== "ALL" && groupByBranch) {
    setGroupByBranch(false);
  }

  if (typeof window !== "undefined") {
    window.renderSidebarProjects?.();
    window.renderProjectBanner?.();
    renderContextualHeaderActions();
    window.renderKanban?.();
    window.renderMetrics?.();
    window.closeSidebar?.();
  }

  if (targetProject !== "ALL" && !projectBranchesMap[targetProject]) {
    loadProjectBranches(targetProject, false).then(() => {
      if (typeof window !== "undefined") {
        window.renderSidebarProjects?.();
        renderContextualHeaderActions();
      }
    });
  }
}

function renderProjectBranchTree(project) {
  if (!project || !project.id) return "";
  const data = projectBranchesMap[project.id];
  const safeProjAttr = escapeAttrJs(project.id);

  if (!data) {
    if (!loadingBranchProjects.has(project.id)) {
      loadProjectBranches(project.id, false).then(() => {
        if (typeof window !== "undefined") {
          window.renderSidebarProjects?.();
          renderContextualHeaderActions();
        }
      });
    }
    return `<div class="pt-0.5 border-t border-slate-200/80 dark:border-slate-700/70 text-[10px] text-slate-400 px-1 py-0.5">載入分支中...</div>`;
  }

  if (!data.isGitRepo) {
    return `<div class="pt-0.5 border-t border-slate-200/80 dark:border-slate-700/70 text-[10px] text-slate-400 px-1 py-0.5">非 Git 資料夾</div>`;
  }

  const branches = Array.isArray(data.branches) ? data.branches : [];
  const defaultFrom = escapeAttrJs(data.defaultBranch || data.currentCheckoutBranch || "main");
  const projTasks = (tasks || []).filter(t => t.project === project.id && t.status !== "archived");

  let html = `<div class="ml-2 pl-1.5 pt-0.5 space-y-0.5 border-l border-[var(--border)]">`;
  branches.forEach(b => {
    const isActive = currentProject === project.id && currentBranch === b.name;
    const safeBranchAttr = escapeAttrJs(b.name);
    const bCount = projTasks.filter(t => (t.targetBranch || t.baseBranch || data.defaultBranch || "") === b.name).length;
    const isDirtyHead = Boolean(b.isCurrentCheckout && data.isMainWorkspaceDirty);
    html += `
      <button type="button" onclick="selectProjectAndBranch('${safeProjAttr}', '${safeBranchAttr}', event)" class="w-full text-left pl-1.5 pr-1.5 py-0.5 rounded-md text-[10.5px] leading-snug flex items-center justify-between gap-1 transition cursor-pointer ${isActive ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold" : "font-normal text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"}">
        <span class="font-mono truncate flex items-center gap-1 min-w-0">
          <span>${b.isCurrentCheckout ? "●" : "⎇"}</span>
          <span class="truncate">${escapeHtml(b.name)}</span>
          ${isDirtyHead ? `<span class="px-1 rounded border text-[9px] font-sans flex-shrink-0 ${isActive ? "border-amber-200 text-amber-100" : "border-[var(--warning)] text-[var(--warning)]"}">未提交</span>` : ""}
        </span>
        <span class="font-mono text-[10px] flex-shrink-0">${bCount}</span>
      </button>
    `;
  });
  html += `
    <div class="pt-0.5 flex justify-end">
      <button type="button" onclick="openCreateBranchPopover('${safeProjAttr}', '${defaultFrom}', event)" class="text-[10px] font-medium px-1 py-0.5 rounded text-[var(--link)] hover:underline transition cursor-pointer">
        ＋ 新建分支
      </button>
    </div>
  </div>`;
  return html;
}

function renderContextualHeaderActions() {
  if (typeof document === "undefined") return;
  const headerTitle = document.getElementById("headerCurrentProjectName");
  const bannerPath = document.getElementById("bannerPath");
  const proj = currentProject !== "ALL" ? projects.find(p => p.id === currentProject) : null;
  const projName = proj ? proj.name : currentProject;
  const branchData = currentProject !== "ALL" ? projectBranchesMap[currentProject] : null;

  if (headerTitle) {
    if (currentProject === "ALL") {
      headerTitle.innerText = "全部專案";
    } else if (currentBranch && currentBranch !== "ALL") {
      headerTitle.innerHTML = `<button type="button" onclick="selectProjectAndBranch('${escapeAttrJs(currentProject)}', 'ALL', event)" class="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold cursor-pointer">${escapeHtml(projName)}</button> <span class="text-slate-400 mx-0.5">/</span> <span class="font-mono">⎇ ${escapeHtml(currentBranch)}</span>`;
    } else {
      headerTitle.innerText = projName;
    }
  }

  if (bannerPath) {
    if (currentProject === "ALL") {
      bannerPath.innerText = `共 ${projects.length} 個專案`;
      bannerPath.classList.remove("hidden");
    } else if (branchData && branchData.isGitRepo && (!currentBranch || currentBranch === "ALL")) {
      const dirtySuffix = branchData.isMainWorkspaceDirty ? ` · ${branchData.dirtyFilesCount || 1} 個檔案未提交` : "";
      bannerPath.innerText = `目前資料夾：⎇ ${branchData.currentCheckoutBranch || branchData.defaultBranch || "main"}${dirtySuffix}`;
      bannerPath.classList.remove("hidden");
    } else if (proj) {
      bannerPath.innerText = proj.path || "";
      bannerPath.classList.toggle("hidden", !proj.path);
    }
  }

  const container = document.getElementById("contextualHeaderActions");
  const boardViewSlot = document.getElementById("boardViewToggleSlot");
  if (!container && !boardViewSlot) return;

  const modalEl = document.getElementById("taskModal");
  const mergeModalEl = document.getElementById("mergeBranchModal");
  const prModalEl = document.getElementById("createPrModal");
  if (
    (modalEl && !modalEl.classList.contains("hidden")) ||
    (mergeModalEl && !mergeModalEl.classList.contains("hidden")) ||
    (prModalEl && !prModalEl.classList.contains("hidden"))
  ) {
    if (container) {
      container.innerHTML = "";
      container.classList.add("hidden");
    }
    if (boardViewSlot) {
      boardViewSlot.innerHTML = "";
      boardViewSlot.classList.add("hidden");
    }
    return;
  }

  if (boardViewSlot) {
    if (currentProject !== "ALL") {
      boardViewSlot.classList.remove("hidden");
      boardViewSlot.innerHTML = `
        <div class="inline-flex items-center p-0.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs">
          <button type="button" onclick="toggleBranchGroupView(false)" class="px-2.5 py-1 rounded-md transition cursor-pointer ${!groupByBranch ? "bg-[var(--card)] font-bold text-[var(--foreground)] shadow-xs" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}">看板</button>
          <button type="button" onclick="toggleBranchGroupView(true)" class="px-2.5 py-1 rounded-md transition cursor-pointer ${groupByBranch ? "bg-[var(--card)] font-bold text-[var(--foreground)] shadow-xs" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}">按分支看</button>
        </div>
      `;
    } else {
      boardViewSlot.innerHTML = "";
      boardViewSlot.classList.add("hidden");
    }
  }

  if (container) {
    if (currentProject !== "ALL" && currentBranch && currentBranch !== "ALL") {
      // L2 單一分支：依序提供「推送」、「開立 PR」與「合併回 <defaultBranch>」動作
      const safeProjAttr = escapeAttrJs(currentProject);
      const safeBranchAttr = escapeAttrJs(currentBranch);
      const defaultBranch = String(branchData?.defaultBranch || "main").trim();
      const isNonDefaultBranch = Boolean(currentBranch && defaultBranch && currentBranch !== defaultBranch);
      const hasCommittedDoneOnBranch = isNonDefaultBranch && (tasks || []).some(t =>
        t.project === currentProject &&
        t.status === "done" &&
        (Boolean(t.gitLanding && t.gitLanding.isCommitted) || Boolean(t.gitLanding?.commitSha)) &&
        (t.targetBranch === currentBranch || t.gitLanding?.landedBranch === currentBranch || t.baseBranch === currentBranch)
      );
      const safeDefaultAttr = escapeAttrJs(defaultBranch);
      const remoteKey = `${currentProject}::${currentBranch}`;
      const requirePr = Boolean(proj && proj.requirePr);

      if (branchData?.isGitRepo && !branchRemoteStatusMap[remoteKey]) {
        loadBranchRemoteStatus(currentProject, currentBranch);
      }
      const remoteInfo = branchRemoteStatusMap[remoteKey];
      const actionButtons = [];

      if (branchData?.isGitRepo && (!remoteInfo || remoteInfo.hasRemote !== false)) {
        const behindCount = Number(remoteInfo?.behind || 0);
        const pullLabel = behindCount > 0 ? `拉取 ↓${behindCount}` : "拉取";
        const pullCls = behindCount > 0
          ? "h-7 sm:h-8 inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap"
          : "h-7 sm:h-8 inline-flex items-center gap-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg border border-slate-300/70 dark:border-slate-700 transition cursor-pointer whitespace-nowrap";
        actionButtons.push(
          `<button type="button" onclick="pullCurrentBranch('${safeProjAttr}', '${safeBranchAttr}', event)" title="從遠端 Fetch 並拉取分支 ${escapeHtml(currentBranch)} 最新進度" class="${pullCls}">${escapeHtml(pullLabel)}</button>`
        );

        if (isNonDefaultBranch) {
          actionButtons.push(
            `<button type="button" onclick="openSyncBaseModal('${safeProjAttr}', '${safeBranchAttr}', '${safeDefaultAttr}', event)" title="將 ${escapeHtml(defaultBranch)} 最新進度同步合併至此分支 (支援 Merge / Rebase)" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg border border-slate-300/70 dark:border-slate-700 transition cursor-pointer whitespace-nowrap">同步 ${escapeHtml(defaultBranch)}</button>`
          );
        }

        const pushLabel = remoteInfo && remoteInfo.ahead > 0
          ? `推送 ↑${remoteInfo.ahead}`
          : (remoteInfo && !remoteInfo.hasUpstream ? "推送 ↑" : "推送");
        actionButtons.push(
          `<button type="button" onclick="pushCurrentBranch('${safeProjAttr}', '${safeBranchAttr}', event)" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">${escapeHtml(pushLabel)}</button>`
        );
      }

      if (branchData?.isGitRepo && isNonDefaultBranch) {
        const prBtnLabel = requirePr ? "推送並開立 PR" : "開立 PR";
        actionButtons.push(
          `<button type="button" onclick="openCreatePrModal('${safeProjAttr}', '${safeBranchAttr}', '${safeDefaultAttr}')" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">${escapeHtml(prBtnLabel)}</button>`
        );
      }

      if (hasCommittedDoneOnBranch && !requirePr) {
        actionButtons.push(
          `<button type="button" onclick="openMergeBranchModal('${safeProjAttr}', '${safeBranchAttr}', '${safeDefaultAttr}')" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">合併回 ${escapeHtml(defaultBranch)}</button>`
        );
      }

      if (actionButtons.length > 0) {
        container.classList.remove("hidden");
        container.innerHTML = `<div class="flex items-center gap-1.5">${actionButtons.join("")}</div>`;
      } else {
        container.innerHTML = "";
        container.classList.add("hidden");
      }
    } else {
      container.innerHTML = "";
      container.classList.add("hidden");
    }
  }
  if (window.lucide) lucide.createIcons();
}

function toggleBranchGroupView(enabled) {
  const nextEnabled = typeof enabled === "boolean" ? enabled : !groupByBranch;
  setGroupByBranch(nextEnabled);
  if (nextEnabled && currentBranch && currentBranch !== "ALL") {
    setCurrentBranch("ALL");
  }
  renderContextualHeaderActions();
  if (typeof window !== "undefined") {
    window.renderSidebarProjects?.();
    window.renderKanban?.();
    window.renderMetrics?.();
  }
}

function ensureCreateBranchPopoverEl() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("createBranchPopover");
  if (el) return el;

  el = document.createElement("div");
  el.id = "createBranchPopover";
  el.className = "hidden fixed inset-0 z-[95] bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4";
  el.innerHTML = `
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-4 space-y-3 text-slate-800 dark:text-slate-100" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-slate-900 dark:text-white">＋ 新建分支</h3>
        <button type="button" onclick="closeCreateBranchPopover()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer">✕</button>
      </div>
      <p class="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2">
        直接從 <span id="popoverFromBranchLabel" class="font-mono font-semibold text-indigo-600 dark:text-indigo-300">main</span> 開新分支，不會影響目前修改中的檔案
      </p>
      <div class="space-y-2.5">
        <div>
          <label class="block text-xs font-semibold mb-1">來源分支</label>
          <select id="popoverFromBranchSelect" onchange="document.getElementById('popoverFromBranchLabel').innerText = this.value || 'main'" class="w-full h-9 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 text-xs font-mono focus:outline-none"></select>
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1">新分支名稱</label>
          <input id="popoverNewBranchInput" type="text" placeholder="例如：feat/new-feature" onkeydown="if(event.key==='Enter'){event.preventDefault();submitNewBranch(event);}" class="w-full h-9 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-indigo-500">
        </div>
        <div id="popoverCreateBranchError" class="hidden text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg px-2.5 py-1.5"></div>
      </div>
      <div class="flex items-center justify-end gap-2 pt-1">
        <button type="button" onclick="closeCreateBranchPopover()" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">取消</button>
        <button type="button" id="popoverSubmitBranchBtn" onclick="submitNewBranch(event)" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer">建立分支</button>
      </div>
    </div>
  `;
  el.addEventListener("click", closeCreateBranchPopover);
  document.body.appendChild(el);
  return el;
}

function closeCreateBranchPopover() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("createBranchPopover");
  if (el) el.classList.add("hidden");
}

async function openCreateBranchPopover(projectId, fromBranch = "", event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  const targetProjId = projectId || (currentProject !== "ALL" ? currentProject : "");
  if (!targetProjId) {
    showToast("請先選擇一個專案");
    return;
  }
  popoverTargetProjectId = targetProjId;
  const el = ensureCreateBranchPopoverEl();
  if (!el) return;

  let branchData = projectBranchesMap[targetProjId];
  if (!branchData) branchData = await loadProjectBranches(targetProjId, false);

  const selectEl = document.getElementById("popoverFromBranchSelect");
  const labelEl = document.getElementById("popoverFromBranchLabel");
  const inputEl = document.getElementById("popoverNewBranchInput");
  const errEl = document.getElementById("popoverCreateBranchError");

  if (errEl) { errEl.classList.add("hidden"); errEl.innerText = ""; }
  if (inputEl) inputEl.value = "";

  const branches = (branchData && Array.isArray(branchData.branches)) ? branchData.branches : [];
  const defaultFrom = fromBranch || branchData?.defaultBranch || branchData?.currentCheckoutBranch || "main";
  if (selectEl) {
    const names = branches.map(b => b.name);
    if (defaultFrom && !names.includes(defaultFrom)) names.unshift(defaultFrom);
    selectEl.innerHTML = names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    selectEl.value = defaultFrom;
  }
  if (labelEl) labelEl.innerText = (selectEl && selectEl.value) || defaultFrom || "main";

  el.classList.remove("hidden");
  setTimeout(() => inputEl?.focus(), 20);
}

async function submitNewBranch(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  if (!popoverTargetProjectId) return;

  const inputEl = document.getElementById("popoverNewBranchInput");
  const selectEl = document.getElementById("popoverFromBranchSelect");
  const errEl = document.getElementById("popoverCreateBranchError");
  const btnEl = document.getElementById("popoverSubmitBranchBtn");
  const branchName = (inputEl?.value || "").trim();
  const fromBranch = (selectEl?.value || "").trim();

  if (!branchName) {
    if (errEl) { errEl.innerText = "請輸入新分支名稱"; errEl.classList.remove("hidden"); }
    return;
  }
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(popoverTargetProjectId)}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchName, fromBranch })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "建立分支失敗");
    if (data.branchInfo) {
      setProjectBranchesMap({ ...projectBranchesMap, [popoverTargetProjectId]: data.branchInfo });
    } else {
      await loadProjectBranches(popoverTargetProjectId, true);
    }
    closeCreateBranchPopover();
    selectProjectAndBranch(popoverTargetProjectId, data.branch || branchName);
    showToast(`已從 ${data.fromBranch || fromBranch || "main"} 建立分支 ${data.branch || branchName}`);
  } catch (err) {
    if (errEl) { errEl.innerText = err.message || "建立分支失敗"; errEl.classList.remove("hidden"); }
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

function closeMergeBranchModal() {
  const modal = document.getElementById("mergeBranchModal");
  if (modal) modal.remove();
}

function openMergeBranchModal(projectId, sourceBranch, targetBranch) {
  if (typeof document === "undefined") return;
  closeMergeBranchModal();

  const branchData = projectBranchesMap[projectId];
  const src = String(sourceBranch || currentBranch || "").trim();
  const tgt = String(targetBranch || branchData?.defaultBranch || "main").trim();
  if (!projectId || !src || !tgt) return;

  const safeProjAttr = escapeAttrJs(projectId);
  const safeSrcAttr = escapeAttrJs(src);
  const safeTgtAttr = escapeAttrJs(tgt);

  const modalEl = document.createElement("div");
  modalEl.id = "mergeBranchModal";
  modalEl.className = "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4";
  modalEl.innerHTML = `
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h3 class="text-sm font-bold flex items-center gap-1.5">
          <i data-lucide="git-merge" class="w-4 h-4 text-emerald-500"></i>
          <span>合併回 ${escapeHtml(tgt)}</span>
        </h3>
        <button type="button" onclick="closeMergeBranchModal()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none cursor-pointer">×</button>
      </div>
      <div class="p-4 space-y-3 text-xs">
        <p class="text-slate-600 dark:text-slate-300">
          即將把功能分支 <span class="font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">⎇ ${escapeHtml(src)}</span> 合併回 <span class="font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">⎇ ${escapeHtml(tgt)}</span>。
        </p>
        <div class="space-y-1">
          <label for="mergeBranchStrategySelect" class="block font-semibold text-slate-700 dark:text-slate-300">合併方式</label>
          <select id="mergeBranchStrategySelect" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs">
            <option value="merge">標準合併 (Merge Commit)</option>
            <option value="squash">壓縮合併 (Squash Merge)</option>
            <option value="rebase">變基快進 (Rebase + Fast-forward)</option>
          </select>
        </div>
        <label class="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" id="mergeDeleteSourceCheckbox" class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer">
          <span>合併成功後順便刪除來源分支 ⎇ ${escapeHtml(src)}</span>
        </label>
        <div id="mergeBranchModalError" class="hidden rounded-lg p-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 whitespace-pre-wrap break-words font-mono text-[11px]"></div>
      </div>
      <div class="px-4 py-3 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
        <button type="button" onclick="closeMergeBranchModal()" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer">取消</button>
        <button type="button" id="btnConfirmMergeBranch" onclick="submitMergeBranch('${safeProjAttr}', '${safeSrcAttr}', '${safeTgtAttr}')" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition cursor-pointer">確認合併回 ${escapeHtml(tgt)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);
  if (window.lucide) window.lucide.createIcons();
}

async function submitMergeBranch(projectId, sourceBranch, targetBranch) {
  const btn = document.getElementById("btnConfirmMergeBranch");
  const errEl = document.getElementById("mergeBranchModalError");
  const strategy = document.getElementById("mergeBranchStrategySelect")?.value || "merge";
  const deleteSourceBranch = Boolean(document.getElementById("mergeDeleteSourceCheckbox")?.checked);

  if (errEl) {
    errEl.classList.add("hidden");
    errEl.innerText = "";
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = "合併中...";
  }

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBranch, targetBranch, strategy, deleteSourceBranch })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `合併失敗 (HTTP ${res.status})`);
    }
    if (data.branchInfo) {
      setProjectBranchesMap({ ...projectBranchesMap, [projectId]: data.branchInfo });
    }
    const shortSha = data.commitSha ? ` (${String(data.commitSha).slice(0, 7)})` : "";
    showToast(`已成功將 ${sourceBranch} 合併回 ${targetBranch}${shortSha}`);
    closeMergeBranchModal();
    await loadProjectBranches(projectId, true);
    selectProjectAndBranch(projectId, targetBranch);
    if (typeof window !== "undefined") await window.loadData?.();
  } catch (err) {
    if (errEl) {
      const safeProjAttr = escapeAttrJs(projectId);
      const errMsg = err.message || "合併分支失敗";
      const showIdeBtns = /衝突|未提交|conflict|dirty/i.test(errMsg);
      errEl.innerHTML = `
        <div>${escapeHtml(errMsg)}</div>
        ${showIdeBtns ? `
          <div class="mt-2 pt-2 border-t border-rose-200/70 dark:border-rose-800/70 flex flex-wrap items-center gap-1.5 font-sans">
            <button type="button" onclick="openProjectInEditor('${safeProjAttr}', 'antigravity', event)" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold cursor-pointer">在 Antigravity 開啟</button>
            <button type="button" onclick="openProjectInEditor('${safeProjAttr}', 'vscode', event)" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-semibold cursor-pointer">在 VS Code 開啟</button>
          </div>
        ` : ""}
      `;
      errEl.classList.remove("hidden");
    }
    showToast(`合併失敗：${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = `確認合併回 ${targetBranch}`;
    }
  }
}

async function openProjectInEditor(projectId, editor = "antigravity", event, options = {}) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  if (!projectId || projectId === "ALL") return null;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editor,
        ...(options?.taskId ? { taskId: options.taskId } : {}),
        ...(options?.openWorktree === true ? { openWorktree: true } : {})
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `無法開啟 ${editor} (HTTP ${res.status})`);
    }
    const labelMap = {
      antigravity: "Antigravity IDE",
      vscode: "VS Code",
      finder: "Finder",
      terminal: "Terminal"
    };
    showToast(`已在 ${labelMap[editor] || editor} 開啟專案`);
    return data;
  } catch (err) {
    showToast(`開啟失敗：${err.message || "未知錯誤"}`);
    return null;
  }
}

function closeGitSyncModal() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("gitSyncConflictModal");
  if (el) el.remove();
  _gitSyncModalState = null;
  renderContextualHeaderActions();
}

function openEditorFromGitSyncModal(editor, event) {
  if (!_gitSyncModalState?.projectId) return;
  openProjectInEditor(_gitSyncModalState.projectId, editor, event);
}

function openGitSyncModal(config = {}) {
  if (typeof document === "undefined") return;
  closeGitSyncModal();
  _gitSyncModalState = {
    mode: config.mode === "conflict" ? "conflict" : "choose_sync",
    syncKind: config.syncKind || "pull",
    projectId: config.projectId || "",
    branchName: config.branchName || "",
    baseBranch: config.baseBranch || "main",
    afterSync: config.afterSync || "",
    taskId: config.taskId || ""
  };

  const isConflict = _gitSyncModalState.mode === "conflict";
  const files = Array.isArray(config.files) ? config.files : [];
  const modalTitle = config.title || (
    isConflict
      ? "偵測到合併衝突或未提交變更"
      : (_gitSyncModalState.syncKind === "sync_base"
        ? `同步 ${_gitSyncModalState.baseBranch} 至 ${_gitSyncModalState.branchName}`
        : `分支 ${_gitSyncModalState.branchName} 與遠端分叉`)
  );

  let bodyHtml = "";
  let footerHtml = "";

  if (isConflict) {
    const fileListHtml = files.length > 0
      ? `<div class="space-y-1">
          <div class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">涉及檔案（${files.length}）：</div>
          <div class="max-h-28 overflow-y-auto rounded-lg bg-slate-100 dark:bg-slate-800/80 p-2 font-mono text-[11px] text-rose-700 dark:text-rose-300 space-y-0.5">
            ${files.map(f => `<div class="truncate">${escapeHtml(f)}</div>`).join("")}
          </div>
        </div>`
      : "";
    bodyHtml = `
      <pre class="whitespace-pre-wrap break-words font-mono text-[11px] rounded-lg p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200 max-h-32 overflow-y-auto">${escapeHtml(config.message || "Git 操作發生衝突，已自動安全還原工作區。")}</pre>
      ${fileListHtml}
      <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Task Dashboard 不直接修改衝突檔案。建議一鍵跳轉至 Antigravity IDE 或 VS Code 使用視覺化 Merge 編輯器解完衝突並 commit 後，再回到看板推送。
      </p>
    `;
    footerHtml = `
      <button type="button" onclick="closeGitSyncModal()" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer">關閉</button>
      <button type="button" onclick="openEditorFromGitSyncModal('vscode', event)" class="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold cursor-pointer">在 VS Code 開啟</button>
      <button type="button" onclick="openEditorFromGitSyncModal('antigravity', event)" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm cursor-pointer">在 Antigravity 開啟</button>
    `;
  } else {
    const introText = config.message || (
      _gitSyncModalState.afterSync === "push"
        ? `遠端 origin/${escapeHtml(_gitSyncModalState.branchName)} 已有新進度，需先將遠端變更同步進本地後再自動推送。`
        : (_gitSyncModalState.syncKind === "sync_base"
          ? `即將把 ⎇ ${escapeHtml(_gitSyncModalState.baseBranch)}（優先取遠端最新）同步至功能分支 ⎇ ${escapeHtml(_gitSyncModalState.branchName)}。`
          : `分支 ⎇ ${escapeHtml(_gitSyncModalState.branchName)} 與遠端分支已分叉，無法直接 Fast-Forward，請選擇同步策略：`)
    );
    bodyHtml = `
      <p class="text-slate-600 dark:text-slate-300 leading-relaxed">${introText}</p>
      <div class="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
        <div><span class="font-semibold text-emerald-700 dark:text-emerald-400">• 合併同步 (git merge，推薦)：</span>保留雙方紀錄並建立合併節點，最直覺安全。</div>
        <div><span class="font-semibold text-sky-700 dark:text-sky-400">• 變基同步 (git rebase)：</span>把本地修改重新接到最新進度後面，歷史呈一條直線。</div>
      </div>
    `;
    footerHtml = `
      <button type="button" onclick="closeGitSyncModal()" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer">取消</button>
      <button type="button" data-sync-btn="rebase" onclick="runGitSyncModalAction('rebase')" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer">變基同步 (Rebase)</button>
      <button type="button" data-sync-btn="merge" onclick="runGitSyncModalAction('merge')" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm cursor-pointer">合併同步 (Merge，推薦)</button>
    `;
  }

  const modalEl = document.createElement("div");
  modalEl.id = "gitSyncConflictModal";
  modalEl.className = "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4";
  modalEl.innerHTML = `
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h3 class="text-sm font-bold flex items-center gap-1.5">
          <i data-lucide="${isConflict ? "alert-triangle" : "git-merge"}" class="w-4 h-4 ${isConflict ? "text-rose-500" : "text-sky-500"}"></i>
          <span>${escapeHtml(modalTitle)}</span>
        </h3>
        <button type="button" onclick="closeGitSyncModal()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none cursor-pointer">×</button>
      </div>
      <div class="p-4 space-y-3 text-xs">${bodyHtml}</div>
      <div class="px-4 py-3 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
        ${footerHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);
  if (window.lucide) window.lucide.createIcons();
}

async function runGitSyncModalAction(strategy = "merge") {
  const state = _gitSyncModalState;
  if (!state || !state.projectId || !state.branchName) return;
  const btns = document.querySelectorAll("#gitSyncConflictModal [data-sync-btn]");
  btns.forEach(b => {
    b.disabled = true;
    b.classList.add("opacity-60");
  });

  if (state.syncKind === "sync_base") {
    const ok = await syncCurrentBranchWithBase(
      state.projectId,
      state.branchName,
      state.baseBranch,
      strategy,
      state.afterSync
    );
    if (ok) closeGitSyncModal();
    return;
  }

  const ok = await pullCurrentBranch(state.projectId, state.branchName, null, {
    rebase: strategy === "rebase",
    merge: strategy !== "rebase",
    afterSync: state.afterSync
  });
  if (ok) closeGitSyncModal();
}

function openSyncBaseModal(projectId, branchName, baseBranch, event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  if (!projectId || !branchName) return;
  openGitSyncModal({
    mode: "choose_sync",
    syncKind: "sync_base",
    projectId,
    branchName,
    baseBranch: baseBranch || "main"
  });
}

async function syncCurrentBranchWithBase(projectId, branchName, baseBranch, strategy = "merge", afterSync = "") {
  if (!projectId || !branchName) return false;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/sync-base`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: branchName, baseBranch, strategy })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      if (data.conflict || data.status === "conflict" || data.status === "dirty_workspace") {
        openGitSyncModal({
          mode: "conflict",
          projectId,
          branchName,
          baseBranch,
          message: data.error || `同步 ${baseBranch} 發生衝突`,
          files: data.conflictingFiles || data.dirtyFiles || []
        });
        return false;
      }
      throw new Error(data.error || `同步失敗 (HTTP ${res.status})`);
    }
    if (data.remoteStatus) {
      branchRemoteStatusMap[`${projectId}::${branchName}`] = data.remoteStatus;
    }
    if (data.branchInfo) {
      setProjectBranchesMap({ ...projectBranchesMap, [projectId]: data.branchInfo });
    } else {
      await loadProjectBranches(projectId, true);
    }
    showToast(data.alreadyUpToDate ? `${branchName} 已是最新，無需同步` : `已將 ${data.syncRef || baseBranch} 同步至 ${branchName} ✓`);
    if (typeof window !== "undefined") {
      await window.loadData?.();
    }
    renderContextualHeaderActions();
    if (afterSync === "push") {
      await pushCurrentBranch(projectId, branchName, null);
    }
    return true;
  } catch (err) {
    showToast(`同步失敗：${err.message || "未知錯誤"}`);
    return false;
  }
}

async function pushCurrentBranch(projectId, branchName, event, options = {}) {
  if (!projectId || !branchName) return;
  const taskId = String(options?.taskId || "").trim();
  const btn = event?.currentTarget || event?.target?.closest?.("button") || null;
  const originalText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "推送中...";
  }
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: branchName, ...(taskId ? { taskId } : {}) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      if (data.nonFastForward) {
        openGitSyncModal({
          mode: "choose_sync",
          syncKind: "pull",
          projectId,
          branchName,
          taskId,
          afterSync: "push",
          title: "遠端有新進度，需先同步再推送"
        });
        return;
      }
      throw new Error(data.error || `推送失敗 (HTTP ${res.status})`);
    }
    if (data.remoteStatus) {
      branchRemoteStatusMap[`${projectId}::${branchName}`] = data.remoteStatus;
    }
    const archivedCount = Array.isArray(data.archivedTaskIds) ? data.archivedTaskIds.length : 0;
    showToast(
      archivedCount > 0
        ? `已成功推送分支 ${branchName} 並封存 ${archivedCount} 張任務`
        : `已成功推送分支 ${branchName}`
    );
    if (archivedCount > 0 && taskId && typeof window !== "undefined" && typeof window.closeModal === "function") {
      const modalTaskId = document.getElementById("formTaskId")?.value || "";
      if (modalTaskId === taskId) window.closeModal();
    }
    if (typeof window !== "undefined" && typeof window.loadData === "function") {
      await window.loadData();
      window.updateModalButtonState?.();
    }
    renderContextualHeaderActions();
  } catch (err) {
    showToast(`推送失敗：${err.message || "未知錯誤"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
    renderContextualHeaderActions();
  }
}

function buildPrSummaryFromDoneTasks(projectId, branchName, targetBranch = "main") {
  const doneTasks = (tasks || []).filter(t =>
    t &&
    t.project === projectId &&
    t.status === "done" &&
    (t.targetBranch === branchName || t.gitLanding?.landedBranch === branchName || t.baseBranch === branchName)
  );

  let title = `PR: ${branchName} → ${targetBranch}`;
  if (doneTasks.length === 1) {
    title = `[${doneTasks[0].id}] ${doneTasks[0].title}`;
  } else if (doneTasks.length > 1) {
    title = `feat(${branchName}): 完成 ${doneTasks.length} 項任務`;
  }

  const description = doneTasks
    .map(t => {
      const summary = String(t.resolution || t.objective || t.commitMessage?.subject || "").trim();
      return summary ? `- [${t.id}] ${t.title}：${summary}` : `- [${t.id}] ${t.title}`;
    })
    .join("\n");

  return { title, description, doneTasks };
}

function closeCreatePrModal() {
  if (typeof document === "undefined") return;
  _lastPrConflictState = null;
  const modal = document.getElementById("createPrModal");
  if (modal) modal.remove();
  renderContextualHeaderActions();
}

function openCreatePrModal(projectId, sourceBranch, targetBranch, options = {}) {
  if (typeof document === "undefined") return;
  _lastPrConflictState = null;
  const existing = document.getElementById("createPrModal");
  if (existing) existing.remove();

  const branchData = projectBranchesMap[projectId];
  const src = String(sourceBranch || currentBranch || "").trim();
  const tgt = String(targetBranch || branchData?.defaultBranch || "main").trim();
  const taskId = String(options?.taskId || "").trim();
  if (!projectId || !src) return;

  const branchNames = (branchData?.branches || [])
    .map(b => b.name)
    .filter(name => name && name !== src);
  if (tgt && !branchNames.includes(tgt)) branchNames.unshift(tgt);

  const summary = buildPrSummaryFromDoneTasks(projectId, src, tgt);
  const remoteInfo = branchRemoteStatusMap[`${projectId}::${src}`];
  const proj = (projects || []).find(p => p.id === projectId);
  const requirePr = Boolean(proj && proj.requirePr);
  const shouldAutoPush = requirePr || !remoteInfo || !remoteInfo.hasUpstream || remoteInfo.ahead > 0;

  const safeProjAttr = escapeAttrJs(projectId);
  const safeSrcAttr = escapeAttrJs(src);
  const safeTaskAttr = escapeAttrJs(taskId);

  const modalEl = document.createElement("div");
  modalEl.id = "createPrModal";
  modalEl.className = "fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4";
  modalEl.innerHTML = `
    <div class="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100" onclick="event.stopPropagation()">
      <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h3 class="text-sm font-bold flex items-center gap-1.5">
          <i data-lucide="git-pull-request" class="w-4 h-4 text-indigo-500"></i>
          <span>開立 Pull Request</span>
        </h3>
        <button type="button" onclick="closeCreatePrModal()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none cursor-pointer">×</button>
      </div>
      <div class="p-4 space-y-3 text-xs">
        <div class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <span>來源分支：</span>
          <span class="font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">⎇ ${escapeHtml(src)}</span>
        </div>
        <div class="space-y-1">
          <label for="prTargetBranchSelect" class="block font-semibold text-slate-700 dark:text-slate-300">目標分支</label>
          <select id="prTargetBranchSelect" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono">
            ${branchNames.map(name => `<option value="${escapeHtml(name)}" ${name === tgt ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-1">
          <label for="prTitleInput" class="block font-semibold text-slate-700 dark:text-slate-300">PR 標題</label>
          <input id="prTitleInput" type="text" value="${escapeHtml(summary.title)}" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs focus:outline-none focus:border-indigo-500">
        </div>
        <div class="space-y-1">
          <label for="prDescriptionInput" class="block font-semibold text-slate-700 dark:text-slate-300">PR 說明 (Markdown)</label>
          <textarea id="prDescriptionInput" rows="5" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono focus:outline-none focus:border-indigo-500">${escapeHtml(summary.description)}</textarea>
        </div>
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" id="prPullTargetCheckbox" checked class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer">
            <span>開立 PR 前先拉取並合併目標分支最新進度 (先 pull 目標分支，遇衝突中止送出)</span>
          </label>
          <label class="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" id="prAutoPushCheckbox" ${shouldAutoPush ? "checked" : ""} class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer">
            <span>開立 PR 前先自動推送來源分支至遠端 (git push -u origin)</span>
          </label>
        </div>
        <div id="createPrModalFeedback" class="hidden rounded-lg p-2.5 text-[11px] whitespace-pre-wrap break-words"></div>
      </div>
      <div class="px-4 py-3 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
        <button type="button" onclick="closeCreatePrModal()" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer">取消</button>
        <button type="button" id="btnConfirmCreatePr" onclick="submitCreatePr('${safeProjAttr}', '${safeSrcAttr}', '${safeTaskAttr}')" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition cursor-pointer">建立 PR</button>
      </div>
    </div>
  `;
  modalEl.addEventListener("click", closeCreatePrModal);
  document.body.appendChild(modalEl);
  renderContextualHeaderActions();
  if (window.lucide) window.lucide.createIcons();
}

async function createConflictTaskFromPr(projectId, sourceBranch, targetBranch, files = [], event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  const projId = String(projectId || "").trim();
  const src = String(sourceBranch || "").trim();
  const tgt = String(targetBranch || "main").trim();
  if (!projId || !src) return null;

  const effectiveFiles = Array.isArray(files) && files.length > 0
    ? files
    : (Array.isArray(_lastPrConflictState?.files) ? _lastPrConflictState.files : []);
  const btn = event?.currentTarget || event?.target?.closest?.("button") || null;
  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "建立任務中...";
  }

  try {
    const fileLines = effectiveFiles.length > 0
      ? effectiveFiles.map(f => `- \`${f}\``).join("\n")
      : "- （請執行 `git status` / `git diff` 確認衝突檔案）";
    const description = [
      `在開立 Pull Request (${src} → ${tgt}) 前先拉取目標分支最新進度時發生合併衝突 (Merge Conflict)，系統已自動中止還原工作區。`,
      "",
      "## 衝突檔案清單",
      fileLines,
      "",
      "## 執行指引",
      `1. 確認目前工作區位於來源分支 \`${src}\`（\`git checkout ${src}\`）`,
      `2. 執行 \`git fetch origin --prune && git merge origin/${tgt}\` 重現合併衝突`,
      "3. 依雙方修改意圖完整解決衝突檔案並移除衝突標記 (`<<<<<<<` / `=======` / `>>>>>>>`)",
      "4. 執行相關測試與靜態檢查驗證無誤後，執行 `git add` 與 `git commit` 完成合併提交"
    ].join("\n");

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `解決 PR 合併衝突：${src} ← ${tgt}`,
        project: projId,
        priority: "P1",
        status: "todo",
        workspaceMode: "in_place",
        targetBranch: src,
        baseBranch: src,
        description
      })
    });
    const created = await res.json().catch(() => ({}));
    if (!res.ok || !created?.id) {
      throw new Error(created?.error || `建立解衝任務失敗 (HTTP ${res.status})`);
    }
    showToast(`已建立解衝任務 ${created.id}，請將任務移至進行中交由 Agent 處理`);
    if (typeof window !== "undefined") {
      await window.loadData?.();
    }
    return created;
  } catch (err) {
    showToast(`建立解衝任務失敗：${err.message || "未知錯誤"}`);
    return null;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function submitCreatePr(projectId, sourceBranch, taskId = "") {
  const targetBranch = document.getElementById("prTargetBranchSelect")?.value?.trim() || "main";
  const title = document.getElementById("prTitleInput")?.value?.trim() || "";
  const description = document.getElementById("prDescriptionInput")?.value || "";
  const autoPush = Boolean(document.getElementById("prAutoPushCheckbox")?.checked);
  const pullTargetBeforePr = Boolean(document.getElementById("prPullTargetCheckbox")?.checked ?? true);
  const normalizedTaskId = String(taskId || "").trim();
  const feedbackEl = document.getElementById("createPrModalFeedback");
  const btn = document.getElementById("btnConfirmCreatePr");

  if (feedbackEl) {
    feedbackEl.className = "hidden rounded-lg p-2.5 text-[11px] whitespace-pre-wrap break-words";
    feedbackEl.innerHTML = "";
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = pullTargetBeforePr ? "先同步目標分支並建立中..." : "建立中...";
  }

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranch,
        targetBranch,
        title,
        description,
        autoPush,
        pullTargetBeforePr,
        ...(normalizedTaskId ? { taskId: normalizedTaskId } : {})
      })
    });
    const data = await res.json().catch(() => ({}));

    const prePrSyncHtml =
      data.prePrSync && data.prePrSync.synced && !data.prePrSync.alreadyUpToDate
        ? `<div class="text-[11px] opacity-90">已先拉取並合併目標分支 ${escapeHtml(data.prePrSync.syncRef || targetBranch)} 最新進度 (${escapeHtml(data.prePrSync.strategy || "merge")}) ✓</div>`
        : "";

    if (res.status === 409 || data.conflict || data.status === "conflict" || data.status === "dirty_workspace") {
      const isDirty = data.status === "dirty_workspace";
      const files = Array.isArray(data.conflictingFiles) && data.conflictingFiles.length > 0
        ? data.conflictingFiles
        : (Array.isArray(data.dirtyFiles) ? data.dirtyFiles : []);
      _lastPrConflictState = {
        projectId,
        sourceBranch,
        targetBranch,
        files,
        taskId: normalizedTaskId
      };
      if (feedbackEl) {
        const safeProjAttr = escapeAttrJs(projectId);
        const safeSrcAttr = escapeAttrJs(sourceBranch);
        const safeTgtAttr = escapeAttrJs(targetBranch);
        const safeTaskAttr = escapeAttrJs(normalizedTaskId);
        const fileListHtml = files.length > 0
          ? `<div class="space-y-1">
              <div class="font-semibold text-rose-800 dark:text-rose-200">${isDirty ? "未提交變更檔案" : "衝突檔案"}（${files.length}）：</div>
              <div class="max-h-28 overflow-y-auto rounded bg-white/80 dark:bg-slate-900/70 border border-rose-200 dark:border-rose-800/60 p-1.5 font-mono text-[11px] space-y-0.5">
                ${files.map(f => `<div class="truncate">${escapeHtml(f)}</div>`).join("")}
              </div>
            </div>`
          : "";
        feedbackEl.className = "rounded-lg p-3 text-[11px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2.5";
        feedbackEl.innerHTML = `
          <div class="font-semibold">${isDirty ? "開立 PR 前偵測到工作區有未提交變更 (Dirty Workspace)，已中止送出" : "開立 PR 前同步目標分支發生合併衝突 (Merge Conflict)，已自動安全還原工作區"}</div>
          <div>${escapeHtml(data.error || `同步 ${targetBranch} 失敗，請先解決衝突或處理未提交變更後再送出 PR。`)}</div>
          ${fileListHtml}
          <div class="text-[10px] text-rose-700/90 dark:text-rose-300/90 leading-relaxed">
            可建立 P1 解衝任務交由 Agent 處理，或於 Antigravity / VS Code 解完衝突並 commit 後直接點擊重新送出 PR（已輸入的標題與說明將保留）。
          </div>
          <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button type="button" onclick="createConflictTaskFromPr('${safeProjAttr}', '${safeSrcAttr}', '${safeTgtAttr}', null, event)" class="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer">建立解衝任務 (Agent)</button>
            <button type="button" onclick="openProjectInEditor('${safeProjAttr}', 'antigravity', event)" class="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer">在 Antigravity 開啟</button>
            <button type="button" onclick="openProjectInEditor('${safeProjAttr}', 'vscode', event)" class="px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-white font-semibold cursor-pointer">在 VS Code 開啟</button>
            <button type="button" onclick="submitCreatePr('${safeProjAttr}', '${safeSrcAttr}', '${safeTaskAttr}')" class="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer">衝突已解，重新送出 PR</button>
          </div>
        `;
      }
      showToast(isDirty ? "工作區有未提交變更，已中止建立 PR" : "同步目標分支發生衝突，已自動安全還原並中止建立 PR");
      return;
    }

    if (data.success && data.prUrl) {
      const archivedIds = Array.isArray(data.archivedTaskIds) ? data.archivedTaskIds : [];
      const archivedCount = archivedIds.length;
      showToast(
        archivedCount > 0
          ? `Pull Request 已建立成功，並自動封存 ${archivedCount} 張任務！`
          : "Pull Request 已建立成功！"
      );
      if (feedbackEl) {
        const safeUrlAttr = escapeAttrJs(data.prUrl);
        feedbackEl.className = "rounded-lg p-2.5 text-[11px] bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 space-y-1.5";
        feedbackEl.innerHTML = `
          ${prePrSyncHtml}
          <div class="font-semibold">PR 已成功建立${archivedCount > 0 ? `（已自動封存 ${archivedCount} 張任務）` : ""}：</div>
          <a href="${escapeHtml(data.prUrl)}" onclick="openExternalUrl('${safeUrlAttr}', event)" class="inline-flex items-center gap-1 underline font-mono break-all hover:text-emerald-600 dark:hover:text-emerald-100">${escapeHtml(data.prUrl)}</a>
        `;
      }
      loadBranchRemoteStatus(projectId, sourceBranch, true);
      if (typeof window !== "undefined") {
        const editingTaskId = window.currentModalEditingTask?.id || document.getElementById("formTaskId")?.value || "";
        if (editingTaskId && archivedIds.includes(editingTaskId)) {
          window.closeModal?.();
        }
        await window.loadData?.();
        window.updateModalButtonState?.();
      }
      return;
    }

    if (data.degraded && data.fallbackCreateUrl) {
      const archivedIds = Array.isArray(data.archivedTaskIds) ? data.archivedTaskIds : [];
      const archivedCount = archivedIds.length;
      if (archivedCount > 0) {
        showToast(`分支已推送並封存 ${archivedCount} 張任務，請前往網頁完成建立 PR`);
      }
      if (feedbackEl) {
        const safeFallbackAttr = escapeAttrJs(data.fallbackCreateUrl);
        feedbackEl.className = "rounded-lg p-2.5 text-[11px] bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 space-y-2";
        feedbackEl.innerHTML = `
          ${prePrSyncHtml}
          <div>${escapeHtml(data.error || "無法自動建立 PR，請透過網頁完成建立。")}${archivedCount > 0 ? `（已自動推送並封存 ${archivedCount} 張任務）` : ""}</div>
          <div>
            <a href="${escapeHtml(data.fallbackCreateUrl)}" onclick="openExternalUrl('${safeFallbackAttr}', event)" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-semibold no-underline">前往網頁開立 PR ↗</a>
          </div>
        `;
      }
      if (archivedCount > 0 && typeof window !== "undefined") {
        loadBranchRemoteStatus(projectId, sourceBranch, true);
        const editingTaskId = window.currentModalEditingTask?.id || document.getElementById("formTaskId")?.value || "";
        if (editingTaskId && archivedIds.includes(editingTaskId)) {
          window.closeModal?.();
        }
        await window.loadData?.();
        window.updateModalButtonState?.();
      }
      return;
    }

    throw new Error(data.error || `開立 PR 失敗 (HTTP ${res.status})`);
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.className = "rounded-lg p-2.5 text-[11px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 whitespace-pre-wrap break-words";
      feedbackEl.innerText = err.message || "開立 PR 失敗";
    }
    showToast(`開立 PR 失敗：${err.message || "未知錯誤"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "建立 PR";
    }
  }
}

async function pullCurrentBranch(projectId, branchName, event, options = {}) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  if (!projectId || !branchName) return false;
  const btn = event?.currentTarget || null;
  const origHtml = btn ? btn.innerHTML : "";
  const rebase = options.rebase === true;
  const merge = options.merge === true;
  const afterSync = options.afterSync || "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = rebase ? "Rebase 中..." : (merge ? "合併中..." : "拉取中...");
  }
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: branchName, mode: "pull", rebase, merge })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      if (data.canRetryWithRebase && !rebase && !merge) {
        openGitSyncModal({
          mode: "choose_sync",
          syncKind: "pull",
          projectId,
          branchName,
          afterSync
        });
        return false;
      }
      if (data.conflict || data.status === "conflict" || data.status === "dirty_workspace") {
        openGitSyncModal({
          mode: "conflict",
          projectId,
          branchName,
          message: data.error || `拉取 ${branchName} 發生衝突`,
          files: data.conflictingFiles || data.dirtyFiles || []
        });
        return false;
      }
      throw new Error(data.error || `拉取失敗 (HTTP ${res.status})`);
    }
    if (data.remoteStatus) {
      branchRemoteStatusMap[`${projectId}::${branchName}`] = data.remoteStatus;
    }
    if (data.branchInfo) {
      setProjectBranchesMap({ ...projectBranchesMap, [projectId]: data.branchInfo });
    } else {
      await loadProjectBranches(projectId, true);
    }
    showToast(`分支 ${branchName} 已同步遠端最新進度 ✓`);
    if (typeof window !== "undefined") {
      await window.loadData?.();
    }
    renderContextualHeaderActions();
    if (afterSync === "push") {
      await pushCurrentBranch(projectId, branchName, null);
    }
    return true;
  } catch (err) {
    showToast(`拉取失敗：${err.message || "未知錯誤"}`);
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    renderContextualHeaderActions();
  }
}

async function pushTaskBranchFromCard(taskId, event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  const task =
    (tasks || []).find(t => t.id === taskId) ||
    (typeof window !== "undefined" && window.currentModalEditingTask && window.currentModalEditingTask.id === taskId
      ? window.currentModalEditingTask
      : null);
  const projId = task?.project || "";
  const branchName = (task?.gitLanding?.landedBranch || task?.targetBranch || task?.baseBranch || "").trim();
  if (!projId || !branchName) {
    showToast("找不到此任務對應的分支資訊");
    return;
  }
  await pushCurrentBranch(projId, branchName, event, { taskId });
}

function openCreatePrForTask(taskId, event) {
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  const task =
    (tasks || []).find(t => t.id === taskId) ||
    (typeof window !== "undefined" && window.currentModalEditingTask && window.currentModalEditingTask.id === taskId
      ? window.currentModalEditingTask
      : null);
  if (!task || !task.project) {
    showToast("找不到此任務資訊");
    return;
  }
  const prUrl = (task.gitLanding && task.gitLanding.prUrl) || task.prUrl || "";
  if (prUrl) {
    if (typeof openExternalUrl === "function") {
      openExternalUrl(prUrl, event);
    } else if (typeof window !== "undefined") {
      window.open(prUrl, "_blank");
    }
    return;
  }
  const sourceBranch = (task.gitLanding?.landedBranch || task.targetBranch || task.baseBranch || "").trim();
  const defaultBranch = (projectBranchesMap[task.project]?.defaultBranch || "main").trim();
  if (!sourceBranch) {
    showToast("找不到此任務對應的分支資訊");
    return;
  }
  openCreatePrModal(task.project, sourceBranch, defaultBranch, { taskId });
}

export {
  loadProjectBranches,
  loadBranchRemoteStatus,
  selectProjectAndBranch,
  renderProjectBranchTree,
  renderContextualHeaderActions,
  toggleBranchGroupView,
  openCreateBranchPopover,
  closeCreateBranchPopover,
  submitNewBranch,
  openMergeBranchModal,
  closeMergeBranchModal,
  submitMergeBranch,
  pullCurrentBranch,
  pushCurrentBranch,
  pushTaskBranchFromCard,
  buildPrSummaryFromDoneTasks,
  openCreatePrModal,
  openCreatePrForTask,
  closeCreatePrModal,
  submitCreatePr,
  createConflictTaskFromPr,
  openProjectInEditor,
  openGitSyncModal,
  closeGitSyncModal,
  openEditorFromGitSyncModal,
  runGitSyncModalAction,
  openSyncBaseModal,
  syncCurrentBranchWithBase
};

if (typeof window !== "undefined") {
  window.loadProjectBranches = loadProjectBranches;
  window.loadBranchRemoteStatus = loadBranchRemoteStatus;
  window.selectProjectAndBranch = selectProjectAndBranch;
  window.renderProjectBranchTree = renderProjectBranchTree;
  window.renderContextualHeaderActions = renderContextualHeaderActions;
  window.toggleBranchGroupView = toggleBranchGroupView;
  window.openCreateBranchPopover = openCreateBranchPopover;
  window.closeCreateBranchPopover = closeCreateBranchPopover;
  window.submitNewBranch = submitNewBranch;
  window.openMergeBranchModal = openMergeBranchModal;
  window.closeMergeBranchModal = closeMergeBranchModal;
  window.submitMergeBranch = submitMergeBranch;
  window.pullCurrentBranch = pullCurrentBranch;
  window.pushCurrentBranch = pushCurrentBranch;
  window.pushTaskBranchFromCard = pushTaskBranchFromCard;
  window.buildPrSummaryFromDoneTasks = buildPrSummaryFromDoneTasks;
  window.openCreatePrModal = openCreatePrModal;
  window.openCreatePrForTask = openCreatePrForTask;
  window.closeCreatePrModal = closeCreatePrModal;
  window.submitCreatePr = submitCreatePr;
  window.createConflictTaskFromPr = createConflictTaskFromPr;
  window.openProjectInEditor = openProjectInEditor;
  window.openGitSyncModal = openGitSyncModal;
  window.closeGitSyncModal = closeGitSyncModal;
  window.openEditorFromGitSyncModal = openEditorFromGitSyncModal;
  window.runGitSyncModalAction = runGitSyncModalAction;
  window.openSyncBaseModal = openSyncBaseModal;
  window.syncCurrentBranchWithBase = syncCurrentBranchWithBase;
}
