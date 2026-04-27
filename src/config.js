const path = require("path");

const COMPILE_TIMEOUT_MS = 15000;
const DEFAULT_TEST_TIMEOUT_MS = 3000;
const PROGRAMMERS_HOST = "school.programmers.co.kr";
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOCKER_IMAGE = "programmers-helper-cpp-runtime:1";
const DOCKER_CONTAINER_PREFIX = "programmers-helper-runtime-";
const DOCKER_WORKSPACE_ROOT = "/workspace/Programmers";
const DEFAULT_EXECUTION_MODE = "docker";
const DEFAULT_COMPILER_COMMAND = "clang++";
const DEFAULT_CPP_STANDARD = "c++17";

function getFastCompileFlags(cppStandard = DEFAULT_CPP_STANDARD) {
  return [
    `-std=${cppStandard}`,
    "-Wall",
    "-O2",
  ];
}

function getDebugCompileFlags(cppStandard = DEFAULT_CPP_STANDARD) {
  return getDebugCompileFlagsForMode("docker", cppStandard);
}

function getDebugCompileFlagsForMode(executionMode = DEFAULT_EXECUTION_MODE, cppStandard = DEFAULT_CPP_STANDARD) {
  const common = [
    `-std=${cppStandard}`,
    "-Wall",
    "-O0",
    "-g",
    "-fno-omit-frame-pointer",
  ];

  if (executionMode !== "docker") {
    return common;
  }

  return [
    ...common,
    "-fsanitize=address,undefined",
    "-fno-sanitize-recover=all",
  ];
}

// 확장 폴더 기준 Dockerfile 경로를 만듭니다.
function getDockerfilePath(extensionDir) {
  return path.join(extensionDir, "docker", "cpp-runtime.Dockerfile");
}

module.exports = {
  COMPILE_TIMEOUT_MS,
  DEFAULT_COMPILER_COMMAND,
  DEFAULT_CPP_STANDARD,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_TEST_TIMEOUT_MS,
  DOCKER_CONTAINER_PREFIX,
  DOCKER_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  MAX_FETCH_BYTES,
  MAX_REDIRECTS,
  PROGRAMMERS_HOST,
  getDockerfilePath,
  getDebugCompileFlags,
  getDebugCompileFlagsForMode,
  getFastCompileFlags,
};
