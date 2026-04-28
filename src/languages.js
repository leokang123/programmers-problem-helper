const path = require("path");

const LANGUAGE_DEFINITIONS = {
  cpp: {
    id: "cpp",
    label: "C++",
    programmersParam: "cpp",
    solutionFileName: "solution.cpp",
    initialSolutionFileName: "initial-solution.cpp",
    runnerFileName: "test_runner.cpp",
    fastArtifactPath: ".programmers-helper/test_runner_fast",
    debugArtifactPath: ".programmers-helper/test_runner_debug",
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
    fastArtifactPath: ".programmers-helper/java-classes",
    debugArtifactPath: ".programmers-helper/java-classes",
    sourceExtensions: [".java"],
    snapshotExtension: ".java",
    compilerSettingsLabel: () => "javac/java",
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

function getInitialSolutionRelativePath(languageId) {
  return path.posix.join(".programmers-helper", getLanguage(languageId).initialSolutionFileName);
}

function getInitialSolutionPath(problemDir, languageId) {
  return path.join(problemDir, ".programmers-helper", getLanguage(languageId).initialSolutionFileName);
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

  if (relativeParts.length !== 3 || relativeParts[0] !== ".programmers-helper" || relativeParts[1] !== "solutions") {
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
  getInitialSolutionRelativePath,
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
