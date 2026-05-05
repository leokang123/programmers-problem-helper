// Sidebar Webview client script 조각입니다. buildSidebarClientScript에서 순서대로 이어 붙입니다.
function buildSidebarClientStateScript() {
  return `    const vscode = acquireVsCodeApi();
    const input = document.getElementById('lessonId');
    const createButton = document.getElementById('create');
    const customTests = document.getElementById('customTests');
    const problemList = document.getElementById('problemList');
    const status = document.getElementById('status');
    const app = document.querySelector('.app');
    const topPane = document.getElementById('topPane');
    const testsPane = document.getElementById('testsPane');
    const listPane = document.getElementById('listPane');
    const topSummary = document.getElementById('topSummary');
    const testsSummary = document.getElementById('testsSummary');
    const listSummary = document.getElementById('listSummary');
    const problemSearch = document.getElementById('problemSearch');
    const resetCurrentSolution = document.getElementById('resetCurrentSolution');
    const startCurrentReview = document.getElementById('startCurrentReview');
    const openNotes = document.getElementById('openNotes');
    const openWebsite = document.getElementById('openWebsite');
    const runSamples = document.getElementById('run');
    const runCustom = document.getElementById('runCustom');
    const saveCustomTestsButton = document.getElementById('saveCustomTests');
    const timerPanel = document.getElementById('timerPanel');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerTarget = document.getElementById('timerTarget');
    const timerToggle = document.getElementById('timerToggle');
    const timerReset = document.getElementById('timerReset');
    let testCount = 0;
    let problems = [];
    let currentProblem = undefined;
    let currentProblemDir = '';
    let activeTimer = undefined;
    let timerRenderInterval = undefined;
    let timerNotificationKey = '';
    let notifiedTimerMarks = new Set();
    let savedCustomTests = [];
    let savedCustomTestsSignature = '';
    let searchRenderTimer = undefined;
    let scrollSaveTimer = undefined;
    let reviewSaveTimer = undefined;
    let pendingProblemListScrollTop = undefined;
    const pendingReviewProblemDirs = new Set();
    let sidebarStateReady = false;
    let renderedProblems = [];
    let renderedSnapshots = [];
    let createBusy = false;
    let selectedSnapshotKey = '';
    const problemRowCache = new Map();
    const snapshotRowCache = new Map();
    const otherSnapshotRowCache = new Map();

    // Webview reload 후에도 접힘 상태, 검색어, 선택 snapshot을 유지합니다.
    function saveSidebarState() {
      if (!sidebarStateReady) return;
      vscode.setState({
        currentProblem,
        currentProblemDir,
        activeTimer,
        timerNotificationKey,
        notifiedTimerMarks: Array.from(notifiedTimerMarks),
        customTests: savedCustomTests,
        selectedSnapshotKey,
        problemListScrollTop: problemList.scrollTop,
        problemFilter: document.querySelector('input[name="problemFilter"]:checked')?.value || 'all',
        collapsed: {
          top: topPane.classList.contains('collapsed'),
          tests: testsPane.classList.contains('collapsed'),
          list: listPane.classList.contains('collapsed')
        }
      });
    }

    // VS Code Webview state에서 이전 UI 상태를 복원합니다.
    function restoreSidebarState() {
      const saved = vscode.getState();
      if (!saved || typeof saved !== 'object') return;

      currentProblem = saved.currentProblem;
      currentProblemDir = typeof saved.currentProblemDir === 'string' ? saved.currentProblemDir : '';
      activeTimer = saved.activeTimer ? normalizeTimer(saved.activeTimer) : undefined;
      timerNotificationKey = typeof saved.timerNotificationKey === 'string' ? saved.timerNotificationKey : '';
      notifiedTimerMarks = new Set(Array.isArray(saved.notifiedTimerMarks) ? saved.notifiedTimerMarks : []);
      selectedSnapshotKey = typeof saved.selectedSnapshotKey === 'string' ? saved.selectedSnapshotKey : '';
      pendingProblemListScrollTop = typeof saved.problemListScrollTop === 'number' ? saved.problemListScrollTop : undefined;
      if (Array.isArray(saved.customTests)) {
        setCustomTests(saved.customTests);
      }
      const filterValue = typeof saved.problemFilter === 'string' ? saved.problemFilter : 'all';
      const filter = document.querySelector('input[name="problemFilter"][value="' + filterValue + '"]');
      if (filter) {
        filter.checked = true;
      }
      const collapsed = saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {};
      setPaneCollapsed(topPane, document.getElementById('toggleTop'), 'top-collapsed', Boolean(collapsed.top));
      setPaneCollapsed(testsPane, document.getElementById('toggleTests'), 'tests-collapsed', Boolean(collapsed.tests));
      setPaneCollapsed(listPane, document.getElementById('toggleList'), 'list-collapsed', Boolean(collapsed.list));
    }

    // 상단/목록 pane의 접힘 상태를 DOM class와 접근성 속성에 반영합니다.
    function setPaneCollapsed(pane, button, className, collapsed) {
      const body = pane.querySelector('.pane-body');
      pane.classList.toggle('collapsed', collapsed);
      if (body) {
        body.hidden = collapsed;
      }
      app.classList.toggle(className, collapsed);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.querySelector('.toggle-icon').textContent = collapsed ? '▸' : '▾';
      updatePaneSummaries();
      saveSidebarState();
    }

    // pane header 클릭 시 접힘 상태를 토글하고 Webview state에 저장합니다.
    function togglePane(pane, button, className) {
      setPaneCollapsed(pane, button, className, !pane.classList.contains('collapsed'));
    }

    // 현재 열린 문제가 있을 때만 실행/메모/삭제 같은 액션 버튼을 활성화합니다.
    function updateCurrentActions() {
      resetCurrentSolution.disabled = !currentProblemDir;
      startCurrentReview.disabled = !currentProblemDir;
      openNotes.disabled = !currentProblemDir;
      openWebsite.disabled = !currentProblemDir;
      runSamples.disabled = !currentProblemDir;
      runCustom.disabled = !currentProblemDir;
      updateTimerUi();
      saveSidebarState();
    }

    // extension에서 받은 timer payload를 Webview 계산용 기본값과 합칩니다.
    function normalizeTimer(timer) {
      return {
        problemDir: timer?.problemDir || currentProblemDir,
        elapsedMs: Math.max(0, Number(timer?.elapsedMs) || 0),
        startedAt: typeof timer?.startedAt === 'number' ? timer.startedAt : null,
        isRunning: Boolean(timer?.isRunning && typeof timer?.startedAt === 'number'),
        targetMinutes: [20, 30, 60, 90, 120].includes(Number(timer?.targetMinutes)) ? Number(timer.targetMinutes) : 60,
      };
    }

    // running timer면 현재 시각까지 포함한 경과 시간을 계산합니다.
    function getTimerElapsedMs(timer) {
      if (!timer) return 0;
      const runningDelta = timer.isRunning && timer.startedAt ? Math.max(0, Date.now() - timer.startedAt) : 0;
      return Math.max(0, timer.elapsedMs + runningDelta);
    }

    // 타이머 경과 시간을 HH:MM:SS 텍스트로 변환합니다.
    function formatTimerElapsed(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      // 시간 숫자를 두 자리 문자열로 맞춥니다.
      const pad = (value) => String(value).padStart(2, '0');
      return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(seconds) : pad(minutes) + ':' + pad(seconds);
    }

    // running timer가 있을 때만 1초 UI refresh interval을 유지합니다.
    function updateTimerRefresh() {
      const shouldRun = Boolean(activeTimer?.isRunning && currentProblemDir);
      if (shouldRun && !timerRenderInterval) {
        timerRenderInterval = setInterval(updateTimerUi, 1000);
      }
      if (!shouldRun && timerRenderInterval) {
        clearInterval(timerRenderInterval);
        timerRenderInterval = undefined;
      }
    }

    // 타이머 버튼, 경과 시간, 목표 시간 표시를 현재 timer 상태로 갱신합니다.
    function updateTimerUi() {
      const timer = normalizeTimer(activeTimer);
      const elapsedMs = currentProblemDir ? getTimerElapsedMs(timer) : 0;
      const targetMinutes = timer.targetMinutes;
      const targetMs = targetMinutes * 60 * 1000;
      const overTarget = timer.isRunning && elapsedMs > targetMs;
      const nearTarget = timer.isRunning && !overTarget && targetMs - elapsedMs <= 3 * 60 * 1000;
      maybeNotifyTimer(timer, elapsedMs, targetMs);
      timerPanel.classList.toggle('timer-over', overTarget);
      timerPanel.classList.toggle('timer-warning', nearTarget);
      timerPanel.classList.toggle('timer-paused', Boolean(currentProblemDir && !timer.isRunning));
      timerDisplay.textContent = '⏱ ' + formatTimerElapsed(elapsedMs) + ' / ' + targetMinutes + 'm' + (overTarget ? ' 초과' : '');
      timerTarget.value = String(targetMinutes);
      timerTarget.disabled = !currentProblemDir;
      timerToggle.disabled = !currentProblemDir;
      timerToggle.textContent = timer.isRunning ? '중지' : '시작';
      timerReset.disabled = !currentProblemDir || (!timer.isRunning && elapsedMs === 0);
      updateTimerRefresh();
    }

    // 같은 목표 시간 초과 알림을 중복해서 띄우지 않기 위한 key를 만듭니다.
    function getTimerNotificationKey(timer) {
      return (timer.problemDir || currentProblemDir || '') + '::' + timer.targetMinutes;
    }

    // 문제 전환 시 타이머 알림 중복 방지 상태를 초기화합니다.
    function resetTimerNotifications() {
      timerNotificationKey = '';
      notifiedTimerMarks = new Set();
    }

    // 목표 시간을 처음 넘긴 순간 extension에 알림 요청 메시지를 보냅니다.
    function maybeNotifyTimer(timer, elapsedMs, targetMs) {
      if (!currentProblemDir || !timer.isRunning) return;
      const nextKey = getTimerNotificationKey(timer);
      if (timerNotificationKey !== nextKey) {
        timerNotificationKey = nextKey;
        notifiedTimerMarks = new Set();
      }
      const remainingMs = targetMs - elapsedMs;
      const marks = [
        { key: '3m', minMs: 2 * 60 * 1000, maxMs: 3 * 60 * 1000, text: '3분 남았습니다.' },
        { key: '2m', minMs: 1 * 60 * 1000, maxMs: 2 * 60 * 1000, text: '2분 남았습니다.' },
        { key: '1m', minMs: 0, maxMs: 1 * 60 * 1000, text: '1분 남았습니다.' },
        { key: 'over', minMs: -Infinity, maxMs: 0, text: '타임오버' }
      ];
      for (const mark of marks) {
        if (remainingMs > mark.minMs && remainingMs <= mark.maxMs && !notifiedTimerMarks.has(mark.key)) {
          notifiedTimerMarks.add(mark.key);
          vscode.postMessage({ type: 'timerNotification', text: mark.text });
          saveSidebarState();
          break;
        }
      }
    }

    // extension에서 받은 timer 상태를 Webview 상태와 화면에 반영합니다.
    function applyTimerState(timer) {
      if (!timer || timer.problemDir !== currentProblemDir) {
        activeTimer = undefined;
      } else {
        activeTimer = normalizeTimer(timer);
      }
      updateTimerUi();
      saveSidebarState();
    }

    // 접힌 pane header에 현재 문제/검색/테스트 개수 요약을 표시합니다.
    function updatePaneSummaries() {
      const statusTitle = status.textContent.split('\\n').find((line) => line.trim()) || '대기 중';
      topSummary.textContent = topPane.classList.contains('collapsed') ? statusTitle : '';

      const customCount = document.querySelectorAll('.test-card').length;
      testsSummary.textContent = testsPane.classList.contains('collapsed') ? '샘플 · 커스텀 ' + customCount + '개' : '';

      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = getMatchedProblems(query);
      const currentMatchesQuery = matchesProblemQuery(currentProblem, query);
      const visibleCount = filter === 'solutions'
        ? (currentMatchesQuery ? buildAllSolutionRows(currentProblem).length : 0)
        : (filter === 'review' ? matched.filter((problem) => problem.review) : matched).length;
      listSummary.textContent = listPane.classList.contains('collapsed')
        ? (filter === 'solutions' ? '풀이기록 ' + visibleCount + '개' : filter === 'review' ? '다시풀 ' + visibleCount + '개' : '전체 ' + visibleCount + '개')
        : '';
    }`;
}

module.exports = {
  buildSidebarClientStateScript,
};
