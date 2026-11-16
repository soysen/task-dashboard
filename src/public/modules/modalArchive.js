import { projects, tasks, archivedTasks, selectedArchivedTaskIds, setArchivedTasks, setArchivedTasksCount } from "./state.js";
import { escapeHtml, showToast, withButtonLoading } from "./utils.js";
import { loadData } from "./app.js";
import { openModalForEdit, promptTaskDeleteOrAbandon } from "./modal.js";

    let selectedArchiveTaskIds = new Set();
    let archiveLoadSeq = 0;
    let isLoadingArchivedTasks = false;

    async function loadArchivedTasks() {
      const reqId = ++archiveLoadSeq;
      isLoadingArchivedTasks = true;
      try {
        const res = await fetch('/api/tasks/archived?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (reqId === archiveLoadSeq && Array.isArray(data)) {
            setArchivedTasks(data);
            setArchivedTasksCount(data.length);
            const archiveBadge = document.getElementById('headerArchiveCountBadge');
            if (archiveBadge) archiveBadge.innerText = data.length;
            return data;
          }
        }
      } catch (err) {
        console.error('Error loading archived tasks:', err);
      } finally {
        if (reqId === archiveLoadSeq) {
          isLoadingArchivedTasks = false;
        }
      }
      return archivedTasks;
    }

    async function openArchiveModal() {
      selectedArchiveTaskIds.clear();
      const selectAllCb = document.getElementById('archiveSelectAllCheckbox');
      if (selectAllCb) selectAllCb.checked = false;

      // 填充專案篩選下拉選單
      const projFilter = document.getElementById('archiveProjectFilter');
      if (projFilter) {
        const currentVal = projFilter.value || 'ALL';
        projFilter.innerHTML = '<option value="ALL"> 全部專案</option>' + projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        projFilter.value = currentVal;
      }

      const modalEl = document.getElementById('archiveModal');
      if (modalEl) modalEl.classList.remove('hidden');
      const listEl = document.getElementById('archiveTasksList');
      if (listEl && archivedTasks.length === 0) {
        listEl.innerHTML = '<div class="h-48 flex items-center justify-center text-xs text-slate-400">載入封存任務中...</div>';
      }

      const reqIdBefore = archiveLoadSeq + 1;
      await loadArchivedTasks();
      if (reqIdBefore === archiveLoadSeq) {
        renderArchiveTasksList();
        if (window.lucide) lucide.createIcons();
      }
    }

    function closeArchiveModal() {
      document.getElementById('archiveModal').classList.add('hidden');
    }

    function renderArchiveTasksList() {
      const listEl = document.getElementById('archiveTasksList');
      const totalCountLabel = document.getElementById('archiveTotalCountLabel');
      const selectedCountLabel = document.getElementById('archiveSelectedCountLabel');
      const filterProj = document.getElementById('archiveProjectFilter') ? document.getElementById('archiveProjectFilter').value : 'ALL';

      let archived = [...archivedTasks];
      if (filterProj !== 'ALL') {
        archived = archived.filter(t => t.project === filterProj);
      }

      // 由新到舊排序
      archived.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

      if (totalCountLabel) totalCountLabel.innerText = `共 ${archived.length} 筆封存任務`;
      if (selectedCountLabel) selectedCountLabel.innerText = `已選取 ${selectedArchiveTaskIds.size} 項`;

      if (archived.length === 0) {
        listEl.innerHTML = `
          <div class="h-48 flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <i data-lucide="archive-restore" class="w-10 h-10 text-slate-400 mb-2 opacity-60"></i>
            <span class="text-xs font-medium"> 目前封存庫中無任何任務</span>
            <span class="text-[11px] text-slate-400 mt-0.5"> 當您在「已完成」欄位執行 Commit 後，任務將自動封存於此。</span>
          </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
      }

      listEl.innerHTML = archived.map(t => {
        const proj = projects.find(p => p.id === t.project);
        const projName = proj ? proj.name : (t.project || '未指定專案');
        const isChecked = selectedArchiveTaskIds.has(t.id);
        const dateStr = t.updatedAt ? new Date(t.updatedAt).toLocaleString('zh-TW', { hour12: false }) : (t.createdAt || '');

        return `
          <div class="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl flex items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-600 transition">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <input type="checkbox" data-archive-id="${t.id}" ${isChecked ? 'checked' : ''} onchange="toggleArchiveTaskSelect('${t.id}', this.checked)" class="rounded text-indigo-600 w-4 h-4 flex-shrink-0 cursor-pointer">
              
              <div class="flex-1 min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 font-bold">${t.id}</span>
                  <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 font-mono truncate max-w-[120px]" title="${escapeHtml(projName)}">
                     ${escapeHtml(projName)}
                  </span>
                  <span class="text-[10px] text-slate-400 font-mono"> ${dateStr}</span>
                </div>
                <h4 onclick="openModalForEdit('${t.id}', { fromArchive: true })" class="text-xs font-bold text-slate-800 dark:text-slate-200 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition" title="${escapeHtml(t.title)}">
                  ${escapeHtml(t.title)}
                </h4>
                ${t.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml(t.description)}</p>` : ''}
              </div>
            </div>

            <!-- 操作按鈕 -->
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button onclick="openModalForEdit('${t.id}', { fromArchive: true })" title="檢視詳情與 Diff" class="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-xs flex items-center gap-1 transition">
                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline text-[11px]"> 查看</span>
              </button>
              <button onclick="restoreSingleArchivedTask('${t.id}', event)" title="還原至已完成欄位" class="text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-xs flex items-center gap-1 transition">
                <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline text-[11px]"> 還原</span>
              </button>
              <button onclick="deleteSingleArchivedTask('${t.id}', event)" title="永久刪除此任務" class="text-rose-600 hover:text-rose-500 dark:text-rose-400 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-xs flex items-center gap-1 transition">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span class="hidden sm:inline text-[11px]"> 刪除</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      if (window.lucide) lucide.createIcons();
    }

    function toggleArchiveTaskSelect(id, checked) {
      if (checked) {
        selectedArchiveTaskIds.add(id);
      } else {
        selectedArchiveTaskIds.delete(id);
      }
      const selectedCountLabel = document.getElementById('archiveSelectedCountLabel');
      if (selectedCountLabel) selectedCountLabel.innerText = `已選取 ${selectedArchiveTaskIds.size} 項`;
    }

    function toggleArchiveSelectAll(checked) {
      const filterProj = document.getElementById('archiveProjectFilter') ? document.getElementById('archiveProjectFilter').value : 'ALL';
      let archived = [...archivedTasks];
      if (filterProj !== 'ALL') {
        archived = archived.filter(t => t.project === filterProj);
      }

      if (checked) {
        archived.forEach(t => selectedArchiveTaskIds.add(t.id));
      } else {
        selectedArchiveTaskIds.clear();
      }
      renderArchiveTasksList();
    }

    async function batchDeleteSelectedArchived(event) {
      if (selectedArchiveTaskIds.size === 0) {
        showToast('請先勾選要刪除的封存任務！');
        return;
      }
      const count = selectedArchiveTaskIds.size;
      if (!confirm(`確定要永久刪除已選取的 ${count} 筆封存任務嗎？此操作無法復原。`)) {
        return;
      }

      const btn = event ? event.currentTarget : document.getElementById('btnBatchDeleteArchived');
      await withButtonLoading(btn, '刪除中...', async () => {
        try {
          const res = await fetch('/api/tasks/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: Array.from(selectedArchiveTaskIds) })
          });
          const data = await res.json();
          showToast(`已成功刪除 ${count} 筆封存任務！`);
          selectedArchiveTaskIds.clear();
          await loadData();
          if (!document.getElementById('archiveModal').classList.contains('hidden')) {
            await loadArchivedTasks();
            renderArchiveTasksList();
          }
        } catch (err) {
          showToast(`刪除失敗: ${err.message}`);
        }
      });
    }

    async function deleteAllArchivedTasks(event) {
      const archivedCount = archivedTasks.length;
      if (archivedCount === 0) {
        showToast('目前沒有任何封存任務需要清空。');
        return;
      }
      if (!confirm(` 確定要清空全部 ${archivedCount} 筆封存任務嗎？\n此操作將永久從資料庫刪除所有已封存任務，無法復原！`)) {
        return;
      }

      const btn = event ? event.currentTarget : document.getElementById('btnDeleteAllArchived');
      await withButtonLoading(btn, '清空中...', async () => {
        try {
          const res = await fetch('/api/tasks/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allArchived: true })
          });
          const data = await res.json();
          showToast(`已清空所有封存任務 (${archivedCount} 筆)！`);
          selectedArchiveTaskIds.clear();
          await loadData();
          if (!document.getElementById('archiveModal').classList.contains('hidden')) {
            await loadArchivedTasks();
            renderArchiveTasksList();
          }
        } catch (err) {
          showToast(`清空失敗: ${err.message}`);
        }
      });
    }

    async function batchRestoreSelectedArchived(event) {
      if (selectedArchiveTaskIds.size === 0) {
        showToast('請先勾選要還原的封存任務！');
        return;
      }
      const count = selectedArchiveTaskIds.size;

      const btn = event ? event.currentTarget : document.getElementById('btnBatchRestoreArchived');
      await withButtonLoading(btn, '還原中...', async () => {
        try {
          const res = await fetch('/api/tasks/batch-restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: Array.from(selectedArchiveTaskIds) })
          });
          const data = await res.json();
          showToast(`已成功還原 ${count} 筆任務至「已完成」欄位！`);
          selectedArchiveTaskIds.clear();
          await loadData();
          if (!document.getElementById('archiveModal').classList.contains('hidden')) {
            await loadArchivedTasks();
            renderArchiveTasksList();
          }
        } catch (err) {
          showToast(`還原失敗: ${err.message}`);
        }
      });
    }

    async function restoreSingleArchivedTask(id, event) {
      const btn = event ? event.currentTarget : null;
      await withButtonLoading(btn, '還原中...', async () => {
        try {
          await fetch('/api/tasks/batch-restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: [id] })
          });
          showToast(`已還原任務 ${id} 至「已完成」！`);
          selectedArchiveTaskIds.delete(id);
          await loadData();
          if (!document.getElementById('archiveModal').classList.contains('hidden')) {
            await loadArchivedTasks();
            renderArchiveTasksList();
          }
        } catch (err) {
          showToast(`還原失敗: ${err.message}`);
        }
      });
    }

    async function deleteSingleArchivedTask(id, event) {
      promptTaskDeleteOrAbandon(id, 'delete', event);
    }

export {
  selectedArchiveTaskIds,
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
  deleteSingleArchivedTask
};
