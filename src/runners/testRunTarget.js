const {
  getExecutionSettings,
} = require("../core/settings");
const {
  getLanguage,
  getSolutionPath,
} = require("../problems/languages");


// Windows local 실행에서 필요한 binary 확장자를 반환합니다.
function getLocalBinaryExtension(settings) {
  return settings.executionMode === "local" && process.platform === "win32" ? ".exe" : "";
}


// 명령/사이드바에서 들어온 실행 대상을 problemDir, solutionPath, language로 정규화합니다.
function normalizeRunTarget(target) {
  if (!target) {
    return undefined;
  }
  if (typeof target === "string") {
    const settings = getExecutionSettings();
    const language = getLanguage(settings.language);
    return {
      problemDir: target,
      solutionPath: getSolutionPath(target, language.id),
      cppPath: getSolutionPath(target, language.id),
      language: language.id,
    };
  }
  if (typeof target.problemDir === "string") {
    const settings = getExecutionSettings();
    const language = getLanguage(target.language || settings.language);
    const solutionPath = typeof target.solutionPath === "string"
      ? target.solutionPath
      : typeof target.cppPath === "string"
        ? target.cppPath
        : getSolutionPath(target.problemDir, language.id);
    return {
      problemDir: target.problemDir,
      solutionPath,
      cppPath: solutionPath,
      language: language.id,
    };
  }
  return undefined;
}

module.exports = {
  getLocalBinaryExtension,
  normalizeRunTarget,
};
