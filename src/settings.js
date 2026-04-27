const vscode = require("vscode");
const {
  DEFAULT_COMPILER_COMMAND,
  DEFAULT_CPP_STANDARD,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_TEST_TIMEOUT_MS,
} = require("./config");

const EXECUTION_MODES = new Set(["docker", "local"]);
const COMPILER_COMMANDS = new Set(["clang++", "g++"]);
const CPP_STANDARDS = new Set(["c++17", "c++20"]);

function getExecutionSettings() {
  const config = vscode.workspace.getConfiguration("programmersHelper");
  return {
    executionMode: normalizeEnum(config.get("executionMode"), EXECUTION_MODES, DEFAULT_EXECUTION_MODE),
    compilerCommand: normalizeEnum(config.get("compilerCommand"), COMPILER_COMMANDS, DEFAULT_COMPILER_COMMAND),
    cppStandard: normalizeEnum(config.get("cppStandard"), CPP_STANDARDS, DEFAULT_CPP_STANDARD),
    testTimeoutMs: normalizeTimeoutMs(config.get("testTimeoutMs"), DEFAULT_TEST_TIMEOUT_MS),
  };
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

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
