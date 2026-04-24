const vscode = require("vscode");
const path = require("path");
const cp = require("child_process");
const {
  COMPILE_TIMEOUT_MS,
  DOCKER_DEBUG_COMPILE_FLAGS,
  DOCKER_FAST_COMPILE_FLAGS,
  DOCKER_IMAGE,
  TEST_TIMEOUT_MS,
} = require("./src/config");
const {
  buildRunner,
  parseCustomTests,
  parseSolutionSignature,
} = require("./src/cppRunnerBuilder");
const {
  ensureDockerRuntimeReady: ensureDockerRuntimeReadyModule,
  prepareDockerRuntimeOnOpen: prepareDockerRuntimeOnOpenModule,
} = require("./src/dockerRuntime");
const {
  buildProcessFailureError,
  formatTestErrorForPanel,
  formatTestErrorForStatus,
  limitStatusText,
  parseCompilerDiagnostics,
} = require("./src/errorFormatting");
const {
  decodeHtml,
  extractExamplesFromMarkdown,
  fetchText,
  htmlToMarkdown,
  matchFirst,
  slugify,
} = require("./src/problemParsing");

let sidebarProvider;
let outputChannel;
let diagnosticCollection;
let activeTestProcess;
let testRunInProgress = false;
let stopRequested = false;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Programmers Helper");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("programmers-helper");
  sidebarProvider = new ProgrammersSidebarProvider(context);

  context.subscriptions.push(
    outputChannel,
    diagnosticCollection,
    vscode.window.registerWebviewViewProvider("programmersHelper.sidebar", sidebarProvider),
    vscode.commands.registerCommand("programmersHelper.createProblem", async () => {
      await createProblemFromInput(context);
    }),
    vscode.commands.registerCommand("programmersHelper.runSamples", async () => {
      await runSamplesFromCommand(context);
    })
  );
}

function deactivate() {}

class ProgrammersSidebarProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.refreshProblems();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "create") {
        await createProblemFromId(this.context, String(message.lessonId || ""));
      }
      if (message.type === "runSamples") {
        await runSamplesFromCommand(this.context);
      }
      if (message.type === "runCustom") {
        await runCustomTestsFromMessage(this.context, message.tests || []);
      }
      if (message.type === "stopTests") {
        stopTestRun();
      }
      if (message.type === "openLast") {
        await openLastProblem(this.context);
      }
      if (message.type === "refreshProblems") {
        await this.refreshProblems();
      }
      if (message.type === "toggleReview") {
        await toggleReview(this.context, String(message.problemDir || ""), Boolean(message.review));
      }
      if (message.type === "openProblem") {
        await openProblemFromDir(this.context, String(message.problemDir || ""));
      }
      if (message.type === "deleteProblem") {
        await deleteProblem(this.context, String(message.problemDir || ""));
      }
    });
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  async refreshProblems() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    const problems = programmersDir ? await loadProblems(programmersDir) : [];
    this.post({ type: "problems", problems });
    const currentProblem = getCurrentProblemFromList(this.context, problems);
    this.post({ type: "currentProblem", problem: currentProblem });
  }

  getHtml(webview) {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { height: 100%; margin: 0; overflow: hidden; }
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
    <section class="pane top-pane">
      <div class="pane-title">문제 열기 / 현재 상태</div>
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
    const testsPane = document.getElementById('testsPane');
    const listPane = document.getElementById('listPane');
    const testsSummary = document.getElementById('testsSummary');
    const listSummary = document.getElementById('listSummary');
    const problemSearch = document.getElementById('problemSearch');
    let testCount = 0;
    let problems = [];

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

    function updatePaneSummaries() {
      const customCount = document.querySelectorAll('.test-card').length;
      testsSummary.textContent = testsPane.classList.contains('collapsed') ? '샘플 · 커스텀 ' + customCount + '개' : '';

      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = problems.filter((problem) => {
        if (!query) return true;
        return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
      });
      const visibleCount = (filter === 'review' ? matched.filter((problem) => problem.review) : matched).length;
      listSummary.textContent = listPane.classList.contains('collapsed')
        ? (filter === 'review' ? '다시풀 ' + visibleCount + '개' : '전체 ' + visibleCount + '개')
        : '';
    }

    function renderList(container, visible, emptyText) {
      if (visible.length === 0) {
        container.innerHTML = '<div class="empty">' + escapeHtml(emptyText) + '</div>';
        return;
      }

      container.innerHTML = visible.map((problem, index) => (
        '<div class="problem-row" data-index="' + index + '">' +
          '<div><div class="problem-title">' + escapeHtml(problem.title) + '</div>' +
          '<div class="problem-id">#' + escapeHtml(problem.lessonId || '-') + '</div></div>' +
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

    function renderProblems() {
      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = problems.filter((problem) => {
        if (!query) return true;
        return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
      });
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
    });
    updatePaneSummaries();
    vscode.postMessage({ type: 'refreshProblems' });
  </script>
</body>
</html>`;
  }
}

async function createProblemFromInput(context) {
  const lessonId = await vscode.window.showInputBox({
    title: "Programmers 문제 생성",
    prompt: "프로그래머스 문제 번호를 입력하세요.",
    placeHolder: "예: 468379",
    validateInput(value) {
      return /^\d+$/.test(value.trim()) ? undefined : "숫자만 입력해주세요.";
    },
  });

  if (lessonId) {
    await createProblemFromId(context, lessonId);
  }
}

async function createProblemFromId(context, rawLessonId) {
  const lessonId = rawLessonId.trim();
  if (!/^\d+$/.test(lessonId)) {
    vscode.window.showErrorMessage("문제 번호는 숫자만 입력해주세요.");
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const programmersDir = await resolveProgrammersDir(context, workspaceFolder?.uri, { create: true });

  try {
    sidebarProvider?.post({ type: "status", kind: "running", text: `생성 중\n\n기존 문제를 확인하고 있습니다...` });
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Programmers ${lessonId} 생성 중`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "기존 문제를 확인하는 중..." });
        const created = await createProblem(programmersDir, lessonId);
        progress.report({ message: "에디터를 여는 중..." });
        return created;
      }
    );

    await openProblemFromDir(context, result.problemDir.fsPath);
    vscode.window.showInformationMessage(`Programmers ${lessonId} 준비 완료`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sidebarProvider?.post({ type: "status", kind: "error", text: `오류\n\n${message}` });
    vscode.window.showErrorMessage(message);
  }
}

async function openProblem(mdUri, cppUri) {
  await vscode.workspace.saveAll(false);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("markdown.showPreview", mdUri, vscode.ViewColumn.One);
  await vscode.window.showTextDocument(cppUri, {
    viewColumn: vscode.ViewColumn.Two,
    preserveFocus: false,
    preview: false,
  });
}

async function openLastProblem(context) {
  const dir = await getProblemDir(context);
  if (!dir) {
    return;
  }
  await openProblemFromDir(context, dir);
}

async function openProblemFromDir(context, problemDir) {
  const safeDir = await validateProblemDir(context, problemDir);
  if (!safeDir) {
    vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
    return;
  }

  await context.workspaceState.update("lastProblemDir", safeDir);
  await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(path.join(safeDir, "solution.cpp")));
  const runtimeStatus = await prepareDockerRuntimeOnOpen(context, safeDir);
  await showOpenedProblemState(context, safeDir, runtimeStatus);
}

async function toggleReview(context, problemDir, review) {
  const safeDir = await validateProblemDir(context, problemDir);
  if (!safeDir) {
    vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
    return;
  }

  const helperDir = vscode.Uri.file(path.join(safeDir, ".programmers-helper"));
  const reviewUri = vscode.Uri.joinPath(helperDir, "review.json");
  const payload = {
    review,
    updatedAt: new Date().toISOString(),
  };

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.writeFile(reviewUri, Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8"));
  await context.workspaceState.update("lastProblemDir", safeDir);
  await sidebarProvider?.refreshProblems();
}

async function deleteProblem(context, problemDir) {
  const safeDir = await validateProblemDir(context, problemDir);
  if (!safeDir) {
    vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
    return;
  }

  const folderName = path.basename(safeDir);
  const picked = await vscode.window.showWarningMessage(
    `${folderName} 문제 폴더를 삭제할까요?`,
    { modal: true, detail: "problem.md, solution.cpp, .programmers-helper가 함께 삭제됩니다." },
    "삭제"
  );
  if (picked !== "삭제") {
    return;
  }

  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(safeDir), { recursive: true, useTrash: true });
  } catch (error) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(safeDir), { recursive: true, useTrash: false });
    } catch (fallbackError) {
      const detail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError || error);
      vscode.window.showErrorMessage(`문제 폴더를 삭제하지 못했습니다.\n${detail}`);
      return;
    }
  }

  const last = context.workspaceState.get("lastProblemDir");
  if (typeof last === "string" && path.resolve(last) === path.resolve(safeDir)) {
    await context.workspaceState.update("lastProblemDir", undefined);
    sidebarProvider?.post({ type: "currentProblem", problem: undefined });
    sidebarProvider?.post({ type: "status", kind: "", text: "대기 중\n\n문제 번호를 입력하고 생성 버튼을 누르세요." });
  }

  await sidebarProvider?.refreshProblems();
  vscode.window.showInformationMessage(`${folderName} 삭제 완료`);
}

async function runCustomTestsFromMessage(context, tests) {
  const problemDir = await getProblemDir(context);
  if (!problemDir) {
    return;
  }

  await saveCustomTests(problemDir, tests);
  await runSamplesFromCommand(context, JSON.stringify(tests || []), problemDir);
}

async function showOpenedProblemState(context, problemDir, runtimeStatus = { kind: "ready", detail: "" }) {
  const problem = await loadProblemInfo(problemDir);
  const examples = await loadProblemExamples(problemDir);
  const savedCustomTests = await loadSavedCustomTests(problemDir);

  await context.workspaceState.update("lastProblemDir", problemDir);
  sidebarProvider?.post({ type: "currentProblem", problem });
  sidebarProvider?.post({ type: "customTests", tests: savedCustomTests.length > 0 ? savedCustomTests : examples.length > 0 ? [examples[0]] : [] });
  await sidebarProvider?.refreshProblems();
  sidebarProvider?.post({
    type: "status",
    kind: runtimeStatus.kind || "ready",
    text: `준비 완료\n\n${problem.folderName}${runtimeStatus.detail ? `\n${runtimeStatus.detail}` : ""}`,
  });
}

async function validateProblemDir(context, problemDir) {
  if (!problemDir) {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const programmersDir = await resolveProgrammersDir(context, workspaceFolder?.uri);
  if (!programmersDir) {
    return undefined;
  }

  const root = path.resolve(programmersDir.fsPath);
  const target = path.resolve(problemDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return undefined;
  }

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(target, "problem.md")));
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(target, "solution.cpp")));
    return target;
  } catch {
    return undefined;
  }
}

async function loadProblems(programmersDir) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    return [];
  }

  const problems = (await Promise.all(
    entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(async ([name]) => {
        const problemDir = vscode.Uri.joinPath(programmersDir, name);
        if (!(await hasProblemFiles(problemDir))) {
          return undefined;
        }
        return loadProblemInfo(problemDir.fsPath);
      })
  )).filter(Boolean);

  return problems.sort((a, b) => {
    const left = /^\d+$/.test(a.lessonId) ? Number(a.lessonId) : undefined;
    const right = /^\d+$/.test(b.lessonId) ? Number(b.lessonId) : undefined;
    if (left !== undefined && right !== undefined && left !== right) {
      return left - right;
    }
    return a.folderName.localeCompare(b.folderName, "ko");
  });
}

async function resolveProgrammersDir(context, workspaceUri, options = {}) {
  const candidates = getProgrammersDirCandidates(context, workspaceUri);
  for (const candidate of candidates) {
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if (stat.type === vscode.FileType.Directory) {
        return candidate;
      }
    } catch {
      // Try the next known location.
    }
  }

  const fallback = getDefaultProgrammersDir(context, workspaceUri);
  if (options.create) {
    await vscode.workspace.fs.createDirectory(fallback);
    return fallback;
  }

  return undefined;
}

function getProgrammersDirCandidates(context, workspaceUri) {
  const candidates = [];
  if (workspaceUri && vscode.env.remoteName === "dev-container") {
    candidates.push(path.basename(workspaceUri.fsPath) === "Programmers" ? workspaceUri : vscode.Uri.joinPath(workspaceUri, "Programmers"));
  }
  candidates.push(getDefaultProgrammersDir(context, workspaceUri));

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate.fsPath);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getDefaultProgrammersDir(context, workspaceUri) {
  if (workspaceUri && vscode.env.remoteName === "dev-container") {
    return path.basename(workspaceUri.fsPath) === "Programmers"
      ? workspaceUri
      : vscode.Uri.joinPath(workspaceUri, "Programmers");
  }
  return vscode.Uri.joinPath(context.globalStorageUri, "Programmers");
}

function getCurrentProblemFromList(context, problems) {
  const last = context.workspaceState.get("lastProblemDir");
  if (typeof last !== "string") {
    return undefined;
  }
  const normalizedLast = path.resolve(last);
  return problems.find((problem) => path.resolve(problem.problemDir) === normalizedLast);
}

async function loadProblemInfo(problemDir) {
  const folderName = path.basename(problemDir);
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const metadata = await readJson(vscode.Uri.joinPath(helperDir, "programmers.json"));
  const reviewData = await readJson(vscode.Uri.joinPath(helperDir, "review.json"));
  const fallback = parseProblemFolderName(folderName);
  return {
    problemDir,
    folderName,
    lessonId: String(metadata?.lessonId || fallback.lessonId || ""),
    title: String(metadata?.title || fallback.title || folderName),
    review: Boolean(reviewData?.review),
    updatedAt: typeof reviewData?.updatedAt === "string" ? reviewData.updatedAt : "",
  };
}

async function loadProblemExamples(problemDir) {
  const metadata = await readJson(vscode.Uri.file(path.join(problemDir, ".programmers-helper", "programmers.json")));
  if (Array.isArray(metadata?.examples)) {
    return metadata.examples;
  }

  try {
    const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
    return extractExamplesFromMarkdown(markdown);
  } catch {
    return [];
  }
}

function getCustomTestsUri(problemDir) {
  return vscode.Uri.file(path.join(problemDir, ".programmers-helper", "custom-tests.json"));
}

async function loadSavedCustomTests(problemDir) {
  const saved = await readJson(getCustomTestsUri(problemDir));
  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((test) => test && typeof test.inputsText === "string" && typeof test.expectedText === "string")
    .map((test) => ({
      inputsText: test.inputsText,
      expectedText: test.expectedText,
    }));
}

async function saveCustomTests(problemDir, tests) {
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const customTests = Array.isArray(tests)
    ? tests
      .filter((test) => test && (String(test.inputsText || "").trim() || String(test.expectedText || "").trim()))
      .map((test) => ({
        inputsText: String(test.inputsText || "").trim(),
        expectedText: String(test.expectedText || "").trim(),
      }))
    : [];

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.writeFile(
    getCustomTestsUri(problemDir),
    Buffer.from(JSON.stringify(customTests, null, 2) + "\n", "utf8")
  );
}

async function readJson(uri) {
  try {
    return JSON.parse(await readText(uri));
  } catch {
    return undefined;
  }
}

function parseProblemFolderName(folderName) {
  const match = folderName.match(/^(\d+)_?(.*)$/);
  if (!match) {
    return { lessonId: "", title: folderName.replace(/_/g, " ") };
  }
  return {
    lessonId: match[1],
    title: (match[2] || folderName).replace(/_/g, " "),
  };
}

async function createProblem(programmersDir, lessonId) {
  const existing = await findExistingProblem(programmersDir, lessonId);
  if (existing) {
    return existing;
  }

  const url = `https://school.programmers.co.kr/learn/courses/30/lessons/${lessonId}?language=cpp`;
  const html = await fetchText(url);
  const title = decodeHtml(
    matchFirst(html, /data-lesson-title="([^"]+)"/, /<span class="challenge-title">([\s\S]*?)<\/span>/, /<title>코딩테스트 연습 - ([^|]+?)\s*\|/)
  ).trim();

  if (!title) {
    throw new Error(`문제 제목을 찾지 못했습니다: ${url}`);
  }

  const markdownHtml = matchFirst(html, /<div class="markdown solarized-dark">([\s\S]*?)<\/div>/);
  if (!markdownHtml) {
    throw new Error(`문제 본문을 찾지 못했습니다: ${url}`);
  }

  const level = matchFirst(html, /data-challenge-level="([^"]+)"/);
  const category = matchFirst(html, /data-challenge-category="([^"]+)"/);
  const folderName = `${lessonId}_${slugify(title)}`;
  const problemDir = vscode.Uri.joinPath(programmersDir, folderName);
  const mdUri = vscode.Uri.joinPath(problemDir, "problem.md");
  const cppUri = vscode.Uri.joinPath(problemDir, "solution.cpp");
  const helperDir = vscode.Uri.joinPath(problemDir, ".programmers-helper");
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");

  await vscode.workspace.fs.createDirectory(problemDir);
  await vscode.workspace.fs.createDirectory(helperDir);

  const problemMd = [
    `# [Programmers ${lessonId}] ${title}`,
    "",
    `- 출처: [프로그래머스 스쿨](${url})`,
    level ? `- 난이도: Level ${level}` : "",
    category ? `- 분류: ${category}` : "",
    "",
    htmlToMarkdown(markdownHtml),
    "",
  ].filter((line, index, arr) => line !== "" || arr[index - 1] !== "").join("\n");

  await writeFileIfAbsent(mdUri, problemMd);

  const code = decodeHtml(
    matchFirst(html, /<textarea hidden id="code" name="code">([\s\S]*?)<\/textarea>/, /name="initial_code_\d+"[^>]*value="([\s\S]*?)"/)
  ).replace(/\r\n/g, "\n");

  if (!code.trim()) {
    throw new Error("C++ 기본 코드 템플릿을 찾지 못했습니다.");
  }

  await writeFileIfAbsent(cppUri, code.trimEnd() + "\n");

  const metadata = {
    lessonId,
    title,
    url,
    examples: extractExamplesFromMarkdown(problemMd),
  };
  await vscode.workspace.fs.writeFile(metadataUri, Buffer.from(JSON.stringify(metadata, null, 2) + "\n", "utf8"));

  return { folderName, problemDir, mdUri, cppUri, examples: metadata.examples };
}

async function findExistingProblem(programmersDir, lessonId) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    return undefined;
  }

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory) {
      continue;
    }

    const problemDir = vscode.Uri.joinPath(programmersDir, name);
    const fallback = parseProblemFolderName(name);
    let matchesLesson = fallback.lessonId === lessonId;
    if (!matchesLesson) {
      const metadata = await readJson(vscode.Uri.joinPath(problemDir, ".programmers-helper", "programmers.json"));
      matchesLesson = String(metadata?.lessonId || "") === lessonId;
    }

    if (!matchesLesson || !(await hasProblemFiles(problemDir))) {
      continue;
    }

    const mdUri = vscode.Uri.joinPath(problemDir, "problem.md");
    const cppUri = vscode.Uri.joinPath(problemDir, "solution.cpp");
    return {
      folderName: name,
      problemDir,
      mdUri,
      cppUri,
      examples: await loadProblemExamples(problemDir.fsPath),
    };
  }

  return undefined;
}

async function hasProblemFiles(problemDir) {
  try {
    await Promise.all([
      vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, "problem.md")),
      vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, "solution.cpp")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfAbsent(uri, contents) {
  try {
    await vscode.workspace.fs.stat(uri);
    return;
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  }
}

async function runSamplesFromCommand(context, customTestsText = "", providedProblemDir) {
  if (testRunInProgress) {
    vscode.window.showInformationMessage("이미 테스트가 실행 중입니다.");
    return;
  }

  const problemDir = providedProblemDir || await getProblemDir(context);
  if (!problemDir) {
    return;
  }

  testRunInProgress = true;
  stopRequested = false;
  sidebarProvider?.post({ type: "testRunning", running: true });

  try {
    const hasCustomTests = customTestsText.trim().length > 0;
    sidebarProvider?.post({ type: "status", kind: "running", text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 실행 중...` });
    const result = await runSamples(problemDir, customTestsText);
    sidebarProvider?.post({
      type: "status",
      kind: result.failed === 0 ? "ready" : "error",
      text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 완료\n\n${result.summary}`,
    });
    outputChannel.show(true);
  } catch (error) {
    const panelMessage = formatTestErrorForPanel(error);
    outputChannel.appendLine("");
    outputChannel.appendLine(`[Programmers Helper] ${panelMessage}`);
    outputChannel.show(true);
    sidebarProvider?.post({ type: "status", kind: "error", text: `테스트 실행 오류\n\n${formatTestErrorForStatus(error)}` });
    vscode.window.showErrorMessage(formatTestErrorForStatus(error));
  } finally {
    activeTestProcess = undefined;
    testRunInProgress = false;
    stopRequested = false;
    sidebarProvider?.post({ type: "testRunning", running: false });
  }
}

function clearProblemDiagnostics(problemDir) {
  diagnosticCollection?.delete(vscode.Uri.file(path.join(problemDir, "solution.cpp")));
}

function applyCompilerDiagnostics(problemDir, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith("clang++ 실패")) {
    return;
  }

  const solutionUri = vscode.Uri.file(path.join(problemDir, "solution.cpp"));
  const diagnostics = parseCompilerDiagnostics(vscode, message, solutionUri);
  if (diagnostics.length > 0) {
    diagnosticCollection?.set(solutionUri, diagnostics);
  }
}

function stopTestRun() {
  if (!testRunInProgress) {
    return;
  }

  stopRequested = true;
  if (activeTestProcess && !activeTestProcess.killed) {
    const child = activeTestProcess;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 1000);
  }
  outputChannel.appendLine("");
  outputChannel.appendLine("[Programmers Helper] 테스트 실행 중지 요청");
  sidebarProvider?.post({ type: "status", kind: "error", text: "테스트 실행 중지 요청\n\n현재 실행 중인 프로세스를 종료하고 있습니다." });
}

async function getProblemDir(context) {
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const fromActive = activeFile ? findProblemDirFromPath(activeFile) : undefined;
  if (fromActive) {
    const validActive = await validateProblemDir(context, fromActive);
    if (validActive) {
      await context.workspaceState.update("lastProblemDir", validActive);
      return validActive;
    }
  }

  const last = context.workspaceState.get("lastProblemDir");
  if (typeof last === "string") {
    const validLast = await validateProblemDir(context, last);
    if (validLast) {
      return validLast;
    }
    await context.workspaceState.update("lastProblemDir", undefined);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const programmersDir = await resolveProgrammersDir(context, workspaceFolder?.uri);
  if (!programmersDir) {
    vscode.window.showErrorMessage(`Programmers 폴더를 찾지 못했습니다: ${getDefaultProgrammersDir(context, workspaceFolder?.uri).fsPath}`);
    return undefined;
  }

  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    vscode.window.showErrorMessage(`Programmers 폴더를 찾지 못했습니다: ${programmersDir.fsPath}`);
    return undefined;
  }

  const folders = entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => name).sort();
  if (folders.length === 0) {
    vscode.window.showErrorMessage("실행할 문제 폴더가 없습니다.");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(folders, { title: "샘플 테스트를 실행할 문제를 선택하세요." });
  return picked ? path.join(programmersDir.fsPath, picked) : undefined;
}

function findProblemDirFromPath(filePath) {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf("Programmers");
  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }
  return parts.slice(0, index + 2).join(path.sep);
}

async function runSamples(problemDir, customTestsText = "") {
  const mdPath = path.join(problemDir, "problem.md");
  const cppPath = path.join(problemDir, "solution.cpp");
  const md = await readText(vscode.Uri.file(mdPath));
  const cpp = await readText(vscode.Uri.file(cppPath));
  const examples = customTestsText.trim() ? parseCustomTests(customTestsText) : extractExamplesFromMarkdown(md);
  const signature = parseSolutionSignature(cpp);

  if (examples.length === 0) {
    throw new Error(customTestsText.trim() ? "커스텀 테스트케이스가 비어 있습니다." : "problem.md에서 입출력 예를 찾지 못했습니다.");
  }
  if (!signature) {
    throw new Error("solution.cpp에서 solution 함수 시그니처를 찾지 못했습니다.");
  }

  const runnerDir = path.join(problemDir, ".programmers-helper");
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(runnerDir));
  const runnerPath = path.join(runnerDir, "test_runner.cpp");
  const fastBinaryPath = ".programmers-helper/test_runner_fast";
  const debugBinaryPath = ".programmers-helper/test_runner_debug";
  const runnerCode = buildRunner(signature, examples);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(runnerPath), Buffer.from(runnerCode, "utf8"));

  outputChannel.clear();
  outputChannel.appendLine(`[Programmers Helper] ${path.basename(problemDir)} ${customTestsText.trim() ? "커스텀" : "샘플"} 테스트`);
  outputChannel.appendLine(`[Programmers Helper] Docker runtime: ${DOCKER_IMAGE}`);
  outputChannel.appendLine("");

  const runtime = await ensureDockerRuntimeReady(problemDir);
  clearProblemDiagnostics(problemDir);
  try {
    await compileRunner(runtime, problemDir, runnerPath, fastBinaryPath, DOCKER_FAST_COMPILE_FLAGS, "컴파일");
  } catch (error) {
    applyCompilerDiagnostics(problemDir, error);
    throw error;
  }
  if (stopRequested) {
    throw new Error("테스트 실행이 중지되었습니다.");
  }

  let output = "";
  let debugBinaryReady = false;
  for (let index = 0; index < examples.length; index++) {
    if (stopRequested) {
      throw new Error("테스트 실행이 중지되었습니다.");
    }

    try {
      output += await runTestBinary(runtime, problemDir, fastBinaryPath, index + 1, {
        label: `테스트 #${index + 1}`,
        timeoutMs: TEST_TIMEOUT_MS,
        streamOutput: true,
        streamStderr: false,
        streamSanitizedRuntime: false,
      });
    } catch (error) {
      if (!shouldRetryWithSanitizer(error)) {
        throw error;
      }

      if (!debugBinaryReady) {
        try {
          await compileRunner(runtime, problemDir, runnerPath, debugBinaryPath, DOCKER_DEBUG_COMPILE_FLAGS, "디버그 컴파일");
          debugBinaryReady = true;
        } catch (compileError) {
          applyCompilerDiagnostics(problemDir, compileError);
          throw compileError;
        }
      }

      try {
        const debugOutput = await runTestBinary(runtime, problemDir, debugBinaryPath, index + 1, {
          label: `테스트 #${index + 1}`,
          timeoutMs: TEST_TIMEOUT_MS,
          streamOutput: false,
          streamSanitizedRuntime: true,
          debugEnv: true,
        });
        if (hasSanitizerOutput(debugOutput)) {
          throw buildProcessFailureError("docker", { label: `테스트 #${index + 1}` }, 1, undefined, debugOutput, "", 0);
        }
        throw error;
      } catch (debugError) {
        throw debugError;
      }
    }
  }

  const passed = (output.match(/\[PASS\]/g) || []).length;
  const failed = (output.match(/\[FAIL\]/g) || []).length;
  const summary = `테스트 완료: ${passed} 통과, ${failed} 실패`;
  outputChannel.appendLine("");
  outputChannel.appendLine(summary);
  vscode.window.showInformationMessage(summary);
  return { summary, passed, failed };
}

async function compileRunner(runtime, problemDir, runnerPath, outputBinaryPath, compileFlags, label) {
  await execFile("docker", [
    "exec",
    "-w",
    runtime.problemPath,
    runtime.containerName,
    "clang++",
    ...compileFlags,
    path.posix.relative(runtime.problemPath, path.posix.join(runtime.problemPath, ".programmers-helper", "test_runner.cpp")),
    "-o",
    outputBinaryPath,
  ], problemDir, {
    timeoutMs: COMPILE_TIMEOUT_MS,
    label,
  });

  return execFile("docker", [
    "exec",
    "-w",
    runtime.problemPath,
    runtime.containerName,
    "chmod",
    "+x",
    outputBinaryPath,
  ], problemDir, {
    timeoutMs: COMPILE_TIMEOUT_MS,
    label: `${label} 권한 설정`,
  });
}

async function runTestBinary(runtime, problemDir, binaryPath, testIndex, options = {}) {
  const command = [
    "exec",
    "-w",
    runtime.problemPath,
    runtime.containerName,
  ];

  if (options.debugEnv) {
    command.push(
      "env",
      "ASAN_OPTIONS=symbolize=1:external_symbolizer_path=/usr/bin/llvm-symbolizer:halt_on_error=1",
      "UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1"
    );
  }

  command.push(binaryPath.startsWith(".") ? binaryPath : `./${binaryPath}`, String(testIndex));
  return execFile("docker", command, problemDir, options);
}

function shouldRetryWithSanitizer(error) {
  if (!error) {
    return false;
  }

  if (typeof error.signal === "string" && error.signal) {
    return true;
  }

  return typeof error.exitCode === "number" && error.exitCode !== 0;
}

function hasSanitizerOutput(output) {
  return /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:/i.test(String(output || ""));
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

async function ensureDockerRuntimeReady(problemDir) {
  return ensureDockerRuntimeReadyModule({
    vscode,
    extensionDir: __dirname,
    problemDir,
    execCommand,
  });
}

async function prepareDockerRuntimeOnOpen(context, problemDir) {
  return prepareDockerRuntimeOnOpenModule({
    vscode,
    extensionDir: __dirname,
    problemDir,
    execCommand,
    limitStatusText,
    postStatus: (message) => sidebarProvider?.post(message),
  });
}

function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, { cwd: options.cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      const result = { code, signal, stdout, stderr };
      if (options.allowNonZeroExit || code === 0) {
        resolve(result);
        return;
      }

      const detail = (stderr || stdout || "").trim();
      reject(new Error(`${command} ${args.join(" ")} 실패${detail ? `\n${detail}` : ""}`));
    });
  });
}

function execFile(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    if (stopRequested) {
      reject(new Error("테스트 실행이 중지되었습니다."));
      return;
    }

    const startedAt = Date.now();
    const child = cp.spawn(command, args, { cwd });
    activeTestProcess = child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;

    const timeout = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 1000);
      }
    }, options.timeoutMs) : undefined;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.streamOutput) {
        outputChannel.append(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.streamStderr && !options.streamSanitizedRuntime) {
        outputChannel.append(text);
      }
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (activeTestProcess === child) {
        activeTestProcess = undefined;
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (activeTestProcess === child) {
        activeTestProcess = undefined;
      }
      if (stopRequested) {
        reject(new Error("테스트 실행이 중지되었습니다."));
        return;
      }
      if (timedOut) {
        const seconds = Math.round((options.timeoutMs || 0) / 1000);
        const elapsedMs = Date.now() - startedAt;
        const error = new Error(`${options.label || command} 시간이 초과되었습니다. (${seconds}초, ${elapsedMs}ms)\n무한루프를 확인해주세요.`);
        error.code = "ETIMEOUT";
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(buildProcessFailureError(command, options, code, signal, stderr, stdout, Date.now() - startedAt));
        return;
      }
      resolve(stdout + stderr);
    });
  });
}

module.exports = {
  activate,
  deactivate,
};
