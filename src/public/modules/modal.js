import { projects, tasks, settings, projectGitStatus, currentProject, currentTaskDependencies, currentActiveTaskDiff, currentModalEditingTask, selectedArchivedTaskIds, setTasks, setCurrentModalEditingTask, setCurrentTaskDependencies, setCurrentActiveTaskDiff } from "./state.js";
import { escapeHtml, autoResizeTextarea, resetTextareaHeight, formatDuration, showToast, withButtonLoading, copyPrompt, copySessionId, copyToClipboard } from "./utils.js";
import { renderKanban, renderMetrics } from "./kanban.js";
import { renderDiffViewer, parseDiffStats, filterDiffForFile, showAllDiffs } from "./diffViewer.js";
import { renderExecutionReport } from "./executionReport.js";
import { loadData } from "./app.js";

    function setFormProject(projId) {
      if (!projId) {
        const formProj = document.getElementById('formProject');
        const formProjInput = document.getElementById('formProjectInput');
        if (formProj) formProj.value = '';
        if (formProjInput) formProjInput.value = '';
        updateProjectClearButtonVisibility('');
        hideProjectAutocomplete();
        initSelect2Dropdown('');
        renderSelect2Chips();
        updateDependencyOptions(currentModalEditingTask ? currentModalEditingTask.id : '');
        return;
      }
      const proj = projects.find(p => p.id === projId) || { id: projId, name: projId };
      const formProj = document.getElementById('formProject');
      const formProjInput = document.getElementById('formProjectInput');
      if (formProj) formProj.value = proj.id;
      if (formProjInput) formProjInput.value = proj.name;
      updateProjectClearButtonVisibility(proj.name);
      hideProjectAutocomplete();

      // 切換或選擇專案時：重置下拉選單選項，讓該專案資料夾下的 .github skills 呈現於下拉清單供使用者手動勾選
      initSelect2Dropdown('');
      renderSelect2Chips();
      updateDependencyOptions(currentModalEditingTask ? currentModalEditingTask.id : '');
      updateConfirmationGateForProject(proj.id);
    }

    function updateConfirmationGateForProject(projId) {
      const proj = projects.find(p => p.id === projId);
      const projSkills = (proj && Array.isArray(proj.skills)) ? proj.skills : [];
      const hasGrillMe = projSkills.some(s => s.id === 'grill-me' || s.label === 'grill-me');
      const reqText = document.getElementById('formRequiresConfirmationText');
      const reqCheckbox = document.getElementById('formRequiresConfirmation');
      if (reqText) {
        if (hasGrillMe) {
          reqText.innerHTML = '<span class="text-orange-600 dark:text-orange-400 font-semibold flex items-center gap-1"><i data-lucide="flame" class="w-3 h-3 text-orange-500"></i> 需經 Grill-Me 邊界確認後執行</span>';
        } else {
          reqText.innerText = '需確認後再執行';
        }
      }
      // 新增任務且該專案有 grill-me 時，主動預設勾選邊界確認
      if (!currentModalEditingTask && hasGrillMe && reqCheckbox && !reqCheckbox.checked) {
        reqCheckbox.checked = true;
        toggleFormRequiresConfirmation(true);
      }
      if (window.lucide) lucide.createIcons();
    }

    function clearFormProject(e) {
      if (e) e.stopPropagation();
      const formProj = document.getElementById('formProject');
      const formProjInput = document.getElementById('formProjectInput');
      if (formProj) formProj.value = '';
      if (formProjInput) formProjInput.value = '';
      hideProjectAutocomplete();
      // 清除後顯示完整專案選單，方便重新 key-in 或選擇
      renderProjectAutocompleteList('');
      showProjectAutocomplete();
      initSelect2Dropdown('');
      updateProjectClearButtonVisibility('');
      updateDependencyOptions(currentModalEditingTask ? currentModalEditingTask.id : '');
      updateConfirmationGateForProject('');
      if (window.lucide) lucide.createIcons();
    }

    function updateProjectClearButtonVisibility(val) {
      const clearBtn = document.getElementById('formProjectClearBtn');
      if (!clearBtn) return;
      if (val && val.trim() !== '') {
        clearBtn.classList.remove('opacity-0', 'pointer-events-none');
        clearBtn.classList.add('opacity-100', 'pointer-events-auto');
      } else {
        clearBtn.classList.add('opacity-0', 'pointer-events-none');
        clearBtn.classList.remove('opacity-100', 'pointer-events-auto');
      }
    }

    function showProjectAutocomplete() {
      const input = document.getElementById('formProjectInput');
      const query = (input ? input.value : '').toLowerCase();
      renderProjectAutocompleteList(query);
      const dropdown = document.getElementById('formProjectDropdown');
      if (dropdown) dropdown.classList.remove('hidden');
    }

    function hideProjectAutocomplete() {
      const dropdown = document.getElementById('formProjectDropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }

    function toggleProjectAutocomplete(e) {
      if (e) e.stopPropagation();
      const dropdown = document.getElementById('formProjectDropdown');
      if (!dropdown) return;
      if (dropdown.classList.contains('hidden')) {
        showProjectAutocomplete();
      } else {
        hideProjectAutocomplete();
      }
    }

    function onProjectAutocompleteInput(val) {
      const formProj = document.getElementById('formProject');
      if (formProj) formProj.value = val;
      updateProjectClearButtonVisibility(val || '');
      renderProjectAutocompleteList((val || '').toLowerCase());
      const dropdown = document.getElementById('formProjectDropdown');
      if (dropdown) dropdown.classList.remove('hidden');
    }

    function renderProjectAutocompleteList(query = '') {
      const listEl = document.getElementById('formProjectDropdownList');
      if (!listEl) return;
      const filtered = projects.filter(p => 
        (p.name && p.name.toLowerCase().includes(query)) || 
        (p.id && p.id.toLowerCase().includes(query)) || 
        (p.description && p.description.toLowerCase().includes(query))
      );

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="p-2 text-center text-slate-400 dark:text-slate-500 text-xs"> 無符合的專案 (將以輸入文字儲存)</div>';
        return;
      }

      const currentVal = document.getElementById('formProject') ? document.getElementById('formProject').value : '';

      listEl.innerHTML = filtered.map(p => {
        const isSelected = currentVal === p.id;
        const colorClass = p.color === 'purple' ? 'bg-purple-500' :
                           p.color === 'blue' ? 'bg-blue-500' :
                           p.color === 'emerald' ? 'bg-emerald-500' :
                           p.color === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';
        return `
          <div onclick="setFormProject('${p.id}')" class="p-2 rounded-lg flex items-center justify-between cursor-pointer transition ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'}">
            <div class="flex items-center gap-2 truncate">
              <span class="w-2 h-2 rounded-full ${colorClass} flex-shrink-0"></span>
              <span class="font-medium truncate">${escapeHtml(p.name)}</span>
              ${p.name !== p.id ? `<span class="text-[10px] text-slate-400 font-mono">(${escapeHtml(p.id)})</span>` : ''}
            </div>
            ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-indigo-500"></i>' : ''}
          </div>
        `;
      }).join('');
      if (window.lucide) lucide.createIcons();
    }

    // 依賴任務管理
    function updateDependencyOptions(currentEditingTaskId) {
      const selectEl = document.getElementById('formDependenciesSelect');
      if (!selectEl) return;

      // 取得當前表單所選專案 (若有)
      const currentFormProjId = document.getElementById('formProject') ? document.getElementById('formProject').value : '';

      // 未選擇所屬專案時，關聯任務為 disabled
      if (!currentFormProjId) {
        selectEl.disabled = true;
        selectEl.classList.add('cursor-not-allowed', 'opacity-75');
        selectEl.innerHTML = '<option value=""> 未選擇所屬專案 (請先選擇專案)</option>';
        renderDependencyChips();
        return;
      }

      // 已選擇所屬專案時，依據唯讀狀態設定 disabled
      if (isCurrentModalReadOnly) {
        selectEl.disabled = true;
        selectEl.classList.add('cursor-not-allowed', 'opacity-75');
      } else {
        selectEl.disabled = false;
        selectEl.classList.remove('cursor-not-allowed', 'opacity-75');
      }

      // 僅顯示對應專案的任務紀錄，取消專案分組
      const availableTasks = tasks.filter(t => t.id !== currentEditingTaskId && t.project === currentFormProjId);

      // 由新到舊排序 (依據 createdAt 降序，若無或相同則依據 TASK ID 數字降序)
      availableTasks.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        const numA = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
        return numB - numA;
      });

      if (availableTasks.length === 0) {
        selectEl.innerHTML = '<option value=""> 該專案尚無其他任務紀錄</option>';
      } else {
        let html = '<option value=""> 選擇關聯/前置任務...</option>';
        availableTasks.forEach(t => {
          html += `<option value="${t.id}">[${t.id}] ${escapeHtml(t.title)} (${t.status})</option>`;
        });
        selectEl.innerHTML = html;
      }
      renderDependencyChips();
    }

    function addDependencyFromSelect(taskId) {
      if (!taskId) return;
      if (!currentTaskDependencies.includes(taskId)) {
        currentTaskDependencies.push(taskId);
        renderDependencyChips();
      }
      document.getElementById('formDependenciesSelect').value = '';
    }

    let isCurrentModalReadOnly = false;

    function removeDependency(taskId) {
      if (isCurrentModalReadOnly) return;
      setCurrentTaskDependencies(currentTaskDependencies.filter(id => id !== taskId));
      renderDependencyChips();
    }

    function renderDependencyChips() {
      const container = document.getElementById('formDependenciesChips');
      if (!container) return;
      if (currentTaskDependencies.length === 0) {
        container.innerHTML = '<span class="text-[10px] text-slate-400 italic"> 無前置依賴</span>';
        return;
      }
      container.innerHTML = currentTaskDependencies.map(depId => {
        return `
          <span class="inline-flex items-center gap-1 text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 px-2 py-0.5 rounded-md font-mono">
            <span> ${escapeHtml(depId)}</span>
            ${!isCurrentModalReadOnly ? `<button type="button" onclick="removeDependency('${depId}')" class="text-indigo-400 hover:text-indigo-600 dark:hover:text-white ml-0.5 font-bold">×</button>` : ''}
          </span>
        `;
      }).join('');
    }

    // Select2 標籤體系常數庫與狀態
    const SELECT2_TAG_OPTIONS = {
      git: [
        { id: 'feat', label: 'feat', desc: '新功能 (Feature)' },
        { id: 'fix', label: 'fix', desc: '錯誤修復 (BugFix)' },
        { id: 'refactor', label: 'refactor', desc: '代碼重構' },
        { id: 'perf', label: 'perf', desc: '效能優化' },
        { id: 'test', label: 'test', desc: '測試用例' },
        { id: 'chore', label: 'chore', desc: '日常維護/相依套件' },
        { id: 'docs', label: 'docs', desc: '文件修訂' },
        { id: 'style', label: 'style', desc: '代碼風格/樣式微調' }
      ],
      skill: [
        { id: 'modern-web-guidance', label: 'modern-web-guidance', desc: '現代 Web 最佳實踐' },
        { id: 'a11y-debugging', label: 'a11y-debugging', desc: '無障礙與 ARIA' },
        { id: 'chrome-devtools', label: 'chrome-devtools', desc: 'DevTools 偵錯與自動化' },
        { id: 'google-antigravity-sdk', label: 'google-antigravity-sdk', desc: 'AI Agent SDK' },
        { id: 'generative_ui', label: 'generative_ui', desc: '互動式視覺 UI' },
        { id: 'debug-optimize-lcp', label: 'debug-optimize-lcp', desc: 'LCP / 效能優化' },
        { id: 'memory-leak-debugging', label: 'memory-leak-debugging', desc: '記憶體洩漏診斷' },
        { id: 'troubleshooting', label: 'troubleshooting', desc: '連線與環境排查' }
      ]
    };

    let select2SelectedTags = [];

    function initSelect2Dropdown(query = '') {
      const q = (query || '').toLowerCase().trim();
      const groupGit = document.getElementById('select2GroupGit');
      const groupSkill = document.getElementById('select2GroupSkill');
      const groupProjectSkill = document.getElementById('select2GroupProjectSkill');
      const projectSkillSection = document.getElementById('select2ProjectSkillSection');
      if (!groupGit || !groupSkill) return;

      const currentProjId = document.getElementById('formProject') ? document.getElementById('formProject').value : '';
      const currentProj = projects.find(p => p.id === currentProjId);
      const projectSkills = (currentProj && Array.isArray(currentProj.skills)) ? currentProj.skills : [];

      const filterList = (list) => list.filter(item => item.id.toLowerCase().includes(q) || 
        item.label.toLowerCase().includes(q) || 
        (item.desc && item.desc.toLowerCase().includes(q))
      );

      const filteredGit = filterList(SELECT2_TAG_OPTIONS.git);
      const filteredSkill = filterList(SELECT2_TAG_OPTIONS.skill);
      const filteredProjectSkill = filterList(projectSkills);

      // Render Project Skills (.github)
      if (groupProjectSkill && projectSkillSection) {
        if (projectSkills.length > 0) {
          projectSkillSection.classList.remove('hidden');
          groupProjectSkill.innerHTML = filteredProjectSkill.map(item => {
            const isSelected = select2SelectedTags.includes(item.id);
            return `
              <div onclick="select2ToggleOption('${escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition text-xs ${isSelected ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'}">
                <div class="flex items-center gap-2 truncate">
                  <span class="font-mono font-medium text-purple-600 dark:text-purple-400 truncate">#${escapeHtml(item.label || item.id)}</span>
                  <span class="text-[10px] text-slate-400 truncate">(${escapeHtml(item.desc || '專案技能')})</span>
                </div>
                ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0"></i>' : ''}
              </div>
            `;
          }).join('') || '<div class="text-[10px] text-slate-400 px-2 py-1 italic"> 無符合項目</div>';
        } else {
          projectSkillSection.classList.add('hidden');
          groupProjectSkill.innerHTML = '';
        }
      }

      groupGit.innerHTML = filteredGit.map(item => {
        const isSelected = select2SelectedTags.includes(item.id);
        return `
          <div onclick="select2ToggleOption('${escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition text-xs ${isSelected ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'}">
            <div class="flex items-center gap-2">
              <span class="font-mono font-medium text-blue-600 dark:text-blue-400">#${escapeHtml(item.label)}</span>
              <span class="text-[10px] text-slate-400">(${escapeHtml(item.desc)})</span>
            </div>
            ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-blue-600 dark:text-blue-400"></i>' : ''}
          </div>
        `;
      }).join('') || '<div class="text-[10px] text-slate-400 px-2 py-1 italic"> 無符合項目</div>';

      groupSkill.innerHTML = filteredSkill.map(item => {
        const isSelected = select2SelectedTags.includes(item.id);
        return `
          <div onclick="select2ToggleOption('${escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition text-xs ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 font-bold' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'}">
            <div class="flex items-center gap-2">
              <span class="font-mono font-medium">${escapeHtml(item.label)}</span>
              <span class="text-[10px] text-slate-400">(${escapeHtml(item.desc)})</span>
            </div>
            ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400"></i>' : ''}
          </div>
        `;
      }).join('') || '<div class="text-[10px] text-slate-400 px-2 py-1 italic"> 無符合項目</div>';

      if (window.lucide) lucide.createIcons();
    }

    function toggleSelect2Dropdown(e) {
      if (isCurrentModalReadOnly) return;
      if (e) e.stopPropagation();
      const dropdown = document.getElementById('select2Dropdown');
      const input = document.getElementById('select2Input');
      if (!dropdown) return;
      
      const isOpen = !dropdown.classList.contains('hidden');
      if (isOpen) {
        dropdown.classList.add('hidden');
      } else {
        dropdown.classList.remove('hidden');
        initSelect2Dropdown(input ? input.value : '');
        if (input) input.focus();
      }
    }

    function onSelect2Search(val) {
      if (isCurrentModalReadOnly) return;
      const dropdown = document.getElementById('select2Dropdown');
      if (dropdown) dropdown.classList.remove('hidden');
      initSelect2Dropdown(val);
    }

    function onSelect2KeyDown(e) {
      if (isCurrentModalReadOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById('select2Input');
        const val = (input ? input.value : '').trim();
        if (val) {
          select2AddTag(val);
          input.value = '';
          initSelect2Dropdown('');
        }
      } else if (e.key === 'Backspace' && e.target.value === '' && select2SelectedTags.length > 0) {
        select2SelectedTags.pop();
        syncSelect2ToHiddenInput();
        renderSelect2Chips();
        initSelect2Dropdown('');
      } else if (e.key === 'Escape') {
        document.getElementById('select2Dropdown').classList.add('hidden');
      }
    }

    function select2ToggleOption(tagId) {
      if (isCurrentModalReadOnly) return;
      if (select2SelectedTags.includes(tagId)) {
        select2SelectedTags = select2SelectedTags.filter(t => t !== tagId);
      } else {
        select2SelectedTags.push(tagId);
      }
      const input = document.getElementById('select2Input');
      if (input) input.value = '';
      syncSelect2ToHiddenInput();
      renderSelect2Chips();
      initSelect2Dropdown('');
    }

    function select2AddTag(tagName) {
      if (isCurrentModalReadOnly || !tagName) return;
      if (!select2SelectedTags.includes(tagName)) {
        select2SelectedTags.push(tagName);
        syncSelect2ToHiddenInput();
        renderSelect2Chips();
      }
    }

    function select2RemoveTag(tagToRemove, e) {
      if (isCurrentModalReadOnly) return;
      if (e) e.stopPropagation();
      select2SelectedTags = select2SelectedTags.filter(t => t !== tagToRemove);
      syncSelect2ToHiddenInput();
      renderSelect2Chips();
      initSelect2Dropdown('');
    }

    function syncSelect2ToHiddenInput() {
      const hiddenInput = document.getElementById('formTags');
      if (hiddenInput) {
        hiddenInput.value = select2SelectedTags.join(', ');
      }
    }

    function setSelect2Tags(tagsArray) {
      select2SelectedTags = Array.isArray(tagsArray) ? [...tagsArray] : [];
      syncSelect2ToHiddenInput();
      renderSelect2Chips();
    }

    function renderSelect2Chips() {
      const chipsContainer = document.getElementById('select2Chips');
      const input = document.getElementById('select2Input');
      if (!chipsContainer) return;

      const currentProjId = document.getElementById('formProject') ? document.getElementById('formProject').value : '';
      const currentProj = projects.find(p => p.id === currentProjId);
      const projectSkills = (currentProj && Array.isArray(currentProj.skills)) ? currentProj.skills : [];

      chipsContainer.innerHTML = select2SelectedTags.map(tag => {
        const isGit = SELECT2_TAG_OPTIONS.git.some(g => g.id === tag);
        const isProjectSkill = projectSkills.some(s => s.id === tag);
        const isGlobalSkill = SELECT2_TAG_OPTIONS.skill.some(s => s.id === tag);
        const colorClass = isProjectSkill ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-400/40 font-bold' :
                           isGit ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/40 font-bold' :
                           isGlobalSkill ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400/40 font-semibold' :
                           'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';
        return `
          <span class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${colorClass}">
            ${isProjectSkill ? '<i data-lucide="sparkles" class="w-3 h-3 text-purple-500"></i>' : ''}
            <span>#${escapeHtml(tag)}</span>
            ${!isCurrentModalReadOnly ? `<button type="button" onclick="select2RemoveTag('${escapeHtml(tag)}', event)" class="text-slate-400 hover:text-slate-700 dark:hover:text-white font-bold ml-0.5">×</button>` : ''}
          </span>
        `;
      }).join('');

      if (input) {
        input.placeholder = select2SelectedTags.length === 0 ? '選擇標籤' : '';
      }
      if (window.lucide) lucide.createIcons();
    }

    // 側邊欄與專案切換

    function insertFeedbackPreset(presetText) {
      const fbEl = document.getElementById('formFeedback');
      if (!fbEl) return;
      const current = (fbEl.value || '').trim();
      if (!current) {
        fbEl.value = presetText;
      } else if (!current.includes(presetText)) {
        fbEl.value = `${current}\n- ${presetText}`;
      }
      autoResizeTextarea(fbEl, 48, 200);
      fbEl.focus();
    }

    function insertGrillMeDecision(decisionText) {
      const planEl = document.getElementById('formExecutionPlan');
      if (!planEl) return;
      const current = (planEl.value || '').trim();
      const decisionBlock = `\n\n【Grill-Me 邊界決策】\n${decisionText}`;
      if (!current.includes(decisionText)) {
        planEl.value = current ? `${current}${decisionBlock}` : `【Grill-Me 邊界決策】\n${decisionText}`;
      }
      autoResizeTextarea(planEl, 60, 300);
      planEl.focus();
      showToast(`已套用邊界決策標籤：「${decisionText}」`);
    }


    function switchModalWorkspaceTab(mode = 'review') {
      const reviewPane = document.getElementById('modalReviewPane');
      const specPane = document.getElementById('modalSpecPane');
      const contextSummary = document.getElementById('modalReviewContextSummary');
      const btnReview = document.getElementById('btnModalTabReview');
      const btnSpec = document.getElementById('btnModalTabSpec');
      const isSpec = mode === 'spec';

      if (specPane) specPane.classList.toggle('hidden', !isSpec);
      if (reviewPane) reviewPane.classList.toggle('hidden', isSpec);
      if (contextSummary) contextSummary.classList.toggle('hidden', isSpec || !currentModalEditingTask);

      if (btnReview && btnSpec) {
        btnReview.setAttribute('aria-selected', String(!isSpec));
        btnSpec.setAttribute('aria-selected', String(isSpec));
        const activeClasses = ['bg-white', 'dark:bg-slate-800', 'text-slate-900', 'dark:text-white', 'shadow-xs', 'font-semibold', 'border-slate-300/80', 'dark:border-slate-600'];
        const inactiveClasses = ['border-transparent', 'text-slate-600', 'dark:text-slate-400', 'hover:text-slate-900', 'dark:hover:text-slate-200', 'font-medium', 'hover:bg-white/40', 'dark:hover:bg-slate-800/40'];
        activeClasses.forEach(cls => {
          btnReview.classList.toggle(cls, !isSpec);
          btnSpec.classList.toggle(cls, isSpec);
        });
        inactiveClasses.forEach(cls => {
          btnReview.classList.toggle(cls, isSpec);
          btnSpec.classList.toggle(cls, !isSpec);
        });
      }

      if (currentModalEditingTask && currentModalEditingTask.status !== 'todo') {
        setTimeout(() => {
          if (isSpec) {
            autoResizeTextarea(document.getElementById('formDescription'), 72, 380);
          } else {
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
      const defaultProj = initialData.project || '';
      setFormProject(defaultProj);

      document.getElementById('formAssignee').value = initialData.assignee || (settings.enableCliAgent ? 'CLI' : 'Antigravity');

      updateDependencyOptions('');
      setSelect2Tags([]);

      // 新增任務時：隱藏分頁切換器與審查回饋區塊，直接聚焦需求規格輸入
      const workspaceTabs = document.getElementById('modalLeftWorkspaceTabs');
      if (workspaceTabs) {
        workspaceTabs.classList.add('hidden');
        workspaceTabs.classList.remove('flex');
      }
      document.getElementById('modalReviewContextSummary')?.classList.add('hidden');
      document.getElementById('modalSpecPane')?.classList.remove('hidden');
      document.getElementById('modalReviewPane')?.classList.add('hidden');
      document.getElementById('reviewFeedbackBox').classList.add('hidden');
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
      toggleFormRequiresConfirmation(!!initialData.requiresConfirmation);

      setModalFieldsReadOnly(false);
      updateModalButtonState();

      document.getElementById('taskModal').classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    function setModalFieldsReadOnly(isReadOnly) {
      isCurrentModalReadOnly = !!isReadOnly;

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

      // 2. 所有文字與文字區塊欄位 readonly (若任務處於待確認狀態，執行計劃 formExecutionPlan 允許使用者進行修改)
      const textInputs = ['formTitle', 'formProjectInput', 'formDescription', 'formFeedback', 'select2Input'];
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

      // 7. 隱藏執行紀錄與測試 Log 區塊 (進行中任務不需顯示)
      const logBox = document.getElementById('formLogBox');
      if (logBox && isReadOnly) {
        logBox.classList.add('hidden');
      }

      // 8. 儲存與刪除/放棄按鈕鎖定 (避免中途異動)
      const btnSubmit = document.getElementById('btnSubmitTask');
      const btnDelete = document.getElementById('btnDeleteTask');
      const btnAbandon = document.getElementById('btnAbandonTask');
      if (btnSubmit) {
        if (isReadOnly) {
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

      // 嚴格規定：進行中任務不需顯示執行紀錄與測試 Log 區塊，維持畫面簡潔並聚焦切片
      const logBox = document.getElementById('formLogBox');
      if (logBox) {
        logBox.classList.add('hidden');
      }
    }

    function shouldShowReviewWorkspace(task) {
      if (!task) return false;
      if (task.status !== 'todo') return true;
      return !!((task.executionLog || '').trim() || (task.feedback || '').trim() || (task.executionPlan || '').trim());
    }

    function openModalForEdit(id) {
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      setCurrentModalEditingTask(task);

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
      setFormProject(task.project || '');
      document.getElementById('formPriority').value = task.priority || 'P1';
      document.getElementById('formStatus').value = task.status || 'todo';
      document.getElementById('formAssignee').value = task.assignee || (settings.enableCliAgent ? 'CLI' : 'Antigravity');
      document.getElementById('formDescription').value = task.description || '';
      if (task.status === 'review' || task.status === 'done' || task.status === 'archived') {
        document.getElementById('formFeedback').value = '';
      } else {
        document.getElementById('formFeedback').value = task.feedback || '';
      }

      const reqConfirmEl = document.getElementById('formRequiresConfirmation');
      if (reqConfirmEl) reqConfirmEl.checked = !!task.requiresConfirmation;
      const execPlanEl = document.getElementById('formExecutionPlan');
      if (execPlanEl) execPlanEl.value = task.executionPlan || '';
      toggleFormRequiresConfirmation(!!task.requiresConfirmation);

      // 設定 Select2 標籤
      setSelect2Tags(task.tags || []);

      // 依賴任務
      setCurrentTaskDependencies(Array.isArray(task.dependencies) ? [...task.dependencies] : []);
      updateDependencyOptions(task.id);

      // 根據任務狀態設定全域欄位唯讀 (進行中任務所有欄位皆改為 readonly，避免中途異動)
      setModalFieldsReadOnly(task.status === 'in_progress');

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
        if (task.modifiedFiles && task.modifiedFiles.length > 0) {
          const stats = parseDiffStats(task.diff || '');
          modFilesList.innerHTML = task.modifiedFiles.map(f => {
            const filePath = typeof f === 'string' ? f : f.path;
            const desc = (typeof f === 'object' && f.description) ? f.description : '';
            const baseName = filePath.split('/').pop();
            const fStat = (stats.filesMap && (stats.filesMap[filePath] || stats.filesMap[baseName])) || { status: 'M', additions: 0, deletions: 0 };
            const status = fStat.status || 'M';
            const statusBadge = status === 'A'
              ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">A</span>'
              : (status === 'D'
                ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">D</span>'
                : '<span class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">M</span>');
            const linesStat = (fStat.additions > 0 || fStat.deletions > 0)
              ? `<span class="text-[10px] font-mono flex items-center gap-1"><span class="text-emerald-600 font-bold">+${fStat.additions}</span><span class="text-rose-600 font-bold">-${fStat.deletions}</span></span>`
              : '';

            return `
              <div data-path="${escapeHtml(filePath)}" onclick="filterDiffForFile('${escapeHtml(filePath)}')" class="mod-file-item flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer transition">
                <div class="flex items-center gap-2 truncate">
                  ${statusBadge}
                  <span class="text-indigo-600 dark:text-indigo-300 font-semibold truncate text-xs font-mono">${escapeHtml(filePath)}</span>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  ${linesStat}
                  <span class="text-slate-500 dark:text-slate-400 text-[10px] truncate max-w-xs">${escapeHtml(desc || '查看 Diff')}</span>
                </div>
              </div>
            `;
          }).join('');
        } else {
          modFilesList.innerHTML = '<div class="text-center py-2 text-slate-400 text-xs italic"> 尚未有異動檔案紀錄</div>';
        }

        // 執行紀錄 (自然完整展開，不加內部滾軸)
        if (task.executionLog) {
          logBox.classList.remove('hidden');
          logVisual.innerText = task.executionLog;
          renderExecutionReport(task);
        } else {
          logBox.classList.add('hidden');
        }
      }

      // 右欄：Git Diff 檢視器 (若有異動檔案則預設呈現第一個檔案，否則顯示全部)
      if (task.modifiedFiles && task.modifiedFiles.length > 0) {
        const firstFile = typeof task.modifiedFiles[0] === 'string' ? task.modifiedFiles[0] : task.modifiedFiles[0].path;
        filterDiffForFile(firstFile);
      } else {
        showAllDiffs();
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
      updateModalButtonState();

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
        document.getElementById('modalReviewContextSummary')?.classList.add('hidden');
        document.getElementById('modalSpecPane')?.classList.remove('hidden');
        document.getElementById('modalReviewPane')?.classList.add('hidden');
        document.getElementById('reviewFeedbackBox')?.classList.add('hidden');
        document.getElementById('formSliceInfoBox')?.classList.add('hidden');
      } else {
        const reviewDot = document.getElementById('modalTabReviewStatusDot');
        if (reviewDot) {
          const needsReviewAttention = task.status === 'review' || (task.status === 'in_progress' && !!task.requiresConfirmation && !!(task.executionPlan || '').trim());
          reviewDot.classList.toggle('hidden', !needsReviewAttention);
        }
        switchModalWorkspaceTab('review');
      }

      document.getElementById('taskModal').classList.remove('hidden');

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
      const status = document.getElementById('formStatus').value;
      const taskId = document.getElementById('formTaskId').value;
      const btnApprove = document.getElementById('btnApproveTask');
      const btnReject = document.getElementById('btnRejectTask');
      const btnSubmit = document.getElementById('btnSubmitTask');
      const reviewFeedbackBox = document.getElementById('reviewFeedbackBox');
      const rightCol = document.getElementById('modalRightColumn');
      const dialogEl = document.getElementById('modalDialogContainer');
      const formGrid = document.getElementById('modalFormGrid');
      const leftCol = document.getElementById('modalLeftColumn');

      // 待處理、進行中或新增任務時：隱藏審查回饋、異動檔案與 Git Diff，左側欄位 100% 滿版展開
      const isSimpleMode = (status === 'todo' || status === 'in_progress' || !taskId);

      if (isSimpleMode) {
        if (reviewFeedbackBox) reviewFeedbackBox.classList.add('hidden');
        if (rightCol) rightCol.classList.add('hidden');
        if (formGrid) {
          formGrid.className = 'grid grid-cols-1 gap-5 flex-1 min-h-0 p-5 overflow-hidden';
        }
        if (leftCol) {
          leftCol.className = 'flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar w-full';
        }
        if (dialogEl) {
          dialogEl.className = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100 transition-all';
        }
      } else {
        if (reviewFeedbackBox) reviewFeedbackBox.classList.remove('hidden');
        if (rightCol) rightCol.classList.remove('hidden');
        if (formGrid) {
          formGrid.className = 'grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1 min-h-0 p-5 overflow-hidden';
        }
        if (leftCol) {
          leftCol.className = 'flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar';
        }
        if (dialogEl) {
          dialogEl.className = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100 transition-all';
        }
      }

      const btnArchiveModal = document.getElementById('btnArchiveTaskModal');
      const btnCommitModal = document.getElementById('btnCommitTaskModal');
      const currentProjectVal = document.getElementById('formProject').value || 'task-dashboard';
      const proj = projects.find(p => p.id === currentProjectVal);
      const projSkills = (proj && Array.isArray(proj.skills)) ? proj.skills : [];
      const hasCommitSkill = projSkills.some(s => 
        (s.id && (s.id.includes('commit') || s.id.includes('git-workflow') || s.id.includes('versioning'))) ||
        (s.label && (s.label.includes('commit') || s.label.includes('git-workflow'))) ||
        (s.desc && /commit|conventional/i.test(s.desc))
      );

      // 檢查是否為該專案最新已完成任務且有未提交之異動
      const newestDoneTaskIdByProject = {};
      const allDoneTasks = tasks.filter(t => t.status === 'done');
      allDoneTasks.forEach(t => {
        const projKey = t.project || 'default';
        const cur = newestDoneTaskIdByProject[projKey];
        const tTime = new Date(t.updatedAt || t.createdAt || 0).getTime();
        if (!cur || tTime > cur.time) {
          newestDoneTaskIdByProject[projKey] = { id: t.id, time: tTime };
        }
      });
      const isLatestInProj = (!taskId) || (newestDoneTaskIdByProject[currentProjectVal]?.id === taskId);
      const projGit = projectGitStatus[currentProjectVal];
      const hasDiff = projGit ? projGit.hasDiff : false;

      // 只有「已完成 (done)」且為該專案最新任務且有異動時，才在彈窗顯示 Commit 按鈕
      // 尚未驗收 (todo, in_progress, review) 絕不顯示 Commit 按鈕
      if (btnCommitModal) {
        if (status === 'done' && isLatestInProj && hasDiff && taskId) {
          btnCommitModal.classList.remove('hidden');
          btnCommitModal.title = hasCommitSkill ? '專案配備 Commit 規範技能，點擊開啟 Agent 產出與提交確認' : '點擊開啟 Git Commit 提交確認彈窗';
        } else {
          btnCommitModal.classList.add('hidden');
        }
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
          if (hasExecutionPlan) {
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

      if (status === 'review') {
        btnApprove.classList.remove('hidden');
        btnReject.classList.remove('hidden');
        if (btnArchiveModal) btnArchiveModal.classList.add('hidden');
        btnSubmit.innerHTML = '僅儲存內容';
        btnSubmit.className = 'bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-lg transition';
      } else if (status === 'done') {
        btnApprove.classList.add('hidden');
        btnReject.classList.add('hidden');
        if (btnArchiveModal) btnArchiveModal.classList.remove('hidden');
        btnSubmit.innerHTML = '儲存變更';
        btnSubmit.className = 'bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow-md shadow-indigo-500/25 transition';
      } else {
        btnApprove.classList.add('hidden');
        btnReject.classList.add('hidden');
        if (btnArchiveModal) btnArchiveModal.classList.add('hidden');
        btnSubmit.innerHTML = '儲存變更';
        btnSubmit.className = 'bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow-md shadow-indigo-500/25 transition';
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
          executionPlan
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
          const confirmLog = '\n[' + nowIso + '] ✅ [Confirmation Gate] 使用者已審閱並確認執行計劃，正式授權進入實作階段！\n----------------------------------------\n';
          const newExecutionLog = (task.executionLog || '') + confirmLog;
          const formExecPlan = (document.getElementById('formExecutionPlan')?.value || '').trim();
          const currentPlan = formExecPlan || task.executionPlan || '';
          const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...task,
              requiresConfirmation: false,
              confirmExecution: true,
              executionPlan: currentPlan,
              executionLog: newExecutionLog,
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

      if (task.commitMessage && task.commitMessage.subject && !isLegacyDesc) {
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

      // 若尚未有 Agent 生成的 commitMessage 或為舊版複製內容，自動非同步向後端獲取依據 diff 分析的 commit 內容
      if (!task.commitMessage || !task.commitMessage.subject || isLegacyDesc) {
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

    function closeCommitModal() {
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
      await withButtonLoading(submitBtn, '提交中...', async () => {
        try {
          showToast(`正在提交 Commit 並封存任務...`);
          const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customSubject: subject, customBody: body })
          });
          const result = await res.json();
          const arcMsg = result.archivedTaskIds && result.archivedTaskIds.length > 0
            ? `，已將 ${result.archivedTaskIds.length} 個已完成任務移入封存庫 `
            : '';
          showToast(`[${taskId}] Commit 成功！${result.message || ''}${arcMsg}`);
          closeCommitModal();
          closeModal();
          await loadData();
        } catch (err) {
          showToast(`Commit 失敗: ${err.message}`);
        }
      });
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

    // ===== 封存任務管理 (Archive Modal) =====
    let selectedArchiveTaskIds = new Set();

    function openArchiveModal() {
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

      renderArchiveTasksList();
      document.getElementById('archiveModal').classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }

    function closeArchiveModal() {
      document.getElementById('archiveModal').classList.add('hidden');
    }

    function renderArchiveTasksList() {
      const listEl = document.getElementById('archiveTasksList');
      const totalCountLabel = document.getElementById('archiveTotalCountLabel');
      const selectedCountLabel = document.getElementById('archiveSelectedCountLabel');
      const filterProj = document.getElementById('archiveProjectFilter') ? document.getElementById('archiveProjectFilter').value : 'ALL';

      let archived = tasks.filter(t => t.status === 'archived');
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
                <h4 class="text-xs font-bold text-slate-800 dark:text-slate-200 truncate" title="${escapeHtml(t.title)}">
                  ${escapeHtml(t.title)}
                </h4>
                ${t.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml(t.description)}</p>` : ''}
              </div>
            </div>

            <!-- 操作按鈕 -->
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button onclick="openModalForEdit('${t.id}')" title="檢視詳情與 Diff" class="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-xs flex items-center gap-1 transition">
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
      let archived = tasks.filter(t => t.status === 'archived');
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
          renderArchiveTasksList();
        } catch (err) {
          showToast(`刪除失敗: ${err.message}`);
        }
      });
    }

    async function deleteAllArchivedTasks(event) {
      const archivedCount = tasks.filter(t => t.status === 'archived').length;
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
          renderArchiveTasksList();
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
          renderArchiveTasksList();
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
          renderArchiveTasksList();
        } catch (err) {
          showToast(`還原失敗: ${err.message}`);
        }
      });
    }

    async function deleteSingleArchivedTask(id, event) {
      promptTaskDeleteOrAbandon(id, 'delete', event);
    }

    let currentPendingAction = null; // { taskId, actionType: 'delete' | 'abandon', task: ... }

    async function promptTaskDeleteOrAbandon(id, actionType = 'delete', event) {
      if (event) {
        event.stopPropagation();
      }
      if (!id) return;
      const task = tasks.find(t => t.id === id);
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
      const descEl = document.getElementById('formDescription');
      if (descEl) {
        descEl.rows = 8;
        resetTextareaHeight(descEl);
      }
      resetTextareaHeight(document.getElementById('formExecutionPlan'));
      resetTextareaHeight(document.getElementById('formFeedback'));
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
  confirmCommitTask,
  commitTaskFromCard,
  archiveTaskFromCard,
  archiveCurrentTaskFromModal,
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
  window.saveTask = saveTask;
  window.toggleFormRequiresConfirmation = toggleFormRequiresConfirmation;
  window.confirmAndExecuteTask = confirmAndExecuteTask;
  window.approveTaskAsDone = approveTaskAsDone;
  window.rejectTaskWithFeedback = rejectTaskWithFeedback;
  window.submitTaskForReview = submitTaskForReview;
  window.quickApproveDone = quickApproveDone;
  window.openCommitModal = openCommitModal;
  window.closeCommitModal = closeCommitModal;
  window.confirmCommitTask = confirmCommitTask;
  window.commitTaskFromCard = commitTaskFromCard;
  window.archiveTaskFromCard = archiveTaskFromCard;
  window.archiveCurrentTaskFromModal = archiveCurrentTaskFromModal;
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
  window.closeModal = closeModal;
}
