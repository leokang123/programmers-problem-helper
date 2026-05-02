const path = require("path");
const vscode = require("vscode");
const {
  DEFAULT_LANGUAGE_ID,
  getInitialSolutionPath,
  getLegacyInitialSolutionPath,
  getLanguage,
  getLanguageIds,
  getSnapshotFileName,
  getSolutionPath,
  inferLanguageFromRunnablePath,
  isSupportedSourceExtension,
} = require("./languages");
const {
  helperPath,
  helperRelativePath,
  solutionsRelativePath,
  solutionsPath,
} = require("./helperPaths");
const {
  formatTimestamp,
  isPathInside,
  isSameOrInsidePath,
  readJson,
  readText,
  writeFileIfAbsent,
  writeJson,
} = require("./problemStoreUtils");


// 현재 풀이를 snapshot으로 남기고 초기 코드로 새 풀이를 시작합니다.
async function createSolutionAttempt(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const solutionUri = vscode.Uri.file(getSolutionPath(problemDir, language.id));
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const solutionsDir = vscode.Uri.file(solutionsPath(problemDir));
  const currentCode = await readText(solutionUri);
  const timestamp = formatTimestamp(new Date());
  const snapshotName = getSnapshotFileName(language.id, timestamp);
  const snapshotUri = vscode.Uri.joinPath(solutionsDir, snapshotName);

  await vscode.workspace.fs.createDirectory(solutionsDir);
  await vscode.workspace.fs.writeFile(snapshotUri, Buffer.from(currentCode, "utf8"));

  const history = await readSolutionHistory(problemDir);
  const nextHistory = {
    attempts: [
      {
        path: solutionsRelativePath(snapshotName),
        createdAt: new Date().toISOString(),
        label: `풀이 ${history.attempts.length + 1}`,
        language: language.id,
      },
      ...history.attempts,
    ],
  };
  await writeJson(vscode.Uri.joinPath(helperDir, "solution-history.json"), nextHistory);

  const initialCode = await loadInitialSolutionCode(problemDir, language.id);
  const resetToInitialCode = Boolean(initialCode);
  if (resetToInitialCode) {
    await vscode.workspace.fs.writeFile(solutionUri, Buffer.from(initialCode, "utf8"));
  }

  return {
    snapshotPath: snapshotUri.fsPath,
    resetToInitialCode,
  };
}


// 현재 풀이 파일을 언어별 초기 템플릿 내용으로 되돌립니다.
async function resetSolutionToInitial(problemDir, solutionPath = getSolutionPath(problemDir, DEFAULT_LANGUAGE_ID), languageId = inferLanguageFromPath(solutionPath) || DEFAULT_LANGUAGE_ID) {
  const initialCode = await loadInitialSolutionCode(problemDir, languageId);
  if (!initialCode) {
    return false;
  }

  const root = path.resolve(problemDir);
  const target = path.resolve(solutionPath);
  if (!isSameOrInsidePath(root, target) || !isSupportedSourceExtension(path.extname(target))) {
    return false;
  }

  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(target),
    Buffer.from(initialCode, "utf8")
  );
  return true;
}


// reset/new attempt에 사용할 초기 풀이 코드를 읽습니다.
async function loadInitialSolutionCode(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  try {
    return await readText(vscode.Uri.file(getInitialSolutionPath(problemDir, languageId)));
  } catch {
    try {
      return await readText(vscode.Uri.file(getLegacyInitialSolutionPath(problemDir, languageId)));
    } catch {
      // Older problem folders kept initial templates at the helper root.
    }
    const metadata = await readJson(vscode.Uri.file(helperPath(problemDir, "programmers.json")));
    const language = getLanguage(languageId);
    const languageMetadata = metadata?.languages?.[language.id];
    if (typeof languageMetadata?.initialCode === "string" && languageMetadata.initialCode.trim()) {
      return languageMetadata.initialCode;
    }
    return typeof metadata?.initialCode === "string" && metadata.initialCode.trim()
      ? metadata.initialCode
      : "";
  }
}


// Webview에서 넘어온 snapshot 상대 경로를 안전한 절대 경로로 해석합니다.
async function getSolutionSnapshotPath(problemDir, snapshotPath) {
  const history = await readSolutionHistory(problemDir);
  const found = history.attempts.find((attempt) => attempt.path === snapshotPath);
  return found ? resolveSolutionSnapshotPath(problemDir, found.path) : undefined;
}


// 선택한 다시 풀기 snapshot 파일을 삭제합니다.
async function deleteSolutionSnapshot(problemDir, snapshotPath) {
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const historyUri = vscode.Uri.joinPath(helperDir, "solution-history.json");
  const history = await readSolutionHistory(problemDir);
  const target = history.attempts.find((attempt) => attempt.path === snapshotPath);
  if (!target) {
    return false;
  }

  const snapshotFilePath = resolveSolutionSnapshotPath(problemDir, target.path);
  if (!snapshotFilePath) {
    await writeJson(historyUri, {
      attempts: history.attempts.filter((attempt) => attempt.path !== snapshotPath),
    });
    return true;
  }

  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(snapshotFilePath), { useTrash: true });
  } catch {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(snapshotFilePath), { useTrash: false });
    } catch {
      // Metadata still gets cleaned up if the file is already gone.
    }
  }

  await writeJson(historyUri, {
    attempts: history.attempts.filter((attempt) => attempt.path !== snapshotPath),
  });
  return true;
}


// 현재 언어와 다른 언어의 풀이 snapshot 목록을 사이드바 표시용으로 읽습니다.
async function readSolutionHistory(problemDir, languageId) {
  const history = await readJson(vscode.Uri.file(helperPath(problemDir, "solution-history.json")));
  return {
    attempts: Array.isArray(history?.attempts)
      ? history.attempts
        .filter((attempt) => attempt && typeof attempt.path === "string")
        .filter((attempt) => Boolean(resolveSolutionSnapshotPath(problemDir, attempt.path)))
        .filter((attempt) => !languageId || (attempt.language || inferLanguageFromSnapshotPath(attempt.path)) === getLanguage(languageId).id)
        .map((attempt) => ({
          path: attempt.path,
          createdAt: typeof attempt.createdAt === "string" ? attempt.createdAt : "",
          label: typeof attempt.label === "string" ? attempt.label : path.basename(attempt.path),
          language: attempt.language || inferLanguageFromSnapshotPath(attempt.path) || DEFAULT_LANGUAGE_ID,
        }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      : [],
  };
}


// snapshot 상대 경로가 solutions 폴더 밖으로 빠져나가지 않도록 검증합니다.
function resolveSolutionSnapshotPath(problemDir, snapshotPath) {
  if (typeof snapshotPath !== "string" || path.isAbsolute(snapshotPath)) {
    return undefined;
  }

  const normalized = snapshotPath.split(path.win32.sep).join(path.posix.sep);
  const expectedPrefix = `${helperRelativePath("solutions")}/`;
  if (!normalized.startsWith(expectedPrefix)) {
    return undefined;
  }

  const relativeParts = normalized.split("/");
  const languageId = inferLanguageFromRunnablePath(relativeParts);
  if (!languageId) {
    return undefined;
  }

  const root = path.resolve(solutionsPath(problemDir));
  const target = path.resolve(problemDir, normalized);
  return isPathInside(root, target) ? target : undefined;
}


// 풀이 파일 경로에서 언어를 추정합니다.
function inferLanguageFromPath(filePath) {
  const extension = path.extname(filePath);
  const languageByExtension = getLanguageIds().filter((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
  if (languageByExtension.length === 1) {
    return languageByExtension[0];
  }
  return undefined;
}


// snapshot 파일명에서 원래 풀이 언어를 추정합니다.
function inferLanguageFromSnapshotPath(snapshotPath) {
  const normalized = String(snapshotPath || "").split(path.win32.sep).join(path.posix.sep);
  return inferLanguageFromRunnablePath(normalized.split("/"));
}

module.exports = {
  createSolutionAttempt,
  resetSolutionToInitial,
  loadInitialSolutionCode,
  getSolutionSnapshotPath,
  deleteSolutionSnapshot,
  readSolutionHistory,
  resolveSolutionSnapshotPath,
  inferLanguageFromPath,
  inferLanguageFromSnapshotPath,
};
