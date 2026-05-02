const path = require("path");
const {
  JAVA_COMMAND,
  PYTHON_COMMAND,
} = require("../core/config");
const {
  buildProcessFailureError,
} = require("./errorFormatting");
const {
  buildLocalExecutionEnv,
  formatDisplayOutput,
  formatTimeoutCommandSeconds,
  formatTimeoutLimitLabel,
} = require("./testRunnerOutput");

const TEST_PROCESS_TIMEOUT_GRACE_MS = 2000;
const MAX_CAPTURE_OUTPUT_CHARS = 100000;

// 컴파일된 runner artifact를 테스트 케이스 단위로 실행합니다.
class TestRunnerExecutor {
  constructor(runner, runtime) {
    this.runner = runner;
    this.runtime = runtime;
  }

  async runTestArtifact(runtime, runContext, artifactPath, testIndex, options = {}) {
    if (runContext.language.id === "java") {
      return this.runJavaTest(runtime, runContext, artifactPath, testIndex, options);
    }
    if (runContext.language.id === "python") {
      return this.runPythonTest(runtime, runContext, artifactPath, testIndex, options);
    }
    return this.runTestBinary(runtime, runContext.problemDir, artifactPath, testIndex, runContext.settings, options);
  }

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

      result = await this.runtime.execFile("docker", command, problemDir, {
        ...options,
        resolveWithStatus: true,
        streamOutput: false,
        streamStderr: false,
        timeoutMs: testTimeoutMs + TEST_PROCESS_TIMEOUT_GRACE_MS,
        maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
      });
    } else {
      try {
        result = await this.runtime.execFile(path.join(problemDir, binaryPath), [String(testIndex)], problemDir, {
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

    return this.formatProcessResult(result, settings.executionMode === "docker" ? "docker" : binaryPath, testIndex, timeoutLabel, options);
  }

  async runPythonTest(runtime, runContext, artifactPath, testIndex, options = {}) {
    const testTimeoutMs = options.timeoutMs || runContext.settings.testTimeoutMs;
    const timeoutSeconds = Math.max(0.1, testTimeoutMs / 1000);
    const timeoutLabel = formatTimeoutLimitLabel(testTimeoutMs);
    let result;

    if (runContext.settings.executionMode === "docker") {
      result = await this.runtime.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        "env",
        "LANG=C.UTF-8",
        "LC_ALL=C.UTF-8",
        "PYTHONDONTWRITEBYTECODE=1",
        "timeout",
        "--signal=TERM",
        "--kill-after=1s",
        `${formatTimeoutCommandSeconds(timeoutSeconds)}s`,
        PYTHON_COMMAND,
        artifactPath,
        String(testIndex),
      ], runContext.problemDir, {
        ...options,
        resolveWithStatus: true,
        streamOutput: false,
        streamStderr: false,
        timeoutMs: testTimeoutMs + TEST_PROCESS_TIMEOUT_GRACE_MS,
        maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
      });
    } else {
      try {
        await this.runtime.ensureLocalCommandAvailable(PYTHON_COMMAND, runContext.problemDir, "Python 실행기 확인");
        result = await this.runtime.execFile(PYTHON_COMMAND, [
          artifactPath,
          String(testIndex),
        ], runContext.problemDir, {
          ...options,
          resolveWithStatus: true,
          streamOutput: false,
          streamStderr: false,
          timeoutMs: testTimeoutMs,
          maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
          env: {
            PYTHONDONTWRITEBYTECODE: "1",
          },
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

    return this.formatProcessResult(result, runContext.settings.executionMode === "docker" ? "docker" : PYTHON_COMMAND, testIndex, timeoutLabel, options);
  }

  async runJavaTest(runtime, runContext, artifactPath, testIndex, options = {}) {
    const testTimeoutMs = options.timeoutMs || runContext.settings.testTimeoutMs;
    const timeoutSeconds = Math.max(0.1, testTimeoutMs / 1000);
    const timeoutLabel = formatTimeoutLimitLabel(testTimeoutMs);
    let result;

    if (runContext.settings.executionMode === "docker") {
      result = await this.runtime.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        "env",
        "LANG=C.UTF-8",
        "LC_ALL=C.UTF-8",
        "timeout",
        "--signal=TERM",
        "--kill-after=1s",
        `${formatTimeoutCommandSeconds(timeoutSeconds)}s`,
        JAVA_COMMAND,
        "-cp",
        artifactPath,
        "TestRunner",
        String(testIndex),
      ], runContext.problemDir, {
        ...options,
        resolveWithStatus: true,
        streamOutput: false,
        streamStderr: false,
        timeoutMs: testTimeoutMs + TEST_PROCESS_TIMEOUT_GRACE_MS,
        maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
      });
    } else {
      try {
        await this.runtime.ensureLocalCommandAvailable(JAVA_COMMAND, runContext.problemDir, "Java 실행기 확인");
        result = await this.runtime.execFile(JAVA_COMMAND, [
          "-cp",
          artifactPath,
          "TestRunner",
          String(testIndex),
        ], runContext.problemDir, {
          ...options,
          resolveWithStatus: true,
          streamOutput: false,
          streamStderr: false,
          timeoutMs: testTimeoutMs,
          maxCaptureOutputChars: MAX_CAPTURE_OUTPUT_CHARS,
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

    return this.formatProcessResult(result, runContext.settings.executionMode === "docker" ? "docker" : JAVA_COMMAND, testIndex, timeoutLabel, options);
  }

  formatProcessResult(result, commandLabel, testIndex, timeoutLabel, options) {
    if (result.code === 124 || result.code === 137) {
      return this.handleTimeoutResult(testIndex, timeoutLabel, result, options);
    }

    if (result.code !== 0) {
      throw buildProcessFailureError(commandLabel, options, result.code, result.signal, result.stderr, result.stdout, result.elapsedMs);
    }

    const displayed = formatDisplayOutput(result.stderr + result.stdout, result.stdoutTruncated || result.stderrTruncated);
    if (options.streamOutput && displayed) {
      this.runner.outputChannel.append(displayed);
    } else if (options.streamStderr && !options.streamSanitizedRuntime && result.stderr) {
      this.runner.outputChannel.append(formatDisplayOutput(result.stderr, result.stderrTruncated));
    }

    return displayed;
  }

  handleTimeoutResult(testIndex, timeoutLabel, result, options) {
    const line = `[TIMEOUT] #${testIndex} time=${result.elapsedMs}ms limit=${timeoutLabel}`;
    const displayed = formatDisplayOutput(result.stderr + result.stdout, result.stdoutTruncated || result.stderrTruncated);
    const outputText = `${line}\n${displayed}`;
    if (options.streamOutput) {
      this.runner.outputChannel.appendLine(line);
      if (displayed) {
        this.runner.outputChannel.append(displayed);
      }
    }
    return outputText;
  }
}

module.exports = {
  TestRunnerExecutor,
};
