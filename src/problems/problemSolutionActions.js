const path = require("path");
const vscode = require("vscode");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  createSolutionAttempt,
  deleteSolutionSnapshot,
  getSolutionSnapshotPath,
  loadProblemInfo,
  readText,
  resetSolutionToInitial,
} = require("./problemStore");
const {
  getLanguage,
  getSolutionPath,
} = require("./languages");
const {
  helperPath,
} = require("./helperPaths");
const {
  closeOpenTabsForUri,
  openProblem,
  showSolution,
} = require("./problemEditor");

// 풀이 파일, 풀이 기록, 메모, 다시풀 상태처럼 문제 내부 풀이 작업을 처리합니다.
class ProblemSolutionActions {
  constructor(commands) {
    this.commands = commands;
  }

  async startReviewAttempt(problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await vscode.workspace.saveAll(false);
    const settings = getExecutionSettings();
    const result = await createSolutionAttempt(safeDir, settings.language);
    await writeReviewState(safeDir, true);
    await this.commands.context.workspaceState.update("lastProblemDir", safeDir);
    await showSolution(vscode.Uri.file(getSolutionPath(safeDir, settings.language)));
    const runtimeStatus = await this.commands.prepareDockerRuntimeOnOpen(safeDir);
    await this.commands.showOpenedProblemState(safeDir, runtimeStatus, { forceRefreshProblems: true });

    if (result.resetToInitialCode) {
      vscode.window.showInformationMessage("이전 풀이를 보관하고 새 풀이 템플릿을 열었습니다.");
    } else {
      vscode.window.showWarningMessage("이전 풀이를 보관했습니다. 이 문제에는 초기 템플릿 기록이 없어 현재 풀이 파일은 그대로 두었습니다.");
    }
  }

  async openNotes(problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const settings = getExecutionSettings();
    const problem = await loadProblemInfo(safeDir, settings.language);
    const notesUri = vscode.Uri.file(helperPath(safeDir, "notes.md"));
    await ensureNotesFile(notesUri, problem);
    await this.commands.context.workspaceState.update("lastProblemDir", safeDir);
    if (await closeOpenTabsForUri(notesUri)) {
      return;
    }

    await vscode.window.showTextDocument(notesUri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
      preview: false,
    });
  }

  async openWebsite(problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
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

    const target = await this.commands.getActiveCodeTarget(safeDir);
    if (target) {
      await vscode.workspace.saveAll(false);
      const code = await readText(vscode.Uri.file(target.solutionPath));
      await vscode.env.clipboard.writeText(code);
    }

    await vscode.env.openExternal(vscode.Uri.parse(problem.url));
    vscode.window.showInformationMessage("현재 풀이 코드를 클립보드에 복사하고 웹사이트를 열었습니다.");
  }

  async resetCurrentSolution(problemDir) {
    const target = await this.commands.getActiveCodeTarget(problemDir);
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

    await this.commands.context.workspaceState.update("lastProblemDir", target.problemDir);
    await showSolution(vscode.Uri.file(target.solutionPath));
    await this.commands.showOpenedProblemState(target.problemDir);
    vscode.window.showInformationMessage(`${relativeSolutionPath} 파일을 초기 코드로 되돌렸습니다.`);
  }

  async openSolutionSnapshot(problemDir, snapshotPath) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    const filePath = await getSolutionSnapshotPath(safeDir, snapshotPath);
    if (!filePath) {
      vscode.window.showInformationMessage("선택한 이전 풀이를 찾지 못했습니다.");
      return;
    }

    const settings = getExecutionSettings();
    const preserveRightProblemTabs = settings.tabResetMode !== "always";
    await openProblem(vscode.Uri.file(path.join(safeDir, "problem.md")), vscode.Uri.file(filePath), {
      preserveRightProblemTabs,
      preserveRightProblemTabsAcrossProblems: settings.tabResetMode === "never",
    });
  }

  async deleteSolutionSnapshot(problemDir, snapshotPath) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
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

    await this.commands.showOpenedProblemState(safeDir, { kind: "", detail: "" });
    vscode.window.showInformationMessage("이전 풀이 기록을 삭제했습니다.");
  }

  async toggleReview(problemDir, review) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showErrorMessage("문제 폴더를 찾지 못했습니다.");
      return;
    }

    await writeReviewState(safeDir, review);
    await this.commands.context.workspaceState.update("lastProblemDir", safeDir);
    const problems = await this.commands.updateProblemIndexForDir(safeDir);
    await this.commands.refreshProblemsFromIndex(problems);
  }
}

async function writeReviewState(problemDir, review) {
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const reviewUri = vscode.Uri.joinPath(helperDir, "review.json");

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.writeFile(reviewUri, Buffer.from(JSON.stringify({ review }, null, 2) + "\n", "utf8"));
}

async function ensureNotesFile(notesUri, problem) {
  try {
    await vscode.workspace.fs.stat(notesUri);
    return;
  } catch {
    // 새 메모 파일이 필요할 때만 기본 템플릿을 씁니다.
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

module.exports = {
  ProblemSolutionActions,
};
