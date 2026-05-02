const path = require("path");

const COMPILE_TIMEOUT_MS = 15000;
const DEFAULT_TEST_TIMEOUT_MS = 3000;
const PROGRAMMERS_HOST = "school.programmers.co.kr";
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOCKER_IMAGE = "kangjung/programmers-helper-runtime:3";
const DOCKER_LOCAL_IMAGE = "programmers-helper-runtime:3";
const DOCKER_CONTAINER_PREFIX = "programmers-helper-runtime-v3-";
const DOCKER_WORKSPACE_ROOT = "/workspace/Programmers";
const DEFAULT_EXECUTION_MODE = "docker";
const DEFAULT_LANGUAGE = "cpp";
const DEFAULT_COMPILER_COMMAND = "clang++";
const DEFAULT_CPP_STANDARD = "c++17";
const JAVA_COMMAND = "java";
const JAVAC_COMMAND = "javac";
const PYTHON_COMMAND = "python3";

// 샘플 테스트를 빠르게 돌릴 때 쓰는 C++ 기본 컴파일 옵션을 만듭니다.
function getFastCompileFlags(cppStandard = DEFAULT_CPP_STANDARD) {
  return [
    `-std=${cppStandard}`,
    "-Wall",
    "-O2",
  ];
}

// 런타임 오류 재현 시 sanitizer를 켜는 C++ 디버그 컴파일 옵션을 만듭니다.
function getDebugCompileFlags(cppStandard = DEFAULT_CPP_STANDARD) {
  return getDebugCompileFlagsForMode("docker", cppStandard);
}

// 실행 모드에 맞춰 sanitizer 지원 여부가 다른 디버그 컴파일 옵션을 고릅니다.
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

// extension 설치 위치에서 Docker runtime image를 빌드할 Dockerfile 경로를 찾습니다.
function getDockerfilePath(extensionDir) {
  return path.join(extensionDir, "docker", "cpp-runtime.Dockerfile");
}

module.exports = {
  COMPILE_TIMEOUT_MS,
  DEFAULT_COMPILER_COMMAND,
  DEFAULT_CPP_STANDARD,
  DEFAULT_EXECUTION_MODE,
  DEFAULT_LANGUAGE,
  DEFAULT_TEST_TIMEOUT_MS,
  DOCKER_CONTAINER_PREFIX,
  DOCKER_IMAGE,
  DOCKER_LOCAL_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  MAX_FETCH_BYTES,
  MAX_REDIRECTS,
  JAVA_COMMAND,
  JAVAC_COMMAND,
  PYTHON_COMMAND,
  PROGRAMMERS_HOST,
  getDockerfilePath,
  getDebugCompileFlags,
  getDebugCompileFlagsForMode,
  getFastCompileFlags,
};
