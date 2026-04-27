const vscode = require("vscode");

const SIDEBAR_VIEW_ID = "programmersHelper.sidebar";

// 사이드바 Webview와 메시지 핸들링을 관리합니다.
class ProgrammersSidebarProvider {
  // 컨텍스트와 메시지 핸들러를 저장합니다.
  constructor(context, handlers = {}) {
    this.context = context;
    this.handlers = handlers;
    this.view = undefined;
    this.problemListCache = undefined;
    this.problemListRefreshPromise = undefined;
  }

  // Webview가 열릴 때 HTML과 메시지 핸들러를 설정합니다.
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    this.refreshProblems({ force: false, progress: true });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "refreshProblems") {
        await this.refreshProblems({ force: Boolean(message.force), progress: true });
        return;
      }

      const handler = this.handlers[message.type];
      if (handler) {
        await handler(message);
      }
    });
  }

  // Webview로 메시지를 보냅니다.
  post(message) {
    if (!this.view) {
      return false;
    }
    this.view.webview.postMessage(message);
    return true;
  }

  // 문제 목록과 현재 문제 상태를 새로 보냅니다.
  async refreshProblems(options = {}) {
    if (options.progress) {
      return vscode.window.withProgress(
        {
          location: { viewId: SIDEBAR_VIEW_ID },
          title: "문제 목록 불러오는 중...",
        },
        () => this.refreshProblems({ ...options, progress: false })
      );
    }

    await Promise.resolve();
    const {
      loadProblems,
      resolveProgrammersDir,
    } = require("./problemStore");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    const cacheKey = programmersDir?.fsPath || "";
    if (Array.isArray(options.problems)) {
      const problems = options.problems;
      this.problemListCache = { cacheKey, problems };
      if (this.problemListRefreshPromise?.cacheKey === cacheKey) {
        this.problemListRefreshPromise = undefined;
      }
      this.post({ type: "problems", problems });
      return;
    }

    if (options.invalidateCache && this.problemListCache?.cacheKey === cacheKey) {
      this.problemListCache = undefined;
    }
    if (options.invalidateCache && this.problemListRefreshPromise?.cacheKey === cacheKey) {
      this.problemListRefreshPromise = undefined;
    }

    if (!options.force && this.problemListCache?.cacheKey === cacheKey) {
      this.post({ type: "problems", problems: this.problemListCache.problems });
      return;
    }

    if (!options.force && this.problemListRefreshPromise?.cacheKey === cacheKey) {
      const problems = await this.problemListRefreshPromise.promise;
      this.post({ type: "problems", problems });
      return;
    }

    const promise = programmersDir ? loadProblems(programmersDir, { rebuildIndex: Boolean(options.force) }) : Promise.resolve([]);
    this.problemListRefreshPromise = { cacheKey, promise };
    try {
      const problems = await promise;
      if (this.problemListRefreshPromise?.promise !== promise) {
        return;
      }
      this.problemListCache = { cacheKey, problems };
      this.post({ type: "problems", problems });
    } finally {
      if (this.problemListRefreshPromise?.promise === promise) {
        this.problemListRefreshPromise = undefined;
      }
    }
  }

  // 사이드바 HTML을 생성합니다.
  getHtml() {
    return buildSidebarHtml(String(Date.now()));
  }
}

// Webview에 삽입할 HTML 문자열을 만듭니다.
function buildSidebarHtml(nonce) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    input, textarea { width: 100%; box-sizing: border-box; padding: 6px 7px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    textarea { min-height: 52px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    button { width: 100%; margin-top: 6px; padding: 6px 7px; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .app { height: 100%; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 58fr) minmax(0, 42fr); gap: 4px; padding: 4px; overflow: hidden; }
    .app.tests-collapsed { grid-template-rows: auto auto minmax(0, 1fr); }
    .app.list-collapsed { grid-template-rows: auto minmax(0, 1fr) auto; }
    .app.tests-collapsed.list-collapsed { grid-template-rows: auto auto auto; align-content: start; }
    .pane { min-height: 0; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); }
    .pane + .pane { border-top: 1px solid var(--vscode-panel-border); }
    .pane-title { flex: 0 0 auto; padding: 5px 2px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .toggle-title { display: flex; align-items: center; gap: 6px; width: 100%; margin: 0; border: 0; background: transparent; color: var(--vscode-foreground); text-align: left; cursor: pointer; }
    .toggle-title:hover { background: var(--vscode-list-hoverBackground); }
    .toggle-icon { width: 10px; color: var(--vscode-descriptionForeground); }
    .toggle-label { flex: 1 1 auto; min-width: 0; }
    .toggle-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .collapsed-badge { display: none; flex: 0 0 auto; padding: 1px 5px; border: 1px solid var(--vscode-panel-border); border-radius: 2px; font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .pane-body { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 2px; box-sizing: border-box; }
    .top-pane .pane-body { overflow: visible; }
    #testsPane .pane-body { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
    .pane.collapsed { overflow: hidden; }
    .pane.collapsed .pane-body { display: none; }
    .pane-body[hidden] { display: none !important; }
    .pane.collapsed .collapsed-badge { display: inline-block; }
    .section-title { margin-bottom: 5px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .section { margin-bottom: 8px; }
    .section:last-child { margin-bottom: 0; }
    .open-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .open-actions button { margin-top: 6px; }
    .current-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
    .current-actions button { margin-top: 0; }
    .list-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
    .filter { display: flex; gap: 6px; align-items: center; margin: 0; font-size: 12px; color: var(--vscode-foreground); }
    .filter input { width: auto; margin: 0; }
    .search { flex: 1 1 100%; min-width: 0; }
    .refresh { width: auto; min-width: 30px; margin: 0 0 0 auto; padding: 3px 7px; }
    button:disabled { opacity: 0.55; cursor: default; }
    .problem-list { border-top: 1px solid var(--vscode-panel-border); }
    .problem-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .problem-row:hover { background: var(--vscode-list-hoverBackground); }
    .problem-title { font-size: 12px; line-height: 1.35; color: var(--vscode-foreground); word-break: break-word; }
    .problem-id { margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .problem-actions { display: flex; gap: 6px; align-items: center; }
    .review-toggle { display: flex; gap: 4px; align-items: center; margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .review-toggle input { width: auto; margin: 0; }
    .solution-action { width: auto; margin: 0; padding: 2px 6px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 11px; }
    .solution-action:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
    .snapshot-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .snapshot-row:hover { background: var(--vscode-list-hoverBackground); }
    .snapshot-title { font-size: 12px; line-height: 1.35; color: var(--vscode-foreground); word-break: break-word; }
    .snapshot-meta { margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .delete-problem { width: auto; margin: 0; padding: 2px 6px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .delete-problem:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-errorForeground); }
    .empty { padding: 9px 0; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
    .test-actions { flex: 0 0 auto; padding: 2px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .test-actions-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 6px; }
    .test-actions-grid button { margin-top: 0; }
    .tests-content { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 8px 2px 2px; box-sizing: border-box; }
    .test-card { margin-top: 8px; padding: 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .test-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .remove { width: auto; margin: 0; padding: 3px 7px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .status { margin-top: 5px; padding: 5px 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBarSectionHeader-background); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-size: 12px; color: var(--vscode-foreground); line-height: 1.25; }
    .status.ready { border-color: var(--vscode-testing-iconPassed); }
    .status.error { border-color: var(--vscode-testing-iconFailed); }
    .status.running { border-color: var(--vscode-progressBar-background); }
    .hint { margin-top: 6px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="app">
    <section id="topPane" class="pane top-pane collapsible-pane">
      <button id="toggleTop" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">문제 열기 / 현재 상태</span>
        <span id="topSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="section">
          <label for="lessonId">Programmers 문제 번호</label>
          <input id="lessonId" placeholder="468379" inputmode="numeric" />
          <div class="open-actions">
            <button id="create">생성 및 열기</button>
            <button id="open" class="secondary">마지막 열기</button>
          </div>
        </div>
        <div id="status" class="status">대기 중

문제 번호를 입력하고 생성 버튼을 누르세요.</div>
        <div class="current-actions">
          <button id="resetCurrentSolution" class="secondary" disabled>초기화</button>
          <button id="startCurrentReview" class="secondary" disabled>새풀이</button>
          <button id="openNotes" class="secondary" disabled>메모</button>
        </div>
      </div>
    </section>

    <section id="testsPane" class="pane collapsible-pane">
      <button id="toggleTests" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">테스트 실행</span>
        <span id="testsSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="test-actions">
          <div class="test-actions-grid">
            <button id="run">샘플 테스트 실행</button>
            <button id="stopRun" class="secondary" disabled>실행 중지</button>
          </div>
        </div>
        <div class="tests-content">
          <div class="section">
            <label>커스텀 테스트케이스</label>
            <div id="customTests"></div>
            <button id="addTest" class="secondary">+ 테스트 추가</button>
            <button id="runCustom">커스텀 테스트 실행</button>
            <div class="hint">Input은 solution 인자 순서대로 쉼표로 구분합니다. 예: 4, 5, 2, 2, [[0,0]]</div>
            <div class="hint">테스트는 현재 사용자 권한으로 solution.cpp를 컴파일하고 실행합니다.</div>
          </div>
        </div>
      </div>
    </section>

    <section id="listPane" class="pane collapsible-pane">
      <button id="toggleList" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">문제 목록</span>
        <span id="listSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="list-actions">
          <label class="filter"><input name="problemFilter" type="radio" value="all" checked /> 전체</label>
          <label class="filter"><input name="problemFilter" type="radio" value="review" /> 다시풀</label>
          <label class="filter"><input name="problemFilter" type="radio" value="solutions" /> 풀이기록</label>
          <button id="refreshProblems" class="secondary refresh" title="새로고침">↻</button>
          <input id="problemSearch" class="search" type="text" placeholder="문제 번호 또는 제목 검색" />
        </div>
        <div id="problemList" class="problem-list"></div>
      </div>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('lessonId');
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
    const runSamples = document.getElementById('run');
    const runCustom = document.getElementById('runCustom');
    let testCount = 0;
    let problems = [];
    let currentProblem = undefined;
    let currentProblemDir = '';
    let searchRenderTimer = undefined;
    let renderedProblems = [];
    let renderedSnapshots = [];
    const problemRowCache = new Map();
    const snapshotRowCache = new Map();

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
    }

    function togglePane(pane, button, className) {
      setPaneCollapsed(pane, button, className, !pane.classList.contains('collapsed'));
    }

    function updateCurrentActions() {
      resetCurrentSolution.disabled = !currentProblemDir;
      startCurrentReview.disabled = !currentProblemDir;
      openNotes.disabled = !currentProblemDir;
      runSamples.disabled = !currentProblemDir;
      runCustom.disabled = !currentProblemDir;
    }

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
        ? (currentMatchesQuery ? buildSolutionRows(currentProblem).length : 0)
        : (filter === 'review' ? matched.filter((problem) => problem.review) : matched).length;
      listSummary.textContent = listPane.classList.contains('collapsed')
        ? (filter === 'solutions' ? '풀이기록 ' + visibleCount + '개' : filter === 'review' ? '다시풀 ' + visibleCount + '개' : '전체 ' + visibleCount + '개')
        : '';
    }

    function matchesProblemQuery(problem, query) {
      if (!problem) return false;
      if (!query) return true;
      return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
    }

    function getMatchedProblems(query) {
      return problems.filter((problem) => matchesProblemQuery(problem, query));
    }

    function formatSnapshotTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('ko-KR', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function buildSolutionRows(problem) {
      if (!problem) return [];
      return (Array.isArray(problem.solutionHistory) ? problem.solutionHistory : [])
        .map((snapshot) => ({ problem, snapshot }))
        .sort((a, b) => {
          return String(b.snapshot.createdAt || '').localeCompare(String(a.snapshot.createdAt || ''));
        });
    }

    // 빈 목록 메시지는 실제 row cache와 별개인 임시 DOM이다.
    // 검색 결과 없음, 현재 문제 없음 같은 상태를 표시할 때만 만든다.
    function createEmptyRow(text) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = text;
      return empty;
    }

    // 이번 렌더 결과에 남아 있는 key만 cache에 보관한다.
    // DOM에서 빠진 row를 계속 들고 있으면 검색/삭제 후 메모리가 불필요하게 유지된다.
    function pruneRowCache(cache, nextKeys) {
      for (const key of Array.from(cache.keys())) {
        if (!nextKeys.has(key)) {
          cache.delete(key);
        }
      }
    }

    // 목록이 비었을 때는 해당 목록의 row cache를 비우고 empty row 하나만 배치한다.
    function renderEmptyList(container, cache, emptyText) {
      cache.clear();
      container.replaceChildren(createEmptyRow(emptyText));
    }

    // key에 해당하는 row를 cache에서 꺼내고, 없으면 factory로 새 row를 만든다.
    // row 생성 책임과 row 갱신 책임을 분리하기 위한 작은 진입점이다.
    function getCachedRow(cache, key, factory) {
      let row = cache.get(key);
      if (!row) {
        row = factory();
        cache.set(key, row);
      }
      return row;
    }

    // 현재 렌더 결과를 DocumentFragment 하나로 모아 container에 배치한다.
    // 각 항목의 key 계산, row 생성, row 갱신은 인자로 받아 목록 종류별 차이를 밖으로 밀어낸다.
    function renderCachedRows(container, items, cache, getKey, createRow, updateRow) {
      const nextKeys = new Set();
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        const key = getKey(item, index);
        nextKeys.add(key);
        const row = getCachedRow(cache, key, createRow);
        updateRow(row, item, index);
        fragment.appendChild(row);
      });
      pruneRowCache(cache, nextKeys);
      container.replaceChildren(fragment);
    }

    // 문제 row의 안정적인 identity는 문제 폴더 경로다.
    // 경로가 없는 비정상 데이터는 index로 fallback하지만, 정상 목록에서는 problemDir가 항상 key가 된다.
    function getProblemRowKey(problem, index) {
      return problem.problemDir || String(index);
    }

    // 풀이기록 row는 같은 문제 안에 여러 snapshot이 있으므로 문제 경로와 snapshot 경로를 함께 쓴다.
    function getSnapshotRowKey(row, index) {
      return (row.problem.problemDir || '') + '::' + (row.snapshot.path || index);
    }

    // 문제 row의 DOM 구조는 최초 생성 때만 만든다.
    // 이후 렌더에서는 updateProblemRow가 텍스트와 checkbox 상태만 바꾼다.
    function createProblemRow() {
      const row = document.createElement('div');
      row.className = 'problem-row';
      row.innerHTML =
        '<div><div class="problem-title"></div><div class="problem-id"></div></div>' +
        '<div class="problem-actions">' +
          '<label class="review-toggle"><input class="review-check" type="checkbox" /> 다시풀</label>' +
          '<button class="delete-problem" type="button" title="문제 삭제">삭제</button>' +
        '</div>';
      row._title = row.querySelector('.problem-title');
      row._id = row.querySelector('.problem-id');
      row._review = row.querySelector('.review-check');
      return row;
    }

    // 기존 문제 row를 최신 summary로 갱신한다.
    // 클릭 핸들러는 event delegation을 쓰므로 여기서는 data-index와 표시 상태만 맞춘다.
    function updateProblemRow(row, problem, index) {
      row.dataset.index = String(index);
      row._title.textContent = problem.title || '';
      row._id.textContent =
        '#' + (problem.lessonId || '-') +
        (problem.solutionHistoryCount ? ' · 이전풀이 ' + problem.solutionHistoryCount + '개' : '');
      row._review.checked = Boolean(problem.review);
    }

    // 풀이기록 row의 DOM 구조도 최초 생성 때만 만든다.
    // 열기/삭제 버튼 동작은 상위 목록 click handler가 data-index로 처리한다.
    function createSnapshotRow() {
      const row = document.createElement('div');
      row.className = 'snapshot-row';
      row.innerHTML =
        '<div><div class="snapshot-title"></div><div class="snapshot-meta"></div></div>' +
        '<div class="problem-actions">' +
          '<button class="solution-action open-snapshot" type="button">열기</button>' +
          '<button class="delete-problem delete-snapshot" type="button">삭제</button>' +
        '</div>';
      row._title = row.querySelector('.snapshot-title');
      row._meta = row.querySelector('.snapshot-meta');
      return row;
    }

    // 기존 풀이기록 row를 최신 snapshot metadata로 갱신한다.
    function updateSnapshotRow(row, item, index) {
      const { problem, snapshot } = item;
      row.dataset.index = String(index);
      row._title.textContent = problem.title || '';
      row._meta.textContent =
        '#' + (problem.lessonId || '-') +
        ' · ' + (snapshot.label || '이전 풀이') +
        ' · ' + formatSnapshotTime(snapshot.createdAt);
    }

    // 일반 문제 목록 렌더링 진입점이다.
    // snapshot 목록 cache와 현재 renderedSnapshots를 비워 클릭 대상이 문제 row임을 명확히 한다.
    function renderList(container, visible, emptyText) {
      renderedProblems = visible;
      renderedSnapshots = [];
      snapshotRowCache.clear();
      if (visible.length === 0) {
        renderEmptyList(container, problemRowCache, emptyText);
        return;
      }

      renderCachedRows(container, visible, problemRowCache, getProblemRowKey, createProblemRow, updateProblemRow);
    }

    // 풀이기록 목록 렌더링 진입점이다.
    // 문제 목록 cache와 현재 renderedProblems를 비워 클릭 대상이 snapshot row임을 명확히 한다.
    function renderSolutionList(container, rows, emptyText) {
      renderedProblems = [];
      renderedSnapshots = rows;
      problemRowCache.clear();
      if (rows.length === 0) {
        renderEmptyList(container, snapshotRowCache, emptyText);
        return;
      }

      renderCachedRows(container, rows, snapshotRowCache, getSnapshotRowKey, createSnapshotRow, updateSnapshotRow);
    }

    function renderProblems() {
      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = getMatchedProblems(query);
      if (filter === 'solutions') {
        const currentMatchesQuery = matchesProblemQuery(currentProblem, query);
        const rows = currentMatchesQuery ? buildSolutionRows(currentProblem) : [];
        const emptyText = !currentProblem
          ? '현재 열린 문제가 없습니다.'
          : query
            ? '현재 문제와 검색어가 일치하지 않습니다.'
            : '현재 문제에 저장된 풀이 기록이 없습니다.';
        renderSolutionList(problemList, rows, emptyText);
        updatePaneSummaries();
        return;
      }

      const visible = filter === 'review' ? matched.filter((problem) => problem.review) : matched;
      const emptyText = query
        ? '검색 결과가 없습니다.'
        : filter === 'review'
          ? '다시 풀 문제가 없습니다.'
          : 'Programmers 폴더에 문제가 없습니다.';
      renderList(problemList, visible, emptyText);
      updatePaneSummaries();
    }

    function scheduleRenderProblems() {
      if (searchRenderTimer) {
        clearTimeout(searchRenderTimer);
      }
      searchRenderTimer = setTimeout(() => {
        searchRenderTimer = undefined;
        renderProblems();
      }, 120);
    }

    function addTest(inputValue = '', expectedValue = '') {
      testCount += 1;
      const card = document.createElement('div');
      card.className = 'test-card';
      card.innerHTML =
        '<div class="test-head"><span>테스트 #' + testCount + '</span><button class="remove" type="button">삭제</button></div>' +
        '<label>Input</label>' +
        '<textarea class="test-input" spellcheck="false" placeholder="solution 인자를 쉼표로 입력"></textarea>' +
        '<label>Expected Output</label>' +
        '<textarea class="test-expected" spellcheck="false" placeholder="기대 결과를 C++ 리터럴 형태로 입력"></textarea>';
      card.querySelector('.test-input').value = inputValue;
      card.querySelector('.test-expected').value = expectedValue;
      card.querySelector('.remove').addEventListener('click', () => {
        card.remove();
        updatePaneSummaries();
      });
      customTests.appendChild(card);
      updatePaneSummaries();
    }

    function setCustomTests(tests) {
      customTests.innerHTML = '';
      testCount = 0;
      if (!Array.isArray(tests) || tests.length === 0) {
        addTest();
        return;
      }
      for (const test of tests) {
        const inputValue = typeof test.inputsText === 'string' ? test.inputsText : (test.inputs || []).join(', ');
        const expectedValue = typeof test.expectedText === 'string' ? test.expectedText : (test.expected || '');
        addTest(inputValue, expectedValue);
      }
    }

    function collectTests() {
      return Array.from(document.querySelectorAll('.test-card')).map((card) => ({
        inputsText: card.querySelector('.test-input').value.trim(),
        expectedText: card.querySelector('.test-expected').value.trim()
      })).filter((test) => test.inputsText || test.expectedText);
    }

    function openSnapshot(row) {
      vscode.postMessage({
        type: 'openSolutionSnapshot',
        problemDir: row.problem.problemDir,
        snapshotPath: row.snapshot.path
      });
    }

    function submitCreateProblem() {
      vscode.postMessage({ type: 'create', lessonId: input.value.trim() });
    }

    function submitCustomTests() {
      if (!currentProblemDir) return;
      vscode.postMessage({ type: 'runCustom', problemDir: currentProblemDir, tests: collectTests() });
    }

    function handleProblemListClick(event) {
      const problemRow = event.target.closest('.problem-row');
      const snapshotRow = event.target.closest('.snapshot-row');

      if (problemRow) {
        const problem = renderedProblems[Number(problemRow.dataset.index)];
        if (!problem) return;
        if (event.target.closest('.review-check')) {
          vscode.postMessage({
            type: 'toggleReview',
            problemDir: problem.problemDir,
            review: event.target.checked
          });
          return;
        }
        if (event.target.closest('.delete-problem')) {
          vscode.postMessage({
            type: 'deleteProblem',
            problemDir: problem.problemDir
          });
          return;
        }
        vscode.postMessage({ type: 'openProblem', problemDir: problem.problemDir });
        return;
      }

      if (snapshotRow) {
        const row = renderedSnapshots[Number(snapshotRow.dataset.index)];
        if (!row) return;
        if (event.target.closest('.delete-snapshot')) {
          vscode.postMessage({
            type: 'deleteSolutionSnapshot',
            problemDir: row.problem.problemDir,
            snapshotPath: row.snapshot.path
          });
          return;
        }
        openSnapshot(row);
      }
    }

    addTest();
    document.getElementById('create').addEventListener('click', submitCreateProblem);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitCreateProblem();
      }
    });
    runSamples.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({ type: 'runSamples', problemDir: currentProblemDir });
    });
    document.getElementById('addTest').addEventListener('click', () => {
      addTest();
    });
    runCustom.addEventListener('click', submitCustomTests);
    document.getElementById('stopRun').addEventListener('click', () => {
      vscode.postMessage({ type: 'stopTests' });
    });
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openLast' });
    });
    resetCurrentSolution.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'resetCurrentSolution',
        problemDir: currentProblemDir
      });
    });
    startCurrentReview.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'startReviewAttempt',
        problemDir: currentProblemDir
      });
    });
    openNotes.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'openNotes',
        problemDir: currentProblemDir
      });
    });
    document.getElementById('toggleTop').addEventListener('click', (event) => {
      togglePane(topPane, event.currentTarget, 'top-collapsed');
    });
    document.getElementById('toggleTests').addEventListener('click', (event) => {
      togglePane(testsPane, event.currentTarget, 'tests-collapsed');
    });
    document.getElementById('toggleList').addEventListener('click', (event) => {
      togglePane(listPane, event.currentTarget, 'list-collapsed');
    });
    document.querySelectorAll('input[name="problemFilter"]').forEach((filter) => {
      filter.addEventListener('change', () => {
        renderProblems();
        updatePaneSummaries();
      });
    });
    problemSearch.addEventListener('input', scheduleRenderProblems);
    document.getElementById('refreshProblems').addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshProblems', force: true });
    });
    problemList.addEventListener('click', handleProblemListClick);
    window.addEventListener('message', (event) => {
      if (event.data.type === 'status') {
        status.textContent = event.data.text;
        status.className = 'status ' + (event.data.kind || '');
        updatePaneSummaries();
      }
      if (event.data.type === 'testRunning') {
        document.getElementById('stopRun').disabled = !event.data.running;
      }
      if (event.data.type === 'customTests') {
        setCustomTests(event.data.tests || []);
        updatePaneSummaries();
      }
      if (event.data.type === 'problems') {
        problems = event.data.problems || [];
        renderProblems();
      }
      if (event.data.type === 'currentProblem') {
        currentProblem = event.data.problem;
        currentProblemDir = currentProblem?.problemDir || '';
        updateCurrentActions();
        renderProblems();
      }
      if (event.data.type === 'runCustomRequest') {
        submitCustomTests();
      }
    });
    updateCurrentActions();
    updatePaneSummaries();
    vscode.postMessage({ type: 'refreshProblems' });
  </script>
</body>
</html>`;
}

module.exports = {
  ProgrammersSidebarProvider,
};
