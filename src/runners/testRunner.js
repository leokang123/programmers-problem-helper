const path = require("path");
const vscode = require("vscode");
const {
  DOCKER_IMAGE,
  getDebugCompileFlagsForMode,
  getFastCompileFlags,
} = require("../core/config");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  loadProblemExamples,
  readText,
} = require("../problems/problemStore");
const {
  getLanguage,
  getSolutionPath,
} = require("../problems/languages");
const {
  runnerPath,
} = require("../problems/helperPaths");
const {
  getRunnerBuilder,
} = require("./languageRunnerRegistry");
const {
  createRunnerFingerprint,
  writeFileIfChanged,
} = require("./testRunnerArtifacts");
const {
  countTestResultOutput,
  describeMemoryOptions,
  hasSanitizerOutput,
  shouldRetryWithSanitizer,
} = require("./testRunnerOutput");
const {
  formatTestErrorForPanel,
  formatTestErrorForStatus,
} = require("./errorFormatting");
const {
  buildProcessFailureError,
} = require("./errorFormatting");
const {
  getLocalBinaryExtension,
  normalizeRunTarget,
} = require("./testRunTarget");
const {
  TestRunnerRuntime,
} = require("./testRunnerRuntime");
const {
  TestRunnerCompiler,
} = require("./testRunnerCompiler");
const {
  TestRunnerExecutor,
} = require("./testRunnerExecutor");

// 언어별 테스트 실행 상태와 실행 환경을 관리합니다.
class TestRunner {
  constructor({ outputChannel, diagnosticCollection, extensionDir, execCommand, postStatus }) {
    this.outputChannel = outputChannel;
    this.diagnosticCollection = diagnosticCollection;
    this.extensionDir = extensionDir;
    this.execCommand = execCommand;
    this.postStatus = postStatus;
    this.activeTestProcess = undefined;
    this.activeProblemDir = undefined;
    this.testRunInProgress = false;
    this.stopRequested = false;
    this.runtime = new TestRunnerRuntime(this);
    this.compiler = new TestRunnerCompiler(this, this.runtime);
    this.executor = new TestRunnerExecutor(this, this.runtime);
  }

  async runFromCommand(context, customTestsText = "", providedProblemDir, getProblemDir) {
    if (this.testRunInProgress) {
      vscode.window.showInformationMessage("이미 테스트가 실행 중입니다.");
      return;
    }

    const target = normalizeRunTarget(providedProblemDir || await getProblemDir(context));
    if (!target) {
      return;
    }

    this.testRunInProgress = true;
    this.stopRequested = false;
    this.activeProblemDir = target.problemDir;
    this.postStatus?.({ type: "testRunning", running: true });

    try {
      const hasCustomTests = customTestsText.trim().length > 0;
      this.postStatus?.({ type: "status", kind: "running", problemDir: target.problemDir, text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 실행 중...` });
      const result = await this.runSamples(target.problemDir, customTestsText, target.solutionPath, target.language);
      this.postStatus?.({
        type: "status",
        kind: result.failed === 0 ? "ready" : "error",
        problemDir: target.problemDir,
        text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 완료\n\n${result.summary}`,
      });
      this.outputChannel.show(true);
    } catch (error) {
      const panelMessage = formatTestErrorForPanel(error);
      this.outputChannel.appendLine("");
      this.outputChannel.appendLine(`[Programmers Helper] ${panelMessage}`);
      this.outputChannel.show(true);
      this.postStatus?.({ type: "status", kind: "error", problemDir: target.problemDir, text: `테스트 실행 오류\n\n${formatTestErrorForStatus(error)}` });
      vscode.window.showErrorMessage(formatTestErrorForStatus(error));
    } finally {
      this.activeTestProcess = undefined;
      this.activeProblemDir = undefined;
      this.testRunInProgress = false;
      this.stopRequested = false;
      this.postStatus?.({ type: "testRunning", running: false });
    }
  }

  stop() {
    if (!this.testRunInProgress) {
      return;
    }

    this.stopRequested = true;
    if (this.activeTestProcess && !this.activeTestProcess.killed) {
      const child = this.activeTestProcess;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1000);
    }
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine("[Programmers Helper] 테스트 실행 중지 요청");
    this.postStatus?.({ type: "status", kind: "error", problemDir: this.activeProblemDir, text: "테스트 실행 중지 요청\n\n현재 실행 중인 프로세스를 종료하고 있습니다." });
  }

  async runSamples(problemDir, customTestsText = "", selectedSolutionPath, selectedLanguage) {
    const runContext = await this.prepareTestRunContext(problemDir, customTestsText, selectedSolutionPath, selectedLanguage);
    this.writeRunHeader(runContext);
    const runtime = await this.runtime.ensureRuntimeReady(problemDir, runContext);
    this.postStatus?.({ type: "status", kind: "running", problemDir, text: `${runContext.isCustomRun ? "커스텀" : "샘플"} 테스트 실행 중...` });
    this.compiler.clearProblemDiagnostics(runContext.solutionPath);

    try {
      await this.compiler.compileRunner(runtime, runContext, runContext.fastArtifactPath, runContext.fastCompileFlags, "컴파일", runContext.fastFingerprint);
    } catch (error) {
      this.compiler.applyCompilerDiagnostics(runContext.solutionPath, error, runContext.language.id);
      throw error;
    }
    this.throwIfStopped();

    let passed = 0;
    let failed = 0;
    let debugBinaryReady = false;
    for (let index = 0; index < runContext.examples.length; index++) {
      this.throwIfStopped();
      try {
        const testOutput = await this.executor.runTestArtifact(runtime, runContext, runContext.fastArtifactPath, index + 1, {
          label: `테스트 #${index + 1}`,
          timeoutMs: runContext.settings.testTimeoutMs,
          streamOutput: true,
          streamStderr: false,
          streamSanitizedRuntime: false,
        });
        const counts = countTestResultOutput(testOutput);
        passed += counts.passed;
        failed += counts.failed;
      } catch (error) {
        if (!runContext.language.supportsDebugRetry || !shouldRetryWithSanitizer(error)) {
          throw error;
        }
        debugBinaryReady = await this.ensureDebugArtifact(runtime, runContext, debugBinaryReady, error);
        await this.runDebugRetry(runtime, runContext, index + 1, error);
      }
    }

    const summary = `테스트 완료: ${passed} 통과, ${failed} 실패`;
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(summary);
    vscode.window.showInformationMessage(summary);
    return { summary, passed, failed };
  }

  async ensureDebugArtifact(runtime, runContext, debugBinaryReady, originalError) {
    if (debugBinaryReady) {
      return true;
    }

    try {
      await this.compiler.compileRunner(runtime, runContext, runContext.debugArtifactPath, runContext.debugCompileFlags, "디버그 컴파일");
      return true;
    } catch (compileError) {
      if (this.runtime.shouldSkipSanitizerFallback(runContext.settings, compileError)) {
        this.outputChannel.appendLine("[Programmers Helper] 로컬 sanitizer fallback을 사용할 수 없어 원래 런타임 에러를 유지합니다.");
        throw originalError;
      }
      this.compiler.applyCompilerDiagnostics(runContext.solutionPath, compileError, runContext.language.id);
      throw compileError;
    }
  }

  async runDebugRetry(runtime, runContext, testIndex, originalError) {
    try {
      const debugOutput = await this.executor.runTestArtifact(runtime, runContext, runContext.debugArtifactPath, testIndex, {
        label: `테스트 #${testIndex}`,
        timeoutMs: runContext.settings.testTimeoutMs,
        streamOutput: false,
        streamSanitizedRuntime: true,
        debugEnv: runContext.settings.executionMode === "docker",
      });
      if (hasSanitizerOutput(debugOutput)) {
        throw buildProcessFailureError(runContext.settings.executionMode === "docker" ? "docker" : runContext.debugArtifactPath, { label: `테스트 #${testIndex}` }, 1, undefined, debugOutput, "", 0);
      }
      throw originalError;
    } finally {
      await cleanupDebugArtifact(runContext);
    }
  }

  async prepareTestRunContext(problemDir, customTestsText = "", selectedSolutionPath, selectedLanguage) {
    const settings = getExecutionSettings();
    const language = getLanguage(selectedLanguage || settings.language);
    const builder = getRunnerBuilder(language.id);
    const fastCompileFlags = language.id === "cpp" ? getFastCompileFlags(settings.cppStandard) : [];
    const debugCompileFlags = language.id === "cpp" ? getDebugCompileFlagsForMode(settings.executionMode, settings.cppStandard) : [];
    const solutionPath = selectedSolutionPath || getSolutionPath(problemDir, language.id);
    const solutionCode = await readText(vscode.Uri.file(solutionPath));
    const examples = customTestsText.trim() ? builder.parseCustomTests(customTestsText) : await loadProblemExamples(problemDir);
    const signature = builder.parseSolutionSignature(solutionCode);

    if (examples.length === 0) {
      throw new Error(customTestsText.trim() ? "커스텀 테스트케이스가 비어 있습니다." : "problem.md에서 입출력 예를 찾지 못했습니다.");
    }
    if (!signature) {
      throw new Error(`${path.basename(solutionPath)}에서 solution 함수 시그니처를 찾지 못했습니다.`);
    }

    const binaryExtension = getLocalBinaryExtension(settings);
    const fastArtifactPath = language.id === "cpp" ? `${language.fastArtifactPath}${binaryExtension}` : language.fastArtifactPath;
    const debugArtifactPath = language.id === "cpp" ? `${language.debugArtifactPath}${binaryExtension}` : language.debugArtifactPath;
    const generatedRunnerPath = language.id === "python"
      ? path.join(problemDir, fastArtifactPath)
      : runnerPath(problemDir, language.runnerFileName);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(generatedRunnerPath)));

    const includePath = path.relative(path.dirname(generatedRunnerPath), solutionPath).split(path.sep).join(path.posix.sep);
    const memoryOptions = this.runtime.resolveRunnerMemoryOptions(settings, language);
    const runnerCode = builder.buildRunner(signature, examples, includePath, memoryOptions);
    const fastFingerprint = createRunnerFingerprint(runnerCode, solutionCode, fastCompileFlags, includePath, settings, language.id);
    const debugFingerprint = language.supportsDebugRetry
      ? createRunnerFingerprint(runnerCode, solutionCode, debugCompileFlags, includePath, settings, language.id)
      : fastFingerprint;
    await writeFileIfChanged(generatedRunnerPath, runnerCode);

    return {
      settings,
      language,
      problemDir,
      fastCompileFlags,
      debugCompileFlags,
      solutionPath,
      cppPath: solutionPath,
      examples,
      memoryOptions,
      fastArtifactPath,
      debugArtifactPath,
      runnerPath: generatedRunnerPath,
      includePath,
      fastFingerprint,
      debugFingerprint,
      isCustomRun: customTestsText.trim().length > 0,
    };
  }

  writeRunHeader(runContext) {
    this.outputChannel.clear();
    this.outputChannel.appendLine(`[Programmers Helper] ${path.basename(runContext.problemDir)} ${runContext.language.label} ${runContext.isCustomRun ? "커스텀" : "샘플"} 테스트`);
    this.outputChannel.appendLine(`[Programmers Helper] Source: ${path.relative(runContext.problemDir, runContext.solutionPath) || runContext.language.solutionFileName}`);
    this.outputChannel.appendLine(`[Programmers Helper] Execution mode: ${runContext.settings.executionMode === "docker" ? `docker (${DOCKER_IMAGE})` : "local"}`);
    this.outputChannel.appendLine(`[Programmers Helper] Compiler: ${runContext.language.compilerSettingsLabel(runContext.settings)}`);
    this.outputChannel.appendLine(`[Programmers Helper] Memory mode: ${describeMemoryOptions(runContext.memoryOptions)}`);
    this.outputChannel.appendLine("");
  }

  throwIfStopped() {
    if (this.stopRequested) {
      throw new Error("테스트 실행이 중지되었습니다.");
    }
  }
}

async function cleanupDebugArtifact(runContext) {
  if (runContext.language.id !== "cpp") {
    return;
  }

  await deleteIfExists(path.join(runContext.problemDir, runContext.debugArtifactPath));
}

async function deleteIfExists(filePath) {
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
  } catch {
    // Debug artifacts are best-effort cleanup.
  }
}

module.exports = {
  TestRunner,
};
