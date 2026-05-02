const crypto = require("crypto");
const path = require("path");
const vscode = require("vscode");
const {
  readText,
} = require("../problems/problemStore");
const {
  ARTIFACTS_DIR_NAME,
  HELPER_DIR_NAME,
  GENERATED_DIR_NAME,
  RUNNERS_DIR_NAME,
  fingerprintPath,
} = require("../problems/helperPaths");


// runner/solution/settings 조합이 바뀌었는지 확인할 cache fingerprint를 만듭니다.
function createRunnerFingerprint(runnerCode, solutionCode, compileFlags, includePath, settings, languageId) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: 4,
      languageId,
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


// 생성 runner 파일이 실제로 바뀐 경우에만 디스크에 씁니다.
async function writeFileIfChanged(filePath, contents) {
  await ensureParentDirectory(filePath);
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


// 생성 파일을 쓰기 전에 부모 디렉터리가 존재하도록 만듭니다.
async function ensureParentDirectory(filePath) {
  const parent = path.dirname(filePath);
  if (parent && parent !== filePath) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(parent));
  }
}


// 컴파일 artifact와 fingerprint가 현재 실행 컨텍스트와 일치하는지 확인합니다.
async function isCompiledRunnerFresh(problemDir, binaryPath, fingerprint) {
  try {
    const artifactPath = path.join(problemDir, binaryPath);
    await vscode.workspace.fs.stat(vscode.Uri.file(artifactPath));
    if (isJavaClassesArtifact(binaryPath)) {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(artifactPath, "TestRunner.class")));
    }
    const metadata = await readJsonFile(getFingerprintPath(problemDir, undefined, binaryPath));
    return metadata?.fingerprint === fingerprint;
  } catch {
    return false;
  }
}


// 언어와 artifact 종류에 맞는 fingerprint metadata 파일 경로를 계산합니다.
function getFingerprintPath(problemDir, languageId, artifactRelativePath) {
  const normalized = String(artifactRelativePath || "").split(path.win32.sep).join(path.posix.sep);
  const artifactRoot = path.posix.join(HELPER_DIR_NAME, GENERATED_DIR_NAME, ARTIFACTS_DIR_NAME);
  let fileName = `${languageId || path.posix.basename(normalized)}.json`;
  if (normalized.startsWith(path.posix.join(artifactRoot, "cpp-fast"))) {
    fileName = "cpp-fast.json";
  } else if (normalized.startsWith(path.posix.join(artifactRoot, "cpp-debug"))) {
    fileName = "cpp-debug.json";
  } else if (normalized === path.posix.join(artifactRoot, "java-classes")) {
    fileName = "java.json";
  } else if (normalized === path.posix.join(HELPER_DIR_NAME, GENERATED_DIR_NAME, RUNNERS_DIR_NAME, "test_runner.py")) {
    fileName = "python.json";
  }
  return fingerprintPath(problemDir, fileName);
}


// artifact 경로가 Java class output 폴더인지 판단합니다.
function isJavaClassesArtifact(artifactRelativePath) {
  const normalized = String(artifactRelativePath || "").split(path.win32.sep).join(path.posix.sep);
  return normalized === path.posix.join(HELPER_DIR_NAME, GENERATED_DIR_NAME, ARTIFACTS_DIR_NAME, "java-classes");
}


// container 내부 문제 경로 기준으로 runner 실행 파일의 상대 경로를 계산합니다.
function getDockerRunnerRelativePath(runtime, runContext) {
  if (runContext.language.id === "python") {
    return path.posix.relative(runtime.problemPath, path.posix.join(runtime.problemPath, runContext.fastArtifactPath));
  }
  return path.posix.relative(
    runtime.problemPath,
    path.posix.join(runtime.problemPath, HELPER_DIR_NAME, GENERATED_DIR_NAME, RUNNERS_DIR_NAME, runContext.language.runnerFileName)
  );
}


// runner cache metadata JSON을 읽고 실패하면 undefined로 처리합니다.
async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readText(vscode.Uri.file(filePath)));
  } catch {
    return undefined;
  }
}


// runner cache metadata JSON을 보기 좋은 형식으로 저장합니다.
async function writeJsonFile(filePath, value) {
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(filePath),
    Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8")
  );
}

module.exports = {
  createRunnerFingerprint,
  writeFileIfChanged,
  ensureParentDirectory,
  isCompiledRunnerFresh,
  getFingerprintPath,
  isJavaClassesArtifact,
  getDockerRunnerRelativePath,
  readJsonFile,
  writeJsonFile,
};
