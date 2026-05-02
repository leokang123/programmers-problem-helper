const path = require("path");
const vscode = require("vscode");


// 대상 경로가 기준 경로와 같거나 그 내부인지 확인합니다.
function isSameOrInsidePath(root, target) {
  return target === root || isPathInside(root, target);
}


// 대상 경로가 기준 경로 내부인지 확인합니다.
function isPathInside(root, target) {
  return target.startsWith(root + path.sep);
}


// VS Code filesystem API로 텍스트 파일을 읽습니다.
async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}


// JSON 파일을 읽고 실패하면 undefined로 처리합니다.
async function readJson(uri) {
  try {
    return JSON.parse(await readText(uri));
  } catch {
    return undefined;
  }
}


// lessonId_title 형태의 폴더명에서 문제 번호와 제목을 추정합니다.
function parseProblemFolderName(folderName) {
  const match = folderName.match(/^(\d+)_?(.*)$/);
  if (!match) {
    return { lessonId: "", title: folderName.replace(/_/g, " ") };
  }
  return {
    lessonId: match[1],
    title: (match[2] || folderName).replace(/_/g, " "),
  };
}


// 파일이 없을 때만 새로 씁니다.
async function writeFileIfAbsent(uri, contents) {
  try {
    await vscode.workspace.fs.stat(uri);
    return;
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  }
}


// VS Code filesystem API 기준으로 파일/폴더 존재 여부를 확인합니다.
async function fileExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}


// JSON 파일을 보기 좋게 씁니다.
async function writeJson(uri, value) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
}


// 파일명에 사용할 timestamp를 만듭니다.
function formatTimestamp(date) {
  // 날짜/시간 구성 요소를 두 자리 문자열로 맞춥니다.
  const pad = (value) => String(value).padStart(2, "0");
  // 밀리초 구성 요소를 세 자리 문자열로 맞춥니다.
  const padMs = (value) => String(value).padStart(3, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    padMs(date.getMilliseconds()),
  ].join("");
}

module.exports = {
  isSameOrInsidePath,
  isPathInside,
  readText,
  readJson,
  parseProblemFolderName,
  writeFileIfAbsent,
  fileExists,
  writeJson,
  formatTimestamp,
};
