const cppRunnerBuilder = require("./cppRunnerBuilder");
const javaRunnerBuilder = require("./javaRunnerBuilder");
const pythonRunnerBuilder = require("./pythonRunnerBuilder");
const {
  getLanguage,
} = require("./languages");

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
