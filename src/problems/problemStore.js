const path = require("path");
const vscode = require("vscode");
const {
  DEFAULT_LANGUAGE_ID,
  getInitialSolutionPath,
  getLegacyInitialSolutionPath,
  getLanguage,
  getLanguageIds,
  getSolutionPath,
  getSolutionFileName,
} = require("./languages");
const {
  decodeHtml,
  extractExamplesFromMarkdown,
  extractProgrammersMarkdownHtml,
  fetchText,
  htmlToMarkdown,
  matchFirst,
  slugify,
} = require("./problemParsing");
const {
  HELPER_DIR_NAME,
  INITIAL_DIR_NAME,
  helperPath,
  helperRelativePath,
} = require("./helperPaths");
const {
  isDevelopmentExtension,
} = require("../core/environment");
const {
  createSolutionAttempt,
  deleteSolutionSnapshot,
  getSolutionSnapshotPath,
  readSolutionHistory,
  resetSolutionToInitial,
} = require("./solutionHistoryStore");
const {
  fileExists,
  isPathInside,
  parseProblemFolderName,
  readJson,
  readText,
  writeFileIfAbsent,
  writeJson,
} = require("./problemStoreUtils");

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

// 사이드바 목록이 항상 같은 순서로 보이도록 lessonId와 폴더명 기준으로 정렬합니다.
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

// 개발/패키징 환경에 따라 사용할 수 있는 Programmers 저장소 후보를 나열합니다.
function getProgrammersDirCandidates(context, workspaceUri) {
  const candidates = [];
  const developmentRoot = getDevelopmentRootUri(context, workspaceUri);
  if (developmentRoot) {
    candidates.push(path.basename(developmentRoot.fsPath) === "Programmers" ? developmentRoot : vscode.Uri.joinPath(developmentRoot, "Programmers"));
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

// 후보가 없을 때 생성할 기본 Programmers 저장소 위치를 계산합니다.
function getDefaultProgrammersDir(context, workspaceUri) {
  const developmentRoot = getDevelopmentRootUri(context, workspaceUri);
  if (developmentRoot) {
    return path.basename(developmentRoot.fsPath) === "Programmers"
      ? developmentRoot
      : vscode.Uri.joinPath(developmentRoot, "Programmers");
  }
  return vscode.Uri.joinPath(context.globalStorageUri, "Programmers");
}

// 개발 실행 중에는 열린 workspace를 저장소 루트로 삼을 수 있는지 판단합니다.
function getDevelopmentRootUri(context, workspaceUri) {
  if (!isDevelopmentExtension(context)) {
    return undefined;
  }

  return workspaceUri || context.extensionUri;
}

// 현재 문제 화면에 필요한 metadata, 예제, 풀이 기록, 커스텀 테스트를 묶어 읽습니다.
async function loadProblemInfo(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const folderName = path.basename(problemDir);
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const metadata = await readJson(vscode.Uri.file(helperPath(problemDir, "programmers.json")));
  const reviewData = await readJson(vscode.Uri.joinPath(helperDir, "review.json"));
  const language = getLanguage(languageId);
  const history = await readSolutionHistory(problemDir);
  const fallback = parseProblemFolderName(folderName);
  const markdownMetadata = metadata?.level && metadata?.category ? {} : await readProblemMarkdownMetadata(problemDir);
  const summary = buildProblemSummary(problemDir, folderName, metadata, reviewData, history, fallback, markdownMetadata);
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

// 사이드바 목록에 필요한 가벼운 문제 요약 정보를 읽습니다.
async function loadProblemSummary(problemDir) {
  const folderName = path.basename(problemDir);
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const metadata = await readJson(vscode.Uri.joinPath(helperDir, "programmers.json"));
  const reviewData = await readJson(vscode.Uri.joinPath(helperDir, "review.json"));
  const history = await readSolutionHistory(problemDir);
  const fallback = parseProblemFolderName(folderName);
  const markdownMetadata = metadata?.level && metadata?.category ? {} : await readProblemMarkdownMetadata(problemDir);
  return buildProblemSummary(problemDir, folderName, metadata, reviewData, history, fallback, markdownMetadata);
}

// 이미 읽은 metadata/history/review를 재사용해 목록 summary를 구성합니다.
function buildProblemSummary(problemDir, folderName, metadata, reviewData, history, fallback, markdownMetadata = {}) {
  return {
    problemDir,
    folderName,
    lessonId: String(metadata?.lessonId || fallback.lessonId || ""),
    title: String(metadata?.title || fallback.title || folderName),
    level: String(metadata?.level || markdownMetadata.level || ""),
    category: String(metadata?.category || markdownMetadata.category || ""),
    review: Boolean(reviewData?.review),
    solutionHistoryCount: history.attempts.length,
  };
}

// 이미 가지고 있는 summary가 있으면 파일을 다시 읽지 않고 problem-index에 반영합니다.
async function updateProblemIndexSummary(programmersDir, existing, summary) {
  if (!summary?.problemDir) {
    return Array.isArray(existing) ? existing : await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  }
  const entries = Array.isArray(existing) ? existing : await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  const target = path.resolve(summary.problemDir);
  const next = entries.filter((problem) => path.resolve(problem.problemDir) !== target);
  next.push(summary);
  const sorted = sortProblemSummaries(next);
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

// 이미 알고 있는 review 값은 problem-index cache에 먼저 반영하고, 누락 항목만 파일에서 보완합니다.
async function updateProblemIndexReviewStates(programmersDir, updates, cachedProblems) {
  const normalized = Array.isArray(updates)
    ? updates
      .filter((update) => update && typeof update.problemDir === "string")
      .map((update) => ({
        problemDir: path.resolve(update.problemDir),
        review: Boolean(update.review),
      }))
    : [];
  if (normalized.length === 0) {
    return Array.isArray(cachedProblems) ? cachedProblems : await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  }

  const reviewByDir = new Map(normalized.map((update) => [update.problemDir, update.review]));
  const existing = Array.isArray(cachedProblems) ? cachedProblems : await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  const seen = new Set();
  const next = existing.map((problem) => {
    const target = path.resolve(problem.problemDir);
    if (!reviewByDir.has(target)) {
      return problem;
    }
    seen.add(target);
    return {
      ...problem,
      review: reviewByDir.get(target),
    };
  });

  const missing = normalized.filter((update) => !seen.has(update.problemDir));
  if (missing.length > 0) {
    next.push(...await Promise.all(missing.map((update) => loadProblemSummary(update.problemDir))));
  }

  const sorted = sortProblemSummaries(next);
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

// 문제 삭제 후 cache/index에서 해당 폴더 항목을 제거합니다.
async function removeProblemIndexEntry(programmersDir, problemDir, cachedProblems) {
  const existing = Array.isArray(cachedProblems) ? cachedProblems : await readProblemIndex(programmersDir) || await rebuildProblemIndex(programmersDir);
  const target = path.resolve(problemDir);
  const sorted = sortProblemSummaries(existing.filter((problem) => path.resolve(problem.problemDir) !== target));
  await writeProblemIndex(programmersDir, sorted);
  return sorted;
}

// 빠른 사이드바 로딩을 위해 저장된 problem-index를 읽습니다.
async function readProblemIndex(programmersDir) {
  const index = await readJson(getProblemIndexUri(programmersDir));
  if (index?.version !== 2 || !Array.isArray(index?.problems)) {
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
      level: String(problem.level || ""),
      category: String(problem.category || ""),
      review: Boolean(problem.review),
      solutionHistoryCount: Number.isInteger(problem.solutionHistoryCount) ? problem.solutionHistoryCount : 0,
    })));
}

// 전체 scan 또는 부분 갱신 결과를 problem-index 파일에 저장합니다.
async function writeProblemIndex(programmersDir, problems) {
  const helperDir = vscode.Uri.joinPath(programmersDir, HELPER_DIR_NAME);
  await vscode.workspace.fs.createDirectory(helperDir);
  await writeJson(getProblemIndexUri(programmersDir), {
    version: 2,
    problems,
  });
}

// problem-index JSON 파일의 URI를 계산합니다.
function getProblemIndexUri(programmersDir) {
  return vscode.Uri.joinPath(programmersDir, HELPER_DIR_NAME, "problem-index.json");
}

// 테스트 실행에 사용할 예제를 metadata 우선, problem.md fallback 순서로 읽습니다.
async function loadProblemExamples(problemDir) {
  const helperDir = vscode.Uri.file(helperPath(problemDir));
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
      await writeProgrammersMetadata(metadataUri, {
        ...normalizeProgrammersMetadata(metadata),
        examples,
      });
    }
    return examples;
  } catch {
    return [];
  }
}

// 사용자가 사이드바에 저장한 커스텀 테스트 파일의 URI를 계산합니다.
function getCustomTestsUri(problemDir) {
  return vscode.Uri.file(helperPath(problemDir, "custom-tests.json"));
}

// 문제별로 저장된 커스텀 테스트 목록을 읽습니다.
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

// Webview에서 넘어온 커스텀 테스트를 문제 helper 영역에 저장합니다.
async function saveCustomTests(problemDir, tests) {
  const helperDir = vscode.Uri.file(helperPath(problemDir));
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

// 문제 번호로 Programmers 페이지를 가져와 폴더, metadata, 풀이 파일을 생성합니다.
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
  const helperDir = vscode.Uri.joinPath(problemDir, HELPER_DIR_NAME);
  const initialDir = vscode.Uri.joinPath(helperDir, INITIAL_DIR_NAME);
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");
  const initialSolutionUri = vscode.Uri.joinPath(initialDir, language.initialSolutionFileName);

  await vscode.workspace.fs.createDirectory(problemDir);
  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.createDirectory(initialDir);

  const problemMd = buildProblemMarkdown(lessonId, url, page);
  await writeFileIfAbsent(mdUri, problemMd);
  await writeFileIfAbsent(solutionUri, initialCode);
  await writeFileIfAbsent(initialSolutionUri, initialCode);

  const metadata = {
    lessonId,
    title,
    level: page.level,
    category: page.category,
    languages: {
      [language.id]: { url },
    },
    examples: extractExamplesFromMarkdown(problemMd),
  };
  await writeProgrammersMetadata(metadataUri, metadata);

  return { folderName, problemDir, mdUri, solutionUri, cppUri: language.id === "cpp" ? solutionUri : undefined, language: language.id, examples: metadata.examples };
}

// Programmers HTML에서 제목, 본문, 초기 코드, 예제 정보를 추출합니다.
function parseProgrammersProblemPage(html, url, language = getLanguage(DEFAULT_LANGUAGE_ID)) {
  const title = decodeHtml(
    matchFirst(html, /data-lesson-title="([^"]+)"/, /<span class="challenge-title">([\s\S]*?)<\/span>/, /<title>코딩테스트 연습 - ([^|]+?)\s*\|/)
  ).trim();
  if (!title) {
    throw new Error(`문제 제목을 찾지 못했습니다: ${url}`);
  }

  const markdownHtml = extractProgrammersMarkdownHtml(html);
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

// 이미 만든 문제에 현재 언어의 풀이 파일과 초기 템플릿이 있는지 보장합니다.
async function ensureSolutionForLanguage(problemDir, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const solutionUri = vscode.Uri.file(getSolutionPath(problemDir, language.id));
  const initialSolutionUri = vscode.Uri.file(getInitialSolutionPath(problemDir, language.id));
  const helperDir = vscode.Uri.file(helperPath(problemDir));
  const initialDir = vscode.Uri.joinPath(helperDir, INITIAL_DIR_NAME);
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");
  const metadata = await readJson(metadataUri);
  const lessonId = String(metadata?.lessonId || parseProblemFolderName(path.basename(problemDir)).lessonId || "");
  if (!lessonId) {
    throw new Error("문제 번호를 확인하지 못해 언어 템플릿을 가져올 수 없습니다.");
  }

  try {
    await vscode.workspace.fs.stat(solutionUri);
    if (await fileExists(initialSolutionUri) || await fileExists(vscode.Uri.file(getLegacyInitialSolutionPath(problemDir, language.id)))) {
      return { solutionUri, language: language.id };
    }
  } catch {
    // Missing language files are fetched below.
  }

  const url = getProgrammersProblemUrl(lessonId, language.id);
  const html = await fetchText(url);
  const page = parseProgrammersProblemPage(html, url, language);
  const initialCode = page.initialCode;

  await vscode.workspace.fs.createDirectory(helperDir);
  await vscode.workspace.fs.createDirectory(initialDir);
  await writeFileIfAbsent(solutionUri, initialCode);
  await writeFileIfAbsent(initialSolutionUri, initialCode);

  const nextMetadata = normalizeProgrammersMetadata(metadata);
  nextMetadata.lessonId = lessonId;
  nextMetadata.title = nextMetadata.title || page.title;
  nextMetadata.level = nextMetadata.level || page.level;
  nextMetadata.category = nextMetadata.category || page.category;
  nextMetadata.languages = {
    ...nextMetadata.languages,
    [language.id]: { url },
  };
  if (!nextMetadata.examples) {
    try {
      const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
      nextMetadata.examples = extractExamplesFromMarkdown(markdown);
    } catch {
      nextMetadata.examples = [];
    }
  }
  await writeProgrammersMetadata(metadataUri, nextMetadata);

  return { solutionUri, language: language.id };
}

// lessonId와 언어 설정으로 Programmers 문제 URL을 만듭니다.
function getProgrammersProblemUrl(lessonId, languageId = DEFAULT_LANGUAGE_ID) {
  return `https://school.programmers.co.kr/learn/courses/30/lessons/${lessonId}?language=${getLanguage(languageId).programmersParam}`;
}

// metadata에 저장된 언어별 원본 문제 URL을 찾아 반환합니다.
function getProblemUrlFromMetadata(metadata, languageId = DEFAULT_LANGUAGE_ID) {
  const language = getLanguage(languageId);
  const languageUrl = metadata?.languages?.[language.id]?.url;
  if (typeof languageUrl === "string" && languageUrl.trim()) {
    return languageUrl;
  }
  if (typeof metadata?.url === "string" && metadata.url.trim()) {
    return metadata.url;
  }
  return metadata?.lessonId ? getProgrammersProblemUrl(String(metadata.lessonId), language.id) : "";
}

// 추출한 문제 정보를 사람이 읽을 problem.md 본문으로 조립합니다.
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

// 같은 lessonId 문제 폴더가 이미 있는지 찾아 중복 생성을 막습니다.
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
      const metadata = await readJson(vscode.Uri.joinPath(problemDir, HELPER_DIR_NAME, "programmers.json"));
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

// 폴더가 실제 문제 폴더인지 problem.md 또는 metadata 존재 여부로 판단합니다.
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

// 예전 metadata와 현재 metadata를 현재 저장 형식으로 정규화합니다.
function normalizeProgrammersMetadata(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const languages = {};
  if (source.languages && typeof source.languages === "object") {
    for (const [languageId, languageMetadata] of Object.entries(source.languages)) {
      if (!getLanguageIds().includes(languageId) || !languageMetadata || typeof languageMetadata !== "object") {
        continue;
      }
      const url = typeof languageMetadata.url === "string" ? languageMetadata.url.trim() : "";
      if (url) {
        languages[languageId] = { url };
      }
    }
  }

  const legacyLanguage = typeof source.language === "string" ? source.language : DEFAULT_LANGUAGE_ID;
  const legacyUrl = typeof source.url === "string" ? source.url.trim() : "";
  if (legacyUrl && getLanguageIds().includes(legacyLanguage) && !languages[legacyLanguage]) {
    languages[legacyLanguage] = { url: legacyUrl };
  }

  const normalized = {
    lessonId: String(source.lessonId || ""),
    title: String(source.title || ""),
    languages,
  };
  if (source.level !== undefined && source.level !== null && String(source.level).trim()) {
    normalized.level = String(source.level).trim();
  }
  if (source.category !== undefined && source.category !== null && String(source.category).trim()) {
    normalized.category = String(source.category).trim();
  }

  if (Array.isArray(source.examples)) {
    normalized.examples = source.examples;
  }

  return normalized;
}

// 예전 metadata에 난이도가 없으면 problem.md 상단 메타 정보에서 보완합니다.
async function readProblemMarkdownMetadata(problemDir) {
  try {
    const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
    return {
      level: matchFirst(markdown, /^-\s*난이도:\s*(?:Level\s*)?(.+?)\s*$/mi),
      category: matchFirst(markdown, /^-\s*분류:\s*(.+?)\s*$/mi),
    };
  } catch {
    return {};
  }
}

// metadata 저장 전에 legacy initialCode를 파일로 보존하고 정규화된 JSON을 씁니다.
async function writeProgrammersMetadata(uri, metadata) {
  await preserveLegacyInitialCode(uri, metadata);
  const normalized = normalizeProgrammersMetadata(metadata);
  await writeJson(uri, normalized);
}

// 예전 metadata 안에 직접 저장되던 initialCode를 언어별 초기 템플릿 파일로 옮깁니다.
async function preserveLegacyInitialCode(metadataUri, metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const problemDir = path.dirname(path.dirname(metadataUri.fsPath));
  const candidates = [];

  const legacyLanguage = typeof source.language === "string" ? source.language : DEFAULT_LANGUAGE_ID;
  if (typeof source.initialCode === "string" && source.initialCode.trim() && getLanguageIds().includes(legacyLanguage)) {
    candidates.push({ languageId: legacyLanguage, initialCode: source.initialCode });
  }

  if (source.languages && typeof source.languages === "object") {
    for (const [languageId, languageMetadata] of Object.entries(source.languages)) {
      if (!getLanguageIds().includes(languageId) || !languageMetadata || typeof languageMetadata !== "object") {
        continue;
      }
      if (typeof languageMetadata.initialCode === "string" && languageMetadata.initialCode.trim()) {
        candidates.push({ languageId, initialCode: languageMetadata.initialCode });
      }
    }
  }

  for (const candidate of candidates) {
    const initialUri = vscode.Uri.file(getInitialSolutionPath(problemDir, candidate.languageId));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(initialUri.fsPath)));
    await writeFileIfAbsent(initialUri, candidate.initialCode.endsWith("\n") ? candidate.initialCode : `${candidate.initialCode}\n`);
  }
}

// 문제 목록 scan에서 제외할 extension 내부 helper 폴더인지 판단합니다.
function isInternalHelperFolder(name) {
  return name === HELPER_DIR_NAME;
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
  updateProblemIndexSummary,
  updateProblemIndexReviewStates,
};
