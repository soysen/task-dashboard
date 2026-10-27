import { tasks, projects, settings } from "./state.js";

    function copyToClipboard(text, successMsg = '已複製到剪貼簿！') {
      if (!text) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(successMsg);
        }).catch(() => {
          showToast('複製失敗，請手動選取文字');
        });
      } else {
        showToast('瀏覽器不支援剪貼簿 API');
      }
    }

    async function withButtonLoading(btn, loadingText, asyncFn) {
      if (!btn) return await asyncFn();
      if (btn.disabled) return;
      const originalHtml = btn.innerHTML;
      const originalDisabled = btn.disabled;
      btn.disabled = true;
      btn.classList.add('opacity-70', 'cursor-not-allowed');
      btn.innerHTML = `<span class="inline-flex items-center justify-center gap-1.5"><svg class="animate-spin h-3.5 w-3.5 text-current flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>${loadingText}</span></span>`;
      try {
        return await asyncFn();
      } finally {
        btn.disabled = originalDisabled;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
        btn.innerHTML = originalHtml;
        if (window.lucide) lucide.createIcons();
      }
    }


    function autoResizeTextarea(el, minHeight = 60, maxHeight = 400) {
      if (!el || !el.style || typeof el.removeAttribute !== 'function') return;
      el.removeAttribute('rows');
      el.style.height = 'auto';
      const newHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
      el.style.height = `${newHeight}px`;
    }


    function resetTextareaHeight(el) {
      if (!el || !el.style) return;
      el.style.height = '';
    }


    function openExternalUrl(url, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!url || url === '#' || url === 'javascript:void(0)') return;

      // 1. 透過後端 Node.js 在 macOS 呼叫原生 open (100% 可穿透 App 外殼與 WebView 沙盒)
      fetch('/api/open-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      }).catch(() => {});

      // 2. 原生 WebKit MessageHandler 支援
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openExternalUrl) {
          window.webkit.messageHandlers.openExternalUrl.postMessage(url);
          return;
        }
      } catch (e) {}

      // 3. 一般瀏覽器 fallback
      try {
        window.open(url, '_blank');
      } catch (e) {}
    }


    function copyPrompt(id, event) {
      if (event) event.stopPropagation();
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const proj = projects.find(p => p.id === task.project);
      const projName = proj ? proj.name : (task.project || '未指定專案');
      const projPath = (proj && proj.path) ? proj.path : (task.projectPath || `~/projects/${task.project}/`);
      const configDir = (settings.dataDirectoryPath || settings.defaultDataDir || '~/Library/Application Support/TaskDashboard').replace(/\/+$/, '');
      const tasksFilePath = `${configDir}/tasks.json`;
      
      const harnessInfo = (proj && proj.harness) ? proj.harness : (task.projectHarness || {});
      const harnessCmd = harnessInfo.command || 'npm run harness:check || npm test';

      const feedbackText = task.feedback ? `\n• 【最高優先 Feedback】: ${task.feedback}` : '';

      const projSkills = (proj && Array.isArray(proj.skills)) ? proj.skills : [];
      let recommendedSkillText = '';
      if (projSkills.length > 0) {
        const fullText = `${task.title} ${task.description || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
        const matched = projSkills.filter(s => {
          const l = (s.label || s.id || '').toLowerCase();
          const d = (s.desc || '').toLowerCase();
          if (fullText.includes('ui') || fullText.includes('切版') || fullText.includes('css')) {
            return l.includes('web') || l.includes('ui') || d.includes('ui');
          }
          if (fullText.includes('test') || fullText.includes('測試')) {
            return l.includes('test') || d.includes('test');
          }
          if (fullText.includes('api') || fullText.includes('後端') || fullText.includes('server')) {
            return l.includes('api') || d.includes('api');
          }
          return false;
        }).slice(0, 2);
        if (matched.length > 0) {
          recommendedSkillText = `\n• 【推薦動態 Skills】: ${matched.map(m => `${m.label} (${m.path || m.id})`).join('、')}`;
        }
      }

      const negativeGuardrails = `\n【負向守門邊界 (Negative Boundaries / Never Do)】:\n• 嚴禁整檔盲讀與未經 Impact Analysis 任意搜尋取代。\n• 純調查/診斷任務嚴禁變更原始碼；實作僅限任務最小必要範圍，禁止跨專案副作用。`;
      const subagentNotice = `\n【Subagent 自動調度規範 (Flash 執行 + Pro 審核)】:\n• 條件允許時自動啟用 Subagent (Workspace: "inherit")：先以 flash 執行實作與測試、再以 pro 進行審核把關。`;

      const prompt = `【任務開工】[${task.id}] ${task.title}
• 專案: ${projName} (${projPath}) | 驗證: ${harnessCmd} | 資料庫: ${tasksFilePath}
• 需求: ${task.description || '無'}${feedbackText}${recommendedSkillText}
${negativeGuardrails}
${subagentNotice}

【Task Dashboard 3-Phase Gate 平台規範】：
1. Pre-Flight: 檢閱專案架構文檔並執行 ${harnessCmd}；有 Feedback 優先滿足；若任務勾選需確認後再執行且未具備執行計劃，必須先產出完整執行計劃回寫 executionPlan 供確認；大檔 (>500 行) 禁整檔全覽，一律以 grep-n 定位切片 30-50 行避免 Loop。
2. Implementation: 遵循目錄規範最小範圍實作並補齊測試，嚴禁跨專案副作用。
3. Review Promotion: 驗證通過後收集全量 diff，依核心主軸產出 commitMessage ({ subject, body })；撰寫標準結構化『任務執行報告 (Task Execution Report)』並恪遵 Chat-Report Symmetry 對齊原則；呼叫 API (PUT /api/tasks/${task.id}) 或回寫 tasks.json 推進至 review (feedback 歸入 description 並清空)。`;
      copyToClipboard(prompt, `已複製【${projName}】Harness 3-Phase 派工指令！`);
    }

    function copySessionId(sid, event) {
      if (event) event.stopPropagation();
      if (!sid) return;
      copyToClipboard(sid, `已複製 Hermes Session ID：${sid}`);
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toastMsg');
      toastMsg.innerText = msg;
      toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
      setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
      }, 2500);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatDuration(seconds) {
      const s = Math.max(0, parseInt(seconds || 0, 10));
      const m = Math.floor(s / 60);
      const sec = s % 60;
      const h = Math.floor(m / 60);
      const min = m % 60;
      if (h > 0) {
        return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      }
      return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }


export {
  withButtonLoading,
  autoResizeTextarea,
  resetTextareaHeight,
  openExternalUrl,
  copyToClipboard,
  copyPrompt,
  copySessionId,
  showToast,
  escapeHtml,
  formatDuration
};

if (typeof window !== "undefined") {
  window.withButtonLoading = withButtonLoading;
  window.autoResizeTextarea = autoResizeTextarea;
  window.resetTextareaHeight = resetTextareaHeight;
  window.openExternalUrl = openExternalUrl;
  window.copyToClipboard = copyToClipboard;
  window.copyPrompt = copyPrompt;
  window.copySessionId = copySessionId;
  window.showToast = showToast;
  window.escapeHtml = escapeHtml;
  window.formatDuration = formatDuration;
}
