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

function getLanguage(languageId) {
  return LANGUAGE_DEFINITIONS[languageId] || LANGUAGE_DEFINITIONS[DEFAULT_LANGUAGE_ID];
}

function getLanguageIds() {
  return Object.keys(LANGUAGE_DEFINITIONS);
}

function getSolutionFileName(languageId) {
  return getLanguage(languageId).solutionFileName;
}

function getSolutionPath(problemDir, languageId) {
  return path.join(problemDir, getSolutionFileName(languageId));
}

function getInitialSolutionPath(problemDir, languageId) {
  return initialPath(problemDir, getLanguage(languageId).initialSolutionFileName);
}

function getLegacyInitialSolutionPath(problemDir, languageId) {
  return legacyInitialPath(problemDir, getLanguage(languageId).initialSolutionFileName);
}

function getSnapshotFileName(languageId, timestamp) {
  return `solution-${timestamp}${getLanguage(languageId).snapshotExtension}`;
}

function isSupportedSourceExtension(extension) {
  return getLanguageIds().some((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
}

function getLanguageBySourceExtension(extension) {
  return getLanguageIds().find((languageId) => getLanguage(languageId).sourceExtensions.includes(extension));
}

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
