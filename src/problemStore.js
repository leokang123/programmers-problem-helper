const path = require("path");
const vscode = require("vscode");
const {
  DEFAULT_LANGUAGE_ID,
  getInitialSolutionPath,
  getInitialSolutionRelativePath,
  getLanguage,
  getLanguageIds,
  getSnapshotFileName,
  getSolutionPath,
  inferLanguageFromRunnablePath,
  isSupportedSourceExtension,
  getSolutionFileName,
} = require("./languages");
const {
  decodeHtml,
  extractExamplesFromMarkdown,
  fetchText,
  htmlToMarkdown,
  matchFirst,
  slugify,
} = require("./problemParsing");

// 저장된 문제 목록을 빠른 인덱스에서 읽고, 필요할 때만 전체 스캔으로 재생성합니다.
async function loadProblems(programmersDir, options = {}) {
  if (!options.rebuildIndex) {
    const indexed = await readProblemIndex(programmersDir);
    if (indexed) {
      return indexed;
    }
  }

  return rebuildProblemIndex(programmersDir);
}

// 문제 폴더를 스캔해서 목록 인덱스를 다시 만듭니다.
async function rebuildProblemIndex(programmersDir) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    return [];
  }

  const problems = (await Promise.all(
    entries
      .filter(([name, type]) => type === vscode.FileType.Directory && !isInternalHelperFolder(name))
      .map(async ([name]) => {
        const problemDir = vscode.Uri.joinPath(programmersDir, name);
        if (!(await hasProblemFiles(problemDir))) {
          return undefined;
        }
        return loadProblemSummary(problemDir.fsPath);
      })
  )).filter(Boolean);

  const sorted = sortProblemSummaries(problems);
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

function sortProblemSummaries(problems) {
  return problems.sort((a, b) => {
    const left = /^\d+$/.test(a.lessonId) ? Number(a.lessonId) : undefined;
    const right = /^\d+$/.test(b.lessonId) ? Number(b.lessonId) : undefined;
    if (left !== undefined && right !== undefined && left !== right) {
      return left - right;
    }
    return a.folderName.localeCompare(b.folderName, "ko");
  });
}

// 사용할 Programmers 폴더를 찾거나 생성합니다.
async function resolveProgrammersDir(context, workspaceUri, options = {}) {
  const candidates = getProgrammersDirCandidates(context, workspaceUri);
  for (const candidate of candidates) {
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if (stat.type === vscode.FileType.Directory) {
        return candidate;
      }
    } catch {
      // Try the next known location.
    }
  }

  const fallback = getDefaultProgrammersDir(context, workspaceUri);
  if (options.create) {
    await vscode.workspace.fs.createDirectory(fallback);
    return fallback;
  }

  return undefined;
}

// 가능한 Programmers 폴더 후보를 만듭니다.
function getProgrammersDirCandidates(context, workspaceUri) {
  const candidates = [];
  if (shouldUseWorkspaceProgrammersDir(context, workspaceUri)) {
    candidates.push(path.basename(workspaceUri.fsPath) === "Programmers" ? workspaceUri : vscode.Uri.joinPath(workspaceUri, "Programmers"));
  }
  candidates.push(getDefaultProgrammersDir(context, workspaceUri));

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate.fsPath);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// 기본 Programmers 폴더 위치를 반환합니다.
function getDefaultProgrammersDir(context, workspaceUri) {
  if (shouldUseWorkspaceProgrammersDir(context, workspaceUri)) {
    return path.basename(workspaceUri.fsPath) === "Programmers"
      ? workspaceUri
      : vscode.Uri.joinPath(workspaceUri, "Programmers");
  }
  return vscode.Uri.joinPath(context.globalStorageUri, "Programmers");
}

function shouldUseWorkspaceProgrammersDir(context, workspaceUri) {
  if (!workspaceUri) {
    return false;
  }

  return vscode.env.remoteName === "dev-container"
    || context.extensionMode === vscode.ExtensionMode.Development;
}

// 문제 폴더의 표시 정보를 읽습니다.
async function loadProblemInfo(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const summary = await loadProblemSummary(problemDir);
  const metadata = await readJson(vscode.Uri.file(path.join(problemDir, ".programmers-helper", "programmers.json")));
  const language = getLanguage(languageId);
  const history = await readSolutionHistory(problemDir);
  const currentLanguageHistory = history.attempts.filter((attempt) => attempt.language === language.id);
  const otherLanguageHistory = history.attempts.filter((attempt) => attempt.language !== language.id);
  return {
    ...summary,
    solutionHistory: currentLanguageHistory,
    otherSolutionHistory: otherLanguageHistory,
    language: language.id,
    solutionFileName: getSolutionFileName(languageId),
    url: getProblemUrlFromMetadata(metadata, language.id),
  };
}

// 목록에 필요한 최소 문제 정보를 읽습니다.
async function loadProblemSummary(problemDir) {
  const folderName = path.basename(problemDir);
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const metadata = await readJson(vscode.Uri.joinPath(helperDir, "programmers.json"));
  const reviewData = await readJson(vscode.Uri.joinPath(helperDir, "review.json"));
  const history = await readSolutionHistory(problemDir);
  const fallback = parseProblemFolderName(folderName);
  return {
    problemDir,
    folderName,
    lessonId: String(metadata?.lessonId || fallback.lessonId || ""),
    title: String(metadata?.title || fallback.title || folderName),
    review: Boolean(reviewData?.review),
    solutionHistoryCount: history.attempts.length,
  };
}

// 단일 문제의 최신 상태를 인덱스에 반영합니다.
async function updateProblemIndexEntry(programmersDir, problemDir) {
  const existing = await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  const summary = await loadProblemSummary(problemDir);
  const target = path.resolve(problemDir);
  const next = existing.filter((problem) => path.resolve(problem.problemDir) !== target);
  next.push(summary);
  const sorted = sortProblemSummaries(next);
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

// 삭제된 문제를 인덱스에서 제거합니다.
async function removeProblemIndexEntry(programmersDir, problemDir) {
  const existing = await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  const target = path.resolve(problemDir);
  const sorted = sortProblemSummaries(existing.filter((problem) => path.resolve(problem.problemDir) !== target));
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

async function readProblemIndex(programmersDir) {
  const index = await readJson(getProblemIndexUri(programmersDir));
  if (!Array.isArray(index?.problems)) {
    return undefined;
  }

  const root = path.resolve(programmersDir.fsPath);
  const entries = index.problems.filter((problem) => problem && typeof problem.problemDir === "string");
  const scopedEntries = entries.filter((problem) => {
    const target = path.resolve(problem.problemDir);
    return isPathInside(root, target);
  });
  if (scopedEntries.length !== entries.length) {
    return undefined;
  }

  return sortProblemSummaries(scopedEntries
    .map((problem) => ({
      problemDir: problem.problemDir,
      folderName: String(problem.folderName || path.basename(problem.problemDir)),
      lessonId: String(problem.lessonId || ""),
      title: String(problem.title || problem.folderName || path.basename(problem.problemDir)),
      review: Boolean(problem.review),
      solutionHistoryCount: Number.isInteger(problem.solutionHistoryCount) ? problem.solutionHistoryCount : 0,
    })));
}

async function writeProblemIndex(programmersDir, problems) {
  const helperDir = vscode.Uri.joinPath(programmersDir, ".programmers-helper");
  await vscode.workspace.fs.createDirectory(helperDir);
  await writeJson(getProblemIndexUri(programmersDir), {
    version: 1,
    problems,
  });
}

function getProblemIndexUri(programmersDir) {
  return vscode.Uri.joinPath(programmersDir, ".programmers-helper", "problem-index.json");
}

// 문제의 예제 테스트를 메타데이터나 markdown에서 읽습니다.
async function loadProblemExamples(problemDir) {
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");
  const metadata = await readJson(metadataUri);
  if (Array.isArray(metadata?.examples) && metadata.examples.length > 0) {
    return metadata.examples;
  }

  try {
    const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
    const examples = extractExamplesFromMarkdown(markdown);
    if (examples.length > 0) {
      await vscode.workspace.fs.createDirectory(helperDir);
      await writeJson(metadataUri, {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        examples,
      });
    }
    return examples;
  } catch {
    return [];
  }
}

// 커스텀 테스트 저장 파일 URI를 만듭니다.
function getCustomTestsUri(problemDir) {
  return vscode.Uri.file(path.join(problemDir, ".programmers-helper", "custom-tests.json"));
}

// 저장된 커스텀 테스트를 읽습니다.
async function loadSavedCustomTests(problemDir) {
  const saved = await readJson(getCustomTestsUri(problemDir));
  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((test) => test && typeof test.inputsText === "string" && typeof test.expectedText === "string")
    .map((test) => ({
      inputsText: test.inputsText,
      expectedText: test.expectedText,
    }));
}

// 커스텀 테스트를 정리해 저장합니다.
async function saveCustomTests(problemDir, tests) {
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const customTests = Array.isArray(tests)
    ? tests
      .filter((test) => test && (String(test.inputsText || "").trim() || String(test.expectedText || "").trim()))
      .map((test) => ({
        inputsText: String(test.inputsText || "").trim(),
        expectedText: String(test.expectedText || "").trim(),
      }))
    : [];

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.writeFile(
    getCustomTestsUri(problemDir),
    Buffer.from(JSON.stringify(customTests, null, 2) + "\n", "utf8")
  );
}

// Programmers 페이지에서 문제 파일을 생성합니다.
async function createProblem(programmersDir, lessonId, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const existing = await findExistingProblem(programmersDir, lessonId);
  if (existing) {
    const solution = await ensureSolutionForLanguage(existing.problemDir.fsPath, language.id);
    return {
      ...existing,
      solutionUri: solution.solutionUri,
      cppUri: language.id === "cpp" ? solution.solutionUri : existing.cppUri,
      language: language.id,
    };
  }

  const url = getProgrammersProblemUrl(lessonId, language.id);
  const html = await fetchText(url);
  const page = parseProgrammersProblemPage(html, url, language);
  const { title, initialCode } = page;
  const folderName = `${lessonId}_${slugify(title)}`;
  const problemDir = vscode.Uri.joinPath(programmersDir, folderName);
  const mdUri = vscode.Uri.joinPath(problemDir, "problem.md");
  const solutionUri = vscode.Uri.joinPath(problemDir, language.solutionFileName);
  const helperDir = vscode.Uri.joinPath(problemDir, ".programmers-helper");
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");
  const initialSolutionUri = vscode.Uri.joinPath(helperDir, language.initialSolutionFileName);

  await vscode.workspace.fs.createDirectory(problemDir);
  await vscode.workspace.fs.createDirectory(helperDir);

  const problemMd = buildProblemMarkdown(lessonId, url, page);
  await writeFileIfAbsent(mdUri, problemMd);
  await writeFileIfAbsent(solutionUri, initialCode);
  await writeFileIfAbsent(initialSolutionUri, initialCode);

  const metadata = {
    lessonId,
    title,
    url,
    initialCode,
    initialCodePath: getInitialSolutionRelativePath(language.id),
    language: language.id,
    solutionFile: language.solutionFileName,
    languages: {
      [language.id]: {
        url,
        solutionFile: language.solutionFileName,
        initialCodePath: getInitialSolutionRelativePath(language.id),
      },
    },
    examples: extractExamplesFromMarkdown(problemMd),
  };
  await vscode.workspace.fs.writeFile(metadataUri, Buffer.from(JSON.stringify(metadata, null, 2) + "\n", "utf8"));

  return { folderName, problemDir, mdUri, solutionUri, cppUri: language.id === "cpp" ? solutionUri : undefined, language: language.id, examples: metadata.examples };
}

// HTML에서 문제 생성에 필요한 원천 데이터를 추출하고 필수 항목을 검증합니다.
function parseProgrammersProblemPage(html, url, language = getLanguage(DEFAULT_LANGUAGE_ID)) {
  const title = decodeHtml(
    matchFirst(html, /data-lesson-title="([^"]+)"/, /<span class="challenge-title">([\s\S]*?)<\/span>/, /<title>코딩테스트 연습 - ([^|]+?)\s*\|/)
  ).trim();
  if (!title) {
    throw new Error(`문제 제목을 찾지 못했습니다: ${url}`);
  }

  const markdownHtml = matchFirst(html, /<div class="markdown solarized-dark">([\s\S]*?)<\/div>/);
  if (!markdownHtml) {
    throw new Error(`문제 본문을 찾지 못했습니다: ${url}`);
  }

  const code = decodeHtml(
    matchFirst(html, /<textarea hidden id="code" name="code">([\s\S]*?)<\/textarea>/, /name="initial_code_\d+"[^>]*value="([\s\S]*?)"/)
  ).replace(/\r\n/g, "\n");
  if (!code.trim()) {
    throw new Error(`${language.label} 기본 코드 템플릿을 찾지 못했습니다.`);
  }

  return {
    title,
    markdownHtml,
    initialCode: code.trimEnd() + "\n",
    level: matchFirst(html, /data-challenge-level="([^"]+)"/),
    category: matchFirst(html, /data-challenge-category="([^"]+)"/),
  };
}

async function ensureSolutionForLanguage(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const solutionUri = vscode.Uri.file(getSolutionPath(problemDir, language.id));
  const initialSolutionUri = vscode.Uri.file(getInitialSolutionPath(problemDir, language.id));
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");
  const metadata = await readJson(metadataUri);
  const lessonId = String(metadata?.lessonId || parseProblemFolderName(path.basename(problemDir)).lessonId || "");
  if (!lessonId) {
    throw new Error("문제 번호를 확인하지 못해 언어 템플릿을 가져올 수 없습니다.");
  }

  try {
    await Promise.all([
      vscode.workspace.fs.stat(solutionUri),
      vscode.workspace.fs.stat(initialSolutionUri),
    ]);
    return { solutionUri, language: language.id };
  } catch {
    // Missing language files are fetched below.
  }

  const url = getProgrammersProblemUrl(lessonId, language.id);
  const html = await fetchText(url);
  const page = parseProgrammersProblemPage(html, url, language);
  const initialCode = page.initialCode;

  await vscode.workspace.fs.createDirectory(helperDir);
  await writeFileIfAbsent(solutionUri, initialCode);
  await writeFileIfAbsent(initialSolutionUri, initialCode);

  const nextMetadata = {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    lessonId,
    title: metadata?.title || page.title,
    languages: {
      ...(metadata?.languages && typeof metadata.languages === "object" ? metadata.languages : {}),
      [language.id]: {
        url,
        solutionFile: language.solutionFileName,
        initialCodePath: getInitialSolutionRelativePath(language.id),
      },
    },
  };
  if (!nextMetadata.url) nextMetadata.url = url;
  if (!nextMetadata.initialCode) nextMetadata.initialCode = initialCode;
  if (!nextMetadata.initialCodePath) nextMetadata.initialCodePath = getInitialSolutionRelativePath(language.id);
  if (!nextMetadata.examples) {
    try {
      const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
      nextMetadata.examples = extractExamplesFromMarkdown(markdown);
    } catch {
      nextMetadata.examples = [];
    }
  }
  await writeJson(metadataUri, nextMetadata);

  return { solutionUri, language: language.id };
}

function getProgrammersProblemUrl(lessonId, languageId = DEFAULT_LANGUAGE_ID) {
  return `https://school.programmers.co.kr/learn/courses/30/lessons/${lessonId}?language=${getLanguage(languageId).programmersParam}`;
}

function getProblemUrlFromMetadata(metadata, languageId = DEFAULT_LANGUAGE_ID) {
  const languageUrl = metadata?.languages?.[getLanguage(languageId).id]?.url;
  if (typeof languageUrl === "string" && languageUrl.trim()) {
    return languageUrl;
  }
  return typeof metadata?.url === "string" ? metadata.url : "";
}

// 저장할 problem.md를 조립합니다.
// page 파싱과 파일 쓰기 사이에 문서 포맷 책임을 분리해 둔다.
function buildProblemMarkdown(lessonId, url, page) {
  return [
    `# [Programmers ${lessonId}] ${page.title}`,
    "",
    `- 출처: [프로그래머스 스쿨](${url})`,
    page.level ? `- 난이도: Level ${page.level}` : "",
    page.category ? `- 분류: ${page.category}` : "",
    "",
    htmlToMarkdown(page.markdownHtml),
    "",
  ].filter((line, index, arr) => line !== "" || arr[index - 1] !== "").join("\n");
}

// 같은 lessonId로 이미 만든 문제를 찾습니다.
async function findExistingProblem(programmersDir, lessonId) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    return undefined;
  }

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory || isInternalHelperFolder(name)) {
      continue;
    }

    const problemDir = vscode.Uri.joinPath(programmersDir, name);
    const fallback = parseProblemFolderName(name);
    let matchesLesson = fallback.lessonId === lessonId;
    if (!matchesLesson) {
      const metadata = await readJson(vscode.Uri.joinPath(problemDir, ".programmers-helper", "programmers.json"));
      matchesLesson = String(metadata?.lessonId || "") === lessonId;
    }

    if (!matchesLesson || !(await hasProblemFiles(problemDir))) {
      continue;
    }

    const mdUri = vscode.Uri.joinPath(problemDir, "problem.md");
    const cppUri = vscode.Uri.joinPath(problemDir, "solution.cpp");
    return {
      folderName: name,
      problemDir,
      mdUri,
      cppUri,
      examples: await loadProblemExamples(problemDir.fsPath),
    };
  }

  return undefined;
}

// 현재 언어 풀이 파일을 풀이 기록으로 저장하고 새 풀이 상태를 준비합니다.
async function createSolutionAttempt(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const solutionUri = vscode.Uri.file(getSolutionPath(problemDir, language.id));
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const solutionsDir = vscode.Uri.joinPath(helperDir, "solutions");
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
        path: path.posix.join(".programmers-helper", "solutions", snapshotName),
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

// 지정한 풀이 파일을 처음 받아온 원본 코드로 되돌립니다.
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

// 처음 받아온 현재 언어 풀이 원본 코드를 읽습니다.
async function loadInitialSolutionCode(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  try {
    return await readText(vscode.Uri.file(getInitialSolutionPath(problemDir, languageId)));
  } catch {
    const metadata = await readJson(vscode.Uri.file(path.join(problemDir, ".programmers-helper", "programmers.json")));
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

// 특정 풀이 기록 파일 경로를 찾습니다.
async function getSolutionSnapshotPath(problemDir, snapshotPath) {
  const history = await readSolutionHistory(problemDir);
  const found = history.attempts.find((attempt) => attempt.path === snapshotPath);
  return found ? resolveSolutionSnapshotPath(problemDir, found.path) : undefined;
}

// 풀이 기록 하나를 삭제합니다.
async function deleteSolutionSnapshot(problemDir, snapshotPath) {
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
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

// 풀이 기록 메타데이터를 읽습니다.
async function readSolutionHistory(problemDir, languageId) {
  const history = await readJson(vscode.Uri.file(path.join(problemDir, ".programmers-helper", "solution-history.json")));
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

function resolveSolutionSnapshotPath(problemDir, snapshotPath) {
  if (typeof snapshotPath !== "string" || path.isAbsolute(snapshotPath)) {
    return undefined;
  }

  const normalized = snapshotPath.split(path.win32.sep).join(path.posix.sep);
  const expectedPrefix = ".programmers-helper/solutions/";
  if (!normalized.startsWith(expectedPrefix)) {
    return undefined;
  }

  const relativeParts = normalized.split("/");
  const languageId = inferLanguageFromRunnablePath(relativeParts);
  if (!languageId) {
    return undefined;
  }

  const root = path.resolve(problemDir, ".programmers-helper", "solutions");
  const target = path.resolve(problemDir, normalized);
  return isPathInside(root, target) ? target : undefined;
}

function isSameOrInsidePath(root, target) {
  return target === root || isPathInside(root, target);
}

function isPathInside(root, target) {
  return target.startsWith(root + path.sep);
}

// 문제 폴더에 필수 파일이 있는지 확인합니다.
async function hasProblemFiles(problemDir) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, "problem.md"));
    const stats = await Promise.allSettled(
      getLanguageIds().map((languageId) => vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, getLanguage(languageId).solutionFileName)))
    );
    if (!stats.some((result) => result.status === "fulfilled")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function inferLanguageFromPath(filePath) {
  const extension = path.extname(filePath);
  const languageByExtension = getLanguageIds().filter((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
  if (languageByExtension.length === 1) {
    return languageByExtension[0];
  }
  return undefined;
}

function inferLanguageFromSnapshotPath(snapshotPath) {
  const normalized = String(snapshotPath || "").split(path.win32.sep).join(path.posix.sep);
  return inferLanguageFromRunnablePath(normalized.split("/"));
}

// UTF-8 텍스트 파일을 읽습니다.
async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

// JSON 파일을 읽고 실패하면 undefined를 반환합니다.
async function readJson(uri) {
  try {
    return JSON.parse(await readText(uri));
  } catch {
    return undefined;
  }
}

// 폴더명에서 문제 번호와 제목을 추정합니다.
function parseProblemFolderName(folderName) {
  const match = folderName.match(/^(\d+)_?(.*)$/);
  if (!match) {
    return { lessonId: "", title: folderName.replace(/_/g, " ") };
  }
  return {
    lessonId: match[1],
    title: (match[2] || folderName).replace(/_/g, " "),
  };
}

// 파일이 없을 때만 새로 씁니다.
async function writeFileIfAbsent(uri, contents) {
  try {
    await vscode.workspace.fs.stat(uri);
    return;
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  }
}

// JSON 파일을 보기 좋게 씁니다.
async function writeJson(uri, value) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}

// 파일명에 사용할 timestamp를 만듭니다.
function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const padMs = (value) => String(value).padStart(3, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    padMs(date.getMilliseconds()),
  ].join("");
}

function isInternalHelperFolder(name) {
  return name === ".programmers-helper";
}

module.exports = {
  createProblem,
  createSolutionAttempt,
  deleteSolutionSnapshot,
  ensureSolutionForLanguage,
  getSolutionSnapshotPath,
  getDefaultProgrammersDir,
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadProblems,
  loadSavedCustomTests,
  readText,
  rebuildProblemIndex,
  removeProblemIndexEntry,
  resetSolutionToInitial,
  resolveProgrammersDir,
  saveCustomTests,
  updateProblemIndexEntry,
};
