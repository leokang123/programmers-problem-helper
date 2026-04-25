const cp = require("child_process");
const path = require("path");
const vscode = require("vscode");
const {
  COMPILE_TIMEOUT_MS,
  DOCKER_DEBUG_COMPILE_FLAGS,
  DOCKER_FAST_COMPILE_FLAGS,
  DOCKER_IMAGE,
  TEST_TIMEOUT_MS,
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
  extractExamplesFromMarkdown,
} = require("./problemParsing");
const {
  readText,
} = require("./problemStore");

const TEST_PROCESS_TIMEOUT_GRACE_MS = 2000;
const MAX_DISPLAY_OUTPUT_CHARS = 20000;
const MAX_CAPTURE_OUTPUT_CHARS = 100000;

// C++ 테스트 실행 상태와 Docker 실행을 관리합니다.
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
    const mdPath = path.join(problemDir, "problem.md");
    const cppPath = selectedCppPath || path.join(problemDir, "solution.cpp");
    const md = await readText(vscode.Uri.file(mdPath));
    const cpp = await readText(vscode.Uri.file(cppPath));
    const examples = customTestsText.trim() ? parseCustomTests(customTestsText) : extractExamplesFromMarkdown(md);
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
    const runnerCode = buildRunner(signature, examples, includePath);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(runnerPath), Buffer.from(runnerCode, "utf8"));

    this.outputChannel.clear();
    this.outputChannel.appendLine(`[Programmers Helper] ${path.basename(problemDir)} ${customTestsText.trim() ? "커스텀" : "샘플"} 테스트`);
    this.outputChannel.appendLine(`[Programmers Helper] Source: ${path.relative(problemDir, cppPath) || "solution.cpp"}`);
    this.outputChannel.appendLine(`[Programmers Helper] Docker runtime: ${DOCKER_IMAGE}`);
    this.outputChannel.appendLine("");

    const runtime = await this.ensureDockerRuntimeReady(problemDir);
    this.clearProblemDiagnostics(problemDir);
    try {
      await this.compileRunner(runtime, problemDir, runnerPath, fastBinaryPath, DOCKER_FAST_COMPILE_FLAGS, "컴파일");
    } catch (error) {
      this.applyCompilerDiagnostics(problemDir, error);
      throw error;
    }
    if (this.stopRequested) {
      throw new Error("테스트 실행이 중지되었습니다.");
    }

    let output = "";
    let debugBinaryReady = false;
    for (let index = 0; index < examples.length; index++) {
      if (this.stopRequested) {
        throw new Error("테스트 실행이 중지되었습니다.");
      }

      try {
        output += await this.runTestBinary(runtime, problemDir, fastBinaryPath, index + 1, {
          label: `테스트 #${index + 1}`,
          timeoutMs: TEST_TIMEOUT_MS,
          streamOutput: true,
          streamStderr: false,
          streamSanitizedRuntime: false,
        });
      } catch (error) {
        if (!shouldRetryWithSanitizer(error)) {
          throw error;
        }

        if (!debugBinaryReady) {
          try {
            await this.compileRunner(runtime, problemDir, runnerPath, debugBinaryPath, DOCKER_DEBUG_COMPILE_FLAGS, "디버그 컴파일");
            debugBinaryReady = true;
          } catch (compileError) {
            this.applyCompilerDiagnostics(problemDir, compileError);
            throw compileError;
          }
        }

        try {
          const debugOutput = await this.runTestBinary(runtime, problemDir, debugBinaryPath, index + 1, {
            label: `테스트 #${index + 1}`,
            timeoutMs: TEST_TIMEOUT_MS,
            streamOutput: false,
            streamSanitizedRuntime: true,
            debugEnv: true,
          });
          if (hasSanitizerOutput(debugOutput)) {
            throw buildProcessFailureError("docker", { label: `테스트 #${index + 1}` }, 1, undefined, debugOutput, "", 0);
          }
          throw error;
        } catch (debugError) {
          throw debugError;
        }
      }
    }

    const passed = (output.match(/\[PASS\]/g) || []).length;
    const failed = (output.match(/\[FAIL\]/g) || []).length + (output.match(/\[TIMEOUT\]/g) || []).length;
    const summary = `테스트 완료: ${passed} 통과, ${failed} 실패`;
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(summary);
    vscode.window.showInformationMessage(summary);
    return { summary, passed, failed };
  }

  // 해당 문제의 진단 메시지를 지웁니다.
  clearProblemDiagnostics(problemDir) {
    this.diagnosticCollection?.delete(vscode.Uri.file(path.join(problemDir, "solution.cpp")));
  }

  // 컴파일 오류를 VS Code 진단으로 표시합니다.
  applyCompilerDiagnostics(problemDir, error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("clang++ 실패")) {
      return;
    }

    const solutionUri = vscode.Uri.file(path.join(problemDir, "solution.cpp"));
    const diagnostics = parseCompilerDiagnostics(vscode, message, solutionUri);
    if (diagnostics.length > 0) {
      this.diagnosticCollection?.set(solutionUri, diagnostics);
    }
  }

  // 생성된 C++ 러너를 컴파일합니다.
  async compileRunner(runtime, problemDir, runnerPath, outputBinaryPath, compileFlags, label) {
    await this.execFile("docker", [
      "exec",
      "-i",
      "-w",
      runtime.problemPath,
      runtime.containerName,
      "clang++",
      ...compileFlags,
      path.posix.relative(runtime.problemPath, path.posix.join(runtime.problemPath, ".programmers-helper", "test_runner.cpp")),
      "-o",
      outputBinaryPath,
    ], problemDir, {
      timeoutMs: COMPILE_TIMEOUT_MS,
      label,
    });

    return this.execFile("docker", [
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
  }

  // 컴파일된 테스트 바이너리를 한 케이스만 실행합니다.
  async runTestBinary(runtime, problemDir, binaryPath, testIndex, options = {}) {
    const testTimeoutMs = options.timeoutMs || TEST_TIMEOUT_MS;
    const seconds = Math.max(1, Math.ceil(testTimeoutMs / 1000));
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
      `${seconds}s`,
      binaryPath.startsWith(".") ? binaryPath : `./${binaryPath}`,
      String(testIndex)
    );

    const result = await this.execFile("docker", command, problemDir, {
      ...options,
      resolveWithStatus: true,
      streamOutput: false,
      streamStderr: false,
      timeoutMs: testTimeoutMs + TEST_PROCESS_TIMEOUT_GRACE_MS,
      maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
    });

    if (result.code === 124 || result.code === 137) {
      const line = `[TIMEOUT] #${testIndex} time=${result.elapsedMs}ms limit=${seconds}s`;
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

    if (result.code !== 0) {
      throw buildProcessFailureError("docker", options, result.code, result.signal, result.stderr, result.stdout, result.elapsedMs);
    }

    const displayed = formatDisplayOutput(result.stderr + result.stdout, result.stdoutTruncated || result.stderrTruncated);
    if (options.streamOutput && displayed) {
      this.outputChannel.append(displayed);
    } else if (options.streamStderr && !options.streamSanitizedRuntime && result.stderr) {
      this.outputChannel.append(formatDisplayOutput(result.stderr, result.stderrTruncated));
    }

    return displayed;
  }

  // Docker 런타임 준비를 위임합니다.
  async ensureDockerRuntimeReady(problemDir) {
    return ensureDockerRuntimeReadyModule({
      vscode,
      extensionDir: this.extensionDir,
      problemDir,
      execCommand: this.execCommand,
    });
  }

  // 자식 프로세스를 실행하고 결과를 캡처합니다.
  execFile(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.stopRequested) {
        reject(new Error("테스트 실행이 중지되었습니다."));
        return;
      }

      const startedAt = Date.now();
      const child = cp.spawn(command, args, { cwd });
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
        if (timeout) clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        if (this.activeTestProcess === child) {
          this.activeTestProcess = undefined;
        }
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (timeout) clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
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
  if (!maxChars || current.length >= maxChars) {
    return { text: current, truncated: Boolean(maxChars) };
  }

  const remaining = maxChars - current.length;
  if (chunk.length <= remaining) {
    return { text: current + chunk, truncated: false };
  }

  return { text: current + chunk.slice(0, remaining), truncated: true };
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
