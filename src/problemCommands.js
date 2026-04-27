const path = require("path");
const vscode = require("vscode");
const {
  prepareDockerRuntimeOnOpen: prepareDockerRuntimeOnOpenModule,
} = require("./dockerRuntime");
const {
  limitStatusText,
} = require("./errorFormatting");
const {
  createProblem,
  createSolutionAttempt,
  deleteSolutionSnapshot,
  getSolutionSnapshotPath,
  getDefaultProgrammersDir,
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadProblems,
  loadSavedCustomTests,
  removeProblemIndexEntry,
  resetSolutionToInitial,
  resolveProgrammersDir,
  saveCustomTests,
  updateProblemIndexEntry,
} = require("./problemStore");

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
          const created = await createProblem(programmersDir, lessonId);
          progress.report({ message: "에디터를 여는 중..." });
          return created;
        }
      );

      const runtimeStatus = await this.openProblemFromDir(result.problemDir.fsPath, { forceRefreshProblems: true });
      if (runtimeStatus?.kind === "ready") {
        vscode.window.showInformationMessage(`Programmers ${lessonId} 준비 완료`);
      } else {
        vscode.window.showWarningMessage(`Programmers ${lessonId} 문제를 열었지만 실행 컨테이너는 준비되지 않았습니다.`);
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
    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(path.join(safeDir, "solution.cpp")));
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
    const result = await createSolutionAttempt(safeDir);
    await writeReviewState(safeDir, true);
    await this.context.workspaceState.update("lastProblemDir", safeDir);
    await showSolution(vscode.Uri.file(path.join(safeDir, "solution.cpp")));
    const runtimeStatus = await this.prepareDockerRuntimeOnOpen(safeDir);
    await this.showOpenedProblemState(safeDir, runtimeStatus, { forceRefreshProblems: true });

    if (result.resetToInitialCode) {
      vscode.window.showInformationMessage("이전 풀이를 보관하고 새 풀이 템플릿을 열었습니다.");
    } else {
      vscode.window.showWarningMessage("이전 풀이를 보관했습니다. 이 문제에는 초기 템플릿 기록이 없어 solution.cpp는 그대로 두었습니다.");
    }
  }

  // 현재 문제의 메모 파일을 옆 에디터 그룹에 토글합니다.
  async openNotes(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const problem = await loadProblemInfo(safeDir);
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

  // 현재 보고 있는 C++ 파일을 기록하지 않고 초기 템플릿으로 되돌립니다.
  async resetCurrentSolution(problemDir) {
    const target = await this.getActiveCodeTarget(problemDir);
    if (!target) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const relativeCppPath = path.relative(target.problemDir, target.cppPath) || "solution.cpp";
    const picked = await vscode.window.showWarningMessage(
      `${relativeCppPath} 파일을 초기 코드로 되돌릴까요?`,
      { modal: true, detail: "현재 작성 중인 내용은 풀이기록에 저장되지 않습니다. 보관하려면 새풀이를 먼저 사용하세요." },
      "초기화"
    );
    if (picked !== "초기화") {
      return;
    }

    await vscode.workspace.saveAll(false);
    const reset = await resetSolutionToInitial(target.problemDir, target.cppPath);
    if (!reset) {
      vscode.window.showWarningMessage("이 문제에는 초기 템플릿 기록이 없어 초기화할 수 없습니다.");
      return;
    }

    await this.context.workspaceState.update("lastProblemDir", target.problemDir);
    await showSolution(vscode.Uri.file(target.cppPath));
    await this.showOpenedProblemState(target.problemDir);
    vscode.window.showInformationMessage(`${relativeCppPath} 파일을 초기 코드로 되돌렸습니다.`);
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

    await this.updateProblemIndexForDir(safeDir);
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
    await this.updateProblemIndexForDir(safeDir);
    await this.refreshProblems?.({ invalidateCache: true });
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

    const last = this.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string" && path.resolve(last) === path.resolve(safeDir)) {
      await this.context.workspaceState.update("lastProblemDir", undefined);
      this.postMessage?.({ type: "currentProblem", problem: undefined });
      this.postMessage?.({ type: "status", kind: "", text: "대기 중\n\n문제 번호를 입력하고 생성 버튼을 누르세요." });
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (programmersDir) {
      await removeProblemIndexEntry(programmersDir, safeDir);
    }
    await this.refreshProblems?.({ invalidateCache: true });
    vscode.window.showInformationMessage(`${folderName} 삭제 완료`);
  }

  // Webview에서 받은 커스텀 테스트를 저장하고 실행합니다.
  async runCustomTestsFromMessage(tests, problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
      return;
    }

    const target = {
      problemDir: safeDir,
      cppPath: path.join(safeDir, "solution.cpp"),
    };
    await saveCustomTests(target.problemDir, tests);
    await this.runTests(JSON.stringify(tests || []), target);
  }

  // 열린 문제 상태를 사이드바에 반영합니다.
  async showOpenedProblemState(problemDir, runtimeStatus = { kind: "", detail: "" }, options = {}) {
    const problem = await loadProblemInfo(problemDir);
    const examples = await loadProblemExamples(problemDir);
    const savedCustomTests = await loadSavedCustomTests(problemDir);

    await this.context.workspaceState.update("lastProblemDir", problemDir);
    this.postMessage?.({ type: "currentProblem", problem });
    this.postMessage?.({ type: "customTests", tests: savedCustomTests.length > 0 ? savedCustomTests : examples.length > 0 ? [examples[0]] : [] });
    await this.updateProblemIndexForDir(problemDir);
    await this.refreshProblems?.({ invalidateCache: true });
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
      await updateProblemIndexEntry(programmersDir, problemDir);
    }
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
          cppPath: fromActive.cppPath,
        };
      }
    }

    const last = this.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string") {
      const validLast = await this.validateProblemDir(last);
      if (validLast) {
        return {
          problemDir: validLast,
          cppPath: path.join(validLast, "solution.cpp"),
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
    return {
      problemDir,
      cppPath: path.join(problemDir, "solution.cpp"),
    };
  }

  // 현재 에디터의 C++ 파일을 우선하고, 없으면 전달된 문제의 solution.cpp를 사용합니다.
  async getActiveCodeTarget(problemDir) {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fromActive = activeFile ? getRunTargetFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.validateProblemDir(fromActive.problemDir);
      if (validActive) {
        return {
          problemDir: validActive,
          cppPath: fromActive.cppPath,
        };
      }
    }

    const safeDir = await this.validateProblemDir(problemDir);
    return safeDir
      ? {
        problemDir: safeDir,
        cppPath: path.join(safeDir, "solution.cpp"),
      }
      : undefined;
  }

  // 문제를 열 때 Docker 런타임을 준비합니다.
  async prepareDockerRuntimeOnOpen(problemDir) {
    return prepareDockerRuntimeOnOpenModule({
      vscode,
      extensionDir: this.extensionDir,
      problemDir,
      execCommand: this.execCommand,
      limitStatusText,
      postStatus: (message) => this.postMessage?.(message),
    });
  }
}

// Markdown 미리보기와 solution.cpp를 나란히 엽니다.
async function openProblem(mdUri, cppUri) {
  await vscode.workspace.saveAll(false);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await openLockedMarkdownPreview(mdUri, vscode.ViewColumn.One);
  await showSolution(cppUri);
}

// 풀이 파일을 오른쪽 그룹에 보여주되 기존 탭은 닫지 않고 재사용합니다.
async function showSolution(cppUri) {
  await vscode.workspace.saveAll(false);
  await vscode.window.showTextDocument(cppUri, {
    viewColumn: vscode.ViewColumn.Two,
    preserveFocus: false,
    preview: false,
  });
}

// Markdown preview가 다른 Markdown 파일로 따라가지 않도록 잠급니다.
async function openLockedMarkdownPreview(mdUri, viewColumn) {
  await vscode.commands.executeCommand("markdown.showPreview", mdUri, viewColumn);
  await vscode.commands.executeCommand("markdown.preview.toggleLock");
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

// 파일 경로에서 문제 폴더와 실행 cpp를 추정합니다.
function getRunTargetFromPath(filePath) {
  const normalized = path.normalize(filePath);
  if (path.extname(normalized) !== ".cpp") {
    return undefined;
  }
  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf("Programmers");
  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }
  return {
    problemDir: parts.slice(0, index + 2).join(path.sep),
    cppPath: normalized,
  };
}

module.exports = {
  ProblemCommands,
};
