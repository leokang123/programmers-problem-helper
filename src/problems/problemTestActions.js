const vscode = require("vscode");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  ensureSolutionForLanguage,
  getDefaultProgrammersDir,
  loadProblems,
  resolveProgrammersDir,
  saveCustomTests,
} = require("./problemStore");
const {
  getRunTargetFromPath,
  getVisibleCodeTarget,
} = require("./problemEditor");

// 테스트 실행 요청, 커스텀 테스트 저장, 실행 대상 탐색을 처리합니다.
class ProblemTestActions {
  constructor(commands) {
    this.commands = commands;
  }

  async runCustomTestsFromMessage(tests, problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
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
    this.commands.postMessage?.({ type: "customTestsSaved", tests });
    await this.commands.runTests(JSON.stringify(tests || []), target);
  }

  async saveCustomTestsFromMessage(tests, problemDir) {
    const safeDir = await this.commands.validateProblemDir(problemDir);
    if (!safeDir) {
      vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
      return;
    }

    await saveCustomTests(safeDir, tests);
    this.commands.postMessage?.({ type: "customTestsSaved", tests });
    vscode.window.showInformationMessage("커스텀 테스트 저장 완료");
  }

  async getProblemDir() {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fromActive = activeFile ? getRunTargetFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.commands.validateProblemDir(fromActive.problemDir);
      if (validActive) {
        await this.commands.context.workspaceState.update("lastProblemDir", validActive);
        return {
          problemDir: validActive,
          solutionPath: fromActive.solutionPath,
          cppPath: fromActive.solutionPath,
          language: fromActive.language,
        };
      }
    }

    const last = this.commands.context.workspaceState.get("lastProblemDir");
    if (typeof last === "string") {
      const validLast = await this.commands.validateProblemDir(last);
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
      await this.commands.context.workspaceState.update("lastProblemDir", undefined);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.commands.context, workspaceFolder?.uri);
    if (!programmersDir) {
      vscode.window.showErrorMessage(`Programmers 폴더를 찾지 못했습니다: ${getDefaultProgrammersDir(this.commands.context, workspaceFolder?.uri).fsPath}`);
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

    const settings = getExecutionSettings();
    const solution = await ensureSolutionForLanguage(picked.problemDir, settings.language);
    return {
      problemDir: picked.problemDir,
      solutionPath: solution.solutionUri.fsPath,
      cppPath: solution.solutionUri.fsPath,
      language: settings.language,
    };
  }

  async getActiveCodeTarget(problemDir) {
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const fromActive = activeFile ? getRunTargetFromPath(activeFile) : undefined;
    if (fromActive) {
      const validActive = await this.commands.validateProblemDir(fromActive.problemDir);
      if (validActive) {
        return {
          problemDir: validActive,
          solutionPath: fromActive.solutionPath,
          cppPath: fromActive.solutionPath,
          language: fromActive.language,
        };
      }
    }

    const safeDir = await this.commands.validateProblemDir(problemDir);
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
}

module.exports = {
  ProblemTestActions,
};
