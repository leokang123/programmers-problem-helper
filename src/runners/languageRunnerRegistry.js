const cppRunnerBuilder = require("./cppRunnerBuilder");
const javaRunnerBuilder = require("./javaRunnerBuilder");
const pythonRunnerBuilder = require("./pythonRunnerBuilder");
const {
  getLanguage,
} = require("../problems/languages");

// 현재 실행 언어에 맞는 runner builder 구현을 반환합니다.
function getRunnerBuilder(languageId) {
  const language = getLanguage(languageId);
  if (language.id === "java") {
    return javaRunnerBuilder;
  }
  if (language.id === "python") {
    return pythonRunnerBuilder;
  }
  return cppRunnerBuilder;
}

module.exports = {
  getRunnerBuilder,
};
