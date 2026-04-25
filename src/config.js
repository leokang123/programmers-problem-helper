const path = require("path");

const COMPILE_TIMEOUT_MS = 15000;
const TEST_TIMEOUT_MS = 3000;
const PROGRAMMERS_HOST = "school.programmers.co.kr";
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOCKER_IMAGE = "programmers-helper-cpp-runtime:1";
const DOCKER_CONTAINER_PREFIX = "programmers-helper-runtime-";
const DOCKER_WORKSPACE_ROOT = "/workspace/Programmers";
const DOCKER_FAST_COMPILE_FLAGS = [
  "-std=c++17",
  "-Wall",
  "-O2",
];
const DOCKER_DEBUG_COMPILE_FLAGS = [
  "-std=c++17",
  "-Wall",
  "-O0",
  "-g",
  "-fno-omit-frame-pointer",
  "-fsanitize=address,undefined",
  "-fno-sanitize-recover=all",
];

// 확장 폴더 기준 Dockerfile 경로를 만듭니다.
function getDockerfilePath(extensionDir) {
  return path.join(extensionDir, "docker", "cpp-runtime.Dockerfile");
}

module.exports = {
  COMPILE_TIMEOUT_MS,
  DOCKER_CONTAINER_PREFIX,
  DOCKER_DEBUG_COMPILE_FLAGS,
  DOCKER_FAST_COMPILE_FLAGS,
  DOCKER_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  MAX_FETCH_BYTES,
  MAX_REDIRECTS,
  PROGRAMMERS_HOST,
  TEST_TIMEOUT_MS,
  getDockerfilePath,
};
