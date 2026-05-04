const path = require("path");
const vscode = require("vscode");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  createProblem,
  ensureSolutionForLanguage,
  removeProblemIndexEntry,
  resolveProgrammersDir,
} = require("./problemStore");
const {
  openProblem,
} = require("./problemEditor");

const CREATE_PROBLEM_COOLDOWN_MS = 1000;

// 문제 생성, 열기, 삭제처럼 문제 폴더 생명주기를 바꾸는 명령을 처리합니다.
class ProblemCrudActions {
  constructor(commands) {
    this.commands = commands;
  }

  async createProblemFromInput() {
    const lessonId = await vscode.window.showInputBox({
      title: "Programmers 문제 생성",
      prompt: "프로그래머스 문제 번호를 입력하세요.",
      placeHolder: "예: 468379",
      validateInput(value) {
        return /^\d{1,10}$/.test(value.trim()) ? undefined : "문제 번호는 1~10자리 숫자로 입력해주세요.";
      },
    });

    if (lessonId) {
      await this.createProblemFromId(lessonId);
    }
  }

  async createProblemFromId(rawLessonId) {
    const lessonId = rawLessonId.trim();
    if (!/^\d{1,10}$/.test(lessonId)) {
      vscode.window.showErrorMessage("문제 번호는 1~10자리 숫자로 입력해주세요.");
      this.commands.postMessage?.({ type: "createBusy", busy: false });
      return;
    }

    if (this.commands.createProblemInFlight) {
      vscode.window.showInformationMessage("이미 문제를 생성하고 있습니다. 잠시만 기다려주세요.");
      this.commands.postMessage?.({ type: "createBusy", busy: true });
      return;
    }

    const cooldownMs = this.commands.createProblemCooldownUntil - Date.now();
    if (cooldownMs > 0) {
      vscode.window.showInformationMessage("잠시 후 다시 시도해주세요.");
      this.commands.postMessage?.({ type: "createBusy", busy: true });
      setTimeout(() => this.commands.postMessage?.({ type: "createBusy", busy: false }), cooldownMs);
      return;
    }

    this.commands.createProblemInFlight = true;
    this.commands.postMessage?.({ type: "createBusy", busy: true });
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const programmersDir = await resolveProgrammersDir(this.commands.context, workspaceFolder?.uri, { create: true });
      this.commands.postMessage?.({ type: "status", kind: "running", text: "생성 중\n\n기존 문제를 확인하고 있습니다..." });
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
      this.commands.postMessage?.({ type: "status", kind: "error", text: `오류\n\n${message}` });
      vscode.window.showErrorMessage(message);
    } finally {
      this.commands.createProblemInFlight = false;
      this.commands.createProblemCooldownUntil = Date.now() + CREATE_PROBLEM_COOLDOWN_MS;
      setTimeout(() => this.commands.postMessage?.({ type: "createBusy", busy: false }), CREATE_PROBLEM_COOLDOWN_MS);
    }
  }

  async openLastProblem() {
    const target = await this.commands.getProblemDir();
    if (target) {
      await this.openProblemFromDir(target.problemDir);
    }
  }

  async openLastProblemFromState() {
    const last = this.commands.context.workspaceState.get("lastProblemDir");
    if (typeof last !== "string") {
      return;
    }

    const safeDir = await this.commands.validateProblemDir(last);
    if (!safeDir) {
      await this.commands.context.workspaceState.update("lastProblemDir", undefined);
      this.commands.postMessage?.({ type: "currentProblem", problem: undefined });
      return;
    }

    const settings = getExecutionSettings();
    await this.openProblemFromDir(safeDir, {
      deferDockerRuntime: settings.executionMode === "docker",
    });
  }

  async openProblemFromDir(problemDir, options = {}) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return undefined;
    }

    const lastProblemDir = this.commands.context.workspaceState.get("lastProblemDir");
    await this.commands.context.workspaceState.update("lastProblemDir", safeDir);
    const settings = getExecutionSettings();
    const sameProblem = typeof lastProblemDir === "string" && path.resolve(lastProblemDir) === path.resolve(safeDir);
    const preserveRightProblemTabs = settings.tabResetMode === "never"
      || (settings.tabResetMode === "onProblemChange" && sameProblem);
    const preserveRightProblemTabsAcrossProblems = settings.tabResetMode === "never";
    const solution = await ensureSolutionForLanguage(safeDir, settings.language);
    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), solution.solutionUri, {
      preserveRightProblemTabs,
      preserveRightProblemTabsAcrossProblems,
    });
    const runtimeStatus = options.deferDockerRuntime && settings.executionMode === "docker"
      ? {
          kind: "",
          title: "Docker 대기 중",
          detail: "문제를 열거나 테스트를 실행하면 준비합니다.",
        }
      : await this.commands.prepareDockerRuntimeOnOpen(safeDir);
    await this.commands.showOpenedProblemState(safeDir, runtimeStatus, { forceRefreshProblems: Boolean(options.forceRefreshProblems) });
    return runtimeStatus;
  }

  async deleteProblem(problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
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

    const last = this.commands.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string" && path.resolve(last) === path.resolve(safeDir)) {
      await this.commands.context.workspaceState.update("lastProblemDir", undefined);
      this.commands.postMessage?.({ type: "currentProblem", problem: undefined });
      this.commands.postMessage?.({ type: "status", kind: "", text: "대기 중\n\n문제 번호를 입력하고 생성 버튼을 누르세요." });
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.commands.context, workspaceFolder?.uri);
    const problems = programmersDir ? await removeProblemIndexEntry(programmersDir, safeDir) : undefined;
    await this.commands.refreshProblemsFromIndex(problems);
    vscode.window.showInformationMessage(`${folderName} 삭제 완료`);
  }
}

module.exports = {
  ProblemCrudActions,
};
