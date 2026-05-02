const path = require("path");
const vscode = require("vscode");
const {
  COMPILE_TIMEOUT_MS,
  JAVAC_COMMAND,
} = require("../core/config");
const {
  runnerRelativePath,
} = require("../problems/helperPaths");
const {
  parseCompilerDiagnostics,
} = require("./errorFormatting");
const {
  ensureParentDirectory,
  getDockerRunnerRelativePath,
  getFingerprintPath,
  isCompiledRunnerFresh,
  writeJsonFile,
} = require("./testRunnerArtifacts");

// 생성된 runner를 언어와 실행 모드에 맞게 컴파일하고 diagnostic을 갱신합니다.
class TestRunnerCompiler {
  constructor(runner, runtime) {
    this.runner = runner;
    this.runtime = runtime;
  }

  clearProblemDiagnostics(solutionPath) {
    this.runner.diagnosticCollection?.delete(vscode.Uri.file(solutionPath));
  }

  applyCompilerDiagnostics(solutionPath, error, languageId) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("컴파일 실패")) {
      return;
    }

    const solutionUri = vscode.Uri.file(solutionPath);
    const diagnostics = parseCompilerDiagnostics(vscode, message, solutionUri, languageId);
    if (diagnostics.length > 0) {
      this.runner.diagnosticCollection?.set(solutionUri, diagnostics);
    }
  }

  async compileRunner(runtime, runContext, outputArtifactPath, compileFlags, label, fingerprint) {
    if (fingerprint && await isCompiledRunnerFresh(runContext.problemDir, outputArtifactPath, fingerprint)) {
      this.runner.outputChannel.appendLine(`[Programmers Helper] ${label} 생략: 기존 실행 산출물을 재사용합니다.`);
      return;
    }

    await ensureParentDirectory(path.join(runContext.problemDir, outputArtifactPath));

    if (runContext.language.id === "python") {
      this.runner.outputChannel.appendLine(`[Programmers Helper] ${label} 생략: Python은 별도 컴파일 없이 생성된 runner를 실행합니다.`);
    } else if (runContext.language.id === "java") {
      await this.compileJavaRunner(runtime, runContext, outputArtifactPath, label);
    } else if (runContext.settings.executionMode === "docker") {
      await this.runtime.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        runContext.settings.compilerCommand,
        ...compileFlags,
        getDockerRunnerRelativePath(runtime, runContext),
        "-o",
        outputArtifactPath,
      ], runContext.problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label,
      });

      await this.runtime.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        "chmod",
        "+x",
        outputArtifactPath,
      ], runContext.problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label: `${label} 권한 설정`,
      });
    } else {
      await this.runtime.ensureLocalCommandAvailable(runContext.settings.compilerCommand, runContext.problemDir, "컴파일러 확인");
      await this.runtime.execFile(runContext.settings.compilerCommand, [
        ...compileFlags,
        runnerRelativePath(runContext.language.runnerFileName),
        "-o",
        outputArtifactPath,
      ], runContext.problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label,
      });
    }

    if (fingerprint) {
      const fingerprintFilePath = getFingerprintPath(runContext.problemDir, runContext.language.id, outputArtifactPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fingerprintFilePath)));
      await writeJsonFile(fingerprintFilePath, {
        fingerprint,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async compileJavaRunner(runtime, runContext, outputArtifactPath, label) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(runContext.problemDir, outputArtifactPath)));
    if (runContext.settings.executionMode === "docker") {
      await this.runtime.execFile("docker", [
        "exec",
        "-i",
        "-w",
        runtime.problemPath,
        runtime.containerName,
        "env",
        "LANG=C.UTF-8",
        "LC_ALL=C.UTF-8",
        JAVAC_COMMAND,
        "-encoding",
        "UTF-8",
        "-d",
        outputArtifactPath,
        path.relative(runContext.problemDir, runContext.solutionPath).split(path.sep).join(path.posix.sep),
        getDockerRunnerRelativePath(runtime, runContext),
      ], runContext.problemDir, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        label,
      });
      return;
    }

    await this.runtime.ensureLocalCommandAvailable(JAVAC_COMMAND, runContext.problemDir, "Java 컴파일러 확인");
    await this.runtime.execFile(JAVAC_COMMAND, [
      "-encoding",
      "UTF-8",
      "-d",
      outputArtifactPath,
      path.relative(runContext.problemDir, runContext.solutionPath),
      runnerRelativePath(runContext.language.runnerFileName),
    ], runContext.problemDir, {
      timeoutMs: COMPILE_TIMEOUT_MS,
      label,
    });
  }
}

module.exports = {
  TestRunnerCompiler,
};
