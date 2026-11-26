import {
  projects, tasks, currentProject, currentBranch, projectBranchesMap, groupByBranch, expandedProjectId,
  setCurrentProject, setCurrentBranch, setProjectBranchesMap, setGroupByBranch, setExpandedProjectId
} from "./state.js";
import { escapeHtml, showToast, openExternalUrl } from "./utils.js";

const loadingBranchProjects = new Set();
const loadingRemoteStatusKeys = new Set();
let branchRemoteStatusMap = {};
let popoverTargetProjectId = "";

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
    return `<div class="pt-1 border-t border-slate-200/80 dark:border-slate-700/70 text-[11px] text-slate-400 px-1 py-0.5">載入分支中...</div>`;
  }

  if (!data.isGitRepo) {
    return `<div class="pt-1 border-t border-slate-200/80 dark:border-slate-700/70 text-[10px] text-slate-400 px-1 py-0.5">非 Git 資料夾</div>`;
  }

  const branches = Array.isArray(data.branches) ? data.branches : [];
  const defaultFrom = escapeAttrJs(data.defaultBranch || data.currentCheckoutBranch || "main");
  const projTasks = (tasks || []).filter(t => t.project === project.id && t.status !== "archived");

  let html = `<div class="space-y-0.5 pt-1 border-t border-[var(--border)]">`;
  branches.forEach(b => {
    const isActive = currentProject === project.id && currentBranch === b.name;
    const safeBranchAttr = escapeAttrJs(b.name);
    const bCount = projTasks.filter(t => (t.targetBranch || t.baseBranch || data.defaultBranch || "") === b.name).length;
    const isDirtyHead = Boolean(b.isCurrentCheckout && data.isMainWorkspaceDirty);
    html += `
      <button type="button" onclick="selectProjectAndBranch('${safeProjAttr}', '${safeBranchAttr}', event)" class="w-full text-left pl-3 pr-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-1.5 transition cursor-pointer ${isActive ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"}">
        <span class="font-mono truncate flex items-center gap-1.5 min-w-0">
          <span>${b.isCurrentCheckout ? "●" : "⎇"}</span>
          <span class="truncate">${escapeHtml(b.name)}</span>
          ${isDirtyHead ? `<span class="px-1 rounded border text-[10px] font-sans flex-shrink-0 ${isActive ? "border-amber-200 text-amber-100" : "border-[var(--warning)] text-[var(--warning)]"}">未提交</span>` : ""}
        </span>
        <span class="font-mono text-xs flex-shrink-0">${bCount}</span>
      </button>
    `;
  });
  html += `
    <div class="pt-0.5 flex justify-end">
      <button type="button" onclick="openCreateBranchPopover('${safeProjAttr}', '${defaultFrom}', event)" class="text-[11px] font-semibold px-1.5 py-0.5 rounded text-[var(--link)] hover:underline transition cursor-pointer">
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
      errEl.innerText = err.message || "合併分支失敗";
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
  const modal = document.getElementById("createPrModal");
  if (modal) modal.remove();
  renderContextualHeaderActions();
}

function openCreatePrModal(projectId, sourceBranch, targetBranch, options = {}) {
  if (typeof document === "undefined") return;
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
        <label class="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" id="prAutoPushCheckbox" ${shouldAutoPush ? "checked" : ""} class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer">
          <span>開立 PR 前先自動推送來源分支至遠端 (git push -u origin)</span>
        </label>
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

async function submitCreatePr(projectId, sourceBranch, taskId = "") {
  const targetBranch = document.getElementById("prTargetBranchSelect")?.value?.trim() || "main";
  const title = document.getElementById("prTitleInput")?.value?.trim() || "";
  const description = document.getElementById("prDescriptionInput")?.value || "";
  const autoPush = Boolean(document.getElementById("prAutoPushCheckbox")?.checked);
  const normalizedTaskId = String(taskId || "").trim();
  const feedbackEl = document.getElementById("createPrModalFeedback");
  const btn = document.getElementById("btnConfirmCreatePr");

  if (feedbackEl) {
    feedbackEl.className = "hidden rounded-lg p-2.5 text-[11px] whitespace-pre-wrap break-words";
    feedbackEl.innerHTML = "";
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = "建立中...";
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
        ...(normalizedTaskId ? { taskId: normalizedTaskId } : {})
      })
    });
    const data = await res.json().catch(() => ({}));

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
  if (!projectId || !branchName) return;
  const btn = event?.currentTarget || null;
  const origHtml = btn ? btn.innerHTML : "";
  const rebase = options.rebase === true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = rebase ? "Rebase 中..." : "拉取中...";
  }
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: branchName, mode: "pull", rebase })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      if (data.canRetryWithRebase && !rebase && typeof window !== "undefined" && typeof window.confirm === "function") {
        const shouldRebase = window.confirm(`分支 ${branchName} 與遠端分叉，無法直接 Fast-Forward。\n是否改用 git pull --rebase 同步遠端最新進度？`);
        if (shouldRebase) {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
          }
          return await pullCurrentBranch(projectId, branchName, null, { rebase: true });
        }
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
  } catch (err) {
    showToast(`拉取失敗：${err.message || "未知錯誤"}`);
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
  submitCreatePr
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
}
