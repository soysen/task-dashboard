import { projects, tasks, archivedTasks, currentBranch, projectBranchesMap, currentTaskDependencies, currentModalEditingTask, setCurrentTaskDependencies, setProjectBranchesMap } from "./state.js";
import { escapeHtml, autoResizeTextarea, showToast } from "./utils.js";
import { loadProjectBranches } from "./branchNavigator.js";

    function setFormProject(projId, options = {}) {
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
        if (typeof onFormProjectChangeLoadBranches === 'function') {
          onFormProjectChangeLoadBranches('', '');
        }
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
      if (typeof onFormProjectChangeLoadBranches === 'function') {
        onFormProjectChangeLoadBranches(proj.id, options.targetBranch);
      }
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

    let dependencySummaryMap = {};

    // 依賴任務管理
    async function updateDependencyOptions(currentEditingTaskId) {
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

      // 透過輕量 API 取得專案全量任務清單（包含已歸檔任務，符合 Context Engineering 規範）
      let availableTasks = [];
      try {
        const res = await fetch(`/api/tasks/dependencies-summary?project=${encodeURIComponent(currentFormProjId)}&t=${Date.now()}`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            list.forEach(item => {
              if (item && item.id) dependencySummaryMap[item.id] = item;
            });
            availableTasks = list.filter(t => t.id !== currentEditingTaskId);
          }
        }
      } catch (err) {
        console.warn('Failed to load dependency summaries, using fallback:', err);
      }

      // 降級回退：若 API 查詢失敗或為空，使用記憶體中 tasks
      if (availableTasks.length === 0) {
        availableTasks = tasks.filter(t => t.id !== currentEditingTaskId && t.project === currentFormProjId);
        availableTasks.forEach(item => {
          if (item && item.id) dependencySummaryMap[item.id] = item;
        });
      }

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
          const stText = t.status === 'archived' ? '已封存' : (t.status === 'done' ? '已完成' : t.status);
          html += `<option value="${t.id}">[${t.id}] ${escapeHtml(t.title)} (${stText})</option>`;
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
    function setIsCurrentModalReadOnly(val) {
      isCurrentModalReadOnly = !!val;
    }

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
        const depInfo = tasks.find(t => t.id === depId) || archivedTasks.find(t => t.id === depId) || dependencySummaryMap[depId];
        const depTitle = depInfo ? depInfo.title : '';
        const depStatus = depInfo ? depInfo.status : '';
        const statusLabel = depStatus === 'archived' ? '封存' : (depStatus === 'done' ? '完成' : depStatus);
        const statusClass = depStatus === 'archived'
          ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
          : (depStatus === 'done'
            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
            : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300');
        const statusBadge = statusLabel ? `<span class="text-[9px] px-1 py-0.2 rounded font-mono ${statusClass}">${statusLabel}</span>` : '';

        return `
          <span class="inline-flex items-center gap-1.5 text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 px-2 py-0.5 rounded-md font-mono">
            <span onclick="openModalForEdit('${escapeHtml(depId)}')" class="cursor-pointer hover:underline flex items-center gap-1" title="${escapeHtml(depTitle ? `${depId}: ${depTitle} (${statusLabel || '檢視'})` : `點擊檢視 ${depId}`)}">
              <span>${escapeHtml(depId)}</span>
              ${statusBadge}
            </span>
            ${!isCurrentModalReadOnly ? `<button type="button" onclick="event.stopPropagation(); removeDependency('${depId}')" class="text-indigo-400 hover:text-indigo-600 dark:hover:text-white ml-0.5 font-bold cursor-pointer">×</button>` : ''}
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

    async function onFormProjectChangeLoadBranches(projId, preselectBranch) {
      const targetSelect = document.getElementById('formTargetBranch');
      const fromSelect = document.getElementById('formQuickBranchFrom');
      const fromLabel = document.getElementById('formQuickBranchFromLabel');
      const toggleBtn = document.getElementById('btnToggleQuickBranchBox');

      if (!projId) {
        if (targetSelect) {
          targetSelect.innerHTML = '<option value="">（不指定 / 跟隨專案預設分支）</option>';
          targetSelect.value = '';
        }
        if (fromSelect) fromSelect.innerHTML = '';
        if (fromLabel) fromLabel.innerText = 'main';
        if (toggleBtn) toggleBtn.classList.add('hidden');
        toggleQuickBranchBox(false);
        updateInPlaceDirtyWarning();
        return;
      }

      if (toggleBtn) toggleBtn.classList.remove('hidden');
      let branchData = projectBranchesMap[projId];
      if (!branchData) {
        branchData = await loadProjectBranches(projId, false);
      }

      // 確認載入完成後表單仍維持同一個專案
      const currentFormProj = document.getElementById('formProject')?.value || '';
      if (currentFormProj && currentFormProj !== projId) return;

      const branches = (branchData && Array.isArray(branchData.branches)) ? branchData.branches : [];
      const isGitRepo = !branchData || branchData.isGitRepo !== false;

      if (toggleBtn) toggleBtn.classList.toggle('hidden', !isGitRepo);

      if (targetSelect) {
        const optionList = ['<option value="">（不指定 / 跟隨專案預設分支）</option>'];
        branches.forEach(b => {
          optionList.push(`<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}${b.isCurrentCheckout ? ' (目前)' : ''}</option>`);
        });
        if (preselectBranch && !branches.some(b => b.name === preselectBranch)) {
          optionList.push(`<option value="${escapeHtml(preselectBranch)}">${escapeHtml(preselectBranch)}</option>`);
        }
        targetSelect.innerHTML = optionList.join('');

        if (preselectBranch !== undefined) {
          targetSelect.value = preselectBranch;
        } else if (!currentModalEditingTask) {
          const fallback = (currentBranch && currentBranch !== 'ALL')
            ? currentBranch
            : (branchData?.currentCheckoutBranch || branchData?.defaultBranch || '');
          targetSelect.value = fallback && Array.from(targetSelect.options).some(o => o.value === fallback) ? fallback : '';
        }
      }

      if (fromSelect) {
        const defaultFrom = branchData?.defaultBranch || branchData?.currentCheckoutBranch || 'main';
        const fromNames = branches.map(b => b.name);
        if (defaultFrom && !fromNames.includes(defaultFrom)) fromNames.unshift(defaultFrom);
        fromSelect.innerHTML = fromNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        fromSelect.value = defaultFrom;
        if (fromLabel) fromLabel.innerText = fromSelect.value || 'main';
      }

      updateInPlaceDirtyWarning();
    }

    function selectWorkspaceMode(mode) {
      const normalized = (mode === 'worktree' || mode === 'branch_stream' || mode === 'in_place') ? mode : 'worktree';
      const hiddenInput = document.getElementById('formWorkspaceMode');
      if (hiddenInput) hiddenInput.value = normalized;

      const buttons = document.querySelectorAll('#formWorkspaceModeGroup [data-workspace-mode]');
      buttons.forEach(btn => {
        const btnMode = btn.getAttribute('data-workspace-mode');
        const active = btnMode === normalized;
        btn.classList.toggle('border-indigo-500', active);
        btn.classList.toggle('bg-indigo-50', active);
        btn.classList.toggle('dark:bg-indigo-950/50', active);
        btn.classList.toggle('text-indigo-700', active);
        btn.classList.toggle('dark:text-indigo-200', active);
        btn.classList.toggle('border-slate-300', !active);
        btn.classList.toggle('dark:border-slate-700', !active);
        btn.classList.toggle('bg-white', !active);
        btn.classList.toggle('dark:bg-slate-900', !active);
        btn.classList.toggle('text-slate-700', !active);
        btn.classList.toggle('dark:text-slate-300', !active);
      });

      updateInPlaceDirtyWarning();
    }

    function toggleQuickBranchBox(show) {
      const box = document.getElementById('formQuickBranchBox');
      if (!box) return;
      const shouldShow = typeof show === 'boolean' ? show : box.classList.contains('hidden');
      box.classList.toggle('hidden', !shouldShow);
      if (shouldShow) {
        const fromSelect = document.getElementById('formQuickBranchFrom');
        const fromLabel = document.getElementById('formQuickBranchFromLabel');
        if (fromLabel && fromSelect) {
          fromLabel.innerText = fromSelect.value || 'main';
        }
        document.getElementById('formQuickBranchName')?.focus();
      }
    }

    async function quickCreateBranchInline() {
      const projId = (document.getElementById('formProject')?.value || '').trim();
      const branchName = (document.getElementById('formQuickBranchName')?.value || '').trim();
      const fromBranch = (document.getElementById('formQuickBranchFrom')?.value || '').trim();

      if (!projId) {
        showToast('請先選擇所屬專案');
        return;
      }
      if (!branchName) {
        showToast('請輸入新分支名稱');
        document.getElementById('formQuickBranchName')?.focus();
        return;
      }

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projId)}/branches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchName, fromBranch })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || '建立分支失敗');
        }
        if (data.branchInfo) {
          setProjectBranchesMap({ ...projectBranchesMap, [projId]: data.branchInfo });
        }
        const createdBranch = data.branch || branchName;
        await onFormProjectChangeLoadBranches(projId, createdBranch);
        const inputEl = document.getElementById('formQuickBranchName');
        if (inputEl) inputEl.value = '';
        toggleQuickBranchBox(false);
        showToast(`已從 ${data.fromBranch || fromBranch || 'main'} 建立分支 ${createdBranch}`);
      } catch (err) {
        showToast(`建立分支失敗：${err.message}`);
      }
    }

    function updateInPlaceDirtyWarning() {
      const hintEl = document.getElementById('formInPlaceDirtyHint');
      if (!hintEl) return;
      const projId = (document.getElementById('formProject')?.value || '').trim();
      const mode = (document.getElementById('formWorkspaceMode')?.value || 'worktree').trim();
      const targetBranch = (document.getElementById('formTargetBranch')?.value || '').trim();
      const branchData = projId ? projectBranchesMap[projId] : null;

      if (mode !== 'in_place' || !branchData) {
        hintEl.classList.add('hidden');
        hintEl.innerText = '';
        return;
      }

      const warnings = [];
      if (branchData.isMainWorkspaceDirty) {
        warnings.push(`目前專案資料夾有 ${branchData.dirtyFilesCount || 1} 個未提交修改，直接改目前資料夾可能會與現有修改混在一起。`);
      }
      if (targetBranch && branchData.currentCheckoutBranch && targetBranch !== branchData.currentCheckoutBranch) {
        warnings.push(`目前資料夾停留在 ${branchData.currentCheckoutBranch}，與目標分支 ${targetBranch} 不同。`);
      }

      if (warnings.length === 0) {
        hintEl.classList.add('hidden');
        hintEl.innerText = '';
        return;
      }

      hintEl.innerText = `提醒：${warnings.join(' ')} 建議改用「獨立工作區（推薦）」。`;
      hintEl.classList.remove('hidden');
    }


export {
  setIsCurrentModalReadOnly,
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
  onFormProjectChangeLoadBranches,
  selectWorkspaceMode,
  toggleQuickBranchBox,
  quickCreateBranchInline,
  updateInPlaceDirtyWarning
};

if (typeof window !== "undefined") {
  window.onFormProjectChangeLoadBranches = onFormProjectChangeLoadBranches;
  window.selectWorkspaceMode = selectWorkspaceMode;
  window.toggleQuickBranchBox = toggleQuickBranchBox;
  window.quickCreateBranchInline = quickCreateBranchInline;
  window.updateInPlaceDirtyWarning = updateInPlaceDirtyWarning;
}
