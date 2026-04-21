const vscode = require("vscode");
const path = require("path");
const https = require("https");
const cp = require("child_process");

let sidebarProvider;
let outputChannel;

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
      if (message.type === "openLast") {
        await openLastProblem(this.context);
      }
    });
  }

  post(message) {
    this.view?.webview.postMessage(message);
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
    body { padding: 14px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    input, textarea { width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    textarea { min-height: 52px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    button { width: 100%; margin-top: 8px; padding: 7px 8px; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .section { margin-bottom: 18px; }
    .test-card { margin-top: 10px; padding: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .test-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .remove { width: auto; margin: 0; padding: 3px 7px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .status { margin-top: 10px; padding: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBarSectionHeader-background); white-space: pre-wrap; font-size: 12px; color: var(--vscode-foreground); line-height: 1.45; }
    .status.ready { border-color: var(--vscode-testing-iconPassed); }
    .status.error { border-color: var(--vscode-testing-iconFailed); }
    .status.running { border-color: var(--vscode-progressBar-background); }
    .hint { margin-top: 6px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="section">
    <label for="lessonId">Programmers 문제 번호</label>
    <input id="lessonId" value="468379" inputmode="numeric" />
    <button id="create">문제 생성 및 열기</button>
  </div>
  <div class="section">
    <button id="run">샘플 테스트 실행</button>
    <button id="open" class="secondary">마지막 문제 다시 열기</button>
  </div>
  <div class="section">
    <label>커스텀 테스트케이스</label>
    <div id="customTests"></div>
    <button id="addTest" class="secondary">+ 테스트 추가</button>
    <button id="runCustom">커스텀 테스트 실행</button>
    <div class="hint">Input은 solution 인자 순서대로 쉼표로 구분합니다. 예: 4, 5, 2, 2, [[0,0]]</div>
  </div>
  <div id="status" class="status">대기 중

문제 번호를 입력하고 생성 버튼을 누르세요.</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('lessonId');
    const customTests = document.getElementById('customTests');
    const status = document.getElementById('status');
    let testCount = 0;

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
      card.querySelector('.remove').addEventListener('click', () => card.remove());
      customTests.appendChild(card);
    }

    function collectTests() {
      return Array.from(document.querySelectorAll('.test-card')).map((card) => ({
        inputsText: card.querySelector('.test-input').value.trim(),
        expectedText: card.querySelector('.test-expected').value.trim()
      })).filter((test) => test.inputsText || test.expectedText);
    }

    addTest('4, 5, 2, 2, [[0, 0], [3, 1], [1, 3], [2, 4], [1, 1], [2, 2], [2, 3], [0, 4]]', '[2, 2]');
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
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openLast' });
    });
    window.addEventListener('message', (event) => {
      if (event.data.type === 'status') {
        status.textContent = event.data.text;
        status.className = 'status ' + (event.data.kind || '');
      }
    });
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
    sidebarProvider?.post({ type: "status", kind: "running", text: `생성 중\n\nProgrammers ${lessonId} 페이지를 가져오고 있습니다...` });
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Programmers ${lessonId} 생성 중`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "문제 페이지를 가져오는 중..." });
        const created = await createProblem(workspaceFolder.uri, lessonId);
        progress.report({ message: "에디터를 여는 중..." });
        await openProblem(created.mdUri, created.cppUri);
        return created;
      }
    );

    await context.workspaceState.update("lastProblemDir", result.problemDir.fsPath);
    sidebarProvider?.post({
      type: "status",
      kind: "ready",
      text: `준비 완료\n\n${result.folderName}\n\n왼쪽: problem.md Preview\n오른쪽: solution.cpp\n\n이제 샘플 테스트를 실행할 수 있습니다.`,
    });
    vscode.window.showInformationMessage(`Programmers ${lessonId} 준비 완료`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sidebarProvider?.post({ type: "status", kind: "error", text: `오류\n\n${message}` });
    vscode.window.showErrorMessage(message);
  }
}

async function openProblem(mdUri, cppUri) {
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
  await openProblem(vscode.Uri.file(path.join(dir, "problem.md")), vscode.Uri.file(path.join(dir, "solution.cpp")));
}

async function createProblem(workspaceUri, lessonId) {
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
  const problemDir = vscode.Uri.joinPath(workspaceUri, "Programmers", folderName);
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

  return { folderName, problemDir, mdUri, cppUri };
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
  const problemDir = await getProblemDir(context);
  if (!problemDir) {
    return;
  }

  try {
    const hasCustomTests = customTestsText.trim().length > 0;
    sidebarProvider?.post({ type: "status", kind: "running", text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 실행 중...\n\n결과는 Output > Programmers Helper에도 표시됩니다.` });
    const result = await runSamples(problemDir, customTestsText);
    sidebarProvider?.post({
      type: "status",
      kind: result.failed === 0 ? "ready" : "error",
      text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 완료\n\n${result.summary}\n\nOutput 패널에서 expected / actual을 확인하세요.`,
    });
    outputChannel.show(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sidebarProvider?.post({ type: "status", kind: "error", text: `테스트 실행 오류\n\n${message}` });
    vscode.window.showErrorMessage(message);
  }
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
    return last;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("먼저 워크스페이스 폴더를 열어주세요.");
    return undefined;
  }

  const programmersDir = vscode.Uri.joinPath(workspaceFolder.uri, "Programmers");
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

  await execFile("clang++", ["-std=c++17", runnerPath, "-o", binaryPath], problemDir);
  const output = await execFile(binaryPath, [], problemDir);
  outputChannel.append(output);

  const passed = (output.match(/\[PASS\]/g) || []).length;
  const failed = (output.match(/\[FAIL\]/g) || []).length;
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

function execFile(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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

    return `  {
${declarations.join("\n")}
${expected}
    auto actual = solution(${callArgs});
    if (actual == expected) {
      cout << "[PASS] #" << ${index + 1} << " expected=" << repr(expected) << " actual=" << repr(actual) << "\\n";
    } else {
      cout << "[FAIL] #" << ${index + 1} << " expected=" << repr(expected) << " actual=" << repr(actual) << "\\n";
      failed++;
    }
  }`;
  });

  return `#include <algorithm>
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

#include "../solution.cpp"

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

int main() {
  int failed = 0;
${testBlocks.join("\n")}
  if (failed == 0) {
    cout << "All sample tests passed.\\n";
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
