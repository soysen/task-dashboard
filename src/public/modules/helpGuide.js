import { escapeHtml } from "./utils.js";

const GUIDE_TABS = [
  { id: "workspace", label: "1. 主工作區與分支", icon: "layout-dashboard" },
  { id: "execution", label: "2. 派工隔離與門禁", icon: "git-branch" },
  { id: "review", label: "3. 審核、Diff 與提交", icon: "git-compare" },
  { id: "git", label: "4. 分支協作與 gh", icon: "git-pull-request" },
  { id: "shortcuts", label: "5. 鍵盤快捷鍵", icon: "keyboard" }
];

const HOTSPOT_DETAILS = {
  workspace: [
    {
      id: "ws-sidebar",
      badge: "① 專案 × 分支樹",
      title: "左側專案與分支導覽樹 + 遠端 Clone",
      summary: "桌面端常駐左側欄，支援依專案與 Git 分支雙層聚焦看板，並可從遠端 URL 一鍵 Clone 加入專案。",
      steps: [
        "點擊專案列展開底部分支樹：實心圓點 ● 代表本機目前 checkout 分支，若工作區有未提交異動會顯示「未提交」標記。",
        "點擊「＋ 加入專案」可切換「從 Git URL Clone」或「選擇本機資料夾」，Clone GitHub / Azure DevOps 專案時自動帶入對應憑證。",
        "點選單一分支後，頂部立即切換至該分支視角（L2）並浮現遠端同步與開立 PR 按鈕。"
      ],
      tip: "左側欄底部提供即時提醒：選「獨立工作區 (Worktree)」可讓多張卡片同時開工而不互相覆寫目前資料夾。",
      action: { type: "add-project", label: "開啟加入專案 / Clone" }
    },
    {
      id: "ws-attention",
      badge: "② 待確認膠囊",
      title: "待確認事項快捷膠囊與 macOS 原生通知",
      summary: "當任務處於「待確認執行計劃」或「執行中問答 (Pending Clarifications)」時，頂部會亮起琥珀色膠囊與浮動提醒。",
      steps: [
        "點擊頂部「💬 待確認」膠囊，可直接跳轉開啟下一張需要你拍板的任務卡片。",
        "在原生 macOS App 中還會同步推播系統通知，點擊通知即可從背景喚醒視窗並直達該任務。"
      ],
      tip: "待機問答與計劃審閱期間，背景哨兵會自動保持靜默，直到你送出確認後才喚醒 Agent 續跑。"
    },
    {
      id: "ws-engine",
      badge: "③ 開工引擎",
      title: "雙軌自動化開工引擎（哨兵待命 / CLI 即時觸發）",
      summary: "頂部藍色「開工引擎」選單整合兩套驅動模式，無須手動反覆貼上任務內容。",
      steps: [
        "Desktop AI 哨兵：支援 Antigravity、Claude、Codex、Copilot 與 Tier 分流（全部 / 輕量快速單 / 重型專線），以 FSEvents 0 Token 待命並在任務進進行中時自動喚醒。",
        "本機 CLI Agent：可配置 hermes、agy、claude 等指令，卡片拖入「進行中」即自動執行並依 Diff 提煉 Commit Message。"
      ],
      tip: "選單右上角「立即同步」可主動對齊本地狀態與工作區進度。",
      action: { type: "engine", label: "開啟開工引擎選單" }
    },
    {
      id: "ws-views",
      badge: "④ 階段列與雙視圖",
      title: "四階段立體篩選列 ×「看板 / 按分支看」雙視圖",
      summary: "3.0 以 60-30-10 色塊與陰影建立明確視覺階層，並支援於單一專案下切換分支泳道。",
      steps: [
        "上方四個階段膠囊（待處理 → 進行中 → 待驗收 → 已完成）可點擊快速篩選單一階段，再點一次取消篩選。",
        "選取單一專案後，左上角會出現「看板 | 按分支看」切換器，可將任務改以目標分支泳道分組檢視。"
      ],
      tip: "點擊右上角「封存庫」可隨時查閱歷史已提交結案任務，或批次還原至看板。",
      action: { type: "archive", label: "查看封存任務庫" }
    }
  ],
  execution: [
    {
      id: "exec-worktree",
      badge: "① 執行方式隔離",
      title: "三種執行方式與目標分支設定",
      summary: "開卡或編輯規格時，可先指定目標分支（或點「＋ 新建分支」即時開支）並選擇適合的隔離策略。",
      steps: [
        "獨立工作區（Worktree，推薦）：為該任務另開乾淨目錄與隔離分支，多張任務可平行開發，絕不與你正在編輯的檔案互相干擾。",
        "接續同分支 (Branch Stream)：在同一目標分支依序接續實作，系統會透過基底鎖與同 Repo 互斥機制防止併發互蓋。",
        "直接改目前資料夾 (In-Place)：直接在專案主目錄異動；若主目錄已有未提交變更，介面會跳出防呆提示。"
      ],
      tip: "多卡同時派工給 AI 時一律建議維持預設的「獨立工作區（推薦）」。",
      action: { type: "new-task", label: "開啟新增任務表單" }
    },
    {
      id: "exec-plan",
      badge: "② 執行計劃門禁",
      title: "需確認後再執行 + Grill-Me 邊界替代介面",
      summary: "勾選「需確認後再執行」後，Agent 開工會先回填結構化執行計劃（支援切換「結構化計劃 / 原始文字」），等待你核可才動手改碼。",
      steps: [
        "若專案配備 Grill-Me 技能，審核區會出現「Grill-Me 邊界確認替代介面」，可直接點擊「✅ 確認邊界無誤」、「🚫 排除 Non-goals」或「⚡️ 最小 Fast-Track」快捷標籤補充決策。",
        "確認無誤後按「確認並執行」，系統立即保存確認意見並自動喚醒 Agent 進入實作。"
      ],
      tip: "最新確認意見會以最高優先權覆寫舊有描述，確保 Agent 不會沿用過時假設。"
    },
    {
      id: "exec-clarify",
      badge: "③ 執行中互動問答",
      title: "需確認事項 (Pending Clarifications)",
      summary: "Agent 實作途中若遇到規格模糊、邊界取捨或超出預期範圍的異動，會暫停並把問題結構化送到任務卡片內。",
      steps: [
        "每道問題支援單選、多選與自由補充說明，並標出系統推薦選項；右上角提供「⚡ 套用推薦選項」一鍵全填。",
        "點擊「送出確認並繼續執行」後，決策會自動歸檔至歷次問答紀錄並即時喚醒 Agent 接續完成。"
      ],
      tip: "不必切換到終端機或 AI 對話視窗逐行找問題，所有拍板都在看板彈窗內一次完成。"
    },
    {
      id: "exec-slices",
      badge: "④ 藍圖切片與恢復",
      title: "工作切片進度條與中斷恢復指令",
      summary: "任務派工支援 3-Tier 風險分級（micro / standard / heavy），中大型任務會拆為可獨立驗證的 Slices 藍圖並即時追蹤。",
      steps: [
        "卡片進行中欄位會鎖定規格欄位為唯讀避免衝突，同時在審核頁籤即時顯示目前步驟、進度條與各切片狀態。",
        "若執行意外中斷，可直接點擊「恢復指令」複製接續上下文，讓下一輪 Agent 無痛接手。"
      ],
      tip: "單卡退回或驗證失敗達 2 輪時會觸發熔斷轉入「需人類接手 (needs_human)」，避免無限重試。"
    }
  ],
  review: [
    {
      id: "rev-tabs",
      badge: "① 階段感知三頁籤",
      title: "審核與執行成果 / 需求規格與屬性 / 異動內容檢查",
      summary: "3.0 任務彈窗依階段自動切換工作區：待驗收卡片預設開啟「審核與執行成果」，讓先看報告與 Diff 成為自然動線。",
      steps: [
        "「審核與執行成果」：左欄顯示需求摘要、切片藍圖與結構化執行報告，右欄專注展示 Git Diff。",
        "「需求規格與屬性」：切換至滿版雙欄表單，檢視或修改標題、專案、標籤體系與原始需求描述。",
        "「異動內容檢查」：隱藏左欄，將整個視窗寬度 100% 留給檔案清單與 Git Diff 逐行比對。"
      ],
      tip: "點左上方需求摘要旁的「編輯規格」也可一鍵切回規格頁籤。"
    },
    {
      id: "rev-diff",
      badge: "② Master-Detail Diff",
      title: "雙欄 Git Diff 檢視器與動態前後文切換",
      summary: "右側 Diff 區拆分為「左側變更檔案總覽清單」與「右側單檔語法色塊檢視」，支援未追蹤新增檔案與大檔展開。",
      steps: [
        "變更總覽列顯示總異動檔數與加減行數（+N / -M），新增檔案（Untracked / new file）亦會完整解析呈現。",
        "工具列支援切換前後文行數（±3 行、±15 行、±40 行、整檔完整）及「↑ 上一處 / ↓ 下一處」快速跳轉異動區塊。"
      ],
      tip: "點擊「複製完整 Diff」可將當前異動一次複製給外部審查或文件紀錄。"
    },
    {
      id: "rev-land",
      badge: "③ Review Land Studio",
      title: "合一底部提交塢：分支檢查與一鍵寫入",
      summary: "待驗收階段底部固定為單行決策塢，平時不遮擋上方 Diff，並自動在背景執行 Base 分支偏移檢查（drift-check）。",
      steps: [
        "自動顯示「分支檢查：可直接提交 ✓」或主幹新變更／主工作區衝突警示（附一鍵用 Antigravity / VS Code 開啟隔離區）。",
        "點擊「Commit: ... 修改訊息 ▴」可展開編輯提交標題、Body、勾選「提交後順便移入封存庫」或點「AI 重新整理訊息」。",
        "按下「通過並提交 ⎇ <分支>」後自動執行寫入；若遇 Pre-commit hook 阻斷，可直接點「交由 Agent 自動修復」。"
      ],
      tip: "在「獨立工作區」完成的變更會在提交時安全合回目標分支並清理空隔離區。"
    },
    {
      id: "rev-feedback",
      badge: "④ 請 AI 再修改",
      title: "收合式審查意見抽屜與快捷退回標籤",
      summary: "審查意見欄在待驗收時預設收合以保留最大閱讀空間；需要修正時才展開，退回即自動喚醒 AI。",
      steps: [
        "點擊底部「請 AI 再修改」會自動切換至審核頁籤並展開意見輸入框與快捷預設標籤（如補測試、調整樣式、重構）。",
        "填妥原因後再點一次「請 AI 再修改」送出，系統將自動把本次回饋歸檔至歷史紀錄並退回進行中重啟修正。"
      ],
      tip: "也可直接點「放棄任務」於 Double-Check 彈窗選擇是否連帶清除工作區與隔離區的未提交異動。"
    }
  ],
  git: [
    {
      id: "git-l2",
      badge: "① L2 分支動作列",
      title: "遠端進度同步、強制 PR 流程與自動封存",
      summary: "在左側欄點選任意非預設分支後，頂部立即依序呈現完整遠端協作按鈕。",
      steps: [
        "支援「拉取 ↓N」、「同步 <主幹>」（支援 Merge / Rebase 兩種策略）、「推送 ↑N」、「開立 PR」與「合併回 <主幹>」。",
        "開啟專案頂部「PR 流程 (requirePr)」後，系統會停用本地直接合併按鈕，引導改走「推送並開立 PR」，且成功開立 PR 後自動封存該分支已完成的任務卡。"
      ],
      tip: "按鈕上的數字徽章會即時反映目前分支落後（↓）或領先（↑）遠端的 commit 數。"
    },
    {
      id: "git-conflict",
      badge: "② PR 前置同步與衝突救援",
      title: "零破壞安全合併檢查與一鍵轉派解衝",
      summary: "開立 PR 彈窗預設勾選「開立 PR 前先拉取並合併目標分支最新進度」，提早揭露衝突並避免盲送。",
      steps: [
        "若偵測到工作區未提交變更或合併衝突，後端會立即中止並自動安全還原工作區，絕不留下破損的 MERGE_HEAD。",
        "彈窗會列出衝突檔案清單，並提供「建立解衝任務 (Agent)」、「在 Antigravity 開啟」、「在 VS Code 開啟」與「衝突已解，重新送出 PR」（保留已填的標題與說明）。"
      ],
      tip: "建立解衝任務會自動帶入目標分支、來源進度與衝突檔清單，由 Agent 於原地解決衝突。"
    },
    {
      id: "git-gh",
      badge: "③ gh 選配與 Azure PAT",
      title: "首次使用未安裝 gh 的運作與 Azure DevOps 整合",
      summary: "GitHub CLI (gh) 為選配工具：未安裝不影響看板、本地 Git、SSH Clone 或 Azure DevOps。",
      steps: [
        "Azure DevOps 專案可於「系統設定 ➔ Git 帳號與遠端連線」驗證組織 PAT 並加密存於 macOS Keychain（零明文落地），直接使用自動 Clone 與 REST API 開 PR。",
        "未安裝 gh 時，開立 GitHub PR 會自動降級並提供「前往網頁開立 PR ↗」按鈕；安裝 gh 後點設定面板「重新掃描」即可一鍵 OAuth 登入多組 GitHub 帳號。"
      ],
      tip: "下方已附上免裝即用範圍對照與三步驟快速安裝啟用面板。",
      action: { type: "git-settings", label: "開啟 Git 帳號與遠端設定" }
    }
  ]
};

let _activeTab = "workspace";
let _activeHotspotByTab = {
  workspace: "ws-sidebar",
  execution: "exec-worktree",
  review: "rev-tabs",
  git: "git-l2"
};
let _demoState = {
  boardView: "kanban",
  selectedBranch: "feat/auth",
  workspaceMode: "worktree",
  reviewTab: "review",
  diffCtx: 15,
  landDrawer: "none"
};

function getHotspotsForTab(tabId) {
  return HOTSPOT_DETAILS[tabId] || [];
}

function getActiveHotspot(tabId) {
  const list = getHotspotsForTab(tabId);
  if (list.length === 0) return null;
  const targetId = _activeHotspotByTab[tabId];
  return list.find(item => item.id === targetId) || list[0];
}

function hotspotClass(tabId, hotspotId, extra = "") {
  const active = getActiveHotspot(tabId)?.id === hotspotId;
  const ring = active
    ? "ring-2 ring-[var(--primary)] bg-sky-500/10 dark:bg-sky-400/10"
    : "hover:ring-1 hover:ring-[var(--primary)]/50";
  return `${extra} transition cursor-pointer ${ring}`.trim();
}

function hotspotClickAttr(hotspotId) {
  return `onclick="event.stopPropagation(); selectHelpHotspot('${hotspotId}')"`;
}

function renderWorkspaceSandbox() {
  const isSwimlane = _demoState.boardView === "swimlane";
  const branchSelected = _demoState.selectedBranch === "feat/auth";
  return `
    <div class="td-canvas-bg border border-[var(--border)] rounded-xl overflow-hidden shadow-sm flex flex-col h-full min-h-[380px] text-[11px] select-none">
      <!-- 模擬頂部外殼 -->
      <div class="flex flex-1 min-h-0">
        <!-- 左側模擬專案 × 分支樹 -->
        <div ${hotspotClickAttr("ws-sidebar")} class="${hotspotClass("workspace", "ws-sidebar", "w-44 flex-shrink-0 bg-[var(--sidebar)] border-r border-[var(--border)] p-2 flex flex-col justify-between gap-2")}">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-1">
              <span class="font-bold text-[10px] text-[var(--muted-foreground)]">專案與分支</span>
              <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[9px] font-semibold">＋ 加入專案</span>
            </div>
            <div class="space-y-1">
              <div class="px-2 py-1 rounded-md bg-[var(--card)] border border-[var(--border)] font-semibold truncate">task-dashboard</div>
              <div class="ml-2 pl-1.5 border-l border-[var(--border)] space-y-0.5">
                <button type="button" onclick="event.stopPropagation(); setHelpDemoState('selectedBranch', 'ALL'); selectHelpHotspot('ws-sidebar')" class="w-full text-left px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center justify-between cursor-pointer ${!branchSelected ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold" : "text-[var(--muted-foreground)] hover:bg-[var(--card)]"}">
                  <span>● main</span><span>2</span>
                </button>
                <button type="button" onclick="event.stopPropagation(); setHelpDemoState('selectedBranch', 'feat/auth'); selectHelpHotspot('ws-sidebar')" class="w-full text-left px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center justify-between gap-1 cursor-pointer ${branchSelected ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold" : "text-[var(--muted-foreground)] hover:bg-[var(--card)]"}">
                  <span class="truncate">⎇ feat/auth</span>
                  <span class="text-[8px] px-1 rounded border ${branchSelected ? "border-amber-200 text-amber-100" : "border-amber-500 text-amber-600"}">未提交</span>
                </button>
              </div>
            </div>
          </div>
          <div class="px-1.5 py-1 rounded bg-[var(--card)] border border-[var(--border)] text-[9px] text-[var(--muted-foreground)] leading-snug">
            <strong class="text-[var(--foreground)]">提示：</strong>● 目前所在分支；獨立工作區可多卡並行
          </div>
        </div>

        <!-- 右側主工作區模擬 -->
        <div class="flex-1 flex flex-col min-w-0">
          <!-- 模擬 Header -->
          <div class="px-2.5 py-2 border-b border-[var(--border)] bg-[var(--card)] flex flex-wrap items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-bold text-xs truncate">task-dashboard ${branchSelected ? "<span class='text-[var(--muted-foreground)] font-mono'>/ ⎇ feat/auth</span>" : ""}</span>
              <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">PR 流程</span>
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <button type="button" ${hotspotClickAttr("ws-attention")} class="${hotspotClass("workspace", "ws-attention", "px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-bold text-[10px]")}">💬 1 待確認</button>
              <button type="button" ${hotspotClickAttr("ws-engine")} class="${hotspotClass("workspace", "ws-engine", "px-2 py-0.5 rounded-md bg-indigo-600 text-white font-semibold text-[10px]")}">開工引擎 · Desktop AI ▾</button>
              ${branchSelected ? `<span class="px-1.5 py-0.5 rounded bg-slate-700 text-white text-[9px] font-semibold">推送 ↑1</span><span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-semibold">開立 PR</span>` : ""}
              <span class="px-1.5 py-0.5 rounded bg-[var(--background)] border border-[var(--border)] text-[9px]">封存庫 4</span>
            </div>
          </div>

          <!-- 階段列 & 視圖切換 -->
          <div ${hotspotClickAttr("ws-views")} class="${hotspotClass("workspace", "ws-views", "p-2.5 space-y-2 flex-1 flex flex-col min-h-0")}">
            <div class="flex flex-wrap items-center gap-1.5">
              <div class="inline-flex p-0.5 rounded-lg bg-[var(--sidebar)] border border-[var(--border)] text-[10px]">
                <button type="button" onclick="event.stopPropagation(); setHelpDemoState('boardView', 'kanban'); selectHelpHotspot('ws-views')" class="px-2 py-0.5 rounded cursor-pointer ${!isSwimlane ? "bg-[var(--card)] font-bold shadow-xs" : "text-[var(--muted-foreground)]"}">看板</button>
                <button type="button" onclick="event.stopPropagation(); setHelpDemoState('boardView', 'swimlane'); selectHelpHotspot('ws-views')" class="px-2 py-0.5 rounded cursor-pointer ${isSwimlane ? "bg-[var(--card)] font-bold shadow-xs" : "text-[var(--muted-foreground)]"}">按分支看</button>
              </div>
              <div class="grid grid-cols-4 gap-1 flex-1 min-w-[220px]">
                <div class="td-surface-card rounded-lg px-2 py-1 flex items-center justify-between"><span class="text-[9px] truncate">1·待處理</span><span class="font-mono font-bold text-[10px]">2</span></div>
                <div class="td-surface-card rounded-lg px-2 py-1 flex items-center justify-between"><span class="text-[9px] text-sky-600 dark:text-sky-400 truncate">2·進行中</span><span class="font-mono font-bold text-[10px] text-sky-600 dark:text-sky-400">1</span></div>
                <div class="td-surface-card rounded-lg px-2 py-1 flex items-center justify-between"><span class="text-[9px] text-amber-600 dark:text-amber-400 truncate">3·待驗收</span><span class="font-mono font-bold text-[10px] text-amber-600 dark:text-amber-400">1</span></div>
                <div class="td-surface-card rounded-lg px-2 py-1 flex items-center justify-between"><span class="text-[9px] text-emerald-600 dark:text-emerald-400 truncate">4·已完成</span><span class="font-mono font-bold text-[10px] text-emerald-600 dark:text-emerald-400">1</span></div>
              </div>
            </div>

            ${isSwimlane ? `
              <!-- 模擬按分支看泳道 -->
              <div class="flex-1 space-y-2 overflow-y-auto">
                <div class="td-surface-well rounded-xl p-2 space-y-1.5">
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="font-mono font-bold">⎇ feat/auth</span>
                    <span class="text-[var(--muted-foreground)]">2 張任務 · 點擊切換泳道</span>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <div class="td-surface-card rounded-lg p-2 space-y-1">
                      <div class="flex items-center justify-between"><span class="text-[9px] font-mono text-sky-600 dark:text-sky-400">進行中 · P1</span><span class="text-[9px] text-amber-600">💬 待回答</span></div>
                      <div class="font-semibold text-[10px] truncate">實作 OAuth Token 刷新</div>
                    </div>
                    <div class="td-surface-card rounded-lg p-2 space-y-1">
                      <div class="flex items-center justify-between"><span class="text-[9px] font-mono text-amber-600 dark:text-amber-400">待驗收 · P1</span><span class="text-[9px]">3 檔異動</span></div>
                      <div class="font-semibold text-[10px] truncate">補齊登入單元測試</div>
                    </div>
                  </div>
                </div>
                <div class="td-surface-well rounded-xl p-2 flex items-center justify-between text-[10px]">
                  <span class="font-mono font-semibold">● main</span>
                  <span class="text-[var(--muted-foreground)]">1 張已完成待封存</span>
                </div>
              </div>
            ` : `
              <!-- 模擬四欄看板 -->
              <div class="flex-1 grid grid-cols-4 gap-1.5 min-h-0">
                <div class="td-surface-well rounded-xl p-1.5 space-y-1.5">
                  <div class="flex items-center justify-between px-1"><span class="text-[10px] font-bold">待處理</span><span class="px-1.5 py-0.2 rounded bg-sky-600 text-white text-[9px]">＋ 新增</span></div>
                  <div class="td-surface-card rounded-lg p-1.5 space-y-1">
                    <div class="text-[9px] font-mono text-[var(--muted-foreground)]">TASK-108 · P1</div>
                    <div class="text-[10px] font-semibold leading-snug">補強匯出報表邊界測試</div>
                  </div>
                </div>
                <div class="td-surface-well rounded-xl p-1.5 space-y-1.5">
                  <div class="flex items-center justify-between px-1"><span class="text-[10px] font-bold text-sky-600 dark:text-sky-400">進行中</span><span class="text-[9px] font-mono">1</span></div>
                  <div class="td-surface-card rounded-lg p-1.5 space-y-1 border-l-2 border-l-amber-500">
                    <div class="text-[9px] font-mono text-amber-600 dark:text-amber-400">💬 待回答問題</div>
                    <div class="text-[10px] font-semibold leading-snug">實作 OAuth Token 刷新</div>
                    <div class="text-[9px] text-[var(--muted-foreground)]">Slices 2/3 · Hydrogen</div>
                  </div>
                </div>
                <div class="td-surface-well rounded-xl p-1.5 space-y-1.5">
                  <div class="flex items-center justify-between px-1"><span class="text-[10px] font-bold text-amber-600 dark:text-amber-400">待驗收</span><span class="text-[9px] font-mono">1</span></div>
                  <div class="td-surface-card rounded-lg p-1.5 space-y-1">
                    <div class="text-[9px] font-mono text-emerald-600 dark:text-emerald-400">✓ 測試通過 (Exit 0)</div>
                    <div class="text-[10px] font-semibold leading-snug">補齊登入單元測試</div>
                  </div>
                </div>
                <div class="td-surface-well rounded-xl p-1.5 space-y-1.5">
                  <div class="flex items-center justify-between px-1"><span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">已提交</span><span class="text-[9px] font-mono">1</span></div>
                  <div class="td-surface-card rounded-lg p-1.5 space-y-1">
                    <div class="text-[9px] font-mono text-emerald-600 dark:text-emerald-400">⎇ feat/auth</div>
                    <div class="text-[10px] font-semibold leading-snug">調整登入表單驗證</div>
                  </div>
                </div>
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderExecutionSandbox() {
  const mode = _demoState.workspaceMode;
  const modes = [
    { id: "worktree", title: "獨立工作區（推薦）", desc: "另開乾淨目錄，不互相干擾" },
    { id: "branch_stream", title: "接續同分支", desc: "在同一目標分支接續實作" },
    { id: "in_place", title: "直接改目前資料夾", desc: "直接修改目前工作區檔案" }
  ];
  return `
    <div class="td-canvas-bg border border-[var(--border)] rounded-xl p-3 space-y-2.5 text-[11px] select-none">
      <!-- ① 執行方式隔離 -->
      <div ${hotspotClickAttr("exec-worktree")} class="${hotspotClass("execution", "exec-worktree", "td-surface-panel rounded-xl p-2.5 space-y-2")}">
        <div class="flex items-center justify-between gap-2">
          <span class="font-bold text-xs">目標分支：<span class="font-mono text-[var(--primary)]">⎇ feat/auth</span></span>
          <span class="text-[10px] font-semibold text-[var(--primary)]">＋ 新建分支</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          ${modes.map(m => {
            const active = mode === m.id;
            return `
              <button type="button" onclick="event.stopPropagation(); setHelpDemoState('workspaceMode', '${m.id}'); selectHelpHotspot('exec-worktree')" class="text-left p-2 rounded-lg border transition cursor-pointer ${active ? "border-[var(--primary)] bg-sky-500/10 text-[var(--foreground)] font-semibold" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"}">
                <div class="text-[10px] font-semibold">${m.title}</div>
                <div class="text-[9px] opacity-80 mt-0.5">${m.desc}</div>
              </button>
            `;
          }).join("")}
        </div>
        ${mode === "in_place" ? `<div class="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[10px]">偵測到目前資料夾有未提交檔案：若多卡同時選原地修改，後端將序列排隊避免衝突。</div>` : ""}
      </div>

      <!-- ② 執行計劃與 Grill-Me -->
      <div ${hotspotClickAttr("exec-plan")} class="${hotspotClass("execution", "exec-plan", "td-surface-panel border-l-[3px] border-l-amber-500 rounded-xl p-2.5 space-y-1.5")}">
        <div class="flex items-center justify-between gap-2">
          <span class="font-bold text-xs text-amber-800 dark:text-amber-300">完整執行計劃 (Execution Plan)</span>
          <div class="flex items-center gap-1 text-[9px]">
            <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] font-bold">結構化計劃</span>
            <span class="px-1.5 py-0.5 rounded text-[var(--muted-foreground)]">原始文字</span>
            <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 font-semibold">待確認</span>
          </div>
        </div>
        <div class="p-2 rounded-lg bg-amber-500/10 space-y-1">
          <div class="flex items-center justify-between text-[10px] font-semibold text-amber-800 dark:text-amber-300">
            <span>🔥 Grill-Me 邊界確認替代介面</span>
            <span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-[9px] font-mono">免去 AI Chat</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[9px]">✅ 確認邊界無誤</span>
            <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[9px]">🚫 排除 Non-goals</span>
            <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[9px]">⚡️ 最小 Fast-Track</span>
          </div>
        </div>
      </div>

      <!-- ③ 執行中互動問答 + ④ 切片追蹤 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div ${hotspotClickAttr("exec-clarify")} class="${hotspotClass("execution", "exec-clarify", "td-surface-panel border-l-[3px] border-l-amber-500 rounded-xl p-2.5 space-y-1.5")}">
          <div class="flex items-center justify-between gap-1">
            <span class="font-bold text-[11px] text-amber-800 dark:text-amber-300">需確認事項 (Clarifications)</span>
            <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 text-[9px] font-semibold">⚡ 套用推薦</span>
          </div>
          <div class="p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] space-y-1">
            <div class="font-semibold">Refresh Token 過期策略？</div>
            <div class="text-[9px] text-[var(--primary)]">● 自動輪換並撤銷舊 Token（推薦）</div>
            <div class="text-[9px] text-[var(--muted-foreground)]">○ 固定有效期不自動延長</div>
          </div>
          <div class="text-right"><span class="inline-block px-2 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold">送出確認並繼續執行</span></div>
        </div>

        <div ${hotspotClickAttr("exec-slices")} class="${hotspotClass("execution", "exec-slices", "td-surface-panel rounded-xl p-2.5 space-y-1.5")}">
          <div class="flex items-center justify-between gap-1">
            <span class="font-bold text-[11px]">當前工作切片與藍圖追蹤</span>
            <span class="px-1.5 py-0.5 rounded bg-sky-600 text-white text-[9px] font-semibold">恢復指令</span>
          </div>
          <div class="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>Tier: <strong class="font-mono text-[var(--foreground)]">standard</strong></span>
            <span class="font-mono font-bold text-[var(--primary)]">Slices 2 / 3</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div class="h-full w-2/3 bg-[var(--primary)] rounded-full"></div>
          </div>
          <div class="space-y-0.5 text-[9px] font-mono">
            <div class="text-emerald-600 dark:text-emerald-400">✓ [SLICE-1] Auth Token 驗證器</div>
            <div class="text-sky-600 dark:text-sky-400">▶ [SLICE-2] Refresh Endpoint 與測試</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderReviewSandbox() {
  const tab = _demoState.reviewTab;
  const ctx = _demoState.diffCtx;
  const drawer = _demoState.landDrawer;

  return `
    <div class="td-canvas-bg border border-[var(--border)] rounded-xl overflow-hidden flex flex-col min-h-[390px] text-[11px] select-none">
      <!-- ① 階段感知三頁籤 -->
      <div ${hotspotClickAttr("rev-tabs")} class="${hotspotClass("review", "rev-tabs", "px-2.5 pt-2 pb-1.5 border-b border-[var(--border)] bg-[var(--card)]")}">
        <div class="grid grid-cols-3 gap-1 td-surface-well p-0.5 rounded-lg text-[10px]">
          <button type="button" onclick="event.stopPropagation(); setHelpDemoState('reviewTab', 'review'); selectHelpHotspot('rev-tabs')" class="py-1 px-2 rounded-md cursor-pointer ${tab === "review" ? "bg-[var(--card)] font-bold shadow-xs" : "text-[var(--muted-foreground)]"}">審核與執行成果</button>
          <button type="button" onclick="event.stopPropagation(); setHelpDemoState('reviewTab', 'spec'); selectHelpHotspot('rev-tabs')" class="py-1 px-2 rounded-md cursor-pointer ${tab === "spec" ? "bg-[var(--card)] font-bold shadow-xs" : "text-[var(--muted-foreground)]"}">需求規格與屬性</button>
          <button type="button" onclick="event.stopPropagation(); setHelpDemoState('reviewTab', 'diff'); selectHelpHotspot('rev-tabs')" class="py-1 px-2 rounded-md cursor-pointer ${tab === "diff" ? "bg-[var(--card)] font-bold shadow-xs" : "text-[var(--muted-foreground)]"}">異動內容檢查</button>
        </div>
      </div>

      <!-- 中段：依頁籤切換呈現 -->
      <div class="flex-1 p-2.5 grid ${tab === "diff" ? "grid-cols-1" : "grid-cols-12"} gap-2 min-h-0">
        ${tab === "spec" ? `
          <div class="col-span-12 td-surface-panel rounded-xl p-2.5 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs">需求規格與屬性（滿版雙欄表單）</span>
              <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">Worktree · feat/auth</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-[10px]">
              <div class="p-2 rounded bg-[var(--card)] border border-[var(--border)]">標題：實作 OAuth Token 自動刷新</div>
              <div class="p-2 rounded bg-[var(--card)] border border-[var(--border)]">標籤：auth, backend, api</div>
            </div>
            <div class="p-2 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">詳細說明支援條列驗收標準、歷史審查意見歸檔與結構化需求確認紀錄。</div>
          </div>
        ` : `
          ${tab === "review" ? `
            <div class="col-span-5 space-y-2 flex flex-col">
              <div class="td-surface-panel rounded-xl p-2 space-y-1">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="font-bold">任務執行報告</span>
                  <span class="text-emerald-600 dark:text-emerald-400 font-mono">Exit 0 ✓</span>
                </div>
                <div class="text-[10px] text-[var(--muted-foreground)] leading-snug">
                  • 核心異動：補齊 Refresh Token 驗證與單元測試<br>
                  • 驗證指令：<code class="font-mono">npm test</code> 全部通過
                </div>
              </div>
              <div ${hotspotClickAttr("rev-feedback")} class="${hotspotClass("review", "rev-feedback", `td-surface-panel rounded-xl p-2 space-y-1 ${drawer === "feedback" ? "border-l-[3px] border-l-amber-500" : ""}`)}">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="font-bold text-amber-700 dark:text-amber-300">審查意見抽屜</span>
                  <span class="text-[9px] text-[var(--muted-foreground)]">${drawer === "feedback" ? "已展開" : "預設收合省空間"}</span>
                </div>
                ${drawer === "feedback" ? `
                  <div class="flex flex-wrap gap-1 text-[9px]">
                    <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)]">補單元測試</span>
                    <span class="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)]">調整錯誤訊息</span>
                  </div>
                ` : `<div class="text-[9px] text-[var(--muted-foreground)]">點擊底部「請 AI 再修改」時才會展開</div>`}
              </div>
            </div>
          ` : ""}

          <!-- ② Master-Detail 雙欄 Diff 檢視器 -->
          <div ${hotspotClickAttr("rev-diff")} class="${hotspotClass("review", "rev-diff", `${tab === "diff" ? "col-span-1" : "col-span-7"} td-surface-panel rounded-xl p-2 flex flex-col gap-1.5`)}">
            <div class="flex flex-wrap items-center justify-between gap-1 pb-1 border-b border-[var(--border)]">
              <div class="flex items-center gap-1.5 text-[10px]">
                <span class="font-bold">2 檔</span>
                <span class="px-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono font-bold">+18</span>
                <span class="px-1 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 font-mono font-bold">-3</span>
                <span class="px-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-mono text-[9px]">NEW 支援</span>
              </div>
              <div class="inline-flex rounded bg-[var(--sidebar)] border border-[var(--border)] p-0.5 text-[9px]">
                ${[3, 15, 40, "full"].map(val => `
                  <button type="button" onclick="event.stopPropagation(); setHelpDemoState('diffCtx', ${typeof val === "string" ? `'${val}'` : val}); selectHelpHotspot('rev-diff')" class="px-1.5 py-0.5 rounded cursor-pointer ${ctx === val ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold" : "text-[var(--muted-foreground)]"}">${val === "full" ? "整檔" : `±${val}`}</button>
                `).join("")}
              </div>
            </div>
            <div class="grid grid-cols-12 gap-1.5 flex-1 min-h-[115px]">
              <div class="col-span-4 bg-[var(--card)] border border-[var(--border)] rounded-lg p-1 space-y-1 text-[9px] font-mono">
                <div class="px-1.5 py-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 truncate font-semibold">M authService.js</div>
                <div class="px-1.5 py-1 rounded text-emerald-700 dark:text-emerald-300 truncate">+ token.test.js</div>
              </div>
              <div class="col-span-8 bg-[var(--card)] border border-[var(--border)] rounded-lg p-1 overflow-hidden">
                <div class="diff-row diff-line-chunk"><span class="diff-num">@@</span><span class="diff-sign"></span><span class="diff-content">refreshSession() (前後文 ${ctx === "full" ? "整檔完整" : `±${ctx} 行`})</span></div>
                <div class="diff-row diff-line-del"><span class="diff-num">42</span><span class="diff-sign">-</span><span class="diff-content">return oldToken;</span></div>
                <div class="diff-row diff-line-add"><span class="diff-num">42</span><span class="diff-sign">+</span><span class="diff-content">return rotateAndRevoke(oldToken);</span></div>
                ${ctx === 40 || ctx === "full" ? `<div class="diff-row diff-line-expanded-ctx"><span class="diff-num">43</span><span class="diff-sign"> </span><span class="diff-content">await auditLog('token.rotated');</span></div>` : ""}
              </div>
            </div>
          </div>
        `}
      </div>

      <!-- ③ Review Land Studio 底部提交塢 -->
      <div ${hotspotClickAttr("rev-land")} class="${hotspotClass("review", "rev-land", "border-t border-[var(--border)] bg-[var(--sidebar)] px-2.5 py-2 space-y-1.5")}">
        ${drawer === "commit" ? `
          <div class="p-2 rounded-lg bg-[var(--card)] border border-[var(--border)] space-y-1 text-[10px]">
            <div class="flex items-center justify-between"><span class="font-bold">編輯 Commit 訊息</span><span class="text-[var(--primary)]">✨ AI 重新整理訊息</span></div>
            <div class="px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] font-mono">feat(auth): 實作 OAuth Token 自動輪換與撤銷</div>
          </div>
        ` : ""}
        <div class="flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9px] font-semibold">分支檢查：可直接提交 ✓</span>
            <button type="button" onclick="event.stopPropagation(); setHelpDemoState('landDrawer', '${drawer === "commit" ? "none" : "commit"}'); selectHelpHotspot('rev-land')" class="px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[9px] font-mono truncate max-w-[165px] cursor-pointer">Commit: feat(auth): 輪換 ▾</button>
          </div>
          <div class="flex items-center gap-1">
            <button type="button" onclick="event.stopPropagation(); setHelpDemoState('landDrawer', '${drawer === "feedback" ? "none" : "feedback"}'); selectHelpHotspot('rev-feedback')" class="px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-[10px] font-bold cursor-pointer">請 AI 再修改</button>
            <span class="px-2.5 py-1 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-bold">通過並提交 ⎇ main</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGitSandbox() {
  return `
    <div class="td-canvas-bg border border-[var(--border)] rounded-xl p-3 space-y-2.5 text-[11px] select-none">
      <!-- ① L2 分支遠端操作列 -->
      <div ${hotspotClickAttr("git-l2")} class="${hotspotClass("git", "git-l2", "td-surface-panel rounded-xl p-2.5 space-y-2")}">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="font-bold text-xs">分支視角：<span class="font-mono">task-dashboard / ⎇ feat/auth</span></span>
          <span class="text-[9px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold">PR 流程 已啟用 (停用本地合併)</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[10px] font-semibold">拉取 ↓2</span>
          <span class="px-2.5 py-1 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[10px] font-semibold">同步 main</span>
          <span class="px-2.5 py-1 rounded-lg bg-slate-700 text-white text-[10px] font-semibold">推送 ↑1</span>
          <span class="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-semibold">推送並開立 PR</span>
        </div>
      </div>

      <!-- ② 開立 PR 前置同步與衝突救援 -->
      <div ${hotspotClickAttr("git-conflict")} class="${hotspotClass("git", "git-conflict", "rounded-xl p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2")}">
        <div class="font-bold text-xs">開立 PR 前同步目標分支發生合併衝突，已自動安全還原工作區</div>
        <div class="p-1.5 rounded bg-white/80 dark:bg-slate-900/70 border border-rose-200 dark:border-rose-800/60 font-mono text-[10px]">
          衝突檔案：src/server/authService.js
        </div>
        <div class="flex flex-wrap gap-1.5 text-[10px]">
          <span class="px-2 py-1 rounded-md bg-rose-600 text-white font-semibold">建立解衝任務 (Agent)</span>
          <span class="px-2 py-1 rounded-md bg-indigo-600 text-white font-semibold">在 Antigravity 開啟</span>
          <span class="px-2 py-1 rounded-md bg-slate-700 text-white font-semibold">在 VS Code 開啟</span>
          <span class="px-2 py-1 rounded-md bg-emerald-600 text-white font-semibold">衝突已解，重新送出 PR</span>
        </div>
      </div>

      <!-- ③ gh 選配狀態與降級卡片 -->
      <div ${hotspotClickAttr("git-gh")} class="${hotspotClass("git", "git-gh", "td-surface-panel rounded-xl p-2.5 space-y-1.5")}">
        <div class="flex items-center justify-between">
          <span class="font-bold text-xs">遠端帳號與工具偵測</span>
          <span class="font-mono text-[10px] text-[var(--muted-foreground)]">git ✓ · gh ✕（選配）· Azure Keychain ✓</span>
        </div>
        <div class="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-[10px] text-amber-900 dark:text-amber-100 flex flex-wrap items-center justify-between gap-2">
          <span>未裝 <code class="font-mono font-semibold">gh</code> 時 GitHub PR 自動降級為網頁開立；Azure DevOps 不需 gh 即可使用。</span>
          <span class="px-2 py-0.5 rounded bg-amber-600 text-white font-semibold">前往網頁開立 PR ↗</span>
        </div>
      </div>
    </div>
  `;
}

function renderShortcutsStage() {
  const groups = [
    {
      title: "全域與專案導覽",
      icon: "compass",
      items: [
        { desc: "打開 / 收合專案與分支側邊欄", keys: "P / ⌘P" },
        { desc: "開啟原生資料夾選取加入專案", keys: "⇧P / ⌘⇧P" },
        { desc: "開啟本互動式 3.0 介面導覽", keys: "? / F1" },
        { desc: "關閉目前彈窗或專案選單", keys: "Esc" }
      ]
    },
    {
      title: "看板與卡片操作",
      icon: "columns-3",
      items: [
        { desc: "建立新任務卡片", keys: "N / C / ⌘N" },
        { desc: "聚焦第 1 ~ 4 欄首張卡片", keys: "1 ~ 4" },
        { desc: "將聚焦卡片移至左 / 右欄位", keys: "← / →" },
        { desc: "高對比鍵盤焦點巡覽", keys: "Tab / ⇧Tab" }
      ]
    },
    {
      title: "任務彈窗編輯",
      icon: "file-edit",
      items: [
        { desc: "提交並儲存任務表單", keys: "⌘Enter / Ctrl+Enter" },
        { desc: "循環切換任務狀態欄位", keys: "Alt+S" },
        { desc: "快速指定狀態 (待處理 ~ 已完成)", keys: "Alt+1 ~ 4" }
      ]
    }
  ];

  return `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      ${groups.map(group => `
        <div class="td-surface-panel rounded-xl p-3.5 space-y-2.5">
          <h4 class="text-xs font-bold flex items-center gap-1.5 pb-1.5 border-b border-[var(--border)]">
            <i data-lucide="${group.icon}" class="w-4 h-4 text-[var(--primary)]"></i>
            <span>${escapeHtml(group.title)}</span>
          </h4>
          <div class="space-y-2">
            ${group.items.map(item => `
              <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs">
                <span class="text-[var(--muted-foreground)]">${escapeHtml(item.desc)}</span>
                <kbd class="px-2 py-0.5 text-[10px] font-mono font-bold bg-[var(--sidebar)] border border-[var(--border)] rounded whitespace-nowrap">${escapeHtml(item.keys)}</kbd>
              </div>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHotspotExplanationPanel(tabId) {
  const hotspots = getHotspotsForTab(tabId);
  const current = getActiveHotspot(tabId);
  if (!current) return "";
  const idx = hotspots.findIndex(h => h.id === current.id);

  return `
    <div class="td-surface-panel rounded-xl p-4 flex flex-col justify-between gap-3 h-full">
      <div class="space-y-3">
        <!-- 熱區編號切換膠囊 -->
        <div class="flex flex-wrap items-center gap-1.5 pb-2.5 border-b border-[var(--border)]">
          ${hotspots.map(h => {
            const active = h.id === current.id;
            return `
              <button type="button" onclick="selectHelpHotspot('${h.id}')" class="px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${active ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs" : "bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}">
                ${escapeHtml(h.badge)}
              </button>
            `;
          }).join("")}
        </div>

        <div class="space-y-1.5">
          <h4 class="text-sm font-bold text-[var(--foreground)]">${escapeHtml(current.title)}</h4>
          <p class="text-xs text-[var(--muted-foreground)] leading-relaxed">${escapeHtml(current.summary)}</p>
        </div>

        <div class="space-y-1.5">
          <div class="text-[11px] font-bold text-[var(--foreground)]">互動操作與行為說明</div>
          <ul class="space-y-1.5 text-xs text-[var(--foreground)]">
            ${current.steps.map(s => `
              <li class="flex items-start gap-2 leading-relaxed">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--primary)] mt-1.5 flex-shrink-0"></span>
                <span>${escapeHtml(s)}</span>
              </li>
            `).join("")}
          </ul>
        </div>

        <div class="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/25 text-[11px] text-[var(--foreground)] leading-relaxed">
          <strong class="text-[var(--primary)]">技巧：</strong>${escapeHtml(current.tip)}
        </div>
      </div>

      <div class="pt-2.5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="stepHelpHotspot(-1)" class="px-2.5 py-1 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium hover:border-[var(--primary)] transition cursor-pointer">← 上一重點</button>
          <button type="button" onclick="stepHelpHotspot(1)" class="px-2.5 py-1 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium hover:border-[var(--primary)] transition cursor-pointer">下一重點 →</button>
          <span class="text-[10px] font-mono text-[var(--muted-foreground)] ml-1">${idx + 1} / ${hotspots.length}</span>
        </div>
        ${current.action ? `
          <button type="button" onclick="triggerHelpQuickAction('${current.action.type}')" class="px-3 py-1 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold shadow-xs hover:opacity-95 transition cursor-pointer">
            ${escapeHtml(current.action.label)} ↗
          </button>
        ` : ""}
      </div>
    </div>
  `;
}

function renderHelpGuideStage() {
  if (typeof document === "undefined") return;
  const tabBar = document.getElementById("helpGuideTabBar");
  const stage = document.getElementById("helpGuideInteractiveStage");
  const gitSection = document.getElementById("helpGitEnvGuideSection");

  if (tabBar) {
    tabBar.innerHTML = GUIDE_TABS.map(tab => {
      const active = tab.id === _activeTab;
      return `
        <button type="button" role="tab" aria-selected="${active ? "true" : "false"}" onclick="switchHelpGuideTab('${tab.id}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${active ? "bg-[var(--card)] text-[var(--primary)] shadow-xs border border-[var(--border)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-transparent"}">
          <i data-lucide="${tab.icon}" class="w-3.5 h-3.5"></i>
          <span>${escapeHtml(tab.label)}</span>
        </button>
      `;
    }).join("");
  }

  if (stage) {
    if (_activeTab === "shortcuts") {
      stage.innerHTML = renderShortcutsStage();
    } else {
      let sandboxHtml = "";
      if (_activeTab === "workspace") sandboxHtml = renderWorkspaceSandbox();
      else if (_activeTab === "execution") sandboxHtml = renderExecutionSandbox();
      else if (_activeTab === "review") sandboxHtml = renderReviewSandbox();
      else if (_activeTab === "git") sandboxHtml = renderGitSandbox();

      stage.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div class="lg:col-span-7 flex flex-col gap-2">
            <div class="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
              <span>Task Dashboard 3.0 擬真互動區（點擊任一區塊切換右側解說）</span>
            </div>
            ${sandboxHtml}
          </div>
          <div class="lg:col-span-5">
            ${renderHotspotExplanationPanel(_activeTab)}
          </div>
        </div>
      `;
    }
  }

  if (gitSection) {
    gitSection.classList.toggle("hidden", _activeTab !== "git");
  }

  if (typeof window !== "undefined" && window.lucide) {
    window.lucide.createIcons();
  }
}

function initHelpGuideModal() {
  renderHelpGuideStage();
}

function switchHelpGuideTab(tabId) {
  if (!GUIDE_TABS.some(t => t.id === tabId)) return;
  _activeTab = tabId;
  renderHelpGuideStage();
}

function selectHelpHotspot(hotspotId) {
  const list = getHotspotsForTab(_activeTab);
  if (!list.some(h => h.id === hotspotId)) return;
  _activeHotspotByTab[_activeTab] = hotspotId;
  renderHelpGuideStage();
}

function stepHelpHotspot(delta = 1) {
  const list = getHotspotsForTab(_activeTab);
  if (list.length === 0) return;
  const current = getActiveHotspot(_activeTab);
  const idx = list.findIndex(h => h.id === current?.id);
  const nextIdx = (idx + delta + list.length) % list.length;
  _activeHotspotByTab[_activeTab] = list[nextIdx].id;
  renderHelpGuideStage();
}

function setHelpDemoState(key, value) {
  if (!key || !(key in _demoState)) return;
  _demoState[key] = value;
  renderHelpGuideStage();
}

function triggerHelpQuickAction(actionType) {
  if (typeof window === "undefined") return;
  window.closeHelpModal?.();
  if (actionType === "add-project") {
    window.openAddProjectModal?.();
  } else if (actionType === "engine") {
    setTimeout(() => window.openEnginePopover?.(), 40);
  } else if (actionType === "archive") {
    window.openArchiveModal?.();
  } else if (actionType === "new-task") {
    window.openModal?.({ status: "todo" });
  } else if (actionType === "git-settings") {
    window.openGitSettingsFromHelp?.();
  }
}

export {
  initHelpGuideModal,
  switchHelpGuideTab,
  selectHelpHotspot,
  stepHelpHotspot,
  setHelpDemoState,
  triggerHelpQuickAction
};

if (typeof window !== "undefined") {
  window.initHelpGuideModal = initHelpGuideModal;
  window.switchHelpGuideTab = switchHelpGuideTab;
  window.selectHelpHotspot = selectHelpHotspot;
  window.stepHelpHotspot = stepHelpHotspot;
  window.setHelpDemoState = setHelpDemoState;
  window.triggerHelpQuickAction = triggerHelpQuickAction;
}
