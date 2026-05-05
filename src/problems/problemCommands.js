const path = require("path");
const vscode = require("vscode");
const {
  JAVA_COMMAND,
  JAVAC_COMMAND,
  PYTHON_COMMAND,
} = require("../core/config");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  prepareDockerRuntimeOnOpen: prepareDockerRuntimeOnOpenModule,
} = require("../runners/dockerRuntime");
const {
  limitStatusText,
} = require("../runners/errorFormatting");
const {
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadSavedCustomTests,
  resolveProgrammersDir,
  updateProblemIndexSummary,
  updateProblemIndexReviewStates,
} = require("./problemStore");
const {
  getLanguage,
} = require("./languages");
const {
  ProblemCrudActions,
} = require("./problemCrudActions");
const {
  ProblemSolutionActions,
} = require("./problemSolutionActions");
const {
  ProblemTestActions,
} = require("./problemTestActions");

// 문제 명령의 공개 API를 유지하고 실제 작업은 목적별 action으로 위임합니다.
class ProblemCommands {
  constructor({ context, extensionDir, execCommand, postMessage, refreshProblems, getCachedProblems, runTests }) {
    this.context = context;
    this.extensionDir = extensionDir;
    this.execCommand = execCommand;
    this.postMessage = postMessage;
    this.refreshProblems = refreshProblems;
    this.getCachedProblems = getCachedProblems;
    this.runTests = runTests;
    this.createProblemInFlight = false;
    this.createProblemCooldownUntil = 0;
    this.currentProblemInfo = undefined;
    this.crud = new ProblemCrudActions(this);
    this.solutions = new ProblemSolutionActions(this);
    this.tests = new ProblemTestActions(this);
  }

  createProblemFromInput() {
    return this.crud.createProblemFromInput();
  }

  createProblemFromId(rawLessonId) {
    return this.crud.createProblemFromId(rawLessonId);
  }

  openLastProblem() {
    return this.crud.openLastProblem();
  }

  openLastProblemFromState() {
    return this.crud.openLastProblemFromState();
  }

  openProblemFromDir(problemDir, options = {}) {
    return this.crud.openProblemFromDir(problemDir, options);
  }

  deleteProblem(problemDir) {
    return this.crud.deleteProblem(problemDir);
  }

  startReviewAttempt(problemDir) {
    return this.solutions.startReviewAttempt(problemDir);
  }

  openNotes(problemDir) {
    return this.solutions.openNotes(problemDir);
  }

  openWebsite(problemDir) {
    return this.solutions.openWebsite(problemDir);
  }

  resetCurrentSolution(problemDir) {
    return this.solutions.resetCurrentSolution(problemDir);
  }

  openSolutionSnapshot(problemDir, snapshotPath) {
    return this.solutions.openSolutionSnapshot(problemDir, snapshotPath);
  }

  deleteSolutionSnapshot(problemDir, snapshotPath) {
    return this.solutions.deleteSolutionSnapshot(problemDir, snapshotPath);
  }

  saveReviewStates(updates) {
    return this.solutions.saveReviewStates(updates);
  }

  runCustomTestsFromMessage(tests, problemDir) {
    return this.tests.runCustomTestsFromMessage(tests, problemDir);
  }

  saveCustomTestsFromMessage(tests, problemDir) {
    return this.tests.saveCustomTestsFromMessage(tests, problemDir);
  }

  getProblemDir() {
    return this.tests.getProblemDir();
  }

  getActiveCodeTarget(problemDir) {
    return this.tests.getActiveCodeTarget(problemDir);
  }

  async showOpenedProblemState(problemDir, runtimeStatus = { kind: "", detail: "" }) {
    const settings = getExecutionSettings();
    const problem = await loadProblemInfo(problemDir, settings.language);
    const examples = await loadProblemExamples(problemDir);
    const savedCustomTests = await loadSavedCustomTests(problemDir);

    await this.context.workspaceState.update("lastProblemDir", problemDir);
    this.currentProblemInfo = problem;
    this.postMessage?.({ type: "currentProblem", problem });
    this.postMessage?.({ type: "customTests", tests: savedCustomTests.length > 0 ? savedCustomTests : examples.length > 0 ? [examples[0]] : [] });
    const problems = await this.updateProblemIndexForSummary(problem);
    await this.refreshProblemsFromIndex(problems);

    const statusKind = runtimeStatus.kind || "";
    const statusTitle = runtimeStatus.title || (statusKind === "ready"
      ? "준비 완료"
      : statusKind === "error"
        ? "준비 실패"
        : "문제 열림");
    this.postMessage?.({
      type: "status",
      kind: statusKind,
      text: `${statusTitle}\n\n${problem.folderName}${runtimeStatus.detail ? `\n${runtimeStatus.detail}` : ""}`,
    });
  }

  async updateProblemIndexForSummary(summary) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (programmersDir) {
      return updateProblemIndexSummary(programmersDir, this.getCachedProblems?.(programmersDir.fsPath), summary);
    }
    return undefined;
  }

  async updateProblemIndexForReviewStates(updates) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    if (programmersDir) {
      return updateProblemIndexReviewStates(programmersDir, updates, this.getCachedProblems?.(programmersDir.fsPath));
    }
    return undefined;
  }

  getCachedProblemsForProgrammersDir(programmersDir) {
    return programmersDir ? this.getCachedProblems?.(programmersDir.fsPath) : undefined;
  }

  async refreshProblemsFromIndex(problems) {
    if (Array.isArray(problems)) {
      await this.refreshProblems?.({ problems });
      return;
    }
    await this.refreshProblems?.({ invalidateCache: true });
  }

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

    return await hasProblemFiles(vscode.Uri.file(target)) ? target : undefined;
  }

  getCachedProblemInfo(problemDir) {
    if (!problemDir || !this.currentProblemInfo?.problemDir) {
      return undefined;
    }
    return path.resolve(this.currentProblemInfo.problemDir) === path.resolve(problemDir)
      ? this.currentProblemInfo
      : undefined;
  }

  clearCachedProblemInfo(problemDir) {
    if (!problemDir || !this.currentProblemInfo?.problemDir || path.resolve(this.currentProblemInfo.problemDir) === path.resolve(problemDir)) {
      this.currentProblemInfo = undefined;
    }
  }

  async prepareDockerRuntimeOnOpen(problemDir) {
    const settings = getExecutionSettings();
    if (settings.executionMode === "local") {
      return this.prepareLocalRuntimeOnOpen(settings, problemDir);
    }

    return prepareDockerRuntimeOnOpenModule({
      context: this.context,
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
    this.postMessage?.({
      type: "status",
      kind: "running",
      problemDir,
      text: `로컬 실행 환경 확인 중...\n\n${language.label} 실행 명령을 확인하고 있습니다.`,
    });

    try {
      for (const check of getLocalRuntimeCommandChecks(settings)) {
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

module.exports = {
  ProblemCommands,
};
