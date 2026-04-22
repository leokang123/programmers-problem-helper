const vscode = require("vscode");
const path = require("path");
const https = require("https");
const cp = require("child_process");

let sidebarProvider;
let outputChannel;
let activeTestProcess;
let testRunInProgress = false;
let stopRequested = false;

const COMPILE_TIMEOUT_MS = 15000;
const TEST_TIMEOUT_MS = 5000;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Programmers Helper");
  sidebarProvider = new ProgrammersSidebarProvider(context);

  context.subscriptions.push(
    outputChannel,
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
        await runSamplesFromCommand(this.context, JSON.stringify(message.tests || []));
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
    });
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  async refreshProblems() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const problems = workspaceFolder ? await loadProblems(workspaceFolder.uri) : [];
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
    .pane.collapsed .pane-body { display: none; }
    .pane.collapsed .collapsed-badge { display: inline-block; }
    .section-title { margin-bottom: 5px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .section { margin-bottom: 8px; }
    .section:last-child { margin-bottom: 0; }
    .open-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .open-actions button { margin-top: 6px; }
    .list-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
    .filter { display: flex; gap: 6px; align-items: center; margin: 0; font-size: 12px; color: var(--vscode-foreground); }
    .filter input { width: auto; margin: 0; }
    .refresh { width: auto; min-width: 30px; margin: 0 0 0 auto; padding: 3px 7px; }
    button:disabled { opacity: 0.55; cursor: default; }
    .problem-list { border-top: 1px solid var(--vscode-panel-border); }
    .problem-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .problem-row:hover { background: var(--vscode-list-hoverBackground); }
    .problem-title { font-size: 12px; line-height: 1.35; color: var(--vscode-foreground); word-break: break-word; }
    .problem-id { margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .review-toggle { display: flex; gap: 4px; align-items: center; margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .review-toggle input { width: auto; margin: 0; }
    .empty { padding: 9px 0; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
    .test-card { margin-top: 8px; padding: 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .test-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .remove { width: auto; margin: 0; padding: 3px 7px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .status { margin-top: 5px; padding: 5px 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBarSectionHeader-background); white-space: pre-wrap; font-size: 12px; color: var(--vscode-foreground); line-height: 1.25; }
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
          <input id="lessonId" value="468379" inputmode="numeric" />
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
        <div class="section">
          <button id="run">샘플 테스트 실행</button>
          <button id="stopRun" class="secondary" disabled>실행 중지</button>
        </div>
        <div class="section">
          <label>커스텀 테스트케이스</label>
          <div id="customTests"></div>
          <button id="addTest" class="secondary">+ 테스트 추가</button>
          <button id="runCustom">커스텀 테스트 실행</button>
          <div class="hint">Input은 solution 인자 순서대로 쉼표로 구분합니다. 예: 4, 5, 2, 2, [[0,0]]</div>
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
    let testCount = 0;
    let problems = [];

    function setPaneCollapsed(pane, button, className, collapsed) {
      pane.classList.toggle('collapsed', collapsed);
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
      const reviewCount = problems.filter((problem) => problem.review).length;
      const visibleCount = filter === 'review' ? reviewCount : problems.length;
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
          '<label class="review-toggle"><input class="review-check" type="checkbox" ' + (problem.review ? 'checked' : '') + ' /> 다시풀</label>' +
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
      });
    }

    function renderProblems() {
      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const visible = filter === 'review' ? problems.filter((problem) => problem.review) : problems;
      renderList(problemList, visible, filter === 'review' ? '다시 풀 문제가 없습니다.' : 'Programmers 폴더에 문제가 없습니다.');
      updatePaneSummaries();
    }

    function addTest(inputValue = '', expectedValue = '') {
      testCount += 1;
      const card = document.createElement('div');
      card.className = 'test-card';
      card.innerHTML =
        '<div class="test-head"><span>테스트 #' + testCount + '</span><button class="remove" type="button">삭제</button></div>' +
        '<label>Input</label>' +
        '<textarea class="test-input" spellcheck="false" placeholder="4, 5, 2, 2, [[0,0]]"></textarea>' +
        '<label>Expected Output</label>' +
        '<textarea class="test-expected" spellcheck="false" placeholder="[0,0]"></textarea>';
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
        addTest((test.inputs || []).join(', '), test.expected || '');
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
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("먼저 문제를 저장할 워크스페이스 폴더를 열어주세요.");
    return;
  }

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
        const created = await createProblem(workspaceFolder.uri, lessonId);
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
  const safeDir = await validateProblemDir(problemDir);
  if (!safeDir) {
    vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
    return;
  }

  await context.workspaceState.update("lastProblemDir", safeDir);
  await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(path.join(safeDir, "solution.cpp")));
  await showOpenedProblemState(context, safeDir);
}

async function toggleReview(context, problemDir, review) {
  const safeDir = await validateProblemDir(problemDir);
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

async function showOpenedProblemState(context, problemDir) {
  const problem = await loadProblemInfo(problemDir);
  const examples = await loadProblemExamples(problemDir);

  await context.workspaceState.update("lastProblemDir", problemDir);
  sidebarProvider?.post({ type: "currentProblem", problem });
  sidebarProvider?.post({ type: "customTests", tests: examples.length > 0 ? [examples[0]] : [] });
  await sidebarProvider?.refreshProblems();
  sidebarProvider?.post({
    type: "status",
    kind: "ready",
    text: `준비 완료\n\n${problem.folderName}`,
  });
}

async function validateProblemDir(problemDir) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder || !problemDir) {
    return undefined;
  }

  const root = path.resolve(getProgrammersDir(workspaceFolder.uri).fsPath);
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

async function loadProblems(workspaceUri) {
  const programmersDir = getProgrammersDir(workspaceUri);
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

function getProgrammersDir(workspaceUri) {
  return path.basename(workspaceUri.fsPath) === "Programmers" ? workspaceUri : vscode.Uri.joinPath(workspaceUri, "Programmers");
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

async function createProblem(workspaceUri, lessonId) {
  const existing = await findExistingProblem(workspaceUri, lessonId);
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
  const programmersDir = getProgrammersDir(workspaceUri);
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

async function findExistingProblem(workspaceUri, lessonId) {
  const programmersDir = getProgrammersDir(workspaceUri);
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

async function runSamplesFromCommand(context, customTestsText = "") {
  if (testRunInProgress) {
    vscode.window.showInformationMessage("이미 테스트가 실행 중입니다.");
    return;
  }

  const problemDir = await getProblemDir(context);
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
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine("");
    outputChannel.appendLine(`[Programmers Helper] ${message}`);
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

function formatTestErrorForStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) {
    return "알 수 없는 오류";
  }

  if (message.startsWith("clang++ 실패")) {
    return summarizeCompilerError(message);
  }

  return limitStatusText(message);
}

function summarizeCompilerError(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /\b(fatal )?error:/.test(line));
  if (!errorLine) {
    return "컴파일 실패";
  }

  return limitStatusText(`컴파일 실패\n${shortenCompilerPaths(errorLine)}`);
}

function shortenCompilerPaths(line) {
  return line.replace(/(?:\/[^\s:]+)+\/([^/\s:]+:\d+:\d+:)/g, "$1");
}

function limitStatusText(text, maxLength = 180) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
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
    await context.workspaceState.update("lastProblemDir", fromActive);
    return fromActive;
  }

  const last = context.workspaceState.get("lastProblemDir");
  if (typeof last === "string") {
    const validLast = await validateProblemDir(last);
    if (validLast) {
      return validLast;
    }
    await context.workspaceState.update("lastProblemDir", undefined);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("먼저 워크스페이스 폴더를 열어주세요.");
    return undefined;
  }

  const programmersDir = getProgrammersDir(workspaceFolder.uri);
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    vscode.window.showErrorMessage("Programmers 폴더를 찾지 못했습니다.");
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
  const binaryPath = path.join(runnerDir, "test_runner");
  const runnerCode = buildRunner(signature, examples);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(runnerPath), Buffer.from(runnerCode, "utf8"));

  outputChannel.clear();
  outputChannel.appendLine(`[Programmers Helper] ${path.basename(problemDir)} ${customTestsText.trim() ? "커스텀" : "샘플"} 테스트`);
  outputChannel.appendLine("");

  await execFile("clang++", ["-std=c++17", runnerPath, "-o", binaryPath], problemDir, {
    timeoutMs: COMPILE_TIMEOUT_MS,
    label: "컴파일",
  });
  if (stopRequested) {
    throw new Error("테스트 실행이 중지되었습니다.");
  }

  let output = "";
  let timedOut = 0;
  for (let index = 0; index < examples.length; index++) {
    if (stopRequested) {
      throw new Error("테스트 실행이 중지되었습니다.");
    }

    try {
      output += await execFile(binaryPath, [String(index + 1)], problemDir, {
        timeoutMs: TEST_TIMEOUT_MS,
        label: `테스트 #${index + 1}`,
        streamOutput: true,
      });
    } catch (error) {
      if (error?.code === "ETIMEOUT") {
        timedOut += 1;
        const seconds = Math.round(TEST_TIMEOUT_MS / 1000);
        const line = `[TIMEOUT] #${index + 1} limit=${seconds}s`;
        output += line + "\n";
        outputChannel.appendLine(line);
        continue;
      }
      throw error;
    }
  }

  const passed = (output.match(/\[PASS\]/g) || []).length;
  const failed = (output.match(/\[FAIL\]/g) || []).length + timedOut;
  const summary = `테스트 완료: ${passed} 통과, ${failed} 실패`;
  outputChannel.appendLine("");
  outputChannel.appendLine(summary);
  vscode.window.showInformationMessage(summary);
  return { summary, passed, failed };
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

function execFile(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    if (stopRequested) {
      reject(new Error("테스트 실행이 중지되었습니다."));
      return;
    }

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
      if (options.streamOutput) {
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
    child.on("close", (code) => {
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
        const error = new Error(`${options.label || command} 시간이 초과되었습니다. (${seconds}초)\n무한루프를 확인해주세요.`);
        error.code = "ETIMEOUT";
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} 실패\n${stderr || stdout}`));
        return;
      }
      resolve(stdout + stderr);
    });
  });
}

function parseSolutionSignature(cpp) {
  const match = cpp.match(/([A-Za-z_][\w:<>,\s&*]*?)\s+solution\s*\(([\s\S]*?)\)\s*\{/);
  if (!match) {
    return undefined;
  }

  const returnType = normalizeType(match[1]);
  const params = splitTopLevel(match[2], ",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param, index) => {
      const cleaned = param.replace(/\s*=\s*.*$/, "").trim();
      const nameMatch = cleaned.match(/([A-Za-z_]\w*)\s*$/);
      const name = nameMatch ? nameMatch[1] : `arg${index}`;
      const type = normalizeType(cleaned.slice(0, cleaned.length - name.length));
      return { type, name };
    });

  return { returnType, params };
}

function buildRunner(signature, examples) {
  const testBlocks = examples.map((example, index) => {
    if (example.inputs.length !== signature.params.length) {
      throw new Error(`입출력 예 #${index + 1}의 인자 수가 solution 시그니처와 다릅니다.`);
    }

    const declarations = signature.params.map((param, paramIndex) => {
      return `    ${param.type} arg${paramIndex} = ${toCppLiteral(param.type, example.inputs[paramIndex])};`;
    });
    const expected = `    ${signature.returnType} expected = ${toCppLiteral(signature.returnType, example.expected)};`;
    const callArgs = signature.params.map((_, paramIndex) => `arg${paramIndex}`).join(", ");

    return `  if (target == 0 || target == ${index + 1}) {
${declarations.join("\n")}
${expected}
    auto actual = solution(${callArgs});
    if (actual == expected) {
      cout << "[PASS] #" << ${index + 1} << " expected=" << repr(expected) << " actual=" << repr(actual) << endl;
    } else {
      cout << "[FAIL] #" << ${index + 1} << " expected=" << repr(expected) << " actual=" << repr(actual) << endl;
      failed++;
    }
  }`;
  });

  return `#include "../solution.cpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <map>
#include <queue>
#include <set>
#include <sstream>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
using namespace std;

string repr(const string& value) { return string("\\"") + value + "\\""; }
string repr(const char* value) { return repr(string(value)); }
string repr(bool value) { return value ? "true" : "false"; }

template <typename T>
typename enable_if<is_arithmetic<T>::value && !is_same<T, bool>::value, string>::type repr(T value) {
  return to_string(value);
}

template <typename T>
string repr(const vector<T>& value) {
  string out = "[";
  for (size_t i = 0; i < value.size(); ++i) {
    if (i) out += ", ";
    out += repr(value[i]);
  }
  out += "]";
  return out;
}

int main(int argc, char** argv) {
  int target = argc > 1 ? stoi(argv[1]) : 0;
  int failed = 0;
${testBlocks.join("\n")}
  if (target == 0 && failed == 0) {
    cout << "All sample tests passed." << endl;
  }
  return 0;
}
`;
}

function toCppLiteral(type, rawValue) {
  const value = rawValue.trim().replace(/^`|`$/g, "");
  if (/^vector\s*</.test(type)) {
    return value.replace(/\[/g, "{").replace(/\]/g, "}");
  }
  if (type === "string") {
    return /^".*"$/.test(value) ? value : JSON.stringify(value);
  }
  if (type === "bool") {
    return value.toLowerCase();
  }
  return value;
}

function parseCustomTests(customTestsText) {
  let parsed;
  try {
    parsed = JSON.parse(customTestsText);
  } catch (error) {
    throw new Error(`커스텀 테스트 JSON 형식이 올바르지 않습니다.\n${error instanceof Error ? error.message : String(error)}`);
  }

  const tests = Array.isArray(parsed) ? parsed : [parsed];
  return tests.map((test, index) => {
    if (test && typeof test.inputsText === "string") {
      if (!test.inputsText.trim() || !String(test.expectedText || "").trim()) {
        throw new Error(`커스텀 테스트 #${index + 1}의 Input과 Expected Output을 모두 입력해주세요.`);
      }

      return {
        inputs: splitTopLevel(test.inputsText, ",").map((value) => value.trim()).filter(Boolean),
        expected: String(test.expectedText).trim(),
      };
    }

    if (!test || !Array.isArray(test.inputs) || !Object.prototype.hasOwnProperty.call(test, "expected")) {
      throw new Error(`커스텀 테스트 #${index + 1}은 Input과 Expected Output이 필요합니다.`);
    }

    return {
      inputs: test.inputs.map(valueToRawLiteral),
      expected: valueToRawLiteral(test.expected),
    };
  });
}

function valueToRawLiteral(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function normalizeType(type) {
  return type
    .replace(/\bconst\b/g, "")
    .replace(/[&*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*<\s*/g, "<")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let current = "";
  let angle = 0;
  let bracket = 0;
  let quote = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const prev = value[i - 1];
    if (ch === '"' && prev !== "\\") quote = !quote;
    if (!quote) {
      if (ch === "<") angle++;
      if (ch === ">") angle--;
      if (ch === "[") bracket++;
      if (ch === "]") bracket--;
      if (ch === delimiter && angle === 0 && bracket === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function extractExamplesFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tableStart = lines.findIndex((line, index) => {
    return /입출력 예/.test(lines.slice(Math.max(0, index - 3), index + 1).join("\n")) && line.trim().startsWith("|");
  });

  if (tableStart < 0) {
    return [];
  }

  const tableLines = [];
  for (let i = tableStart; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) break;
    tableLines.push(lines[i]);
  }

  if (tableLines.length < 3) {
    return [];
  }

  const header = parseMarkdownRow(tableLines[0]);
  return tableLines.slice(2).map((line) => {
    const row = parseMarkdownRow(line);
    return {
      inputs: row.slice(0, header.length - 1).map(cleanCell),
      expected: cleanCell(row[header.length - 1] || ""),
    };
  });
}

function parseMarkdownRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  let code = false;

  for (const ch of trimmed) {
    if (ch === "`" && !escaped) code = !code;
    if (ch === "|" && !escaped && !code) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    escaped = ch === "\\" && !escaped;
    if (ch !== "\\") escaped = false;
  }
  cells.push(current.trim());
  return cells;
}

function cleanCell(value) {
  return decodeHtml(value).replace(/^`|`$/g, "").replace(/\\\|/g, "|").trim();
}

function fetchText(targetUrl) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      targetUrl,
      {
        headers: {
          "user-agent": "Mozilla/5.0 problem-template-generator",
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          resolve(fetchText(new URL(response.headers.location, targetUrl).toString()));
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${targetUrl}`));
          response.resume();
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error("프로그래머스 페이지 요청 시간이 초과되었습니다."));
    });
  });
}

function matchFirst(source, ...patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function slugify(text) {
  return text
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function htmlToMarkdown(htmlText) {
  let text = htmlText.replace(/\u001d/g, "");

  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const depth = Math.max(2, Number(level));
    return `\n${"#".repeat(depth)} ${inline(inner)}\n`;
  });

  text = text.replace(/<p>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>\s*<\/p>/gi, (_m, src, alt) => {
    return `\n![${decodeHtml(alt || "image")}](${decodeHtml(src)})\n`;
  });

  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, table) => tableToMarkdown(table));
  text = text.replace(/<ul>\s*([\s\S]*?)\s*<\/ul>/gi, (_m, list) => listToMarkdown(list));
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `\n${inline(inner)}\n`);

  return decodeHtml(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tableToMarkdown(table) {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
    return [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => inline(cell[1]).replace(/\|/g, "\\|"));
  });

  if (rows.length === 0) {
    return "";
  }

  const [head, ...body] = rows;
  return [
    "",
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");
}

function listToMarkdown(list) {
  const items = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => {
    const nested = item[1].match(/<ul>\s*([\s\S]*?)\s*<\/ul>/i)?.[1];
    const itemText = inline(item[1].replace(/<ul>[\s\S]*<\/ul>/i, "")).trim();
    const lines = [`- ${itemText}`];

    if (nested) {
      for (const nestedItem of [...nested.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]) {
        lines.push(`  - ${inline(nestedItem[1]).trim()}`);
      }
    }

    return lines.join("\n");
  });

  return `\n${items.join("\n")}\n`;
}

function inline(value) {
  return decodeHtml(
    value
      .replace(/\s+/g, " ")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

module.exports = {
  activate,
  deactivate,
};
