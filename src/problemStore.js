const path = require("path");
const vscode = require("vscode");
const {
  decodeHtml,
  extractExamplesFromMarkdown,
  fetchText,
  htmlToMarkdown,
  matchFirst,
  slugify,
} = require("./problemParsing");

// 저장된 문제 목록을 읽고 정렬합니다.
async function loadProblems(programmersDir) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(programmersDir);
  } catch {
    return [];
  }

  const problems = (await Promise.all(
    entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(async ([name]) => {
        const problemDir = vscode.Uri.joinPath(programmersDir, name);
        if (!(await hasProblemFiles(problemDir))) {
          return undefined;
        }
        return loadProblemInfo(problemDir.fsPath);
      })
  )).filter(Boolean);

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
  if (workspaceUri && vscode.env.remoteName === "dev-container") {
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
  if (workspaceUri && vscode.env.remoteName === "dev-container") {
    return path.basename(workspaceUri.fsPath) === "Programmers"
      ? workspaceUri
      : vscode.Uri.joinPath(workspaceUri, "Programmers");
  }
  return vscode.Uri.joinPath(context.globalStorageUri, "Programmers");
}

// 마지막으로 연 문제를 목록에서 찾습니다.
function getCurrentProblemFromList(context, problems) {
  const last = context.workspaceState.get("lastProblemDir");
  if (typeof last !== "string") {
    return undefined;
  }
  const normalizedLast = path.resolve(last);
  return problems.find((problem) => path.resolve(problem.problemDir) === normalizedLast);
}

// 문제 폴더의 표시 정보를 읽습니다.
async function loadProblemInfo(problemDir) {
  const folderName = path.basename(problemDir);
  const helperDir = vscode.Uri.file(path.join(problemDir, ".programmers-helper"));
  const metadata = await readJson(vscode.Uri.joinPath(helperDir, "programmers.json"));
  const reviewData = await readJson(vscode.Uri.joinPath(helperDir, "review.json"));
  const fallback = parseProblemFolderName(folderName);
  return {
    problemDir,
    folderName,
    lessonId: String(metadata?.lessonId || fallback.lessonId || ""),
    title: String(metadata?.title || fallback.title || folderName),
    review: Boolean(reviewData?.review),
    updatedAt: typeof reviewData?.updatedAt === "string" ? reviewData.updatedAt : "",
  };
}

// 문제의 예제 테스트를 메타데이터나 markdown에서 읽습니다.
async function loadProblemExamples(problemDir) {
  const metadata = await readJson(vscode.Uri.file(path.join(problemDir, ".programmers-helper", "programmers.json")));
  if (Array.isArray(metadata?.examples)) {
    return metadata.examples;
  }

  try {
    const markdown = await readText(vscode.Uri.file(path.join(problemDir, "problem.md")));
    return extractExamplesFromMarkdown(markdown);
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
async function createProblem(programmersDir, lessonId) {
  const existing = await findExistingProblem(programmersDir, lessonId);
  if (existing) {
    return existing;
  }

  const url = `https://school.programmers.co.kr/learn/courses/30/lessons/${lessonId}?language=cpp`;
  const html = await fetchText(url);
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

  const level = matchFirst(html, /data-challenge-level="([^"]+)"/);
  const category = matchFirst(html, /data-challenge-category="([^"]+)"/);
  const folderName = `${lessonId}_${slugify(title)}`;
  const problemDir = vscode.Uri.joinPath(programmersDir, folderName);
  const mdUri = vscode.Uri.joinPath(problemDir, "problem.md");
  const cppUri = vscode.Uri.joinPath(problemDir, "solution.cpp");
  const helperDir = vscode.Uri.joinPath(problemDir, ".programmers-helper");
  const metadataUri = vscode.Uri.joinPath(helperDir, "programmers.json");

  await vscode.workspace.fs.createDirectory(problemDir);
  await vscode.workspace.fs.createDirectory(helperDir);

  const problemMd = [
    `# [Programmers ${lessonId}] ${title}`,
    "",
    `- 출처: [프로그래머스 스쿨](${url})`,
    level ? `- 난이도: Level ${level}` : "",
    category ? `- 분류: ${category}` : "",
    "",
    htmlToMarkdown(markdownHtml),
    "",
  ].filter((line, index, arr) => line !== "" || arr[index - 1] !== "").join("\n");

  await writeFileIfAbsent(mdUri, problemMd);

  const code = decodeHtml(
    matchFirst(html, /<textarea hidden id="code" name="code">([\s\S]*?)<\/textarea>/, /name="initial_code_\d+"[^>]*value="([\s\S]*?)"/)
  ).replace(/\r\n/g, "\n");

  if (!code.trim()) {
    throw new Error("C++ 기본 코드 템플릿을 찾지 못했습니다.");
  }

  await writeFileIfAbsent(cppUri, code.trimEnd() + "\n");

  const metadata = {
    lessonId,
    title,
    url,
    examples: extractExamplesFromMarkdown(problemMd),
  };
  await vscode.workspace.fs.writeFile(metadataUri, Buffer.from(JSON.stringify(metadata, null, 2) + "\n", "utf8"));

  return { folderName, problemDir, mdUri, cppUri, examples: metadata.examples };
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
    if (type !== vscode.FileType.Directory) {
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

// 문제 폴더에 필수 파일이 있는지 확인합니다.
async function hasProblemFiles(problemDir) {
  try {
    await Promise.all([
      vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, "problem.md")),
      vscode.workspace.fs.stat(vscode.Uri.joinPath(problemDir, "solution.cpp")),
    ]);
    return true;
  } catch {
    return false;
  }
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

module.exports = {
  createProblem,
  getCurrentProblemFromList,
  getDefaultProgrammersDir,
  hasProblemFiles,
  loadProblemExamples,
  loadProblemInfo,
  loadProblems,
  loadSavedCustomTests,
  readText,
  resolveProgrammersDir,
  saveCustomTests,
};
