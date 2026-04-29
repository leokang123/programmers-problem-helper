const vscode = require("vscode");

function isDevelopmentExtension(context) {
  return context?.extensionMode === vscode.ExtensionMode.Development;
}

function getDockerRuntimeModeLabel(context) {
  const edition = isDevelopmentExtension(context) ? "개발판" : "배포판";
  return `${edition}: 로컬 + 실행 컨테이너`;
}

function getExtensionRuntimeLabel(context) {
  return isDevelopmentExtension(context) ? "development" : "packaged";
}

module.exports = {
  getDockerRuntimeModeLabel,
  getExtensionRuntimeLabel,
  isDevelopmentExtension,
};
