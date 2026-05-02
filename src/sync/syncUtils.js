const fs = require("fs/promises");
const os = require("os");
const path = require("path");

// remote URL이 token 인증을 사용할 수 있는 GitHub HTTPS 주소인지 확인합니다.
function isHttpsGitHubRemote(remoteUrl) {
  return /^https:\/\/github\.com\//i.test(remoteUrl);
}

// Git stderr/stdout에 token이 섞여 나오지 않도록 표시 문자열을 마스킹합니다.
function maskToken(value, token) {
  if (!token || !value) {
    return value || "";
  }
  return String(value).split(token).join("<token>");
}

// notification/output에 들어갈 오류 메시지 길이를 제한합니다.
function limitMessage(value, max = 400) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// merge/rebase 등 진행 중인 Git 작업 정보를 포함한 오류 객체를 만듭니다.
function createGitOperationError(gitOperation, message, options = {}) {
  const error = new Error(message);
  error.gitOperation = gitOperation;
  if (Object.keys(options).length > 0) {
    Object.assign(error, options);
  }
  return error;
}

// conflict marker가 남은 파일 목록을 sync 중단 오류로 감쌉니다.
function createConflictMarkerError(files) {
  const error = new Error(files.join("\n"));
  error.conflictMarkers = true;
  return error;
}

// 파일 내용에 Git conflict marker가 남아 있는지 확인합니다.
function hasConflictMarkers(content) {
  return /^<{7}(?:\s|$)/m.test(content)
    || /^={7}$/m.test(content)
    || /^>{7}(?:\s|$)/m.test(content);
}

// Webview에서 받은 경로가 Git 저장소 내부 경로인지 검증합니다.
function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

// 사용자가 conflict marker를 그대로 commit/push하지 못하게 하는 Git hook 스크립트를 만듭니다.
function buildConflictMarkerHookScript() {
  return `#!/bin/sh
# Programmers Problem Helper conflict marker guard v2
set -eu

files=$(git ls-files 2>/dev/null || true)
files="$files
$(git ls-files --others --exclude-standard 2>/dev/null || true)"

bad=""
printf '%s\\n' "$files" | awk 'NF' | sort -u | while IFS= read -r file; do
  [ -f "$file" ] || continue
  if grep -q '^<<<<<<< ' "$file" && grep -q '^=======$' "$file" && grep -q '^>>>>>>> ' "$file"; then
    printf '%s\\n' "$file"
  fi
done > .git/programmers-conflict-markers

if [ -s .git/programmers-conflict-markers ]; then
  echo "Programmers Problem Helper: conflict markers remain. Resolve these files before commit/push:" >&2
  cat .git/programmers-conflict-markers >&2
  rm -f .git/programmers-conflict-markers
  exit 1
fi

rm -f .git/programmers-conflict-markers
exit 0
`;
}

// Node filesystem 기준으로 경로 존재 여부를 확인합니다.
async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// sync 초기화 시 필요한 ignore 패턴을 기존 .gitignore에 중복 없이 추가합니다.
async function appendGitignorePatterns(gitignorePath, patterns) {
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf8");
  } catch {
    content = "";
  }

  const existing = new Set(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = patterns.filter((pattern) => !existing.has(pattern));
  if (missing.length === 0) {
    return;
  }

  const prefix = content && !content.endsWith("\n") ? os.EOL : "";
  await fs.appendFile(gitignorePath, `${prefix}${missing.join(os.EOL)}${os.EOL}`, "utf8");
}

module.exports = {
  appendGitignorePatterns,
  buildConflictMarkerHookScript,
  createConflictMarkerError,
  createGitOperationError,
  exists,
  hasConflictMarkers,
  isHttpsGitHubRemote,
  isPathInside,
  limitMessage,
  maskToken,
};
