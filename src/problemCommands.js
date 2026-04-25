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
  getDefaultProgrammersDir,
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadSavedCustomTests,
  resolveProgrammersDir,
  saveCustomTests,
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

      await this.openProblemFromDir(result.problemDir.fsPath);
      vscode.window.showInformationMessage(`Programmers ${lessonId} 준비 완료`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage?.({ type: "status", kind: "error", text: `오류\n\n${message}` });
      vscode.window.showErrorMessage(message);
    }
  }

  // 마지막으로 사용한 문제를 엽니다.
  async openLastProblem() {
    const dir = await this.getProblemDir();
    if (!dir) {
      return;
    }
    await this.openProblemFromDir(dir);
  }

  // 검증된 문제 폴더를 에디터에 엽니다.
  async openProblemFromDir(problemDir) {
    const safeDir = await this.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await this.context.workspaceState.update("lastProblemDir", safeDir);
    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(path.join(safeDir, "solution.cpp")));
    const runtimeStatus = await this.prepareDockerRuntimeOnOpen(safeDir);
    await this.showOpenedProblemState(safeDir, runtimeStatus);
  }

  // 다시풀 상태를 저장합니다.
  async toggleReview(problemDir, review) {
    const safeDir = await this.validateProblemDir(problemDir);
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
    await this.context.workspaceState.update("lastProblemDir", safeDir);
    await this.refreshProblems?.();
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

    await this.refreshProblems?.();
    vscode.window.showInformationMessage(`${folderName} 삭제 완료`);
  }

  // Webview에서 받은 커스텀 테스트를 저장하고 실행합니다.
  async runCustomTestsFromMessage(tests) {
    const problemDir = await this.getProblemDir();
    if (!problemDir) {
      return;
    }

    await saveCustomTests(problemDir, tests);
    await this.runTests(JSON.stringify(tests || []), problemDir);
  }

  // 열린 문제 상태를 사이드바에 반영합니다.
  async showOpenedProblemState(problemDir, runtimeStatus = { kind: "ready", detail: "" }) {
    const problem = await loadProblemInfo(problemDir);
    const examples = await loadProblemExamples(problemDir);
    const savedCustomTests = await loadSavedCustomTests(problemDir);

    await this.context.workspaceState.update("lastProblemDir", problemDir);
    this.postMessage?.({ type: "currentProblem", problem });
    this.postMessage?.({ type: "customTests", tests: savedCustomTests.length > 0 ? savedCustomTests : examples.length > 0 ? [examples[0]] : [] });
    await this.refreshProblems?.();
    this.postMessage?.({
      type: "status",
      kind: runtimeStatus.kind || "ready",
      text: `준비 완료\n\n${problem.folderName}${runtimeStatus.detail ? `\n${runtimeStatus.detail}` : ""}`,
    });
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
    const fromActive = activeFile ? findProblemDirFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.validateProblemDir(fromActive);
      if (validActive) {
        await this.context.workspaceState.update("lastProblemDir", validActive);
        return validActive;
      }
    }

    const last = this.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string") {
      const validLast = await this.validateProblemDir(last);
      if (validLast) {
        return validLast;
      }
      await this.context.workspaceState.update("lastProblemDir", undefined);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (!programmersDir) {
      vscode.window.showErrorMessage(`Programmers 폴더를 찾지 못했습니다: ${getDefaultProgrammersDir(this.context, workspaceFolder?.uri).fsPath}`);
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
  await vscode.commands.executeCommand("markdown.showPreview", mdUri, vscode.ViewColumn.One);
  await vscode.window.showTextDocument(cppUri, {
    viewColumn: vscode.ViewColumn.Two,
    preserveFocus: false,
    preview: false,
  });
}

// 파일 경로에서 문제 폴더를 추정합니다.
function findProblemDirFromPath(filePath) {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf("Programmers");
  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }
  return parts.slice(0, index + 2).join(path.sep);
}

module.exports = {
  ProblemCommands,
};
