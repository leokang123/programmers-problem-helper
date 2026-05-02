const path = require("path");

const HELPER_DIR_NAME = ".programmers-helper";
const GENERATED_DIR_NAME = "generated";
const ARTIFACTS_DIR_NAME = "artifacts";
const FINGERPRINTS_DIR_NAME = "fingerprints";
const INITIAL_DIR_NAME = "initial";
const RUNNERS_DIR_NAME = "runners";
const SOLUTIONS_DIR_NAME = "solutions";

// 문제 폴더 내부 helper 영역의 상대 경로를 만듭니다.
function helperRelativePath(...parts) {
  return path.posix.join(HELPER_DIR_NAME, ...parts);
}

// 문제 폴더 내부 helper 영역의 절대 경로를 만듭니다.
function helperPath(problemDir, ...parts) {
  return path.join(problemDir, HELPER_DIR_NAME, ...parts);
}

// 테스트 실행 중 생성되는 runner/artifact 영역의 상대 경로를 만듭니다.
function generatedRelativePath(...parts) {
  return helperRelativePath(GENERATED_DIR_NAME, ...parts);
}

// 테스트 실행 중 생성되는 runner/artifact 영역의 절대 경로를 만듭니다.
function generatedPath(problemDir, ...parts) {
  return helperPath(problemDir, GENERATED_DIR_NAME, ...parts);
}

// 컴파일 산출물 위치의 상대 경로를 만듭니다.
function artifactRelativePath(...parts) {
  return generatedRelativePath(ARTIFACTS_DIR_NAME, ...parts);
}

// 컴파일 산출물 위치의 절대 경로를 만듭니다.
function artifactPath(problemDir, ...parts) {
  return generatedPath(problemDir, ARTIFACTS_DIR_NAME, ...parts);
}

// runner 캐시 검증용 fingerprint 파일의 상대 경로를 만듭니다.
function fingerprintRelativePath(...parts) {
  return generatedRelativePath(FINGERPRINTS_DIR_NAME, ...parts);
}

// runner 캐시 검증용 fingerprint 파일의 절대 경로를 만듭니다.
function fingerprintPath(problemDir, ...parts) {
  return generatedPath(problemDir, FINGERPRINTS_DIR_NAME, ...parts);
}

// 생성된 언어별 테스트 runner 파일의 상대 경로를 만듭니다.
function runnerRelativePath(...parts) {
  return generatedRelativePath(RUNNERS_DIR_NAME, ...parts);
}

// 생성된 언어별 테스트 runner 파일의 절대 경로를 만듭니다.
function runnerPath(problemDir, ...parts) {
  return generatedPath(problemDir, RUNNERS_DIR_NAME, ...parts);
}

// 언어별 초기 풀이 템플릿의 상대 경로를 만듭니다.
function initialRelativePath(fileName) {
  return helperRelativePath(INITIAL_DIR_NAME, fileName);
}

// 언어별 초기 풀이 템플릿의 절대 경로를 만듭니다.
function initialPath(problemDir, fileName) {
  return helperPath(problemDir, INITIAL_DIR_NAME, fileName);
}

// 이전 버전이 쓰던 초기 템플릿 상대 경로를 만듭니다.
function legacyInitialRelativePath(fileName) {
  return helperRelativePath(fileName);
}

// 이전 버전이 쓰던 초기 템플릿 절대 경로를 만듭니다.
function legacyInitialPath(problemDir, fileName) {
  return helperPath(problemDir, fileName);
}

// 다시 풀기 snapshot 저장소의 상대 경로를 만듭니다.
function solutionsRelativePath(...parts) {
  return helperRelativePath(SOLUTIONS_DIR_NAME, ...parts);
}

// 다시 풀기 snapshot 저장소의 절대 경로를 만듭니다.
function solutionsPath(problemDir, ...parts) {
  return helperPath(problemDir, SOLUTIONS_DIR_NAME, ...parts);
}

module.exports = {
  ARTIFACTS_DIR_NAME,
  FINGERPRINTS_DIR_NAME,
  GENERATED_DIR_NAME,
  HELPER_DIR_NAME,
  INITIAL_DIR_NAME,
  RUNNERS_DIR_NAME,
  SOLUTIONS_DIR_NAME,
  artifactPath,
  artifactRelativePath,
  fingerprintPath,
  fingerprintRelativePath,
  generatedPath,
  generatedRelativePath,
  helperPath,
  helperRelativePath,
  initialPath,
  initialRelativePath,
  legacyInitialPath,
  legacyInitialRelativePath,
  runnerPath,
  runnerRelativePath,
  solutionsPath,
  solutionsRelativePath,
};
