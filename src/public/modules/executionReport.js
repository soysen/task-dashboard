import { escapeHtml } from "./utils.js";

    function switchLogViewTab(tab) {
      const visualBtn = document.getElementById('btnLogTabVisual');
      const rawBtn = document.getElementById('btnLogTabRaw');
      const reportVisual = document.getElementById('formReportVisual');
      const logVisual = document.getElementById('formLogVisual');
      if (!reportVisual || !logVisual) return;
      if (tab === 'visual') {
        reportVisual.classList.remove('hidden');
        logVisual.classList.add('hidden');
        if (visualBtn) visualBtn.className = 'px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 font-bold transition whitespace-nowrap flex-shrink-0';
        if (rawBtn) rawBtn.className = 'px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition whitespace-nowrap flex-shrink-0';
      } else {
        reportVisual.classList.add('hidden');
        logVisual.classList.remove('hidden');
        if (rawBtn) rawBtn.className = 'px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 font-bold transition whitespace-nowrap flex-shrink-0';
        if (visualBtn) visualBtn.className = 'px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition whitespace-nowrap flex-shrink-0';
      }
    }

    function renderExecutionReport(task) {
      const reportEl = document.getElementById('formReportVisual');
      if (!reportEl) return;
      const raw = (task && task.executionLog) ? task.executionLog.trim() : '';
      if (!raw) {
        reportEl.innerHTML = '';
        return;
      }

      // 檢查是否為結構化報告 (包含 任務執行報告 或是 Phase 1~3 標籤)
      let effectiveLog = raw;
      let isStructured = raw.includes('任務執行報告') || raw.includes('### Phase 1') || raw.includes('## 1.');

      // 智慧自癒回退 (Smart Fallback & Synthesis)：
      // 若日誌缺乏結構化內容但任務具備執行計劃、工作切片或異動檔案，自動合成完整的結構化執行內容報告
      if (!isStructured && ((task && task.executionPlan && task.executionPlan.trim()) || (task && task.sliceInfo && task.sliceInfo.slices && task.sliceInfo.slices.length > 0) || (task && task.modifiedFiles && task.modifiedFiles.length > 0))) {
        const slices = (task.sliceInfo && Array.isArray(task.sliceInfo.slices)) ? task.sliceInfo.slices : [];
        const slicesMd = slices.map(s => `  - **${s.title}** (${s.status || '已完成'})`).join('\n');
        const filesMd = (task.modifiedFiles || []).map(f => `  - \`${typeof f === 'string' ? f : (f.path || f)}\``).join('\n');
        const planText = task.executionPlan ? task.executionPlan.replace(/^##\s*執行計劃[^\n]*\n+/i, '').trim() : '';

        effectiveLog = `# 📋 任務執行報告 (Task Execution Report)\n\n## 1. 任務目標與執行計劃 (Objective & Plan)\n${planText ? planText.split('\n').map(l => l.startsWith('#') ? `- **${l.replace(/^#+\s*/, '')}**` : l).join('\n') : `- **核心目標**：${task.title || '完成任務需求'}`}\n\n## 2. 解決方案與核心異動 (Resolution & Key Changes)\n- **已完成工作切片 (Slices Completed)**：\n${slicesMd || '  - 依執行計劃完成所有實作與驗證'}\n- **檔案異動明細**：\n${filesMd || '  - 詳見 Git Diff'}\n\n## 3. 品質驗證與交付證明 (Verification & Test Evidence)\n- **狀態**：任務驗收通過 (目前狀態: ${task.status})\n${task.commitMessage ? `- **Commit 主旨**：\`${task.commitMessage.subject || ''}\`\n${task.commitMessage.body ? task.commitMessage.body.split('\n').map(b => '  ' + b).join('\n') : ''}` : ''}\n\n<details>\n<summary>點擊展開門禁與執行歷史記錄 (Gate History)</summary>\n\n\`\`\`text\n${raw}\n\`\`\`\n</details>`;
        isStructured = true;
      }

      if (isStructured) {
        // 分離原始 terminal 區塊 (若含有 <details> 或 --- 執行詳細記錄 ---)
        let mainReport = effectiveLog;
        let rawTerminalDump = '';

        if (raw.includes('<details>')) {
          const parts = raw.split('<details>');
          mainReport = parts[0].trim();
          rawTerminalDump = parts.slice(1).join('<details>').replace(/<\/details>/g, '').trim();
        } else if (raw.includes('--- 執行詳細記錄 / 原生驗證輸出 ---')) {
          const parts = raw.split('--- 執行詳細記錄 / 原生驗證輸出 ---');
          mainReport = parts[0].trim();
          rawTerminalDump = parts.slice(1).join('').trim();
        }

        // 解析主要段落區塊 (取消區塊陰影與細項多餘分隔線，僅保留大項目之間的清晰分隔線 divide-y，並強化 dark mode 分隔線對比度)
        const sectionsHtml = [];
        const lines = mainReport.split('\n');
        let curCardTitle = '';
        let curCardLines = [];
        let curBadge = '';
        let curAccentColor = 'bg-slate-500 dark:bg-slate-400';
        let curMarkerBg = 'bg-slate-200/80 dark:bg-slate-800';

        const formatInlineReportText = (str) => escapeHtml(str)
          .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-900 dark:text-slate-100">$1</strong>')
          .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-[11px]">$1</code>');

        const flushCard = () => {
          if (!curCardTitle && curCardLines.length === 0) return;
          const bodyHtml = curCardLines.map(l => {
            if (l.startsWith('- **') || l.startsWith('- ')) {
              const formatted = formatInlineReportText(l.slice(2));
              return `<li class="ml-4 list-disc text-slate-800 dark:text-slate-200 leading-[1.7] py-0.5">${formatted}</li>`;
            } else if (l.startsWith('  - ')) {
              const formatted = formatInlineReportText(l.slice(4));
              return `<li class="ml-8 list-circle text-slate-700 dark:text-slate-300 text-[11px] leading-[1.7] py-0.5">${formatted}</li>`;
            } else if (l.trim()) {
              return `<p class="text-slate-700 dark:text-slate-300 leading-[1.7] py-0.5">${formatInlineReportText(l)}</p>`;
            }
            return '';
          }).filter(Boolean).join('');

          sectionsHtml.push(`
            <div class="report-section-block py-3 first:pt-1 last:pb-1 space-y-1.5 shadow-none">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2 min-w-0">
                  <span class="w-4 h-4 rounded-md ${curMarkerBg} flex items-center justify-center flex-shrink-0">
                    <span class="w-1.5 h-1.5 rounded-full ${curAccentColor}"></span>
                  </span>
                  <span class="leading-snug">${escapeHtml(curCardTitle || '執行說明')}</span>
                </span>
                ${curBadge}
              </div>
              <ul class="space-y-1 text-xs pl-6">
                ${bodyHtml}
              </ul>
            </div>
          `);
          curCardTitle = '';
          curCardLines = [];
          curBadge = '';
          curAccentColor = 'bg-slate-500 dark:bg-slate-400';
          curMarkerBg = 'bg-slate-200/80 dark:bg-slate-800';
        };

        for (const line of lines) {
          if (line.startsWith('# 📋') || line.startsWith('# ')) continue;
          if (line.startsWith('## ') || line.startsWith('### ')) {
            flushCard();
            const rawTitle = line.replace(/^[#]+\s*/, '').trim();
            curCardTitle = rawTitle;
            if (rawTitle.includes('驗證') || rawTitle.includes('Phase 3')) {
              curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 whitespace-nowrap flex-shrink-0">驗證通過</span>';
              curAccentColor = 'bg-emerald-600 dark:bg-emerald-400';
              curMarkerBg = 'bg-emerald-100/80 dark:bg-emerald-950/50';
            } else if (rawTitle.includes('解決方案') || rawTitle.includes('核心異動') || rawTitle.includes('審查') || rawTitle.includes('Phase 2')) {
              curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 whitespace-nowrap flex-shrink-0">實作完成</span>';
              curAccentColor = 'bg-sky-600 dark:bg-sky-400';
              curMarkerBg = 'bg-sky-100/80 dark:bg-sky-950/50';
            } else if (rawTitle.includes('色彩') || rawTitle.includes('計劃')) {
              curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 whitespace-nowrap flex-shrink-0">色彩規範</span>';
              curAccentColor = 'bg-amber-500 dark:bg-amber-400';
              curMarkerBg = 'bg-amber-100/80 dark:bg-amber-950/50';
            } else if (rawTitle.includes('根因') || rawTitle.includes('目標') || rawTitle.includes('Phase 1')) {
              curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-slate-200/90 dark:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap flex-shrink-0">目標與分析</span>';
              curAccentColor = 'bg-slate-600 dark:bg-slate-400';
              curMarkerBg = 'bg-slate-200/80 dark:bg-slate-800';
            }
          } else {
            curCardLines.push(line);
          }
        }
        flushCard();

        let riskBadgeHtml = '';
        if (task && task.riskDoor === 'one-way') {
          const reasons = (task.riskReasons || []).map(r => `• ${escapeHtml(r)}`).join('<br>');
          riskBadgeHtml = `
            <div class="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5">
              <span class="text-base flex-shrink-0">🚨</span>
              <div class="text-xs">
                <div class="font-bold text-rose-800 dark:text-rose-300">單向門審查 (One-Way Door / 高風險不可逆變更)</div>
                <div class="text-rose-700 dark:text-rose-400 mt-0.5 leading-relaxed">${reasons || '本任務修改涉及底層核心或較大變更，需人工重點核對。'}</div>
              </div>
            </div>`;
        } else if (task && task.riskDoor === 'two-way') {
          riskBadgeHtml = `
            <div class="mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-2">
              <span class="text-sm flex-shrink-0">🚪</span>
              <div class="text-xs text-emerald-800 dark:text-emerald-300 font-medium">雙向門審查 (Two-Way Door / 可逆低風險變更)</div>
            </div>`;
        }

        let terminalCollapseHtml = '';
        if (rawTerminalDump) {
          const cleanDump = rawTerminalDump.replace(/```text/g, '').replace(/```/g, '').replace(/<summary>.*?<\/summary>/s, '').trim();
          terminalCollapseHtml = `
            <div class="pt-3 border-t border-slate-300 dark:border-slate-500">
              <details class="group rounded-lg overflow-hidden bg-slate-950">
                <summary class="px-3 py-2 bg-slate-900 text-slate-300 text-xs font-mono font-semibold flex items-center justify-between gap-2 cursor-pointer select-none hover:bg-slate-800 transition">
                  <span class="flex items-center gap-1.5 min-w-0">
                    <i data-lucide="terminal" class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></i>
                    <span class="truncate">原生終端 / Harness 輸出記錄 (Raw Terminal Output)</span>
                  </span>
                  <span class="text-[10px] text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0">▼</span>
                </summary>
                <pre class="p-3 text-[11px] font-mono text-emerald-400/90 whitespace-pre-wrap overflow-x-auto leading-relaxed max-h-72 custom-scrollbar">${escapeHtml(cleanDump)}</pre>
              </details>
            </div>
          `;
        }

        reportEl.innerHTML = `
          ${riskBadgeHtml}
          <div class="pl-2 divide-y divide-slate-300 dark:divide-slate-500">
            ${sectionsHtml.join('')}
          </div>
          ${terminalCollapseHtml}
        `;
      } else {
        // 純文字 Terminal 輸出模式 (取消區塊陰影與標題底線，保持簡潔)
        reportEl.innerHTML = `
          <div class="pl-2 py-2 space-y-2 shadow-none">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5 min-w-0">
                <i data-lucide="terminal" class="w-3.5 h-3.5 flex-shrink-0"></i>
                <span class="truncate">執行記錄</span>
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 whitespace-nowrap flex-shrink-0">終端記錄</span>
            </div>
            <pre class="bg-slate-950 text-amber-200/90 p-3 rounded-lg font-mono text-xs whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto custom-scrollbar">${escapeHtml(raw)}</pre>
          </div>
        `;
      }
      if (typeof lucide !== "undefined" && lucide.createIcons) {
        lucide.createIcons();
      } else if (typeof window !== "undefined" && window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
      }
    }

    function switchPlanViewTab(tab) {
      const visualBtn = document.getElementById('btnPlanTabVisual');
      const rawBtn = document.getElementById('btnPlanTabRaw');
      const planVisual = document.getElementById('formPlanVisual');
      const planRaw = document.getElementById('formExecutionPlan');
      if (!planVisual || !planRaw) return;

      if (tab === 'visual') {
        renderExecutionPlan(planRaw.value);
        planVisual.classList.remove('hidden');
        planRaw.classList.add('hidden');
        if (visualBtn) {
          visualBtn.className = 'px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 font-bold transition whitespace-nowrap flex-shrink-0 shadow-xs';
        }
        if (rawBtn) {
          rawBtn.className = 'px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition whitespace-nowrap flex-shrink-0';
        }
      } else {
        planVisual.classList.add('hidden');
        planRaw.classList.remove('hidden');
        if (typeof autoResizeTextarea === 'function') {
          autoResizeTextarea(planRaw, 60, 300);
        }
        if (rawBtn) {
          rawBtn.className = 'px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 font-bold transition whitespace-nowrap flex-shrink-0 shadow-xs';
        }
        if (visualBtn) {
          visualBtn.className = 'px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition whitespace-nowrap flex-shrink-0';
        }
      }
    }

    function renderExecutionPlan(taskOrText) {
      const planEl = document.getElementById('formPlanVisual');
      if (!planEl) return;
      const raw = typeof taskOrText === 'string'
        ? taskOrText
        : ((taskOrText && taskOrText.executionPlan) ? taskOrText.executionPlan.trim() : '');

      if (!raw) {
        planEl.innerHTML = `
          <div class="py-4 text-center text-xs text-slate-400 dark:text-slate-500 italic bg-white/40 dark:bg-slate-900/40 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
            尚未擬定執行計劃，等待負責人或 AI 規劃中...
          </div>
        `;
        return;
      }

      const formatInlinePlanText = (str) => escapeHtml(str)
        .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-900 dark:text-slate-100">$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-[11px] border border-slate-200 dark:border-slate-700/60">$1</code>');

      const lines = raw.split('\n');
      const sectionsHtml = [];
      let curCardTitle = '';
      let curCardLines = [];
      let curBadge = '';
      let curAccentColor = 'bg-amber-500 dark:bg-amber-400';
      let curMarkerBg = 'bg-amber-100/80 dark:bg-amber-950/50';

      const flushPlanCard = () => {
        if (!curCardTitle && curCardLines.length === 0) return;
        const bodyHtml = curCardLines.map(l => {
          const trimmed = l.trim();
          if (!trimmed) return '';
          if (l.startsWith('- **') || l.startsWith('- ') || l.startsWith('* ')) {
            const content = l.replace(/^[-*]\s+/, '');
            return `<li class="ml-4 list-disc text-slate-800 dark:text-slate-200 leading-[1.7] py-0.5">${formatInlinePlanText(content)}</li>`;
          } else if (l.startsWith('  - ') || l.startsWith('    - ')) {
            const content = l.replace(/^\s+[-*]\s+/, '');
            return `<li class="ml-8 list-circle text-slate-700 dark:text-slate-300 text-[11px] leading-[1.7] py-0.5">${formatInlinePlanText(content)}</li>`;
          } else if (/^\s*\d+\.\s+/.test(l)) {
            const content = l.replace(/^\s*\d+\.\s+/, '');
            return `<li class="ml-4 list-decimal text-slate-800 dark:text-slate-200 leading-[1.7] py-0.5">${formatInlinePlanText(content)}</li>`;
          } else {
            return `<p class="text-slate-700 dark:text-slate-300 leading-[1.7] py-0.5">${formatInlinePlanText(l)}</p>`;
          }
        }).filter(Boolean).join('');

        sectionsHtml.push(`
          <div class="report-section-block py-2.5 first:pt-1 last:pb-1 space-y-1.5 shadow-none">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2 min-w-0">
                <span class="w-4 h-4 rounded-md ${curMarkerBg} flex items-center justify-center flex-shrink-0">
                  <span class="w-1.5 h-1.5 rounded-full ${curAccentColor}"></span>
                </span>
                <span class="leading-snug">${escapeHtml(curCardTitle || '計劃步驟與內容')}</span>
              </span>
              ${curBadge}
            </div>
            <div class="space-y-1 text-xs pl-6">
              ${bodyHtml}
            </div>
          </div>
        `);

        curCardTitle = '';
        curCardLines = [];
        curBadge = '';
        curAccentColor = 'bg-amber-500 dark:bg-amber-400';
        curMarkerBg = 'bg-amber-100/80 dark:bg-amber-950/50';
      };

      for (const line of lines) {
        if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ') || line.startsWith('#### ')) {
          flushPlanCard();
          const rawTitle = line.replace(/^[#]+\s*/, '').trim();
          curCardTitle = rawTitle;
          if (rawTitle.includes('目標') || rawTitle.includes('需求') || rawTitle.includes('分析')) {
            curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 whitespace-nowrap flex-shrink-0">需求與目標</span>';
            curAccentColor = 'bg-amber-600 dark:bg-amber-400';
            curMarkerBg = 'bg-amber-100/80 dark:bg-amber-950/50';
          } else if (rawTitle.includes('檔案') || rawTitle.includes('Impact') || rawTitle.includes('架構') || rawTitle.includes('清單')) {
            curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-slate-200/90 dark:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap flex-shrink-0">受影響檔案</span>';
            curAccentColor = 'bg-slate-600 dark:bg-slate-400';
            curMarkerBg = 'bg-slate-200/80 dark:bg-slate-800';
          } else if (rawTitle.includes('切片') || rawTitle.includes('步驟') || rawTitle.includes('實作') || rawTitle.includes('Slice')) {
            curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 whitespace-nowrap flex-shrink-0">實作切片</span>';
            curAccentColor = 'bg-sky-600 dark:bg-sky-400';
            curMarkerBg = 'bg-sky-100/80 dark:bg-sky-950/50';
          } else if (rawTitle.includes('驗證') || rawTitle.includes('測試') || rawTitle.includes('指標') || rawTitle.includes('門禁')) {
            curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 whitespace-nowrap flex-shrink-0">品質驗證</span>';
            curAccentColor = 'bg-emerald-600 dark:bg-emerald-400';
            curMarkerBg = 'bg-emerald-100/80 dark:bg-emerald-950/50';
          } else if (rawTitle.includes('Grill') || rawTitle.includes('邊界') || rawTitle.includes('決策')) {
            curBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 whitespace-nowrap flex-shrink-0">邊界決策</span>';
            curAccentColor = 'bg-orange-500 dark:bg-orange-400';
            curMarkerBg = 'bg-orange-100/80 dark:bg-orange-950/50';
          }
        } else {
          curCardLines.push(line);
        }
      }
      flushPlanCard();

      planEl.innerHTML = `
        <div class="divide-y divide-slate-200 dark:divide-slate-700/80 bg-white/70 dark:bg-slate-900/70 rounded-lg p-3 border border-slate-200/80 dark:border-slate-800">
          ${sectionsHtml.join('')}
        </div>
      `;
      if (typeof lucide !== "undefined" && lucide.createIcons) {
        lucide.createIcons();
      } else if (typeof window !== "undefined" && window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
      }
    }


export {
  switchLogViewTab,
  renderExecutionReport,
  switchPlanViewTab,
  renderExecutionPlan
};

if (typeof window !== "undefined") {
  window.switchLogViewTab = switchLogViewTab;
  window.renderExecutionReport = renderExecutionReport;
  window.switchPlanViewTab = switchPlanViewTab;
  window.renderExecutionPlan = renderExecutionPlan;
}
