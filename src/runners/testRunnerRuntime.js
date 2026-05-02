const cp = require("child_process");
const vscode = require("vscode");
const {
  JAVAC_COMMAND,
  PYTHON_COMMAND,
} = require("../core/config");
const {
  ensureDockerRuntimeReady,
} = require("./dockerRuntime");
const {
  buildProcessFailureError,
} = require("./errorFormatting");
const {
  appendCapturedOutput,
  isSanitizerToolchainError,
} = require("./testRunnerOutput");

// 테스트 실행에 필요한 Docker/local 런타임과 child process 실행을 관리합니다.
class TestRunnerRuntime {
  constructor(runner) {
    this.runner = runner;
  }

  async ensureRuntimeReady(problemDir, runContext) {
    if (runContext.settings.executionMode === "docker") {
      return ensureDockerRuntimeReady({
        vscode,
        extensionDir: this.runner.extensionDir,
        problemDir,
        execCommand: this.runner.execCommand,
        postStatus: (message) => this.runner.postStatus?.({ ...message, problemDir: message.problemDir || problemDir }),
      });
    }

    if (runContext.language.id === "java") {
      await this.ensureLocalCommandAvailable(JAVAC_COMMAND, problemDir, "Java 컴파일러 확인");
    } else if (runContext.language.id === "python") {
      await this.ensureLocalCommandAvailable(PYTHON_COMMAND, problemDir, "Python 실행기 확인");
    } else {
      await this.ensureLocalCommandAvailable(runContext.settings.compilerCommand, problemDir, "컴파일러 확인");
    }
    return {
      kind: "local",
      compilerCommand: runContext.language.compilerSettingsLabel(runContext.settings),
    };
  }

  async ensureLocalCommandAvailable(command, cwd, label) {
    try {
      await this.execFile(command, ["--version"], cwd, {
        timeoutMs: 5000,
        label,
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`컴파일 실패\n${command} 명령어를 찾지 못했습니다.\nVS Code 설정에서 실행 명령을 바꾸거나 ${command}를 설치해주세요.`);
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

  execFile(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.runner.stopRequested) {
        reject(new Error("테스트 실행이 중지되었습니다."));
        return;
      }

      const startedAt = Date.now();
      const child = cp.spawn(command, args, {
        cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
      this.runner.activeTestProcess = child;
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
          this.runner.outputChannel.append(text);
        }
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        const captured = appendCapturedOutput(stderr, text, options.maxCaptureOutputChars);
        stderr = captured.text;
        stderrTruncated = stderrTruncated || captured.truncated;
        if (options.streamStderr && !options.streamSanitizedRuntime) {
          this.runner.outputChannel.append(text);
        }
      });
      child.on("error", (error) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        if (this.runner.activeTestProcess === child) {
          this.runner.activeTestProcess = undefined;
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
        if (this.runner.activeTestProcess === child) {
          this.runner.activeTestProcess = undefined;
        }
        if (this.runner.stopRequested) {
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

module.exports = {
  TestRunnerRuntime,
};
