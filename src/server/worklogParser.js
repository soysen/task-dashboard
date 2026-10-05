/**
 * worklogParser.js
 * 專門負責 Worklog (agent-status.md) 與 Build Plan (*-build-plan.md) 切片追蹤、解析與生命週期同步
 */

const fs = require("fs");
const path = require("path");

let _readTasksProvider = null;
function setReadTasksProvider(fn) {
  _readTasksProvider = fn;
}
function getTasksSafe() {
  if (typeof _readTasksProvider === 'function') {
    try {
      return _readTasksProvider();
    } catch (e) {
      return [];
    }
  }
  return [];
}

function parseAgentStatusContent(content, statusFilePath, targetTaskId) {
  const lines = content.split('\n');
  let currentSection = '';
  let currentSubSection = '';

  const activeTasksMap = new Map();
  let currentActiveTaskFields = null;
  let currentActiveTaskId = '';

  const activeFields = {};
  const completedFields = {};
  const executionFields = {};
  const resumeFields = {};
  const activeUpdatedFiles = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim();
      currentSubSection = '';
      currentActiveTaskId = '';
      currentActiveTaskFields = null;

      const activeMatch = currentSection.match(/Active Task[s]?[:\s(]+([A-Za-z0-9_-]+)/i);
      if (activeMatch) {
        currentActiveTaskId = activeMatch[1].trim();
        currentActiveTaskFields = activeTasksMap.get(currentActiveTaskId.toLowerCase()) || { id: currentActiveTaskId };
        activeTasksMap.set(currentActiveTaskId.toLowerCase(), currentActiveTaskFields);
      }
      continue;
    }

    if (line.startsWith('### ')) {
      currentSubSection = line.substring(4).trim();
      const subMatch = currentSubSection.match(/^(?:\[([A-Za-z0-9_-]+)\]|([A-Za-z0-9_-]+))(?:[:\s]+(.*))?$/);
      if (subMatch && (currentSection.includes('Active Task') || currentSection.includes('進行中'))) {
        currentActiveTaskId = (subMatch[1] || subMatch[2]).trim();
        currentActiveTaskFields = activeTasksMap.get(currentActiveTaskId.toLowerCase()) || { id: currentActiveTaskId };
        if (subMatch[3]) currentActiveTaskFields['title'] = subMatch[3].trim();
        activeTasksMap.set(currentActiveTaskId.toLowerCase(), currentActiveTaskFields);
      }
      continue;
    }

    if (line.startsWith('- ')) {
      const colonIdx = line.indexOf(':');
      const altColonIdx = line.indexOf('：');
      const idx = (colonIdx !== -1 && altColonIdx !== -1)
        ? Math.min(colonIdx, altColonIdx)
        : (colonIdx !== -1 ? colonIdx : altColonIdx);

      if (idx !== -1) {
        const key = line.substring(2, idx).trim().toLowerCase();
        const value = line.substring(idx + 1).trim();

        if (currentSection === 'Active Task' || currentSection.includes('活躍任務') || currentSection.includes('進行中任務') || currentSection.includes('Active Tasks')) {
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else {
            activeFields[key] = value;
          }

          if (key === 'id' || key === '任務 id' || key === '任務id') {
            const parsedId = value.trim();
            if (parsedId && parsedId !== 'none') {
              currentActiveTaskId = parsedId;
              if (currentActiveTaskFields) {
                currentActiveTaskFields['id'] = parsedId;
                activeTasksMap.set(parsedId.toLowerCase(), currentActiveTaskFields);
              } else {
                let existing = activeTasksMap.get(parsedId.toLowerCase());
                if (!existing) {
                  existing = { ...activeFields, id: parsedId };
                  activeTasksMap.set(parsedId.toLowerCase(), existing);
                } else {
                  Object.assign(existing, activeFields, { id: parsedId });
                }
              }
            }
          } else if (!currentActiveTaskFields && currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        } else if (currentSection === 'Last Completed Task' || currentSection.includes('前次完成') || currentSection.includes('最近完成')) {
          completedFields[key] = value;
        } else if (currentSection === 'Execution Tracking' || currentSection.includes('執行狀態') || currentSection.includes('執行追蹤')) {
          executionFields[key] = value;
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else if (currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        } else if (currentSection === 'Resume Entry' || currentSection.includes('恢復入口') || currentSection.includes('進入點')) {
          resumeFields[key] = value;
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else if (currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        }
      } else if ((currentSection.includes('Active Task') || currentSection.includes('活躍任務')) && (line.toLowerCase().startsWith('- updated files:') || line.startsWith('- 異動檔案:') || line.startsWith('- 修改檔案:'))) {
        let j = i + 1;
        while (j < lines.length && (lines[j].trim().startsWith('  - ') || lines[j].trim().startsWith('\t- ') || lines[j].trim().startsWith('- '))) {
          activeUpdatedFiles.push(lines[j].trim().replace(/^[- \t]+/, ''));
          j++;
        }
      }
    }
  }

  const normalizeStatus = (raw) => {
    let rawStatus = (raw || 'idle').toLowerCase();
    if (rawStatus.includes('進行中') || rawStatus.includes('in_progress') || rawStatus.includes('inprogress') || rawStatus.includes('in progress') || rawStatus.includes('active') || rawStatus.includes('running') || rawStatus.includes('doing')) return '進行中';
    if (rawStatus.includes('阻塞') || rawStatus.includes('blocked')) return '阻塞';
    if (rawStatus.includes('暫停') || rawStatus.includes('paused')) return '暫停';
    if (rawStatus.includes('需補充輸入') || rawStatus.includes('need_input') || rawStatus.includes('waiting')) return '需補充輸入';
    if (rawStatus.includes('review') || rawStatus.includes('待審查') || rawStatus.includes('待驗收')) return '待審查';
    if (rawStatus.includes('已完成') || rawStatus.includes('done') || rawStatus.includes('completed')) return '已完成';
    return 'idle';
  };

  const buildTaskObj = (fields) => {
    const rawStatus = fields['status'] || fields['狀態'] || 'idle';
    const status = normalizeStatus(rawStatus);
    const currentStep = fields['currentstep'] || fields['current step'] || fields['當前步驟'] || fields['當下切片'] || fields['當前進度'] || fields['步驟'] || fields['step'] || executionFields['currentstep'] || executionFields['current step'] || executionFields['當前步驟'] || executionFields['當下切片'] || undefined;
    const evidence = fields['evidence'] || fields['驗證證據'] || fields['驗證'] || executionFields['evidence'] || executionFields['驗證證據'] || undefined;
    const nextStep = fields['nextstep'] || fields['next step'] || fields['下一步'] || fields['下個步驟'] || executionFields['nextstep'] || executionFields['next step'] || undefined;
    const resumeEntry = (fields['start here'] || fields['開始位置'] || fields['入口'] || resumeFields['start here'] || resumeFields['開始位置'] || resumeFields['入口'])
      ? `Start here: ${fields['start here'] || fields['開始位置'] || fields['入口'] || resumeFields['start here'] || resumeFields['開始位置'] || resumeFields['入口']}`
      : (fields['恢復入口'] || resumeFields['恢復入口'] || undefined);

    const goalVal = fields['goal'] || fields['目標'] || 'N/A';
    const titleVal = fields['title'] || fields['標題'] || fields['名稱'] || 'N/A';

    return {
      id: fields['id'] || fields['任務 id'] || fields['任務id'] || 'none',
      title: titleVal,
      status,
      lastUpdated: fields['last updated'] || fields['lastupdated'] || fields['更新時間'] || fields['最後更新'] || 'N/A',
      goal: goalVal,
      route: fields['route'] || fields['路由 (skill route)'] || fields['路由'] || fields['skill route'] || 'none',
      taskLevel: fields['task level'] || fields['level'] || fields['等級'] || undefined,
      currentStep,
      evidence,
      nextStep,
      resumeEntry,
      updatedFiles: activeUpdatedFiles.length > 0 ? activeUpdatedFiles : undefined
    };
  };

  let activeTask = null;
  const singleActiveTask = (Object.keys(activeFields).length > 0) ? buildTaskObj(activeFields) : null;

  if (targetTaskId) {
    const cleanTargetId = targetTaskId.toLowerCase().trim();
    if (activeTasksMap.has(cleanTargetId)) {
      activeTask = buildTaskObj(activeTasksMap.get(cleanTargetId));
    } else if (singleActiveTask && (singleActiveTask.id.toLowerCase() === cleanTargetId || singleActiveTask.id === 'none')) {
      activeTask = singleActiveTask;
    } else {
      activeTask = null;
    }
  } else {
    activeTask = singleActiveTask;
  }

  let lastCompletedTask = undefined;
  if ((completedFields['id'] && completedFields['id'] !== 'none') || completedFields['任務 id']) {
    lastCompletedTask = {
      id: completedFields['id'] || completedFields['任務 id'] || 'none',
      title: completedFields['title'] || completedFields['標題'] || 'N/A',
      status: completedFields['status'] || completedFields['狀態'] || '已完成',
      lastUpdated: completedFields['last updated'] || completedFields['更新時間'] || 'N/A',
      goal: completedFields['goal'] || completedFields['目標'] || 'N/A',
      route: completedFields['route'] || completedFields['路由'] || 'none',
      taskLevel: completedFields['task level'] || completedFields['等級'],
      evidence: completedFields['evidence'] || completedFields['驗證證據']
    };
  }

  return { activeTask, lastCompletedTask };
}

function parseBuildPlanContent(content, filePath, fallbackRoute, targetTaskId) {
  const lines = content.split('\n');
  const h1Line = lines.find(l => l.trim().startsWith('# '));
  const title = h1Line ? h1Line.trim().replace(/^#\s*/, '').trim() : path.basename(filePath);

  let featureName = undefined;
  let currentTaskId = undefined;
  let currentSliceGoal = undefined;
  let taskCard = undefined;

  let currentH2 = '';
  let currentH3 = '';
  let currentH4 = '';

  const explicitSlices = [];
  const tasks = [];
  let currentTask = null;
  let currentExplicitSlice = null;
  let inTaskCard = false;
  const taskCardFields = {};

  const isIgnoredH3 = (heading) => {
    const h = heading.toLowerCase();
    return (
      h.includes('未完成任務（優先閱讀）') ||
      h.includes('已重置任務') ||
      h.includes('已完成任務（摘要）') ||
      h.includes('本期包含') ||
      h.includes('本期不包含') ||
      h.includes('未完成任務詳情') ||
      h.includes('已完成任務詳情')
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('## ')) {
      currentH2 = trimmed.substring(3).trim();
      currentH3 = '';
      currentH4 = '';
      inTaskCard = currentH2.includes('任務卡');

      if (currentExplicitSlice && currentExplicitSlice.title) {
        explicitSlices.push(currentExplicitSlice);
        currentExplicitSlice = null;
      }
      if (currentTask && currentTask.id) {
        tasks.push(currentTask);
        currentTask = null;
      }
      continue;
    }

    if (trimmed.startsWith('### ')) {
      currentH3 = trimmed.substring(4).trim();
      currentH4 = '';

      if (currentExplicitSlice && currentExplicitSlice.title) {
        explicitSlices.push(currentExplicitSlice);
        currentExplicitSlice = null;
      }
      if (currentTask && currentTask.id) {
        tasks.push(currentTask);
        currentTask = null;
      }

      if (isIgnoredH3(currentH3)) {
        continue;
      }

      if (/^(切片\s*\d+|slice\s*\d+)/i.test(currentH3)) {
        let status = '進行中';
        if (currentH3.includes('[已完成]') || currentH3.includes('(已完成)')) status = '已完成';
        else if (currentH3.includes('[未開始]') || currentH3.includes('(未開始)')) status = '未開始';
        else if (currentH3.includes('[阻塞]') || currentH3.includes('(阻塞)')) status = '阻塞';

        currentExplicitSlice = {
          sliceId: `slice-${explicitSlices.length + 1}`,
          title: currentH3,
          status,
          route: fallbackRoute || 'none'
        };
        continue;
      }

      const taskMatch = currentH3.match(/^(TASK-[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)[：:\s]*(.*)$/i);
      if (taskMatch) {
        currentTask = {
          id: taskMatch[1].trim(),
          title: taskMatch[2] ? taskMatch[2].trim() : taskMatch[1].trim(),
          status: '進行中',
          route: fallbackRoute || 'none',
          acceptanceCriteria: [],
          slices: []
        };
        continue;
      }
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      currentH4 = trimmed.substring(5).trim();
      continue;
    }

    // 支援 Markdown Checkbox 切片清單: - [x] Slice 1: ..., - [ ] Slice 2: ...
    const checkboxMatch = trimmed.match(/^-\s*\[([ xX\-~])\]\s*(.*)$/);
    if (checkboxMatch) {
      const mark = checkboxMatch[1].toLowerCase();
      const sliceText = checkboxMatch[2].trim();
      let status = '未開始';
      if (mark === 'x') status = '已完成';
      else if (mark === '-') status = '進行中';

      const isSliceHeading = currentH2.toLowerCase().includes('slice') || currentH2.toLowerCase().includes('切片');
      const hasSlicePrefix = /^(slice\s*\d+|切片\s*\d+)/i.test(sliceText);

      if (isSliceHeading || hasSlicePrefix) {
        explicitSlices.push({
          sliceId: `slice-${explicitSlices.length + 1}`,
          title: sliceText,
          status,
          route: fallbackRoute || 'none',
          goal: sliceText
        });
        continue;
      }
    }

    // 支援一般列表式切片: - Slice 1: ...
    if ((currentH2.toLowerCase().includes('slice') || currentH2.toLowerCase().includes('切片')) && /^- (slice\s*\d+|切片\s*\d+)/i.test(trimmed)) {
      const sliceText = trimmed.substring(2).trim();
      let status = '進行中';
      if (sliceText.includes('[已完成]') || sliceText.includes('(已完成)')) status = '已完成';
      else if (sliceText.includes('[未開始]') || sliceText.includes('(未開始)')) status = '未開始';
      explicitSlices.push({
        sliceId: `slice-${explicitSlices.length + 1}`,
        title: sliceText,
        status,
        route: fallbackRoute || 'none',
        goal: sliceText
      });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const colonIdx = trimmed.indexOf(':');
      const altColonIdx = trimmed.indexOf('：');
      const idx = (colonIdx !== -1 && altColonIdx !== -1)
        ? Math.min(colonIdx, altColonIdx)
        : (colonIdx !== -1 ? colonIdx : altColonIdx);

      if (idx !== -1) {
        const rawKey = trimmed.substring(2, idx).replace(/\*\*/g, '').trim().toLowerCase();
        const value = trimmed.substring(idx + 1).replace(/\*\*/g, '').trim();

        if (rawKey === 'feature name') featureName = value;
        if (rawKey.includes('目前任務 id') || rawKey.includes('目前任務id') || rawKey.includes('任務 id') || rawKey.includes('任務id')) currentTaskId = value;
        if (rawKey.includes('本輪切片目標') || rawKey.includes('切片目標')) currentSliceGoal = value;
        if (rawKey === 'skill route' || rawKey === 'skill-route' || rawKey === 'route' || rawKey === '路由') {
          fallbackRoute = value;
        }

        if (inTaskCard) {
          taskCardFields[rawKey] = value;
        }

        if (currentExplicitSlice) {
          if (rawKey.includes('目標') || rawKey === 'goal') {
            currentExplicitSlice.goal = value;
          } else if (rawKey.includes('route') || rawKey.includes('路由')) {
            currentExplicitSlice.route = value;
          } else if (rawKey.includes('boundary') || rawKey.includes('範圍') || rawKey.includes('in/out')) {
            currentExplicitSlice.boundary = value;
          } else if (rawKey.includes('驗證') || rawKey.includes('evidence') || rawKey.includes('標準')) {
            currentExplicitSlice.verification = value;
          } else if (rawKey.includes('狀態') || rawKey === 'status') {
            currentExplicitSlice.status = value;
          }
        }

        if (currentTask) {
          if (rawKey.includes('狀態') || rawKey === 'status') currentTask.status = value;
          else if (rawKey.includes('類型') || rawKey === 'type') currentTask.type = value;
          else if (rawKey.includes('優先') || rawKey === 'priority') currentTask.priority = value;
          else if (rawKey.includes('估點') || rawKey === 'estimate') currentTask.estimate = value;
          else if (rawKey.includes('里程碑') || rawKey === 'milestone') currentTask.milestone = value;
          else if (rawKey.includes('route') || rawKey.includes('路由')) currentTask.route = value;
        }
      }
    }

    if (currentTask && currentH4.includes('描述') && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('- 狀態')) {
      if (!currentTask.description) {
        currentTask.description = trimmed;
      } else {
        currentTask.description += ' ' + trimmed;
      }
    }

    if (currentTask && currentH4.includes('驗收標準') && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]'))) {
      if (!currentTask.acceptanceCriteria) currentTask.acceptanceCriteria = [];
      currentTask.acceptanceCriteria.push(trimmed.substring(2));
    }

    if (currentTask && currentH4.includes('切片') && trimmed.startsWith('|') && !trimmed.includes('---')) {
      const parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3 && !parts[0].includes('切片') && !parts[0].includes('Slice')) {
        const sliceId = parts[0];
        const sliceStatus = parts[1] || '進行中';
        const sliceGoal = parts[2] || '';
        const sliceVerification = parts[3] || '';

        const subSlice = {
          sliceId: `${currentTask.id}-${sliceId}`,
          title: `[${currentTask.id}] 切片 ${sliceId}`,
          status: sliceStatus,
          goal: sliceGoal,
          verification: sliceVerification,
          route: currentTask.route || fallbackRoute || 'none'
        };
        if (!currentTask.slices) currentTask.slices = [];
        currentTask.slices.push(subSlice);
      }
    }
  }

  if (currentExplicitSlice && currentExplicitSlice.title) {
    explicitSlices.push(currentExplicitSlice);
  }
  if (currentTask && currentTask.id) {
    tasks.push(currentTask);
  }

  if (Object.keys(taskCardFields).length > 0) {
    taskCard = {
      goal: taskCardFields['目標'] || taskCardFields['goal'],
      route: taskCardFields['路由 (skill route)'] || taskCardFields['路由'] || taskCardFields['skill route'] || taskCardFields['route'],
      inOutScope: taskCardFields['範圍 (in/out)'] || taskCardFields['範圍'] || taskCardFields['scope'] || taskCardFields['in/out'],
      acceptanceCriteria: taskCardFields['驗收標準'] || taskCardFields['criteria'],
      evidence: taskCardFields['驗證證據'] || taskCardFields['evidence'],
      resumeEntry: taskCardFields['阻塞/恢復入口'] || taskCardFields['恢復入口']
    };
  }

  const cleanTargetId = targetTaskId ? targetTaskId.toLowerCase().trim() : '';
  const planTaskId = (taskCardFields['目前任務 id'] || taskCardFields['目前任務id'] || taskCardFields['任務 id'] || taskCardFields['任務id'] || currentTaskId || '').toLowerCase().trim();

  let isPlanForTargetTask = true;
  if (cleanTargetId && planTaskId && planTaskId !== 'none') {
    isPlanForTargetTask = (planTaskId === cleanTargetId);
  }

  let finalSlices = [];
  if (explicitSlices.length > 0) {
    if (cleanTargetId) {
      const matchingExplicit = explicitSlices.filter(s => s.title && s.title.toLowerCase().includes(`[${cleanTargetId}]`));
      if (matchingExplicit.length > 0) {
        finalSlices = matchingExplicit;
      } else if (isPlanForTargetTask) {
        finalSlices = explicitSlices;
      } else {
        finalSlices = [];
      }
    } else {
      finalSlices = explicitSlices;
    }
  } else {
    const subSlicesFromTasks = [];
    for (const t of tasks) {
      if (cleanTargetId && t.id.toLowerCase() !== cleanTargetId) continue;
      if (t.slices && t.slices.length > 0) {
        for (const s of t.slices) {
          if (!s.route || s.route === 'none') {
            s.route = t.route || (taskCard && taskCard.route) || fallbackRoute || 'none';
          }
          subSlicesFromTasks.push(s);
        }
      }
    }

    if (subSlicesFromTasks.length > 0) {
      finalSlices = subSlicesFromTasks;
    } else if (tasks.length > 0) {
      const filteredTasks = cleanTargetId ? tasks.filter(t => t.id.toLowerCase() === cleanTargetId) : tasks;
      finalSlices = filteredTasks.map(t => ({
        sliceId: t.id,
        title: `[${t.id}] ${t.title}`,
        status: t.status,
        route: t.route || (taskCard && taskCard.route) || fallbackRoute || 'none',
        goal: t.description || t.title,
        description: t.description,
        verification: t.acceptanceCriteria ? t.acceptanceCriteria.join('; ') : ''
      }));
    } else if ((taskCard || currentSliceGoal) && isPlanForTargetTask) {
      finalSlices.push({
        sliceId: currentTaskId || 'active-slice-1',
        title: currentSliceGoal ? `當前切片：${currentSliceGoal}` : `任務卡工作切片`,
        status: '進行中',
        route: (taskCard && taskCard.route) || fallbackRoute || 'none',
        goal: (taskCard && taskCard.goal) || currentSliceGoal,
        boundary: taskCard && taskCard.inOutScope,
        verification: (taskCard && taskCard.acceptanceCriteria) || (taskCard && taskCard.evidence)
      });
    }
  }

  finalSlices = finalSlices.map(s => ({
    ...s,
    route: (s.route && s.route !== 'none') ? s.route : ((taskCard && taskCard.route) || fallbackRoute || 'none')
  }));

  const effectiveTaskCard = (cleanTargetId && !isPlanForTargetTask) ? undefined : (taskCard || undefined);
  const effectiveCurrentSliceGoal = (cleanTargetId && !isPlanForTargetTask) ? undefined : currentSliceGoal;

  return {
    title,
    filePath,
    featureName,
    currentTaskId: planTaskId || currentTaskId,
    currentSliceGoal: effectiveCurrentSliceGoal,
    taskCard: effectiveTaskCard,
    slices: finalSlices,
    tasks: tasks.length > 0 ? tasks : undefined
  };
}

function scanProjectWorklogAndPlan(projPath, taskId) {
  if (!projPath || !fs.existsSync(projPath)) return null;

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  const hasWorklog = fs.existsSync(statusPath);

  let activeTask = null;
  let lastCompletedTask = null;
  let statusLastModifiedMs = 0;

  if (hasWorklog) {
    try {
      const stat = fs.statSync(statusPath);
      statusLastModifiedMs = stat.mtimeMs;
      const content = fs.readFileSync(statusPath, 'utf8');
      const parsed = parseAgentStatusContent(content, statusPath, taskId);
      activeTask = parsed.activeTask;
      lastCompletedTask = parsed.lastCompletedTask;
    } catch (e) {
      console.error(`Error reading ${statusPath}:`, e);
    }
  }

  const fallbackRoute = (activeTask && activeTask.route && activeTask.route !== 'none')
    ? activeTask.route
    : (lastCompletedTask && lastCompletedTask.route && lastCompletedTask.route !== 'none')
    ? lastCompletedTask.route
    : undefined;

  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  let activeBuildPlan = null;
  let buildPlanCount = 0;

  if (fs.existsSync(planDir)) {
    try {
      const planFiles = fs.readdirSync(planDir)
        .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');
      buildPlanCount = planFiles.length;

      if (planFiles.length > 0) {
        const planFilesWithStats = planFiles.map(f => {
          const fullPath = path.join(planDir, f);
          const stat = fs.statSync(fullPath);
          return { file: f, fullPath, mtimeMs: stat.mtimeMs };
        }).sort((a, b) => b.mtimeMs - a.mtimeMs);

        let selectedPlan = null;
        const targetId = taskId || (activeTask && activeTask.id !== 'none' ? activeTask.id : (lastCompletedTask ? lastCompletedTask.id : ''));

        if (targetId && targetId !== 'none') {
          const cleanId = targetId.toLowerCase().replace(/^task-/, '');
          const matchByFile = planFilesWithStats.find(p => p.file.toLowerCase().includes(cleanId));
          if (matchByFile) {
            selectedPlan = matchByFile.file;
          } else {
            for (const p of planFilesWithStats) {
              try {
                const content = fs.readFileSync(p.fullPath, 'utf8');
                if (content.toLowerCase().includes(cleanId)) {
                  selectedPlan = p.file;
                  break;
                }
              } catch (e) {}
            }
          }
        } else {
          // 沒有指定特定任務時（例如全域概覽），優先選取最新且非 done 的 Plan，若皆已 done 則選最新一個
          const nonDonePlan = planFilesWithStats.find(p => {
            try {
              const content = fs.readFileSync(p.fullPath, 'utf8');
              return !/^- Status:\s*done/mi.test(content);
            } catch (e) { return false; }
          });
          selectedPlan = nonDonePlan ? nonDonePlan.file : planFilesWithStats[0].file;
        }

        if (selectedPlan) {
          const planPath = path.join(planDir, selectedPlan);
          const planContent = fs.readFileSync(planPath, 'utf8');
          activeBuildPlan = parseBuildPlanContent(planContent, planPath, fallbackRoute, taskId);
        }
      }
    } catch (e) {
      console.error(`Error reading build plan in ${planDir}:`, e);
    }
  }

  if (!hasWorklog && !activeBuildPlan) {
    // 即使專案無現成 worklog，若有指定任務或當前任務亦即時合成切片資訊，提供切片評估
    const allTasks = getTasksSafe();
    const currentTask = taskId ? allTasks.find(t => t.id.toLowerCase() === taskId.toLowerCase()) : null;
    const taskTitle = currentTask ? currentTask.title : (taskId || '進行中任務');
    const goalText = currentTask
      ? (currentTask.feedback && currentTask.feedback.trim()
          ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
          : (currentTask.description || currentTask.title))
      : (taskId ? `任務執行與驗證：${taskId}` : undefined);

    if (currentTask || taskId) {
      const taskStatus = currentTask ? currentTask.status : 'in_progress';
      return {
        hasWorklog: false,
        activeTask: {
          id: currentTask ? currentTask.id : taskId,
          title: taskTitle,
          status: taskStatus === 'in_progress' ? '進行中' : (taskStatus === 'review' ? '待審查' : (taskStatus === 'done' ? '已完成' : '未開始')),
          lastUpdated: (currentTask && (currentTask.updatedAt || currentTask.createdAt) || new Date().toISOString()).split('T')[0],
          goal: goalText || taskTitle,
          route: (currentTask && currentTask.route) || 'dashboard-state-and-sync'
        },
        currentSliceGoal: goalText || taskTitle,
        route: (currentTask && currentTask.route) || 'dashboard-state-and-sync',
        currentStep: taskStatus === 'in_progress' ? `正在執行：${taskTitle}` : `任務狀態：${taskStatus}`,
        evidence: taskStatus === 'done' ? '測試通過已驗收' : '進行中',
        nextStep: taskStatus === 'in_progress' ? '完成實作與測試後推入 review 交付審查' : '無',
        slices: [
          {
            sliceId: `slice-${(currentTask ? currentTask.id : taskId).toLowerCase()}-1`,
            title: `[${taskStatus === 'done' ? '已完成' : '進行中'}] ${taskTitle}`,
            status: taskStatus === 'done' ? '已完成' : '進行中',
            route: (currentTask && currentTask.route) || 'dashboard-state-and-sync',
            goal: goalText || taskTitle
          }
        ],
        buildPlanCount: 0,
        updatedFiles: (currentTask && currentTask.modifiedFiles) || []
      };
    }
    return null;
  }

  // 讀取當前任務資訊，進行精準的 Task ID 對應與及時資料合成
  const allTasks = getTasksSafe();
  const currentTask = taskId ? allTasks.find(t => t.id.toLowerCase() === taskId.toLowerCase()) : null;

  const isTargetActiveTask = activeTask && activeTask.id !== 'none' && (!taskId || activeTask.id.toLowerCase() === taskId.toLowerCase());
  let effectiveActiveTask = isTargetActiveTask ? activeTask : null;

  // 若當前任務有資訊，補全 activeTask 中為 'N/A' 或缺失的欄位
  if (effectiveActiveTask && currentTask) {
    if (!effectiveActiveTask.title || effectiveActiveTask.title === 'N/A') {
      effectiveActiveTask.title = currentTask.title;
    }
    if (!effectiveActiveTask.goal || effectiveActiveTask.goal === 'N/A') {
      effectiveActiveTask.goal = currentTask.feedback && currentTask.feedback.trim()
        ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
        : (currentTask.description || currentTask.title);
    }
    if (!effectiveActiveTask.route || effectiveActiveTask.route === 'none') {
      effectiveActiveTask.route = currentTask.route || fallbackRoute || 'dashboard-state-and-sync';
    }
  }

  // 若當前任務為進行中，但 agent-status.md 未及時記錄或記錄了其他任務，立即合成當前任務之專屬即時狀態
  if (!effectiveActiveTask && currentTask && currentTask.status === 'in_progress') {
    const todayStr = new Date().toISOString().split('T')[0];
    const goalText = currentTask.feedback && currentTask.feedback.trim()
      ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
      : (currentTask.description || currentTask.title);

    const stepText = currentTask.feedback && currentTask.feedback.trim()
      ? `根據審查意見修復：${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
      : `正在執行：${currentTask.title}`;

    effectiveActiveTask = {
      id: currentTask.id,
      title: currentTask.title,
      status: '進行中',
      lastUpdated: (currentTask.updatedAt || currentTask.createdAt || todayStr).split('T')[0],
      goal: goalText,
      route: currentTask.route || (activeBuildPlan && activeBuildPlan.taskCard && activeBuildPlan.taskCard.route) || fallbackRoute || 'dashboard-state-and-sync',
      currentStep: stepText,
      evidence: currentTask.feedback && currentTask.feedback.trim() ? '待退回重做驗證' : '進行中',
      nextStep: '完成實作與測試後推入 review 交付審查',
      resumeEntry: hasWorklog ? statusPath : undefined,
      updatedFiles: Array.isArray(currentTask.modifiedFiles) ? currentTask.modifiedFiles : []
    };
  }

  let resolvedSliceGoal = (activeBuildPlan && activeBuildPlan.currentSliceGoal && activeBuildPlan.currentSliceGoal !== 'N/A')
    ? activeBuildPlan.currentSliceGoal
    : (effectiveActiveTask && effectiveActiveTask.goal && effectiveActiveTask.goal !== 'N/A' ? effectiveActiveTask.goal : (currentTask ? (currentTask.description || currentTask.title) : undefined));

  let resolvedRoute = (effectiveActiveTask && effectiveActiveTask.route && effectiveActiveTask.route !== 'none')
    ? effectiveActiveTask.route
    : (activeBuildPlan && activeBuildPlan.taskCard && activeBuildPlan.taskCard.route && activeBuildPlan.taskCard.route !== 'none')
    ? activeBuildPlan.taskCard.route
    : (activeBuildPlan && activeBuildPlan.slices && activeBuildPlan.slices.length > 0 && activeBuildPlan.slices[0].route && activeBuildPlan.slices[0].route !== 'none')
    ? activeBuildPlan.slices[0].route
    : fallbackRoute;

  let finalPlanSlices = (activeBuildPlan && activeBuildPlan.slices) ? [...activeBuildPlan.slices] : [];

  // 若當前任務具備 executionPlan（確認後執行的執行計劃），優先將其拆解為專屬工作切片，與任務執行階段同步
  if (finalPlanSlices.length === 0 && currentTask && currentTask.executionPlan && currentTask.executionPlan.trim()) {
    const planLines = currentTask.executionPlan.split('\n').map(l => l.trim()).filter(Boolean);
    const extractedTitles = [];
    for (const line of planLines) {
      const m = line.match(/^[-*•]?\s*(?:(?:Slice|切片)\s*\d+[:：]|(?:\d+[\.、]))\s*(.*)$/i) || line.match(/^[-*•]\s*【(.*?)】\s*(.*)$/);
      if (m) {
        const sliceTitle = (m[1] && m[2]) ? `【${m[1]}】${m[2]}` : (m[1] || line);
        extractedTitles.push(sliceTitle);
      }
    }
    if (extractedTitles.length > 0) {
      finalPlanSlices = extractedTitles.map((t, idx) => ({
        sliceId: `slice-${currentTask.id.toLowerCase()}-${idx + 1}`,
        title: `[-] Slice ${idx + 1}: ${t}`,
        status: idx === 0 ? '進行中' : '未開始',
        route: resolvedRoute || 'dashboard-state-and-sync',
        goal: t
      }));
      if (finalPlanSlices.length > 0 && (!resolvedSliceGoal || resolvedSliceGoal === 'N/A')) {
        resolvedSliceGoal = extractedTitles[0];
      }
    }
  }

  // 若當前任務為進行中但無專屬切片清單，自動建立專屬實作切片，絕不套用其他任務的切片
  if (finalPlanSlices.length === 0 && effectiveActiveTask) {
    const defaultSliceGoal = (effectiveActiveTask.goal && effectiveActiveTask.goal !== 'N/A') ? effectiveActiveTask.goal : effectiveActiveTask.title;
    finalPlanSlices.push({
      sliceId: `slice-${effectiveActiveTask.id.toLowerCase()}-1`,
      title: `[進行中] ${defaultSliceGoal}`,
      status: '進行中',
      route: resolvedRoute || 'dashboard-state-and-sync',
      goal: defaultSliceGoal
    });
    if (!resolvedSliceGoal || resolvedSliceGoal === 'N/A') resolvedSliceGoal = defaultSliceGoal;
  }

  const resolvedCurrentStep = effectiveActiveTask
    ? (effectiveActiveTask.currentStep || `正在執行：${effectiveActiveTask.title}`)
    : (taskId ? undefined : (activeTask ? activeTask.currentStep : undefined));

  const resolvedEvidence = effectiveActiveTask
    ? (effectiveActiveTask.evidence || '進行中')
    : (taskId ? undefined : (activeTask ? activeTask.evidence : undefined));

  const resolvedNextStep = effectiveActiveTask
    ? (effectiveActiveTask.nextStep || '完成實作與測試後推入 review 交付審查')
    : (taskId ? undefined : (activeTask ? activeTask.nextStep : undefined));

  return {
    hasWorklog,
    statusFilePath: hasWorklog ? statusPath : undefined,
    statusLastModifiedMs: statusLastModifiedMs || undefined,
    activeTask: effectiveActiveTask || (taskId ? undefined : activeTask) || undefined,
    lastCompletedTask: lastCompletedTask || undefined,
    currentStep: resolvedCurrentStep,
    evidence: resolvedEvidence,
    nextStep: resolvedNextStep,
    resumeEntry: (effectiveActiveTask && effectiveActiveTask.resumeEntry) ? effectiveActiveTask.resumeEntry : (taskId ? undefined : (activeBuildPlan && activeBuildPlan.taskCard ? activeBuildPlan.taskCard.resumeEntry : (activeTask && activeTask.resumeEntry ? activeTask.resumeEntry : undefined))),
    route: resolvedRoute,
    currentSliceGoal: resolvedSliceGoal,
    inOutScope: (activeBuildPlan && activeBuildPlan.taskCard) ? activeBuildPlan.taskCard.inOutScope : (effectiveActiveTask ? effectiveActiveTask.goal : undefined),
    acceptanceCriteria: (activeBuildPlan && activeBuildPlan.taskCard) ? activeBuildPlan.taskCard.acceptanceCriteria : undefined,
    slices: finalPlanSlices,
    planTitle: activeBuildPlan ? activeBuildPlan.title : undefined,
    planFile: activeBuildPlan ? path.basename(activeBuildPlan.filePath) : undefined,
    buildPlanCount,
    updatedFiles: effectiveActiveTask ? (effectiveActiveTask.updatedFiles || []) : (taskId ? [] : (activeTask ? activeTask.updatedFiles || [] : []))
  };
}

// 當任務進入進行中 (in_progress) 時，及時同步更新專案的 agent-status.md 與 build-plan.md
function syncProjectWorklogForActiveTask(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;

  const todayStr = new Date().toISOString().split('T')[0];
  const isRedo = !!(task.feedback && task.feedback.trim());
  const feedbackText = isRedo ? task.feedback.replace(/[\r\n]+/g, ' ').trim() : '';

  const goalText = isRedo
    ? `[退回重做] ${feedbackText}`
    : (task.description || task.title || '').replace(/[\r\n]+/g, ' ').trim();

  const currentStepText = isRedo
    ? `根據審查意見修復：${feedbackText}`
    : `正在執行：${task.title}`;

  const evidenceText = isRedo ? '待退回重做驗證' : '進行中';
  const routeText = (task.route && task.route !== 'none') ? task.route : 'dashboard-state-and-sync';

  let hasUpdated = false;

  // 1. 同步更新 .github/worklog/agent-status.md (僅在專案已具備該檔案時更新，絕不隱式自動初始化 Harness 污染專案)
  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');

      content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
        let updated = `## Active Task\n\n` +
          `- ID: ${task.id}\n` +
          `- Title: ${task.title}\n` +
          `- Status: in_progress\n` +
          `- Last updated: ${todayStr}\n` +
          `- Goal: ${goalText}\n` +
          `- Route: ${routeText}\n` +
          `- Scope: ${task.title}\n` +
          `- Out of scope: 跨專案副作用\n\n`;
        return updated + nextHeading;
      });

      content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
        let updated = `## Execution Tracking\n\n` +
          `- CurrentStep: ${currentStepText}\n` +
          `- Evidence: ${evidenceText}\n` +
          `- NextStep: 完成實作與測試後推入 review 交付審查\n\n`;
        return updated + nextHeading;
      });

      fs.writeFileSync(statusPath, content, 'utf8');
      hasUpdated = true;
    } catch (e) {
      console.error('Error updating agent-status.md for active task:', e);
    }
  }

  // 2. 同步更新 .github/harness/plan/ 內的 build plan (僅當存在專屬於本任務的 Plan，且尚未結案時才更新)
  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  if (fs.existsSync(planDir)) {
    try {
      const planFiles = fs.readdirSync(planDir)
        .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');

      if (planFiles.length > 0) {
        const cleanId = (task.id || '').toLowerCase().replace(/^task-/, '');
        let targetPlanFile = planFiles.find(f => f.toLowerCase().includes(cleanId));
        if (!targetPlanFile) {
          // 檢查內容是否明確綁定此 taskId（例如包含 [TASK-xxx] 或 目前任務 ID: TASK-xxx）
          for (const f of planFiles) {
            try {
              const c = fs.readFileSync(path.join(planDir, f), 'utf8');
              if (c.toLowerCase().includes(`[${cleanId}]`) || c.toLowerCase().includes(`[task-${cleanId}]`) || c.toLowerCase().includes(`目前任務 id: task-${cleanId}`) || c.toLowerCase().includes(`目前任務 id: ${cleanId}`)) {
                targetPlanFile = f;
                break;
              }
            } catch (e) {}
          }
        }

        // 關鍵防護：若沒有專屬於此任務的 Plan，嚴禁 fallback 覆寫其他既有 Plan！
        if (targetPlanFile) {
          const targetPlanPath = path.join(planDir, targetPlanFile);
          let planContent = fs.readFileSync(targetPlanPath, 'utf8');

          // 若 Plan 已標記為 done，視為已結案歷史文件，不再自動追加切片
          const isPlanDone = /^- Status:\s*done/mi.test(planContent);
          if (!isPlanDone) {
            if (/^- Status:.*$/m.test(planContent)) {
              planContent = planContent.replace(/^- Status:.*$/m, `- Status: in_progress`);
            }

            planContent = planContent.replace(/(## 任務卡[\s\S]*?)(## |$)/, (match, cardSection, nextHeading) => {
              let updatedCard = cardSection;
              if (/- 目前任務 ID:.*$/m.test(updatedCard)) {
                updatedCard = updatedCard.replace(/- 目前任務 ID:.*$/m, `- 目前任務 ID: ${task.id}`);
              } else {
                updatedCard = updatedCard.replace(/(## 任務卡[^\n]*\n)/, `$1\n- 目前任務 ID: ${task.id}\n`);
              }
              if (/- 目標:.*$/m.test(updatedCard)) {
                updatedCard = updatedCard.replace(/- 目標:.*$/m, `- 目標: ${goalText}`);
              }
              return updatedCard + nextHeading;
            });

            const sliceMatch = planContent.match(/(## Slices[\s\S]*?)(## |$)/);
            if (sliceMatch) {
              const slicesSection = sliceMatch[1];
              const hasTaskSlice = slicesSection.includes(`[${task.id}]`) || (isRedo && slicesSection.includes(feedbackText));
              if (!hasTaskSlice) {
                const lines = slicesSection.split('\n');
                const sliceLines = lines.filter(l => l.trim().match(/^-\s*\[([ xX\-~])\]\s*(.*)$/));
                const nextNum = sliceLines.length + 1;
                const newSliceLine = `- [-] Slice ${nextNum}: [${task.id}] ${goalText}`;
                const trimmedSlices = slicesSection.trimEnd();
                const newSlicesSection = trimmedSlices + '\n' + newSliceLine + '\n\n';
                planContent = planContent.replace(sliceMatch[0], newSlicesSection + sliceMatch[2]);
              }
            }

            fs.writeFileSync(targetPlanPath, planContent, 'utf8');
            hasUpdated = true;
          }
        } else if (task.executionPlan && task.executionPlan.trim()) {
          // 當前專案尚無此任務的 build plan，但任務在確認階段已具備完整 executionPlan：
          // 自動為任務在 .github/harness/plan/ 建立專屬 build plan，將 executionPlan 萃取為 Slices
          const cleanTaskId = task.id.toLowerCase();
          const newPlanFileName = `${cleanTaskId}-build-plan.md`;
          const newPlanFilePath = path.join(planDir, newPlanFileName);

          const planLines = task.executionPlan.split('\n').map(l => l.trim()).filter(Boolean);
          const extractedSlices = [];
          for (const line of planLines) {
            const m = line.match(/^[-*•]?\s*(?:(?:Slice|切片)\s*\d+[:：]|(?:\d+[\.、]))\s*(.*)$/i) || line.match(/^[-*•]\s*【(.*?)】\s*(.*)$/);
            if (m) {
              const sliceTitle = (m[1] && m[2]) ? `【${m[1]}】${m[2]}` : (m[1] || line);
              extractedSlices.push(sliceTitle);
            }
          }

          let slicesMd = '';
          if (extractedSlices.length > 0) {
            slicesMd = extractedSlices.map((s, idx) => `- [-] Slice ${idx + 1}: ${s}`).join('\n');
          } else {
            slicesMd = `- [-] Slice 1: [${task.id}] ${goalText}`;
          }

          const newPlanContent = `# Build Plan: [${task.id}] ${task.title}\n\n` +
            `- Status: in_progress\n` +
            `- Skill Route: ${routeText}\n` +
            `- Feature Name: ${task.title}\n\n` +
            `## 任務卡 (Task Card)\n\n` +
            `- 目前任務 ID: ${task.id}\n` +
            `- 目標: ${goalText}\n` +
            `- 路由: ${routeText}\n` +
            `- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用\n` +
            `- 驗收標準: 執行計劃步驟實作與驗證完成\n` +
            `- 驗證證據: 測試通過\n` +
            `- 阻塞/恢復入口: .github/worklog/agent-status.md\n\n` +
            `## Slices\n` +
            `${slicesMd}\n`;

          fs.writeFileSync(newPlanFilePath, newPlanContent, 'utf8');
          hasUpdated = true;
        }
      }
    } catch (e) {
      console.error('Error updating build plan for active task:', e);
    }
  }

  return hasUpdated;
}

// 根據審查退回重做需求，自動同步更新專案的 agent-status.md 與建置藍圖切片清單 (相容性包裝)
function syncProjectWorklogForRedo(projPath, task) {
  return syncProjectWorklogForActiveTask(projPath, task);
}

function markTaskSlicesComplete(projPath, taskId, planStatus) {
  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  if (!fs.existsSync(planDir)) return false;

  try {
    const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskSlicePattern = new RegExp(`^(\\s*-\\s*)\\[[ \\-~]\\](\\s*.*\\[${escapedTaskId}\\].*)$`, 'gm');
    const planFiles = fs.readdirSync(planDir)
      .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');
    let hasUpdated = false;

    for (const planFile of planFiles) {
      const planPath = path.join(planDir, planFile);
      const planContent = fs.readFileSync(planPath, 'utf8');
      
      const hasTaskSlice = taskSlicePattern.test(planContent);
      const cleanId = taskId.toLowerCase().replace(/^task-/, '');
      const isTargetPlan = planFile.toLowerCase().includes(cleanId) || planContent.toLowerCase().includes(`目前任務 id: ${taskId.toLowerCase()}`);

      if (hasTaskSlice || isTargetPlan) {
        taskSlicePattern.lastIndex = 0;
        let updatedContent = planContent.replace(taskSlicePattern, '- [x]$2');
        if (planStatus && /^- Status:.*$/m.test(updatedContent)) {
          updatedContent = updatedContent.replace(/^- Status:.*$/m, `- Status: ${planStatus}`);
        }
        if (updatedContent !== planContent) {
          fs.writeFileSync(planPath, updatedContent, 'utf8');
          hasUpdated = true;
        }
      }
    }

    return hasUpdated;
  } catch (e) {
    console.error('Error completing build plan slices for task:', e);
    return false;
  }
}

// 當任務進入 review 階段時，同步更新 agent-status.md
function syncProjectWorklogOnReview(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;
  const todayStr = new Date().toISOString().split('T')[0];

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');
      if (content.includes(`- ID: ${task.id}`)) {
        content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
          let updated = activeSection.replace(/- Status:.*$/m, `- Status: review`);
          updated = updated.replace(/- Last updated:.*$/m, `- Last updated: ${todayStr}`);
          return updated + nextHeading;
        });
        content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
          let updated = execSection.replace(/- CurrentStep:.*$/m, `- CurrentStep: 實作與測試驗證通過，已推入待審查 (Review)`);
          return updated + nextHeading;
        });
        fs.writeFileSync(statusPath, content, 'utf8');
      }
    } catch (e) {}
  }
  markTaskSlicesComplete(projPath, task.id, 'review');
  return true;
}

// 當任務驗收通過 (done) 結案時，同步更新 agent-status.md 與 build-plan.md
function syncProjectWorklogOnDone(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;
  const todayStr = new Date().toISOString().split('T')[0];

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');

      // 更新 Last Completed Task
      content = content.replace(/(## Last Completed Task[\s\S]*?)(## |$)/, (match, compSection, nextHeading) => {
        let updated = `## Last Completed Task\n\n` +
          `- ID: ${task.id}\n` +
          `- Title: ${task.title}\n` +
          `- Status: 已完成\n` +
          `- Last updated: ${todayStr}\n\n`;
        return updated + nextHeading;
      });

      // 若 Active Task 正是本任務，將其狀態更新為已完成
      if (content.includes(`- ID: ${task.id}`)) {
        content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
          let updated = activeSection.replace(/- Status:.*$/m, `- Status: 已完成`);
          updated = updated.replace(/- Last updated:.*$/m, `- Last updated: ${todayStr}`);
          return updated + nextHeading;
        });
        content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
          let updated = execSection.replace(/- CurrentStep:.*$/m, `- CurrentStep: 任務驗收通過，已成功結案`);
          return updated + nextHeading;
        });
      }

      fs.writeFileSync(statusPath, content, 'utf8');
    } catch (e) {}
  }

  // 將 build plan 內對應本任務的切片標記為完成 [x]
  markTaskSlicesComplete(projPath, task.id, 'done');
  return true;
}


module.exports = {
  parseAgentStatusContent,
  parseBuildPlanContent,
  scanProjectWorklogAndPlan,
  syncProjectWorklogForActiveTask,
  syncProjectWorklogForRedo,
  syncProjectWorklogOnReview,
  syncProjectWorklogOnDone,
  markTaskSlicesComplete,
  setReadTasksProvider
};
