const vscode = require("vscode");
const {
  DEFAULT_COMPILER_COMMAND,
  DEFAULT_CPP_STANDARD,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_LANGUAGE,
  DEFAULT_TEST_TIMEOUT_MS,
} = require("./config");
const {
  getLanguageIds,
} = require("./languages");

const EXECUTION_MODES = new Set(["docker", "local"]);
const LANGUAGES = new Set(getLanguageIds());
const COMPILER_COMMANDS = new Set(["clang++", "g++"]);
const CPP_STANDARDS = new Set(["c++17", "c++20"]);

// VS Code 설정을 읽고 실행 코드가 기대하는 안정적인 값으로 정규화합니다.
function getExecutionSettings() {
  const config = vscode.workspace.getConfiguration("programmersHelper");
  return {
    language: normalizeEnum(config.get("language"), LANGUAGES, DEFAULT_LANGUAGE),
    executionMode: normalizeEnum(config.get("executionMode"), EXECUTION_MODES, DEFAULT_EXECUTION_MODE),
    compilerCommand: normalizeEnum(config.get("compilerCommand"), COMPILER_COMMANDS, DEFAULT_COMPILER_COMMAND),
    cppStandard: normalizeEnum(config.get("cppStandard"), CPP_STANDARDS, DEFAULT_CPP_STANDARD),
    testTimeoutMs: normalizeTimeoutMs(config.get("testTimeoutMs"), DEFAULT_TEST_TIMEOUT_MS),
  };
}

// enum 설정은 package.json의 선택지 밖 값이 들어오면 기본값으로 되돌립니다.
function normalizeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

// timeout 설정은 숫자로 강제하고 너무 작은 값은 테스트 프로세스 관리가 가능한 최소값으로 올립니다.
function normalizeTimeoutMs(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(100, Math.floor(numeric));
}

module.exports = {
  getExecutionSettings,
};
