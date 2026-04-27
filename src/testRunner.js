const cp = require("child_process");
const crypto = require("crypto");
const path = require("path");
const vscode = require("vscode");
const {
  COMPILE_TIMEOUT_MS,
  DOCKER_IMAGE,
  getDebugCompileFlagsForMode,
  getFastCompileFlags,
} = require("./config");
const {
  buildRunner,
  parseCustomTests,
  parseSolutionSignature,
} = require("./cppRunnerBuilder");
const {
  ensureDockerRuntimeReady: ensureDockerRuntimeReadyModule,
} = require("./dockerRuntime");
const {
  buildProcessFailureError,
  formatTestErrorForPanel,
  formatTestErrorForStatus,
  parseCompilerDiagnostics,
} = require("./errorFormatting");
const {
  loadProblemExamples,
  readText,
} = require("./problemStore");
const {
  getExecutionSettings,
} = require("./settings");

const TEST_PROCESS_TIMEOUT_GRACE_MS = 2000;
const MAX_DISPLAY_OUTPUT_CHARS = 20000;
const MAX_CAPTURE_OUTPUT_CHARS = 100000;

// C++ 테스트 실행 상태와 실행 환경을 관리합니다.
class TestRunner {
  // 출력 채널과 실행 의존성을 주입합니다.
  constructor({ outputChannel, diagnosticCollection, extensionDir, execCommand, postStatus }) {
    this.outputChannel = outputChannel;
    this.diagnosticCollection = diagnosticCollection;
    this.extensionDir = extensionDir;
    this.execCommand = execCommand;
    this.postStatus = postStatus;
    this.activeTestProcess = undefined;
    this.testRunInProgress = false;
    this.stopRequested = false;
  }

  // 명령 호출에서 테스트 실행 전체 흐름을 처리합니다.
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
    this.postStatus?.({ type: "testRunning", running: true });

    try {
      const hasCustomTests = customTestsText.trim().length > 0;
      this.postStatus?.({ type: "status", kind: "running", text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 실행 중...` });
      const result = await this.runSamples(target.problemDir, customTestsText, target.cppPath);
      this.postStatus?.({
        type: "status",
        kind: result.failed === 0 ? "ready" : "error",
        text: `${hasCustomTests ? "커스텀" : "샘플"} 테스트 완료\n\n${result.summary}`,
      });
      this.outputChannel.show(true);
    } catch (error) {
      const panelMessage = formatTestErrorForPanel(error);
      this.outputChannel.appendLine("");
      this.outputChannel.appendLine(`[Programmers Helper] ${panelMessage}`);
      this.outputChannel.show(true);
      this.postStatus?.({ type: "status", kind: "error", text: `테스트 실행 오류\n\n${formatTestErrorForStatus(error)}` });
      vscode.window.showErrorMessage(formatTestErrorForStatus(error));
    } finally {
      this.activeTestProcess = undefined;
      this.testRunInProgress = false;
      this.stopRequested = false;
      this.postStatus?.({ type: "testRunning", running: false });
    }
  }

  // 실행 중인 테스트 프로세스를 중지합니다.
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
    this.postStatus?.({ type: "status", kind: "error", text: "테스트 실행 중지 요청\n\n현재 실행 중인 프로세스를 종료하고 있습니다." });
  }

  // 테스트 러너를 생성하고 각 예제를 실행합니다.
  async runSamples(problemDir, customTestsText = "", selectedCppPath) {
    const runContext = await this.prepareTestRunContext(problemDir, customTestsText, selectedCppPath);
    this.writeRunHeader(runContext);
    const runtime = await this.ensureRuntimeReady(problemDir, runContext.settings);
    this.clearProblemDiagnostics(runContext.cppPath);
    try {
      await this.compileRunner(runtime, problemDir, runContext.fastBinaryPath, runContext.fastCompileFlags, "컴파일", runContext.fastFingerprint, runContext.settings);
    } catch (error) {
      this.applyCompilerDiagnostics(runContext.cppPath, error);
      throw error;
    }
    if (this.stopRequested) {
      throw new Error("테스트 실행이 중지되었습니다.");
    }

    let passed = 0;
    let failed = 0;
    let debugBinaryReady = false;
    for (let index = 0; index < runContext.examples.length; index++) {
      if (this.stopRequested) {
        throw new Error("테스트 실행이 중지되었습니다.");
      }

      try {
        const testOutput = await this.runTestBinary(runtime, problemDir, runContext.fastBinaryPath, index + 1, runContext.settings, {
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
        if (!shouldRetryWithSanitizer(error)) {
          throw error;
        }

        if (!debugBinaryReady) {
          try {
            await this.compileRunner(runtime, problemDir, runContext.debugBinaryPath, runContext.debugCompileFlags, "디버그 컴파일", runContext.debugFingerprint, runContext.settings);
            debugBinaryReady = true;
          } catch (compileError) {
            if (this.shouldSkipSanitizerFallback(runContext.settings, compileError)) {
              this.outputChannel.appendLine("[Programmers Helper] 로컬 sanitizer fallback을 사용할 수 없어 원래 런타임 에러를 유지합니다.");
              throw error;
            }
            this.applyCompilerDiagnostics(runContext.cppPath, compileError);
            throw compileError;
          }
        }

        try {
          const debugOutput = await this.runTestBinary(runtime, problemDir, runContext.debugBinaryPath, index + 1, runContext.settings, {
            label: `테스트 #${index + 1}`,
            timeoutMs: runContext.settings.testTimeoutMs,
            streamOutput: false,
            streamSanitizedRuntime: true,
            debugEnv: runContext.settings.executionMode === "docker",
          });
          if (hasSanitizerOutput(debugOutput)) {
            throw buildProcessFailureError(runContext.settings.executionMode === "docker" ? "docker" : runContext.debugBinaryPath, { label: `테스트 #${index + 1}` }, 1, undefined, debugOutput, "", 0);
          }
          throw error;
        } catch (debugError) {
          throw debugError;
        }
      }
    }

    const summary = `테스트 완료: ${passed} 통과, ${failed} 실패`;
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(summary);
    vscode.window.showInformationMessage(summary);
    return { summary, passed, failed };
  }

  // 테스트 실행에 필요한 설정, 예제, 생성 파일 경로, fingerprint를 한 번에 준비합니다.
  // runSamples는 이 결과를 실행 순서에만 사용하고, 준비 세부사항은 이 함수 안에 둔다.
  async prepareTestRunContext(problemDir, customTestsText = "", selectedCppPath) {
    const settings = getExecutionSettings();
    const fastCompileFlags = getFastCompileFlags(settings.cppStandard);
    const debugCompileFlags = getDebugCompileFlagsForMode(settings.executionMode, settings.cppStandard);
    const cppPath = selectedCppPath || path.join(problemDir, "solution.cpp");
    const cpp = await readText(vscode.Uri.file(cppPath));
    const examples = customTestsText.trim() ? parseCustomTests(customTestsText) : await loadProblemExamples(problemDir);
    const signature = parseSolutionSignature(cpp);

    if (examples.length === 0) {
      throw new Error(customTestsText.trim() ? "커스텀 테스트케이스가 비어 있습니다." : "problem.md에서 입출력 예를 찾지 못했습니다.");
    }
    if (!signature) {
      throw new Error(`${path.basename(cppPath)}에서 solution 함수 시그니처를 찾지 못했습니다.`);
    }

    const runnerDir = path.join(problemDir, ".programmers-helper");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(runnerDir));
    const runnerPath = path.join(runnerDir, "test_runner.cpp");
    const fastBinaryPath = ".programmers-helper/test_runner_fast";
    const debugBinaryPath = ".programmers-helper/test_runner_debug";
    const includePath = path.relative(runnerDir, cppPath).split(path.sep).join(path.posix.sep);
    const memoryOptions = this.resolveRunnerMemoryOptions(settings);
    const runnerCode = buildRunner(signature, examples, includePath, memoryOptions);
    const fastFingerprint = createRunnerFingerprint(runnerCode, cpp, fastCompileFlags, includePath, settings);
    const debugFingerprint = createRunnerFingerprint(runnerCode, cpp, debugCompileFlags, includePath, settings);
    await writeFileIfChanged(runnerPath, runnerCode);

    return {
      settings,
      problemDir,
      fastCompileFlags,
      debugCompileFlags,
      cppPath,
      examples,
      memoryOptions,
      fastBinaryPath,
      debugBinaryPath,
      fastFingerprint,
      debugFingerprint,
      isCustomRun: customTestsText.trim().length > 0,
    };
  }

  // Output 패널의 실행 헤더만 담당합니다.
  writeRunHeader(runContext) {
    this.outputChannel.clear();
    this.outputChannel.appendLine(`[Programmers Helper] ${path.basename(runContext.problemDir)} ${runContext.isCustomRun ? "커스텀" : "샘플"} 테스트`);
    this.outputChannel.appendLine(`[Programmers Helper] Source: ${path.relative(runContext.problemDir, runContext.cppPath) || "solution.cpp"}`);
    this.outputChannel.appendLine(`[Programmers Helper] Execution mode: ${runContext.settings.executionMode === "docker" ? `docker (${DOCKER_IMAGE})` : "local"}`);
    this.outputChannel.appendLine(`[Programmers Helper] Compiler: ${runContext.settings.compilerCommand} -std=${runContext.settings.cppStandard}`);
    this.outputChannel.appendLine(`[Programmers Helper] Memory mode: ${describeMemoryOptions(runContext.memoryOptions)}`);
    this.outputChannel.appendLine("");
  }

  // 해당 문제의 진단 메시지를 지웁니다.
  clearProblemDiagnostics(cppPath) {
    this.diagnosticCollection?.delete(vscode.Uri.file(cppPath));
  }

  // 컴파일 오류를 VS Code 진단으로 표시합니다.
  applyCompilerDiagnostics(cppPath, error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("컴파일 실패")) {
      return;
    }

    const solutionUri = vscode.Uri.file(cppPath);
    const diagnostics = parseCompilerDiagnostics(vscode, message, solutionUri);
    if (diagnostics.length > 0) {
      this.diagnosticCollection?.set(solutionUri, diagnostics);
    }
  }

  // 생성된 C++ 러너를 컴파일합니다.
  async compileRunner(runtime, problemDir, outputBinaryPath, compileFlags, label, fingerprint, settings) {
    if (fingerprint && await isCompiledRunnerFresh(problemDir, outputBinaryPath, fingerprint)) {
      this.outputChannel.appendLine(`[Programmers Helper] ${label} 생략: 기존 바이너리를 재사용합니다.`);
      return;
    }

    if (settings.executionMode === "docker") {
      await this.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        settings.compilerCommand,
        ...compileFlags,
        path.posix.relative(runtime.problemPath, path.posix.join(runtime.problemPath, ".programmers-helper", "test_runner.cpp")),
        "-o",
        outputBinaryPath,
      ], problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label,
      });

      await this.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        "chmod",
        "+x",
        outputBinaryPath,
      ], problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label: `${label} 권한 설정`,
      });
    } else {
      await this.ensureLocalCompilerAvailable(settings.compilerCommand, problemDir);
      await this.execFile(settings.compilerCommand, [
        ...compileFlags,
        path.join(".programmers-helper", "test_runner.cpp"),
        "-o",
        outputBinaryPath,
      ], problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label,
      });
    }

    if (fingerprint) {
      await writeJsonFile(path.join(problemDir, `${outputBinaryPath}.meta.json`), {
        fingerprint,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // 컴파일된 테스트 바이너리를 한 케이스만 실행합니다.
  async runTestBinary(runtime, problemDir, binaryPath, testIndex, settings, options = {}) {
    const testTimeoutMs = options.timeoutMs || settings.testTimeoutMs;
    const timeoutSeconds = Math.max(0.1, testTimeoutMs / 1000);
    const timeoutLabel = formatTimeoutLimitLabel(testTimeoutMs);
    let result;

    if (settings.executionMode === "docker") {
      const command = [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
      ];

      if (options.debugEnv) {
        command.push(
          "env",
          "ASAN_OPTIONS=symbolize=1:external_symbolizer_path=/usr/bin/llvm-symbolizer:halt_on_error=1",
          "UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1"
        );
      }

      command.push(
        "timeout",
        "--signal=TERM",
        "--kill-after=1s",
        `${formatTimeoutCommandSeconds(timeoutSeconds)}s`,
        binaryPath.startsWith(".") ? binaryPath : `./${binaryPath}`,
        String(testIndex)
      );

      result = await this.execFile("docker", command, problemDir, {
        ...options,
        resolveWithStatus: true,
        streamOutput: false,
        streamStderr: false,
        timeoutMs: testTimeoutMs + TEST_PROCESS_TIMEOUT_GRACE_MS,
        maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
      });
    } else {
      try {
        result = await this.execFile(path.join(problemDir, binaryPath), [String(testIndex)], problemDir, {
          ...options,
          resolveWithStatus: true,
          streamOutput: false,
          streamStderr: false,
          timeoutMs: testTimeoutMs,
          maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
          env: buildLocalExecutionEnv(options),
        });
      } catch (error) {
        if (error?.code === "ETIMEOUT") {
          return this.handleTimeoutResult(testIndex, timeoutLabel, {
            elapsedMs: error.elapsedMs || testTimeoutMs,
            stderr: error.stderr || "",
            stdout: error.stdout || "",
            stderrTruncated: Boolean(error.stderrTruncated),
            stdoutTruncated: Boolean(error.stdoutTruncated),
          }, options);
        }
        throw error;
      }
    }

    if (result.code === 124 || result.code === 137) {
      return this.handleTimeoutResult(testIndex, timeoutLabel, result, options);
    }

    if (result.code !== 0) {
      throw buildProcessFailureError(settings.executionMode === "docker" ? "docker" : binaryPath, options, result.code, result.signal, result.stderr, result.stdout, result.elapsedMs);
    }

    const displayed = formatDisplayOutput(result.stderr + result.stdout, result.stdoutTruncated || result.stderrTruncated);
    if (options.streamOutput && displayed) {
      this.outputChannel.append(displayed);
    } else if (options.streamStderr && !options.streamSanitizedRuntime && result.stderr) {
      this.outputChannel.append(formatDisplayOutput(result.stderr, result.stderrTruncated));
    }

    return displayed;
  }

  handleTimeoutResult(testIndex, timeoutLabel, result, options) {
    const line = `[TIMEOUT] #${testIndex} time=${result.elapsedMs}ms limit=${timeoutLabel}`;
    const displayed = formatDisplayOutput(result.stderr + result.stdout, result.stdoutTruncated || result.stderrTruncated);
    const outputText = `${line}\n${displayed}`;
    if (options.streamOutput) {
      this.outputChannel.appendLine(line);
      if (displayed) {
        this.outputChannel.append(displayed);
      }
    }
    return outputText;
  }

  // 실행 환경 준비를 위임합니다.
  async ensureRuntimeReady(problemDir, settings) {
    if (settings.executionMode === "docker") {
      return ensureDockerRuntimeReadyModule({
        vscode,
        extensionDir: this.extensionDir,
        problemDir,
        execCommand: this.execCommand,
      });
    }

    await this.ensureLocalCompilerAvailable(settings.compilerCommand, problemDir);
    return {
      kind: "local",
      compilerCommand: settings.compilerCommand,
    };
  }

  async ensureLocalCompilerAvailable(compilerCommand, cwd) {
    try {
      await this.execFile(compilerCommand, ["--version"], cwd, {
        timeoutMs: 5000,
        label: "컴파일러 확인",
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`컴파일 실패\n${compilerCommand} 명령어를 찾지 못했습니다.\nVS Code 설정에서 compilerCommand를 바꾸거나 ${compilerCommand}를 설치해주세요.`);
      }
      throw error;
    }
  }

  shouldSkipSanitizerFallback(settings, error) {
    return settings.executionMode === "local" && isSanitizerToolchainError(error);
  }

  resolveRunnerMemoryOptions(settings) {
    if (settings.executionMode === "docker") {
      return { memoryMode: "judge" };
    }

    return { memoryMode: "none" };
  }

  // 자식 프로세스를 실행하고 결과를 캡처합니다.
  execFile(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.stopRequested) {
        reject(new Error("테스트 실행이 중지되었습니다."));
        return;
      }

      const startedAt = Date.now();
      const child = cp.spawn(command, args, {
        cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
      this.activeTestProcess = child;
      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
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
        const captured = appendCapturedOutput(stdout, text, options.maxCaptureOutputChars);
        stdout = captured.text;
        stdoutTruncated = stdoutTruncated || captured.truncated;
        if (options.streamOutput) {
          this.outputChannel.append(text);
        }
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        const captured = appendCapturedOutput(stderr, text, options.maxCaptureOutputChars);
        stderr = captured.text;
        stderrTruncated = stderrTruncated || captured.truncated;
        if (options.streamStderr && !options.streamSanitizedRuntime) {
          this.outputChannel.append(text);
        }
      });
      child.on("error", (error) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        if (this.activeTestProcess === child) {
          this.activeTestProcess = undefined;
        }
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        if (this.activeTestProcess === child) {
          this.activeTestProcess = undefined;
        }
        if (this.stopRequested) {
          reject(new Error("테스트 실행이 중지되었습니다."));
          return;
        }
        if (timedOut) {
          const seconds = Math.round((options.timeoutMs || 0) / 1000);
          const elapsedMs = Date.now() - startedAt;
          const error = new Error(`${options.label || command} 시간이 초과되었습니다. (${seconds}초, ${elapsedMs}ms)\n무한루프를 확인해주세요.`);
          error.code = "ETIMEOUT";
          error.elapsedMs = elapsedMs;
          error.stdout = stdout;
          error.stderr = stderr;
          error.stdoutTruncated = stdoutTruncated;
          error.stderrTruncated = stderrTruncated;
          reject(error);
          return;
        }
        if (options.resolveWithStatus) {
          resolve({
            code,
            signal,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
            elapsedMs: Date.now() - startedAt,
          });
          return;
        }
        if (code !== 0) {
          reject(buildProcessFailureError(command, options, code, signal, stderr, stdout, Date.now() - startedAt));
          return;
        }
        resolve(stdout + stderr);
      });
    });
  }
}

// 출력 길이를 제한하고 생략 안내를 붙입니다.
function formatDisplayOutput(output, captureTruncated = false) {
  const text = String(output || "");
  const captureNote = captureTruncated ? "\n[Programmers Helper] 출력이 너무 길어 일부를 캡처하지 않았습니다.\n" : "";
  if (text.length <= MAX_DISPLAY_OUTPUT_CHARS) {
    return text + captureNote;
  }

  return `${text.slice(0, MAX_DISPLAY_OUTPUT_CHARS)}\n[Programmers Helper] 출력이 너무 길어 이후 ${text.length - MAX_DISPLAY_OUTPUT_CHARS}자를 생략했습니다.${captureNote}`;
}

// 캡처 버퍼에 최대 길이까지만 추가합니다.
function appendCapturedOutput(current, chunk, maxChars) {
  if (!maxChars) {
    return { text: current + chunk, truncated: false };
  }

  if (current.length >= maxChars) {
    return { text: current, truncated: true };
  }

  const remaining = maxChars - current.length;
  if (chunk.length <= remaining) {
    return { text: current + chunk, truncated: false };
  }

  return { text: current + chunk.slice(0, remaining), truncated: true };
}

function createRunnerFingerprint(runnerCode, solutionCode, compileFlags, includePath, settings) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: 3,
      runnerCode,
      solutionCode,
      includePath,
      compileFlags,
      compilerCommand: settings.compilerCommand,
      cppStandard: settings.cppStandard,
      executionMode: settings.executionMode,
    }))
    .digest("hex");
}

async function writeFileIfChanged(filePath, contents) {
  try {
    const current = await readText(vscode.Uri.file(filePath));
    if (current === contents) {
      return;
    }
  } catch {
    // 파일이 없거나 읽을 수 없으면 아래에서 새로 씁니다.
  }

  await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(contents, "utf8"));
}

async function isCompiledRunnerFresh(problemDir, binaryPath, fingerprint) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path.join(problemDir, binaryPath)));
    const metadata = await readJsonFile(path.join(problemDir, `${binaryPath}.meta.json`));
    return metadata?.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readText(vscode.Uri.file(filePath)));
  } catch {
    return undefined;
  }
}

async function writeJsonFile(filePath, value) {
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(filePath),
    Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8")
  );
}

function countTestResultOutput(output) {
  const text = String(output || "");
  return {
    passed: (text.match(/\[PASS\]/g) || []).length,
    failed: (text.match(/\[FAIL\]/g) || []).length + (text.match(/\[TIMEOUT\]/g) || []).length,
  };
}

// 런타임 오류를 sanitizer로 재시도할지 판단합니다.
function shouldRetryWithSanitizer(error) {
  if (!error) {
    return false;
  }

  if (typeof error.signal === "string" && error.signal) {
    return true;
  }

  return typeof error.exitCode === "number" && error.exitCode !== 0;
}

// sanitizer 출력이 포함됐는지 확인합니다.
function hasSanitizerOutput(output) {
  return /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:/i.test(String(output || ""));
}

function isSanitizerToolchainError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /libclang_rt\.asan|libclang_rt\.ubsan|cannot find -lasan|cannot find -lubsan|sanitizer/i.test(message);
}

function buildLocalExecutionEnv(options) {
  if (!options.debugEnv) {
    return undefined;
  }

  return {
    ASAN_OPTIONS: "symbolize=1:halt_on_error=1",
    UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1",
  };
}

function formatTimeoutCommandSeconds(seconds) {
  return Number(seconds.toFixed(3)).toString();
}

function formatTimeoutLimitLabel(timeoutMs) {
  return `${(timeoutMs / 1000).toFixed(1)}s`;
}

function describeMemoryOptions(memoryOptions) {
  if (memoryOptions.memoryMode === "judge") {
    return "judge-like";
  }
  return "N/A(local)";
}

// 실행 대상을 problemDir과 cppPath로 정규화합니다.
function normalizeRunTarget(target) {
  if (!target) {
    return undefined;
  }
  if (typeof target === "string") {
    return {
      problemDir: target,
      cppPath: path.join(target, "solution.cpp"),
    };
  }
  if (typeof target.problemDir === "string") {
    return {
      problemDir: target.problemDir,
      cppPath: typeof target.cppPath === "string" ? target.cppPath : path.join(target.problemDir, "solution.cpp"),
    };
  }
  return undefined;
}

module.exports = {
  TestRunner,
};
