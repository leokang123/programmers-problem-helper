const path = require("path");
const {
  HELPER_DIR_NAME,
  SOLUTIONS_DIR_NAME,
  artifactRelativePath,
  initialPath,
  legacyInitialPath,
  runnerRelativePath,
} = require("./helperPaths");

const LANGUAGE_DEFINITIONS = {
  cpp: {
    id: "cpp",
    label: "C++",
    programmersParam: "cpp",
    solutionFileName: "solution.cpp",
    initialSolutionFileName: "initial-solution.cpp",
    runnerFileName: "test_runner.cpp",
    fastArtifactPath: artifactRelativePath("cpp-fast"),
    debugArtifactPath: artifactRelativePath("cpp-debug"),
    sourceExtensions: [".cpp"],
    snapshotExtension: ".cpp",
    compilerSettingsLabel: (settings) => `${settings.compilerCommand} -std=${settings.cppStandard}`,
    supportsDebugRetry: true,
  },
  java: {
    id: "java",
    label: "Java",
    programmersParam: "java",
    solutionFileName: "Solution.java",
    initialSolutionFileName: "initial-solution.java",
    runnerFileName: "TestRunner.java",
    fastArtifactPath: artifactRelativePath("java-classes"),
    debugArtifactPath: artifactRelativePath("java-classes"),
    sourceExtensions: [".java"],
    snapshotExtension: ".java",
    compilerSettingsLabel: () => "javac/java",
    supportsDebugRetry: false,
  },
  python: {
    id: "python",
    label: "Python",
    programmersParam: "python3",
    solutionFileName: "solution.py",
    initialSolutionFileName: "initial-solution.py",
    runnerFileName: "test_runner.py",
    fastArtifactPath: runnerRelativePath("test_runner.py"),
    debugArtifactPath: runnerRelativePath("test_runner.py"),
    sourceExtensions: [".py"],
    snapshotExtension: ".py",
    compilerSettingsLabel: () => "python3",
    supportsDebugRetry: false,
  },
};

const DEFAULT_LANGUAGE_ID = "cpp";

// 설정/명령에서 넘어온 언어 id를 지원 언어 정의로 해석합니다.
function getLanguage(languageId) {
  return LANGUAGE_DEFINITIONS[languageId] || LANGUAGE_DEFINITIONS[DEFAULT_LANGUAGE_ID];
}

// 설정 UI와 metadata 정규화에서 사용할 지원 언어 id 목록을 반환합니다.
function getLanguageIds() {
  return Object.keys(LANGUAGE_DEFINITIONS);
}

// 문제 폴더에 놓일 현재 풀이 파일명을 언어 기준으로 반환합니다.
function getSolutionFileName(languageId) {
  return getLanguage(languageId).solutionFileName;
}

// 문제 폴더와 언어 id로 현재 풀이 파일의 절대 경로를 만듭니다.
function getSolutionPath(problemDir, languageId) {
  return path.join(problemDir, getSolutionFileName(languageId));
}

// 문제 생성/언어 전환 시 비교 기준이 되는 초기 풀이 템플릿 경로를 만듭니다.
function getInitialSolutionPath(problemDir, languageId) {
  return initialPath(problemDir, getLanguage(languageId).initialSolutionFileName);
}

// 예전 metadata 구조에서 옮겨올 초기 풀이 템플릿 경로를 만듭니다.
function getLegacyInitialSolutionPath(problemDir, languageId) {
  return legacyInitialPath(problemDir, getLanguage(languageId).initialSolutionFileName);
}

// 다시 풀기 기록에 저장할 snapshot 파일명을 언어와 시각으로 만듭니다.
function getSnapshotFileName(languageId, timestamp) {
  return `solution-${timestamp}${getLanguage(languageId).snapshotExtension}`;
}

// 열린 파일이 이 extension이 실행할 수 있는 풀이 파일인지 확장자로 판정합니다.
function isSupportedSourceExtension(extension) {
  return getLanguageIds().some((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
}

// 파일 확장자에서 실행 언어를 역으로 찾습니다.
function getLanguageBySourceExtension(extension) {
  return getLanguageIds().find((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
}

// 문제 폴더 안 상대 경로가 현재 풀이 또는 snapshot 실행 대상인지 확인합니다.
function isRunnableSolutionPath(relativeParts, languageId) {
  const language = getLanguage(languageId);
  if (relativeParts.length === 1) {
    return relativeParts[0] === language.solutionFileName;
  }

  if (relativeParts.length !== 3 || relativeParts[0] !== HELPER_DIR_NAME || relativeParts[1] !== SOLUTIONS_DIR_NAME) {
    return false;
  }

  const fileName = relativeParts[2];
  return fileName.startsWith("solution-") && path.posix.extname(fileName) === language.snapshotExtension;
}

// 열린 파일 상대 경로를 보고 어떤 언어의 실행 대상인지 추정합니다.
function inferLanguageFromRunnablePath(relativeParts) {
  return getLanguageIds().find((languageId) => isRunnableSolutionPath(relativeParts, languageId));
}

module.exports = {
  DEFAULT_LANGUAGE_ID,
  getInitialSolutionPath,
  getLegacyInitialSolutionPath,
  getLanguage,
  getLanguageBySourceExtension,
  getLanguageIds,
  getSnapshotFileName,
  getSolutionFileName,
  getSolutionPath,
  inferLanguageFromRunnablePath,
  isRunnableSolutionPath,
  isSupportedSourceExtension,
};
