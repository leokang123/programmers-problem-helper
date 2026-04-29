const path = require("path");

const HELPER_DIR_NAME = ".programmers-helper";
const GENERATED_DIR_NAME = "generated";
const ARTIFACTS_DIR_NAME = "artifacts";
const FINGERPRINTS_DIR_NAME = "fingerprints";
const INITIAL_DIR_NAME = "initial";
const RUNNERS_DIR_NAME = "runners";
const SOLUTIONS_DIR_NAME = "solutions";

function helperRelativePath(...parts) {
  return path.posix.join(HELPER_DIR_NAME, ...parts);
}

function helperPath(problemDir, ...parts) {
  return path.join(problemDir, HELPER_DIR_NAME, ...parts);
}

function generatedRelativePath(...parts) {
  return helperRelativePath(GENERATED_DIR_NAME, ...parts);
}

function generatedPath(problemDir, ...parts) {
  return helperPath(problemDir, GENERATED_DIR_NAME, ...parts);
}

function artifactRelativePath(...parts) {
  return generatedRelativePath(ARTIFACTS_DIR_NAME, ...parts);
}

function artifactPath(problemDir, ...parts) {
  return generatedPath(problemDir, ARTIFACTS_DIR_NAME, ...parts);
}

function fingerprintRelativePath(...parts) {
  return generatedRelativePath(FINGERPRINTS_DIR_NAME, ...parts);
}

function fingerprintPath(problemDir, ...parts) {
  return generatedPath(problemDir, FINGERPRINTS_DIR_NAME, ...parts);
}

function runnerRelativePath(...parts) {
  return generatedRelativePath(RUNNERS_DIR_NAME, ...parts);
}

function runnerPath(problemDir, ...parts) {
  return generatedPath(problemDir, RUNNERS_DIR_NAME, ...parts);
}

function initialRelativePath(fileName) {
  return helperRelativePath(INITIAL_DIR_NAME, fileName);
}

function initialPath(problemDir, fileName) {
  return helperPath(problemDir, INITIAL_DIR_NAME, fileName);
}

function legacyInitialRelativePath(fileName) {
  return helperRelativePath(fileName);
}

function legacyInitialPath(problemDir, fileName) {
  return helperPath(problemDir, fileName);
}

function solutionsRelativePath(...parts) {
  return helperRelativePath(SOLUTIONS_DIR_NAME, ...parts);
}

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
