const path = require("path");
const vscode = require("vscode");
const {
  JAVA_COMMAND,
  JAVAC_COMMAND,
  PYTHON_COMMAND,
} = require("./config");
const {
  prepareDockerRuntimeOnOpen: prepareDockerRuntimeOnOpenModule,
} = require("./dockerRuntime");
const {
  limitStatusText,
} = require("./errorFormatting");
const {
  getExecutionSettings,
} = require("./settings");
const {
  createProblem,
  createSolutionAttempt,
  deleteSolutionSnapshot,
  ensureSolutionForLanguage,
  getSolutionSnapshotPath,
  getDefaultProgrammersDir,
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadProblems,
  loadSavedCustomTests,
  readText,
  removeProblemIndexEntry,
  resetSolutionToInitial,
  resolveProgrammersDir,
  saveCustomTests,
  updateProblemIndexEntry,
} = require("./problemStore");
const {
  getLanguage,
  getSolutionPath,
  inferLanguageFromRunnablePath,
  isSupportedSourceExtension,
} = require("./languages");

// 문제 관련 VS Code 액션들을 묶어 관리합니다.
class ProblemCommands {
  // 외부 의존성과 콜백을 주입합니다.
  constructor({ context, extensionDir, execCommand, postMessage, refreshProblems, runTests }) {
    this.context = context;
    this.extensionDir = extensionDir;
    this.execCommand = execCommand;
    this.postMessage = postMessage;
    this.refreshProblems = refreshProblems;
    this.runTests = runTests;
  }

  // 입력창에서 문제 번호를 받아 생성합니다.
  async createProblemFromInput() {
    const lessonId = await vscode.window.showInputBox({
      title: "Programmers 문제 생성",
      prompt: "프로그래머스 문제 번호를 입력하세요.",
      placeHolder: "예: 468379",
      validateInput(value) {
        return /^\d+$/.test(value.trim()) ? undefined : "숫자만 입력해주세요.";
      },
    });

    if (lessonId) {
      await this.createProblemFromId(lessonId);
    }
  }

  // 문제 번호로 문제 파일을 만들고 엽니다.
  async createProblemFromId(rawLessonId) {
    const lessonId = rawLessonId.trim();
    if (!/^\d+$/.test(lessonId)) {
      vscode.window.showErrorMessage("문제 번호는 숫자만 입력해주세요.");
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri, { create: true });

    try {
      this.postMessage?.({ type: "status", kind: "running", text: `생성 중\n\n기존 문제를 확인하고 있습니다...` });
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Programmers ${lessonId} 생성 중`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "기존 문제를 확인하는 중..." });
          const settings = getExecutionSettings();
          const created = await createProblem(programmersDir, lessonId, settings.language);
          progress.report({ message: "에디터를 여는 중..." });
          return created;
        }
      );

      const runtimeStatus = await this.openProblemFromDir(result.problemDir.fsPath, { forceRefreshProblems: true });
      if (runtimeStatus?.kind === "ready") {
        vscode.window.showInformationMessage(`Programmers ${lessonId} 준비 완료`);
      } else {
        vscode.window.showWarningMessage(`Programmers ${lessonId} 문제를 열었지만 실행 환경은 준비되지 않았습니다.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage?.({ type: "status", kind: "error", text: `오류\n\n${message}` });
      vscode.window.showErrorMessage(message);
    }
  }

  // 마지막으로 사용한 문제를 엽니다.
  async openLastProblem() {
    const target = await this.getProblemDir();
    if (!target) {
      return;
    }
    await this.openProblemFromDir(target.problemDir);
  }

  // 검증된 문제 폴더를 에디터에 엽니다.
  async openProblemFromDir(problemDir, options = {}) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await this.context.workspaceState.update("lastProblemDir", safeDir);
    const settings = getExecutionSettings();
    const solution = await ensureSolutionForLanguage(safeDir, settings.language);
    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), solution.solutionUri);
    const runtimeStatus = await this.prepareDockerRuntimeOnOpen(safeDir);
    await this.showOpenedProblemState(safeDir, runtimeStatus, { forceRefreshProblems: Boolean(options.forceRefreshProblems) });
    return runtimeStatus;
  }

  // 현재 풀이를 보관하고 새 풀이 파일을 엽니다.
  async startReviewAttempt(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await vscode.workspace.saveAll(false);
    const settings = getExecutionSettings();
    const result = await createSolutionAttempt(safeDir, settings.language);
    await writeReviewState(safeDir, true);
    await this.context.workspaceState.update("lastProblemDir", safeDir);
    await showSolution(vscode.Uri.file(getSolutionPath(safeDir, settings.language)));
    const runtimeStatus = await this.prepareDockerRuntimeOnOpen(safeDir);
    await this.showOpenedProblemState(safeDir, runtimeStatus, { forceRefreshProblems: true });

    if (result.resetToInitialCode) {
      vscode.window.showInformationMessage("이전 풀이를 보관하고 새 풀이 템플릿을 열었습니다.");
    } else {
      vscode.window.showWarningMessage("이전 풀이를 보관했습니다. 이 문제에는 초기 템플릿 기록이 없어 현재 풀이 파일은 그대로 두었습니다.");
    }
  }

  // 현재 문제의 메모 파일을 옆 에디터 그룹에 토글합니다.
  async openNotes(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const settings = getExecutionSettings();
    const problem = await loadProblemInfo(safeDir, settings.language);
    const notesUri = vscode.Uri.file(path.join(safeDir, ".programmers-helper", "notes.md"));
    await ensureNotesFile(notesUri, problem);
    await this.context.workspaceState.update("lastProblemDir", safeDir);
    if (await closeOpenTabsForUri(notesUri)) {
      return;
    }

    await vscode.window.showTextDocument(notesUri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
      preview: false,
    });
  }

  // 현재 문제의 Programmers 웹 페이지를 엽니다.
  async openWebsite(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const settings = getExecutionSettings();
    const problem = await loadProblemInfo(safeDir, settings.language);
    if (!problem.url) {
      vscode.window.showWarningMessage("이 문제의 웹사이트 URL을 찾지 못했습니다.");
      return;
    }

    const target = await this.getActiveCodeTarget(safeDir);
    if (target) {
      await vscode.workspace.saveAll(false);
      const code = await readText(vscode.Uri.file(target.solutionPath));
      await vscode.env.clipboard.writeText(code);
    }

    await vscode.env.openExternal(vscode.Uri.parse(problem.url));
    vscode.window.showInformationMessage("현재 풀이 코드를 클립보드에 복사하고 웹사이트를 열었습니다.");
  }

  // 현재 보고 있는 풀이 파일을 기록하지 않고 초기 템플릿으로 되돌립니다.
  async resetCurrentSolution(problemDir) {
    const target = await this.getActiveCodeTarget(problemDir);
    if (!target) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const relativeSolutionPath = path.relative(target.problemDir, target.solutionPath) || getLanguage(target.language).solutionFileName;
    const picked = await vscode.window.showWarningMessage(
      `${relativeSolutionPath} 파일을 초기 코드로 되돌릴까요?`,
      { modal: true, detail: "현재 작성 중인 내용은 풀이기록에 저장되지 않습니다. 보관하려면 새풀이를 먼저 사용하세요." },
      "초기화"
    );
    if (picked !== "초기화") {
      return;
    }

    await vscode.workspace.saveAll(false);
    const reset = await resetSolutionToInitial(target.problemDir, target.solutionPath, target.language);
    if (!reset) {
      vscode.window.showWarningMessage("이 문제에는 초기 템플릿 기록이 없어 초기화할 수 없습니다.");
      return;
    }

    await this.context.workspaceState.update("lastProblemDir", target.problemDir);
    await showSolution(vscode.Uri.file(target.solutionPath));
    await this.showOpenedProblemState(target.problemDir);
    vscode.window.showInformationMessage(`${relativeSolutionPath} 파일을 초기 코드로 되돌렸습니다.`);
  }

  // 선택한 이전 풀이 기록을 엽니다.
  async openSolutionSnapshot(problemDir, snapshotPath) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const filePath = await getSolutionSnapshotPath(safeDir, snapshotPath);
    if (!filePath) {
      vscode.window.showInformationMessage("선택한 이전 풀이를 찾지 못했습니다.");
      return;
    }

    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(filePath));
  }

  // 선택한 이전 풀이 기록을 삭제합니다.
  async deleteSolutionSnapshot(problemDir, snapshotPath) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const picked = await vscode.window.showWarningMessage(
      "선택한 이전 풀이 기록을 삭제할까요?",
      { modal: true, detail: "저장된 이전 풀이 파일과 기록에서 제거됩니다." },
      "삭제"
    );
    if (picked !== "삭제") {
      return;
    }

    const deleted = await deleteSolutionSnapshot(safeDir, snapshotPath);
    if (!deleted) {
      vscode.window.showInformationMessage("선택한 이전 풀이를 찾지 못했습니다.");
      return;
    }

    await this.showOpenedProblemState(safeDir, { kind: "", detail: "" });
    vscode.window.showInformationMessage("이전 풀이 기록을 삭제했습니다.");
  }

  // 다시풀 상태를 저장합니다.
  async toggleReview(problemDir, review) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await writeReviewState(safeDir, review);
    await this.context.workspaceState.update("lastProblemDir", safeDir);
    const problems = await this.updateProblemIndexForDir(safeDir);
    await this.refreshProblemsFromIndex(problems);
  }

  // 문제 폴더를 휴지통 또는 직접 삭제합니다.
  async deleteProblem(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const folderName = path.basename(safeDir);
    const picked = await vscode.window.showWarningMessage(
      `${folderName} 문제 폴더를 삭제할까요?`,
      { modal: true, detail: "problem.md, 풀이 파일, .programmers-helper가 함께 삭제됩니다." },
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

    const last = this.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string" && path.resolve(last) === path.resolve(safeDir)) {
      await this.context.workspaceState.update("lastProblemDir", undefined);
      this.postMessage?.({ type: "currentProblem", problem: undefined });
      this.postMessage?.({ type: "status", kind: "", text: "대기 중\n\n문제 번호를 입력하고 생성 버튼을 누르세요." });
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    let problems;
    if (programmersDir) {
      problems = await removeProblemIndexEntry(programmersDir, safeDir);
    }
    await this.refreshProblemsFromIndex(problems);
    vscode.window.showInformationMessage(`${folderName} 삭제 완료`);
  }

  // Webview에서 받은 커스텀 테스트를 저장하고 실행합니다.
  async runCustomTestsFromMessage(tests, problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
      return;
    }

    const target = await this.getActiveCodeTarget(safeDir);
    if (!target) {
      vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
      return;
    }
    await saveCustomTests(safeDir, tests);
    await this.runTests(JSON.stringify(tests || []), target);
  }

  // 열린 문제 상태를 사이드바에 반영합니다.
  async showOpenedProblemState(problemDir, runtimeStatus = { kind: "", detail: "" }, options = {}) {
    const settings = getExecutionSettings();
    const problem = await loadProblemInfo(problemDir, settings.language);
    const examples = await loadProblemExamples(problemDir);
    const savedCustomTests = await loadSavedCustomTests(problemDir);

    await this.context.workspaceState.update("lastProblemDir", problemDir);
    this.postMessage?.({ type: "currentProblem", problem });
    this.postMessage?.({ type: "customTests", tests: savedCustomTests.length > 0 ? savedCustomTests : examples.length > 0 ? [examples[0]] : [] });
    const problems = await this.updateProblemIndexForDir(problemDir);
    await this.refreshProblemsFromIndex(problems);
    const statusKind = runtimeStatus.kind || "";
    const statusTitle = statusKind === "ready"
      ? "준비 완료"
      : statusKind === "error"
        ? "준비 실패"
        : "문제 열림";
    this.postMessage?.({
      type: "status",
      kind: statusKind,
      text: `${statusTitle}\n\n${problem.folderName}${runtimeStatus.detail ? `\n${runtimeStatus.detail}` : ""}`,
    });
  }

  async updateProblemIndexForDir(problemDir) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (programmersDir) {
      return updateProblemIndexEntry(programmersDir, problemDir);
    }
    return undefined;
  }

  // problemStore가 돌려준 최신 인덱스 목록이 있으면 사이드바 cache를 그 목록으로 바로 교체한다.
  // Programmers 루트를 찾지 못한 예외적인 경우에는 기존 full refresh 경로로 fallback한다.
  async refreshProblemsFromIndex(problems) {
    if (Array.isArray(problems)) {
      await this.refreshProblems?.({ problems });
      return;
    }
    await this.refreshProblems?.({ invalidateCache: true });
  }

  // 문제 폴더가 안전하고 유효한지 확인합니다.
  async validateProblemDir(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (!programmersDir) {
      return undefined;
    }

    const root = path.resolve(programmersDir.fsPath);
    const target = path.resolve(problemDir);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return undefined;
    }

    if (await hasProblemFiles(vscode.Uri.file(target))) {
      return target;
    }
    return undefined;
  }

  // 현재 실행 대상 문제 폴더를 결정합니다.
  async getProblemDir() {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fromActive = activeFile ? getRunTargetFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.validateProblemDir(fromActive.problemDir);
      if (validActive) {
        await this.context.workspaceState.update("lastProblemDir", validActive);
        return {
          problemDir: validActive,
          solutionPath: fromActive.solutionPath,
          cppPath: fromActive.solutionPath,
          language: fromActive.language,
        };
      }
    }

    const last = this.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string") {
      const validLast = await this.validateProblemDir(last);
      if (validLast) {
        const settings = getExecutionSettings();
        const solution = await ensureSolutionForLanguage(validLast, settings.language);
        return {
          problemDir: validLast,
          solutionPath: solution.solutionUri.fsPath,
          cppPath: solution.solutionUri.fsPath,
          language: settings.language,
        };
      }
      await this.context.workspaceState.update("lastProblemDir", undefined);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (!programmersDir) {
      vscode.window.showErrorMessage(`Programmers 폴더를 찾지 못했습니다: ${getDefaultProgrammersDir(this.context, workspaceFolder?.uri).fsPath}`);
      return undefined;
    }

    const problems = await loadProblems(programmersDir);
    if (problems.length === 0) {
      vscode.window.showErrorMessage("실행할 문제 폴더가 없습니다.");
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      problems.map((problem) => ({
        label: problem.folderName,
        description: problem.lessonId ? `#${problem.lessonId}` : "",
        problemDir: problem.problemDir,
      })),
      { title: "샘플 테스트를 실행할 문제를 선택하세요." }
    );
    if (!picked) {
      return undefined;
    }
    const problemDir = picked.problemDir;
    const settings = getExecutionSettings();
    const solution = await ensureSolutionForLanguage(problemDir, settings.language);
    return {
      problemDir,
      solutionPath: solution.solutionUri.fsPath,
      cppPath: solution.solutionUri.fsPath,
      language: settings.language,
    };
  }

  // 현재 에디터의 풀이 파일을 우선하고, 없으면 전달된 문제의 현재 언어 solution 파일을 사용합니다.
  async getActiveCodeTarget(problemDir) {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fromActive = activeFile ? getRunTargetFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.validateProblemDir(fromActive.problemDir);
      if (validActive) {
        return {
          problemDir: validActive,
          solutionPath: fromActive.solutionPath,
          cppPath: fromActive.solutionPath,
          language: fromActive.language,
        };
      }
    }

    const safeDir = await this.validateProblemDir(problemDir);
    const fromVisible = safeDir ? getVisibleCodeTarget(safeDir) : undefined;
    if (fromVisible) {
      return fromVisible;
    }

    if (!safeDir) {
      return undefined;
    }

    const settings = getExecutionSettings();
    const solution = await ensureSolutionForLanguage(safeDir, settings.language);
    return {
      problemDir: safeDir,
      solutionPath: solution.solutionUri.fsPath,
      cppPath: solution.solutionUri.fsPath,
      language: settings.language,
    };
  }

  // 문제를 열 때 현재 설정에 맞는 실행 환경을 준비합니다.
  async prepareDockerRuntimeOnOpen(problemDir) {
    const settings = getExecutionSettings();
    if (settings.executionMode === "local") {
      return this.prepareLocalRuntimeOnOpen(settings, problemDir);
    }

    return prepareDockerRuntimeOnOpenModule({
      vscode,
      extensionDir: this.extensionDir,
      problemDir,
      execCommand: this.execCommand,
      limitStatusText,
      postStatus: (message) => this.postMessage?.(message),
    });
  }

  async prepareLocalRuntimeOnOpen(settings, problemDir) {
    const language = getLanguage(settings.language);
    const commandChecks = getLocalRuntimeCommandChecks(settings);
    this.postMessage?.({
      type: "status",
      kind: "running",
      text: `로컬 실행 환경 확인 중...\n\n${language.label} 실행 명령을 확인하고 있습니다.`,
    });

    try {
      for (const check of commandChecks) {
        await checkLocalRuntimeCommand(this.execCommand, check, problemDir);
      }
      return {
        kind: "ready",
        detail: `로컬 실행 준비 완료\n${language.compilerSettingsLabel(settings)}`,
      };
    } catch (error) {
      return {
        kind: "error",
        detail: `로컬 실행 준비 실패\n${formatLocalRuntimeError(error)}`,
      };
    }
  }
}

function getLocalRuntimeCommandChecks(settings) {
  if (settings.language === "java") {
    return [
      { command: JAVAC_COMMAND, args: ["-version"] },
      { command: JAVA_COMMAND, args: ["-version"] },
    ];
  }
  if (settings.language === "python") {
    return [{ command: PYTHON_COMMAND, args: ["--version"] }];
  }
  return [{ command: settings.compilerCommand, args: ["--version"] }];
}

async function checkLocalRuntimeCommand(execCommand, check, cwd) {
  const { command, args } = check;
  try {
    const result = await execCommand(command, args, {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 5000,
    });
    if (result.code !== 0) {
      const output = String(result.stderr || result.stdout || "").trim();
      throw new Error(`${command} ${args.join(" ")} 실행에 실패했습니다.${output ? `\n${output}` : ""}`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${command} 명령어를 찾지 못했습니다.\nVS Code 설정에서 실행 명령을 바꾸거나 ${command}를 설치해주세요.`);
    }
    throw error;
  }
}

function formatLocalRuntimeError(error) {
  return limitStatusText(error instanceof Error ? error.message : String(error));
}

// Markdown 미리보기와 현재 언어 풀이 파일을 나란히 엽니다.
async function openProblem(mdUri, solutionUri) {
  await vscode.workspace.saveAll(false);
  await openLockedMarkdownPreview(mdUri, vscode.ViewColumn.One);
  await closeInactiveProblemTabs(mdUri, solutionUri);
  await showSolution(solutionUri);
  await closeStaleSolutionTabs(solutionUri);
  await keepOnlyProblemLayoutTabs(mdUri, solutionUri);
}

// 풀이 파일을 오른쪽 그룹에 보여주되 기존 탭은 닫지 않고 재사용합니다.
async function showSolution(solutionUri) {
  await vscode.workspace.saveAll(false);
  await vscode.window.showTextDocument(solutionUri, {
    viewColumn: vscode.ViewColumn.Two,
    preserveFocus: false,
    preview: false,
  });
}

// Markdown preview가 다른 Markdown 파일로 따라가지 않도록 잠급니다.
async function openLockedMarkdownPreview(mdUri, viewColumn) {
  try {
    await vscode.commands.executeCommand("vscode.openWith", mdUri, "vscode.markdown.preview.editor", {
      viewColumn,
      preview: false,
    });
  } catch {
    await vscode.commands.executeCommand("markdown.showPreview", mdUri, viewColumn);
    await vscode.commands.executeCommand("markdown.preview.toggleLock");
  }
}

// 같은 파일이 이미 열려 있으면 해당 탭만 닫습니다.
async function closeOpenTabsForUri(uri) {
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      if (tab.input?.uri && sameFsPath(tab.input.uri, uri)) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length === 0) {
    return false;
  }

  await vscode.window.tabGroups.close(tabs, true);
  return true;
}

async function closeInactiveProblemTabs(mdUri, solutionUri) {
  const keep = new Set([path.resolve(mdUri.fsPath), path.resolve(solutionUri.fsPath)]);
  const programmersRoot = path.dirname(path.dirname(mdUri.fsPath));
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      if (tab.isActive || !isProblemMarkdownTab(tab, programmersRoot, keep)) {
        continue;
      }
      tabs.push(tab);
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// 닫아도 되는 Programmers problem.md 탭인지 판정합니다.
// URI가 없는 Markdown preview 탭은 label fallback으로 보수적으로 처리한다.
function isProblemMarkdownTab(tab, programmersRoot, keep) {
  const uris = getTabUris(tab);
  if (uris.length > 0) {
    return uris.some((uri) => {
      const target = path.resolve(uri.fsPath);
      return !keep.has(target)
        && target.endsWith(`${path.sep}problem.md`)
        && target.startsWith(path.resolve(programmersRoot) + path.sep);
    });
  }

  const label = String(tab.label || "").toLowerCase();
  return label.includes("problem.md");
}

// diff/custom editor 입력까지 고려해 탭이 참조하는 file URI들을 모읍니다.
function getTabUris(tab) {
  return [
    tab.input?.uri,
    tab.input?.modified,
    tab.input?.original,
  ].filter((uri) => uri?.scheme === "file");
}

// 현재 문제 풀이 파일 외에 같은 Programmers 루트의 오래된 풀이 탭을 정리합니다.
async function closeStaleSolutionTabs(solutionUri) {
  const keep = path.resolve(solutionUri.fsPath);
  const target = getRunTargetFromPath(solutionUri.fsPath);
  const programmersRoot = target ? path.dirname(target.problemDir) : path.dirname(path.dirname(solutionUri.fsPath));
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      const uris = getTabUris(tab);
      if (uris.some((uri) => {
        const target = path.resolve(uri.fsPath);
        return target !== keep
          && isSupportedSourceExtension(path.extname(target))
          && target.startsWith(path.resolve(programmersRoot) + path.sep);
      })) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// 문제 열기 후 좌/우 editor group에 현재 problem.md와 풀이 파일만 남깁니다.
async function keepOnlyProblemLayoutTabs(mdUri, solutionUri) {
  const keepLeft = path.resolve(mdUri.fsPath);
  const keepRight = path.resolve(solutionUri.fsPath);
  const tabs = [];

  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      const uris = getTabUris(tab);
      if (uris.length === 0) {
        continue;
      }

      const hasLeft = uris.some((uri) => path.resolve(uri.fsPath) === keepLeft);
      const hasRight = uris.some((uri) => path.resolve(uri.fsPath) === keepRight);
      if (!hasLeft && !hasRight) {
        tabs.push(tab);
        continue;
      }

      if (group.viewColumn === vscode.ViewColumn.One && !hasLeft) {
        tabs.push(tab);
      }
      if (group.viewColumn === vscode.ViewColumn.Two && !hasRight) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// VS Code URI의 파일 경로를 정규화해서 비교합니다.
function sameFsPath(left, right) {
  return path.resolve(left.fsPath) === path.resolve(right.fsPath);
}

// 다시풀 상태 파일을 저장합니다.
async function writeReviewState(problemDir, review) {
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const reviewUri = vscode.Uri.joinPath(helperDir, "review.json");
  const payload = {
    review,
    updatedAt: new Date().toISOString(),
  };

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.writeFile(reviewUri, Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8"));
}

// 문제별 메모 파일이 없으면 기본 템플릿으로 생성합니다.
async function ensureNotesFile(notesUri, problem) {
  try {
    await vscode.workspace.fs.stat(notesUri);
    return;
  } catch {
    // 파일이 없을 때만 아래에서 생성합니다.
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(notesUri.fsPath)));
  const title = problem.title || problem.folderName || "Programmers 문제";
  const lessonId = problem.lessonId ? `#${problem.lessonId}` : "";
  const template = [
    `# ${title}${lessonId ? ` (${lessonId})` : ""}`,
    "",
    "## 핵심 아이디어",
    "",
    "- ",
    "",
    "## 틀린 이유",
    "",
    "- ",
    "",
    "## 다시 풀 때 볼 것",
    "",
    "- ",
    "",
  ].join("\n");
  await vscode.workspace.fs.writeFile(notesUri, Buffer.from(template, "utf8"));
}

// 파일 경로에서 문제 폴더와 실행 풀이 파일을 추정합니다.
function getRunTargetFromPath(filePath) {
  const normalized = path.normalize(filePath);
  if (!isSupportedSourceExtension(path.extname(normalized))) {
    return undefined;
  }

  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf("Programmers");
  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }

  const relativeParts = parts.slice(index + 2);
  const language = inferLanguageFromRunnablePath(relativeParts);
  if (!language) {
    return undefined;
  }

  return {
    problemDir: parts.slice(0, index + 2).join(path.sep),
    solutionPath: normalized,
    cppPath: normalized,
    language,
  };
}

function getVisibleCodeTarget(problemDir) {
  const safeDir = path.resolve(problemDir);
  const settings = getExecutionSettings();
  const defaultSolutionPath = path.resolve(safeDir, getLanguage(settings.language).solutionFileName);
  const visibleTargets = vscode.window.visibleTextEditors
    .map((editor) => getRunTargetFromPath(editor.document.uri.fsPath))
    .filter((target) => target && path.resolve(target.problemDir) === safeDir);

  const sameLanguageTargets = visibleTargets.filter((target) => target.language === settings.language);
  const snapshotTarget = sameLanguageTargets.find((target) => path.resolve(target.solutionPath) !== defaultSolutionPath);
  return snapshotTarget || sameLanguageTargets[0] || visibleTargets[0];
}

module.exports = {
  ProblemCommands,
};
