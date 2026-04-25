const vscode = require("vscode");
const {
  loadProblems,
  resolveProgrammersDir,
} = require("./problemStore");

// 사이드바 Webview와 메시지 핸들링을 관리합니다.
class ProgrammersSidebarProvider {
  // 컨텍스트와 메시지 핸들러를 저장합니다.
  constructor(context, handlers = {}) {
    this.context = context;
    this.handlers = handlers;
    this.view = undefined;
  }

  // Webview가 열릴 때 HTML과 메시지 핸들러를 설정합니다.
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    this.refreshProblems();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "refreshProblems") {
        await this.refreshProblems();
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
    this.view?.webview.postMessage(message);
  }

  // 문제 목록과 현재 문제 상태를 새로 보냅니다.
  async refreshProblems() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    const problems = programmersDir ? await loadProblems(programmersDir) : [];
    this.post({ type: "problems", problems });
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
    .current-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
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
          <button id="startCurrentReview" class="secondary" disabled>현재 문제 새풀이</button>
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
    let testCount = 0;
    let problems = [];
    let currentProblemDir = '';

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

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[ch]);
    }

    function updateCurrentActions() {
      resetCurrentSolution.disabled = !currentProblemDir;
      startCurrentReview.disabled = !currentProblemDir;
    }

    function updatePaneSummaries() {
      const statusTitle = status.textContent.split('\\n').find((line) => line.trim()) || '대기 중';
      topSummary.textContent = topPane.classList.contains('collapsed') ? statusTitle : '';

      const customCount = document.querySelectorAll('.test-card').length;
      testsSummary.textContent = testsPane.classList.contains('collapsed') ? '샘플 · 커스텀 ' + customCount + '개' : '';

      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = problems.filter((problem) => {
        if (!query) return true;
        return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
      });
      const currentProblem = problems.find((problem) => currentProblemDir && problem.problemDir === currentProblemDir);
      const currentMatchesQuery = currentProblem && (!query
        || (currentProblem.title || '').toLowerCase().includes(query)
        || String(currentProblem.lessonId || '').includes(query));
      const visibleCount = filter === 'solutions'
        ? (currentMatchesQuery ? buildSolutionRows([currentProblem]).length : 0)
        : (filter === 'review' ? matched.filter((problem) => problem.review) : matched).length;
      listSummary.textContent = listPane.classList.contains('collapsed')
        ? (filter === 'solutions' ? '풀이기록 ' + visibleCount + '개' : filter === 'review' ? '다시풀 ' + visibleCount + '개' : '전체 ' + visibleCount + '개')
        : '';
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

    function buildSolutionRows(sourceProblems) {
      return sourceProblems.flatMap((problem) => (
        Array.isArray(problem.solutionHistory) ? problem.solutionHistory : []
      ).map((snapshot) => ({ problem, snapshot })))
        .sort((a, b) => {
          return String(b.snapshot.createdAt || '').localeCompare(String(a.snapshot.createdAt || ''));
        });
    }

    function renderList(container, visible, emptyText) {
      if (visible.length === 0) {
        container.innerHTML = '<div class="empty">' + escapeHtml(emptyText) + '</div>';
        return;
      }

      container.innerHTML = visible.map((problem, index) => (
        '<div class="problem-row" data-index="' + index + '">' +
          '<div><div class="problem-title">' + escapeHtml(problem.title) + '</div>' +
          '<div class="problem-id">#' + escapeHtml(problem.lessonId || '-') + (problem.solutionHistoryCount ? ' · 이전풀이 ' + escapeHtml(problem.solutionHistoryCount) + '개' : '') + '</div></div>' +
          '<div class="problem-actions">' +
            '<label class="review-toggle"><input class="review-check" type="checkbox" ' + (problem.review ? 'checked' : '') + ' /> 다시풀</label>' +
            '<button class="delete-problem" type="button" title="문제 삭제">삭제</button>' +
          '</div>' +
        '</div>'
      )).join('');

      Array.from(container.querySelectorAll('.problem-row')).forEach((row, index) => {
        const problem = visible[index];
        row.addEventListener('click', () => {
          vscode.postMessage({ type: 'openProblem', problemDir: problem.problemDir });
        });
        row.querySelector('.review-check').addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({
            type: 'toggleReview',
            problemDir: problem.problemDir,
            review: event.currentTarget.checked
          });
        });
        row.querySelector('.delete-problem').addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({
            type: 'deleteProblem',
            problemDir: problem.problemDir
          });
        });
      });
    }

    function renderSolutionList(container, rows, emptyText) {
      if (rows.length === 0) {
        container.innerHTML = '<div class="empty">' + escapeHtml(emptyText) + '</div>';
        return;
      }

      container.innerHTML = rows.map(({ problem, snapshot }, index) => (
        '<div class="snapshot-row" data-index="' + index + '">' +
          '<div><div class="snapshot-title">' + escapeHtml(problem.title) + '</div>' +
          '<div class="snapshot-meta">#' + escapeHtml(problem.lessonId || '-') + ' · ' + escapeHtml(snapshot.label || '이전 풀이') + ' · ' + escapeHtml(formatSnapshotTime(snapshot.createdAt)) + '</div></div>' +
          '<div class="problem-actions">' +
            '<button class="solution-action open-snapshot" type="button">열기</button>' +
            '<button class="delete-problem delete-snapshot" type="button">삭제</button>' +
          '</div>' +
        '</div>'
      )).join('');

      Array.from(container.querySelectorAll('.snapshot-row')).forEach((row, index) => {
        const { problem, snapshot } = rows[index];
        const open = () => {
          vscode.postMessage({
            type: 'openSolutionSnapshot',
            problemDir: problem.problemDir,
            snapshotPath: snapshot.path
          });
        };
        row.addEventListener('click', open);
        row.querySelector('.open-snapshot').addEventListener('click', (event) => {
          event.stopPropagation();
          open();
        });
        row.querySelector('.delete-snapshot').addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({
            type: 'deleteSolutionSnapshot',
            problemDir: problem.problemDir,
            snapshotPath: snapshot.path
          });
        });
      });
    }

    function renderProblems() {
      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = problems.filter((problem) => {
        if (!query) return true;
        return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
      });
      if (filter === 'solutions') {
        const currentProblem = problems.find((problem) => currentProblemDir && problem.problemDir === currentProblemDir);
        const currentMatchesQuery = currentProblem && (!query
          || (currentProblem.title || '').toLowerCase().includes(query)
          || String(currentProblem.lessonId || '').includes(query));
        const rows = currentMatchesQuery ? buildSolutionRows([currentProblem]) : [];
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

    addTest();
    document.getElementById('create').addEventListener('click', () => {
      vscode.postMessage({ type: 'create', lessonId: input.value.trim() });
    });
    document.getElementById('run').addEventListener('click', () => {
      vscode.postMessage({ type: 'runSamples' });
    });
    document.getElementById('addTest').addEventListener('click', () => {
      addTest();
    });
    document.getElementById('runCustom').addEventListener('click', () => {
      vscode.postMessage({ type: 'runCustom', tests: collectTests() });
    });
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
    problemSearch.addEventListener('input', () => {
      renderProblems();
      updatePaneSummaries();
    });
    document.getElementById('refreshProblems').addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshProblems' });
    });
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
        currentProblemDir = event.data.problem?.problemDir || '';
        updateCurrentActions();
        renderProblems();
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
