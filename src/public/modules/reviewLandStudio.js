import { projects, tasks, currentModalEditingTask } from "./state.js";
import { escapeHtml, showToast, withButtonLoading } from "./utils.js";
import { loadData } from "./app.js";

let _activeLandTaskId = null;
let _landSubjectTouched = false;
let _landBodyTouched = false;
let _commitDrawerExpanded = false;
let _feedbackDrawerExpanded = false;

function resolveLandTargetBranch(task) {
  if (!task) return "main";
  const proj = projects.find(p => p.id === task.project);
  return String(
    task.targetBranch ||
    task.baseBranch ||
    (proj && proj.defaultBranch) ||
    "main"
  ).trim();
}

function buildFallbackSubject(task) {
  if (!task) return "";
  if (task.commitMessage && task.commitMessage.subject) {
    return String(task.commitMessage.subject).trim();
  }
  const idSlug = String(task.id || "task").toLowerCase();
  const title = String(task.title || "Update task").trim();
  return `feat(${idSlug}): ${title}`;
}

function syncCommitPreviewText() {
  const previewEl = document.getElementById("landCommitPreviewText");
  const subjectEl = document.getElementById("landSubjectInput");
  if (previewEl && subjectEl) {
    previewEl.textContent = subjectEl.value.trim() || "（點擊設定 Commit 標題）";
  }
}

function toggleLandCommitDrawer(forceState) {
  const drawer = document.getElementById("reviewLandCommitDrawer");
  const toggleBtnText = document.getElementById("btnToggleCommitDrawerText");
  if (!drawer) return;
  _commitDrawerExpanded = typeof forceState === "boolean" ? forceState : !_commitDrawerExpanded;
  drawer.classList.toggle("hidden", !_commitDrawerExpanded);
  if (_commitDrawerExpanded && _feedbackDrawerExpanded) {
    toggleReviewFeedbackDrawer(false);
  }
  if (toggleBtnText) {
    toggleBtnText.textContent = _commitDrawerExpanded ? "收合訊息 ▾" : "修改訊息 ▴";
  }
  if (_commitDrawerExpanded) {
    setTimeout(() => document.getElementById("landSubjectInput")?.focus(), 20);
  }
}

function toggleReviewFeedbackDrawer(forceState) {
  const fbBox = document.getElementById("reviewFeedbackBox");
  if (!fbBox) return;
  _feedbackDrawerExpanded = typeof forceState === "boolean" ? forceState : !_feedbackDrawerExpanded;
  fbBox.classList.toggle("hidden", !_feedbackDrawerExpanded);
  if (_feedbackDrawerExpanded) {
    if (_commitDrawerExpanded) toggleLandCommitDrawer(false);
    setTimeout(() => {
      fbBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      document.getElementById("formFeedback")?.focus();
    }, 30);
  }
}

function triggerDockRejectFlow(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  const fbInput = document.getElementById("formFeedback");
  const fbBox = document.getElementById("reviewFeedbackBox");
  const currentFb = (fbInput?.value || "").trim();

  // 若意見欄尚未展開且尚未填寫內容，先展開並引導輸入；若已展開或已有內容，直接執行退回
  if (fbBox && fbBox.classList.contains("hidden") && !currentFb) {
    // 確保切回審核頁籤以便看到意見欄
    if (typeof window.switchModalWorkspaceTab === "function") {
      window.switchModalWorkspaceTab("review");
    }
    toggleReviewFeedbackDrawer(true);
    showToast("請輸入想讓 AI 調整的地方，再點一次「請 AI 再修改」即可送出");
    return;
  }

  if (typeof window.rejectTaskWithFeedback === "function") {
    window.rejectTaskWithFeedback(event);
  }
}

function updateLandButtonTargetBadge(task) {
  const badgeEl = document.getElementById("btnLandTaskTargetBranch");
  if (!badgeEl) return;
  const targetBranch = resolveLandTargetBranch(task);
  badgeEl.innerText = `寫入 ⎇ ${targetBranch}`;
}

function setLandErrorBox(message, options = {}) {
  const box = document.getElementById("reviewLandErrorBox");
  if (!box) return;
  if (!message) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const { taskId = "", requiresConfirmation = false, showSwitchWorktree = false } = options;
  const safeTaskAttr = escapeHtml(taskId);
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="flex items-start justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
      <div class="flex items-start gap-2 min-w-0 flex-1">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5"></i>
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="font-semibold">無法直接提交，請先處理以下狀況：</div>
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] bg-white/80 dark:bg-rose-950/60 rounded-lg p-2 border border-rose-200 dark:border-rose-800/60 max-h-28 overflow-y-auto">${escapeHtml(message)}</pre>
          <div class="flex flex-wrap items-center gap-2">
            ${requiresConfirmation ? `
              <button type="button" onclick="landTaskChanges(event, { confirmOneWayMerge: true })" class="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition cursor-pointer">
                確認寫入目標分支
              </button>
            ` : ""}
            ${showSwitchWorktree && safeTaskAttr ? `
              <button type="button" onclick="switchWorkspaceToWorktreeAndStart('${safeTaskAttr}')" class="px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition cursor-pointer">
                改用獨立工作區重新開工
              </button>
            ` : ""}
          </div>
        </div>
      </div>
      <button type="button" onclick="document.getElementById('reviewLandErrorBox').classList.add('hidden')" class="text-rose-400 hover:text-rose-700 p-1 cursor-pointer">✕</button>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderDriftStatusBadge(driftData, taskId) {
  const statusEl = document.getElementById("reviewLandDriftStatus");
  if (!statusEl) return;

  if (!driftData) {
    statusEl.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300";
    statusEl.innerHTML = `
      <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0"></i>
      <span>分支檢查：可直接提交 ✓</span>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const hasConflict = Boolean(
    driftData.hasConflict ||
    driftData.conflict ||
    driftData.status === "conflict" ||
    driftData.status === "dirty_main_workspace"
  );
  const hasDrift = Boolean(driftData.hasDrift || Number(driftData.behindCount || driftData.behind || 0) > 0);

  if (hasConflict) {
    const safeTaskAttr = escapeHtml(taskId || "");
    statusEl.className = "inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300 flex-wrap";
    statusEl.innerHTML = `
      <i data-lucide="alert-octagon" class="w-3.5 h-3.5 text-rose-500 flex-shrink-0"></i>
      <span>有未提交檔案或衝突，無法直接寫入</span>
      ${safeTaskAttr ? `
        <button type="button" onclick="switchWorkspaceToWorktreeAndStart('${safeTaskAttr}')" class="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition cursor-pointer">
          改用獨立工作區
        </button>
      ` : ""}
    `;
  } else if (hasDrift) {
    const behind = Number(driftData.behindCount || driftData.behind || 0);
    statusEl.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300";
    statusEl.innerHTML = `
      <i data-lucide="git-branch" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0"></i>
      <span>主幹多了 ${behind > 0 ? `${behind} 筆更新` : "新變更"}，提交時會自動同步</span>
    `;
  } else {
    statusEl.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300";
    statusEl.innerHTML = `
      <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0"></i>
      <span>分支檢查：可直接提交 ✓</span>
    `;
  }
  if (window.lucide) window.lucide.createIcons();
}

async function checkTaskBaseDrift(taskId) {
  if (!taskId) return null;
  const statusEl = document.getElementById("reviewLandDriftStatus");
  if (statusEl) {
    statusEl.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
    statusEl.innerHTML = `<span>檢查分支狀態中...</span>`;
  }
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/drift-check`);
    if (!res.ok) {
      renderDriftStatusBadge(null, taskId);
      return null;
    }
    const data = await res.json();
    if (_activeLandTaskId === taskId) {
      renderDriftStatusBadge(data, taskId);
    }
    return data;
  } catch (err) {
    if (_activeLandTaskId === taskId) {
      renderDriftStatusBadge(null, taskId);
    }
    return null;
  }
}

async function regenerateLandCommitMessage(taskId, forceOverwrite = true) {
  const id = taskId || document.getElementById("formTaskId")?.value || "";
  if (!id) return;
  const subjectEl = document.getElementById("landSubjectInput");
  const bodyEl = document.getElementById("landBodyInput");
  if (!subjectEl || !bodyEl) return;

  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/generate-commit`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    if (_activeLandTaskId !== id) return;
    if ((forceOverwrite || !_landSubjectTouched) && data.subject) {
      subjectEl.value = data.subject;
      syncCommitPreviewText();
    }
    if ((forceOverwrite || !_landBodyTouched) && data.body !== undefined) {
      bodyEl.value = data.body || "";
    }
  } catch (_) {}
}

function initReviewLandPanel(task) {
  const panel = document.getElementById("reviewLandStudioPanel");
  const stdFooter = document.getElementById("modalStandardFooter");
  if (!panel) return;

  const isReviewMode = Boolean(task && (task.status === "review" || task.status === "pending_review"));
  const specPaneVisible = !document.getElementById("modalSpecPane")?.classList.contains("hidden");

  if (!isReviewMode || specPaneVisible) {
    if (!isReviewMode) _activeLandTaskId = null;
    panel.classList.add("hidden");
    if (!isReviewMode) panel.innerHTML = "";
    if (stdFooter) stdFooter.classList.remove("hidden");
    return;
  }

  if (stdFooter) stdFooter.classList.add("hidden");

  const isSameTask = _activeLandTaskId === task.id && panel.innerHTML.trim().length > 0;
  _activeLandTaskId = task.id;
  panel.classList.remove("hidden");
  updateLandButtonTargetBadge(task);

  if (isSameTask) {
    return;
  }

  _landSubjectTouched = false;
  _landBodyTouched = false;
  _commitDrawerExpanded = false;
  _feedbackDrawerExpanded = false;

  const targetBranch = resolveLandTargetBranch(task);
  const initialSubject = buildFallbackSubject(task);
  const initialBody = (task.commitMessage && task.commitMessage.body) ? String(task.commitMessage.body) : "";
  const safeTaskAttr = escapeHtml(task.id);

  panel.innerHTML = `
    <div class="border-t border-slate-200 dark:border-slate-700 bg-slate-50/95 dark:bg-slate-900/95 px-5 py-3 space-y-2.5 flex-shrink-0">
      <!-- 錯誤提示區（平時隱藏） -->
      <div id="reviewLandErrorBox" class="hidden rounded-xl p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60"></div>

      <!-- 可展開的 Commit 詳細編輯抽屜（預設收起，保持上方 Diff 100% 滿版） -->
      <div id="reviewLandCommitDrawer" class="hidden rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2.5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-100">編輯 Commit 訊息與提交選項</span>
          <div class="flex items-center gap-3">
            <button type="button" onclick="regenerateLandCommitMessage('${safeTaskAttr}', true)" class="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> AI 重新整理訊息
            </button>
            <button type="button" onclick="toggleLandCommitDrawer(false)" class="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">收起 ▾</button>
          </div>
        </div>
        <input type="text" id="landSubjectInput" value="${escapeHtml(initialSubject)}" placeholder="輸入簡短提交標題（例如 feat: 完成功能）" class="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none">
        <textarea id="landBodyInput" rows="3" placeholder="補充修改重點（選填）" class="w-full p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none resize-y">${escapeHtml(initialBody)}</textarea>
        <div class="flex items-center justify-between gap-2 pt-0.5">
          <label class="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" id="landArchiveImmediately" class="rounded border-slate-300 text-sky-600 w-3.5 h-3.5 cursor-pointer">
            <span>提交成功後順便移入封存庫（只結案這張卡片，不影響其他任務）</span>
          </label>
          <button type="button" onclick="checkTaskBaseDrift('${safeTaskAttr}')" class="text-xs text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline cursor-pointer">重新檢查分支</button>
        </div>
      </div>

      <!-- 預設單行決策塢（左：分支狀態 + Commit 預覽 ｜ 右：請 AI 再修改 + 通過並提交） -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
          <button type="button" onclick="promptTaskDeleteOrAbandon('${safeTaskAttr}', 'abandon')" class="text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 transition flex-shrink-0 cursor-pointer" title="放棄此任務">
            放棄任務
          </button>
          <div id="reviewLandDriftStatus" class="flex-shrink-0"></div>
          <div onclick="toggleLandCommitDrawer()" class="min-w-0 flex-1 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-sky-400 transition cursor-pointer" title="點擊展開修改 Commit 標題與內文">
            <div class="min-w-0 flex items-center gap-1.5 text-xs">
              <span class="text-slate-400 font-semibold flex-shrink-0">Commit:</span>
              <span id="landCommitPreviewText" class="font-mono text-slate-800 dark:text-slate-100 truncate">${escapeHtml(initialSubject)}</span>
            </div>
            <span id="btnToggleCommitDrawerText" class="text-[11px] font-semibold text-sky-600 dark:text-sky-400 whitespace-nowrap flex-shrink-0">修改訊息 ▴</span>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0 ml-auto">
          <button type="button" onclick="closeModal()" class="px-3 py-2 rounded-xl text-xs font-medium bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer">
            先關閉
          </button>
          <button type="button" id="btnDockRejectTask" onclick="triggerDockRejectFlow(event)" class="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 transition flex items-center gap-1.5 cursor-pointer">
            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
            <span>請 AI 再修改</span>
          </button>
          <button type="button" id="btnLandPanelSubmit" onclick="landTaskChanges(event)" class="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--primary)] hover:opacity-95 text-[var(--primary-foreground)] shadow-sm transition cursor-pointer flex items-center gap-1.5">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i>
            <span>通過並提交</span>
            <span class="px-1.5 py-0.5 rounded bg-black/20 font-mono text-[11px]">⎇ ${escapeHtml(targetBranch)}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const subjectEl = document.getElementById("landSubjectInput");
  const bodyEl = document.getElementById("landBodyInput");
  if (subjectEl) {
    subjectEl.addEventListener("input", () => {
      _landSubjectTouched = true;
      syncCommitPreviewText();
    });
  }
  if (bodyEl) bodyEl.addEventListener("input", () => { _landBodyTouched = true; });

  if (window.lucide) window.lucide.createIcons();
  renderDriftStatusBadge(null, task.id);
  checkTaskBaseDrift(task.id);

  if (!(task.commitMessage && task.commitMessage.subject)) {
    regenerateLandCommitMessage(task.id, false);
  }
}

async function landTaskChanges(event, extraOptions = {}) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  const taskId = document.getElementById("formTaskId")?.value || _activeLandTaskId;
  if (!taskId) return;

  const btnLand = document.getElementById("btnLandPanelSubmit") || document.getElementById("btnLandTask");
  const btnReject = document.getElementById("btnDockRejectTask") || document.getElementById("btnRejectTask");
  const btnSubmit = document.getElementById("btnSubmitTask");
  const subject = (document.getElementById("landSubjectInput")?.value || "").trim();
  const body = (document.getElementById("landBodyInput")?.value || "").trim();
  const archiveImmediately = Boolean(document.getElementById("landArchiveImmediately")?.checked);

  setLandErrorBox("");
  [btnReject, btnSubmit].filter(Boolean).forEach(b => {
    b.disabled = true;
    b.classList.add("opacity-50", "pointer-events-none");
  });

  try {
    await withButtonLoading(btnLand, "提交中...", async () => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/land`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          archiveImmediately,
          ...extraOptions
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const errMsg = data.error || data.message || `提交失敗 (HTTP ${res.status})`;
        const showSwitch = Boolean(
          res.status === 409 ||
          data.status === "dirty_main_workspace" ||
          data.status === "rebase_conflict"
        );
        setLandErrorBox(errMsg, {
          taskId,
          requiresConfirmation: Boolean(data.requiresConfirmation),
          showSwitchWorktree: showSwitch
        });
        showToast(`提交失敗：${errMsg}`);
        return;
      }

      const shortSha = data.gitLanding && data.gitLanding.commitSha
        ? ` (${String(data.gitLanding.commitSha).slice(0, 7)})`
        : "";
      showToast(`任務 ${taskId} 已通過並提交${shortSha}！`);
      if (typeof window.closeModal === "function") window.closeModal();
      await loadData();
    });
  } finally {
    [btnReject, btnSubmit].filter(Boolean).forEach(b => {
      b.disabled = false;
      b.classList.remove("opacity-50", "pointer-events-none");
    });
  }
}

async function switchWorkspaceToWorktreeAndStart(taskId) {
  const id = taskId || document.getElementById("formTaskId")?.value || _activeLandTaskId;
  if (!id) return;
  const task = tasks.find(t => t.id === id) || currentModalEditingTask;

  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(task || {}),
        workspaceMode: "worktree",
        status: "in_progress",
        updatedAt: new Date().toISOString()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    showToast(`任務 ${id} 已切換為獨立工作區並重新開工`);
    if (typeof window.closeModal === "function") window.closeModal();
    await loadData();
  } catch (err) {
    setLandErrorBox(`切換獨立工作區失敗：${err.message}`, { taskId: id });
    showToast(`切換失敗：${err.message}`);
  }
}

export {
  initReviewLandPanel,
  checkTaskBaseDrift,
  landTaskChanges,
  switchWorkspaceToWorktreeAndStart,
  regenerateLandCommitMessage,
  toggleLandCommitDrawer,
  toggleReviewFeedbackDrawer,
  triggerDockRejectFlow
};

if (typeof window !== "undefined") {
  window.initReviewLandPanel = initReviewLandPanel;
  window.checkTaskBaseDrift = checkTaskBaseDrift;
  window.landTaskChanges = landTaskChanges;
  window.switchWorkspaceToWorktreeAndStart = switchWorkspaceToWorktreeAndStart;
  window.regenerateLandCommitMessage = regenerateLandCommitMessage;
  window.toggleLandCommitDrawer = toggleLandCommitDrawer;
  window.toggleReviewFeedbackDrawer = toggleReviewFeedbackDrawer;
  window.triggerDockRejectFlow = triggerDockRejectFlow;
}
