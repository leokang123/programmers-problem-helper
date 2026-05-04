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
} = require("../problems/languages");

const EXECUTION_MODES = new Set(["docker", "local"]);
const LANGUAGES = new Set(getLanguageIds());
const COMPILER_COMMANDS = new Set(["clang++", "g++"]);
const CPP_STANDARDS = new Set(["c++17", "c++20"]);
const TAB_RESET_MODES = new Set(["always", "onProblemChange", "never"]);
const DEFAULT_SYNC_BRANCH = "main";

// 테스트 실행과 문제 생성에 필요한 사용자 설정을 VS Code 설정에서 읽습니다.
function getExecutionSettings() {
  const config = vscode.workspace.getConfiguration("programmersHelper");
  return {
    language: normalizeEnum(config.get("language"), LANGUAGES, DEFAULT_LANGUAGE),
    executionMode: normalizeEnum(config.get("executionMode"), EXECUTION_MODES, DEFAULT_EXECUTION_MODE),
    compilerCommand: normalizeEnum(config.get("compilerCommand"), COMPILER_COMMANDS, DEFAULT_COMPILER_COMMAND),
    cppStandard: normalizeEnum(config.get("cppStandard"), CPP_STANDARDS, DEFAULT_CPP_STANDARD),
    testTimeoutMs: normalizeTimeoutMs(config.get("testTimeoutMs"), DEFAULT_TEST_TIMEOUT_MS),
    tabResetMode: normalizeEnum(config.get("tabResetMode"), TAB_RESET_MODES, "onProblemChange"),
  };
}

// Git 동기화 흐름에서 사용할 설정값을 VS Code 설정에서 읽습니다.
function getSyncSettings() {
  const config = vscode.workspace.getConfiguration("programmersHelper");
  return {
    enabled: Boolean(config.get("sync.enabled")),
    branch: normalizeBranch(config.get("sync.branch"), DEFAULT_SYNC_BRANCH),
    autoPullOnActivate: config.get("sync.autoPullOnActivate") !== false,
    statusCheckIntervalMinutes: normalizeNonNegativeInteger(config.get("sync.statusCheckIntervalMinutes"), 0),
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

// Git 브랜치 설정을 공백 없는 안전한 문자열로 정리합니다.
function normalizeBranch(value, fallback) {
  const branch = typeof value === "string" ? value.trim() : "";
  return branch && !/[\s~^:?*[\\]/.test(branch) ? branch : fallback;
}

// 주기 설정처럼 음수가 의미 없는 숫자 설정을 0 이상의 정수로 정규화합니다.
function normalizeNonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

module.exports = {
  getExecutionSettings,
  getSyncSettings,
};
