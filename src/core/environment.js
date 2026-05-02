const vscode = require("vscode");

// 개발 실행인지 패키징 설치본인지 구분해 저장소 위치 결정을 돕습니다.
function isDevelopmentExtension(context) {
  return context?.extensionMode === vscode.ExtensionMode.Development;
}

// Docker 상태 메시지에 표시할 현재 extension 실행 모드 라벨을 만듭니다.
function getDockerRuntimeModeLabel(context) {
  const edition = isDevelopmentExtension(context) ? "개발판" : "배포판";
  return `${edition}: 로컬 + 실행 컨테이너`;
}

// 사용자 안내 메시지에 표시할 extension runtime 라벨을 만듭니다.
function getExtensionRuntimeLabel(context) {
  return isDevelopmentExtension(context) ? "development" : "packaged";
}

module.exports = {
  getDockerRuntimeModeLabel,
  getExtensionRuntimeLabel,
  isDevelopmentExtension,
};
