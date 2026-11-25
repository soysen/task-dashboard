import {
  projects, tasks, currentProject, currentBranch, projectBranchesMap, groupByBranch,
  setCurrentProject, setCurrentBranch, setProjectBranchesMap, setGroupByBranch
} from "./state.js";
import { escapeHtml, showToast } from "./utils.js";

const loadingBranchProjects = new Set();
let popoverTargetProjectId = "";

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
  if (!container) return;

  const modalEl = document.getElementById("taskModal");
  const mergeModalEl = document.getElementById("mergeBranchModal");
  if ((modalEl && !modalEl.classList.contains("hidden")) || (mergeModalEl && !mergeModalEl.classList.contains("hidden"))) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  const viewToggleHtml = `
    <div class="inline-flex items-center p-0.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs">
      <button type="button" onclick="toggleBranchGroupView(false)" class="px-2.5 py-1 rounded-md transition cursor-pointer ${!groupByBranch ? "bg-[var(--card)] font-bold text-[var(--foreground)] shadow-xs" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}">看板</button>
      <button type="button" onclick="toggleBranchGroupView(true)" class="px-2.5 py-1 rounded-md transition cursor-pointer ${groupByBranch ? "bg-[var(--card)] font-bold text-[var(--foreground)] shadow-xs" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}">按分支看</button>
    </div>
  `;

  if (currentProject === "ALL") {
    // L0 全局總覽：僅顯示「＋ 新增任務」（隱藏「按分支看」與合併按鈕）
    container.innerHTML = `
      <button type="button" onclick="openModal({ status: 'todo' })" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">＋ 新增任務</button>
    `;
  } else if (!currentBranch || currentBranch === "ALL") {
    // L1 單一專案・全部分支：顯示「看板 | 按分支看」+「＋ 新建分支」+「＋ 新增任務」
    const safeProjAttr = escapeAttrJs(currentProject);
    const showNewBranchBtn = !branchData || branchData.isGitRepo !== false;
    const fromAttr = escapeAttrJs(branchData?.defaultBranch || branchData?.currentCheckoutBranch || "main");
    container.innerHTML = `
      ${viewToggleHtml}
      ${showNewBranchBtn ? `<button type="button" onclick="openCreateBranchPopover('${safeProjAttr}', '${fromAttr}', event)" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-slate-300 dark:border-slate-700 text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg transition cursor-pointer whitespace-nowrap">＋ 新建分支</button>` : ""}
      <button type="button" onclick="openModal({ status: 'todo', project: '${safeProjAttr}' })" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">＋ 新增任務</button>
    `;
  } else {
    // L2 單一分支：自動收起「看板 | 按分支看」，非主幹且有已提交任務時顯示「合併回 <defaultBranch>」
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

    container.innerHTML = `
      ${hasCommittedDoneOnBranch ? `<button type="button" onclick="openMergeBranchModal('${safeProjAttr}', '${safeBranchAttr}', '${safeDefaultAttr}')" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">合併回 ${escapeHtml(defaultBranch)}</button>` : ""}
      <button type="button" onclick="openCreateBranchPopover('${safeProjAttr}', '${safeBranchAttr}', event)" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-slate-300 dark:border-slate-700 text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg transition cursor-pointer whitespace-nowrap">＋ 新建分支</button>
      <button type="button" onclick="openModal({ status: 'todo', project: '${safeProjAttr}', targetBranch: '${safeBranchAttr}' })" class="h-7 sm:h-8 inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] sm:text-xs font-semibold px-2.5 rounded-lg shadow-sm transition cursor-pointer whitespace-nowrap">＋ 新增任務</button>
    `;
  }
  if (window.lucide) lucide.createIcons();
}

function toggleBranchGroupView(enabled) {
  setGroupByBranch(typeof enabled === "boolean" ? enabled : !groupByBranch);
  renderContextualHeaderActions();
  if (typeof window !== "undefined") window.renderKanban?.();
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

export {
  loadProjectBranches,
  selectProjectAndBranch,
  renderProjectBranchTree,
  renderContextualHeaderActions,
  toggleBranchGroupView,
  openCreateBranchPopover,
  closeCreateBranchPopover,
  submitNewBranch,
  openMergeBranchModal,
  closeMergeBranchModal,
  submitMergeBranch
};

if (typeof window !== "undefined") {
  window.loadProjectBranches = loadProjectBranches;
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
}
