const cppRunnerBuilder = require("./cppRunnerBuilder");
const javaRunnerBuilder = require("./javaRunnerBuilder");
const {
  getLanguage,
} = require("./languages");

function getRunnerBuilder(languageId) {
  const language = getLanguage(languageId);
  if (language.id === "java") {
    return javaRunnerBuilder;
  }
  return cppRunnerBuilder;
}

module.exports = {
  getRunnerBuilder,
};
