const path = require("path");

// 충돌 파일들을 문제 폴더 단위로 묶어 Webview 항목으로 보여주기 쉽게 만듭니다.
function groupFilesByTopLevelFolder(files) {
  const groups = new Map();
  for (const file of files || []) {
    const folder = getTopLevelFolders([file])[0] || path.dirname(file) || file;
    if (!groups.has(folder)) {
      groups.set(folder, []);
    }
    groups.get(folder).push(file);
  }
  return [...groups.entries()]
    .map(([folder, groupFiles]) => ({ folder, files: groupFiles.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

// 현재 충돌 상태를 사용자가 선택할 수 있는 Webview HTML로 렌더링합니다.
function renderConflictResolverHtml(state) {
  const nonce = String(Date.now());
  const itemsHtml = state.items.length === 0
    ? `<section class="empty">
        <h2>모든 충돌 선택이 끝났습니다</h2>
        <p>${escapeHtml(state.continueLabel)}를 눌러 Git 작업을 이어가세요.</p>
      </section>`
    : state.items.map((item, index) => renderConflictItemHtml(item, index)).join("");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Programmers Sync Conflicts</title>
  <style nonce="${nonce}">
    body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { font-size: 20px; margin: 0; font-weight: 600; }
    .summary { color: var(--vscode-descriptionForeground); margin: 4px 0 0; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    button { border: 0; padding: 6px 10px; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
    button:disabled { opacity: .45; cursor: default; }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .item { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; background: var(--vscode-sideBar-background); }
    .item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .title { font-weight: 600; word-break: break-all; }
    .kind { font-size: 11px; padding: 2px 6px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); white-space: nowrap; }
    .subtitle { margin-top: 6px; color: var(--vscode-descriptionForeground); }
    .files { margin: 8px 0 0; padding-left: 18px; color: var(--vscode-descriptionForeground); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .empty { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 18px; background: var(--vscode-sideBar-background); }
    .empty h2 { margin: 0 0 6px; font-size: 16px; }
    .empty p { margin: 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Programmers Sync 충돌 해결</h1>
      <p class="summary">${state.items.length}개 항목이 남아 있습니다.</p>
    </div>
    <div class="toolbar">
      <button data-command="refresh">Refresh</button>
      <button data-command="continue" ${state.canContinue ? "" : "disabled"}>${escapeHtml(state.continueLabel)}</button>
      <button class="secondary" data-command="abort">${escapeHtml(state.abortLabel)}</button>
    </div>
  </header>
  <main class="list">${itemsHtml}</main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const operation = ${JSON.stringify(state.operation)};
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-command]');
      if (!button || button.disabled) return;
      const files = button.dataset.files ? JSON.parse(button.dataset.files) : [];
      vscode.postMessage({ command: button.dataset.command, type: button.dataset.type, files, operation });
    });
  </script>
</body>
</html>`;
}

// merge/rebase continue 성공 후 보여줄 완료 Webview HTML을 렌더링합니다.
function renderConflictResolverCompleteHtml(operation) {
  const nonce = String(Date.now());
  const title = operation === "rebase" ? "Rebase 완료" : operation === "merge" ? "Merge 완료" : "Sync 완료";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Programmers Sync Complete</title>
  <style nonce="${nonce}">
    body { padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    section { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 18px; background: var(--vscode-sideBar-background); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
    button { border: 0; padding: 6px 10px; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <section>
    <h1>${title}</h1>
    <p>충돌 해결이 끝났고 동기화가 이어졌습니다. 이 창은 닫아도 됩니다.</p>
    <button data-command="close">닫기</button>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-command]');
      if (!button) return;
      vscode.postMessage({ command: button.dataset.command, operation: ${JSON.stringify(operation)} });
    });
  </script>
</body>
</html>`;
}

// 수정/수정 또는 삭제/수정 충돌 하나를 Webview 목록 item HTML로 만듭니다.
function renderConflictItemHtml(item, index) {
  const filesJson = escapeAttribute(JSON.stringify(item.files));
  const kind = item.type === "deleteModify" ? "삭제/수정" : "수정/수정";
  const actions = item.type === "deleteModify"
    ? `<button data-command="open" data-type="${item.type}" data-files="${filesJson}">미리보기</button>
       <button data-command="keep-modification" data-type="${item.type}" data-files="${filesJson}">문제 유지</button>
       <button class="secondary" data-command="keep-delete" data-type="${item.type}" data-files="${filesJson}">삭제 유지</button>`
    : `<button data-command="open" data-type="${item.type}" data-files="${filesJson}">파일 열기</button>`;
  const files = item.files.length > 1
    ? `<ul class="files">${item.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
    : "";
  return `<section class="item" data-index="${index}">
    <div class="item-head">
      <div>
        <div class="title">${escapeHtml(item.title)}</div>
        <div class="subtitle">${escapeHtml(item.subtitle)}</div>
      </div>
      <span class="kind">${kind}</span>
    </div>
    ${files}
    <div class="actions">${actions}</div>
  </section>`;
}

// Webview message에서 온 Git 작업 이름을 안전한 값으로 정규화합니다.
function normalizeConflictOperation(operation) {
  return operation === "merge" || operation === "rebase" ? operation : "sync";
}

// 현재 Git 작업에 맞는 continue 버튼 라벨을 반환합니다.
function getConflictContinueLabel(operation) {
  if (operation === "rebase") {
    return "Continue Rebase";
  }
  if (operation === "merge") {
    return "Finish Merge";
  }
  return "Sync Now";
}

// 현재 Git 작업에 맞는 abort 버튼 라벨을 반환합니다.
function getConflictAbortLabel(operation) {
  if (operation === "rebase") {
    return "Abort Rebase";
  }
  if (operation === "merge") {
    return "Abort Merge";
  }
  return "닫기";
}

// 충돌 파일 경로에서 문제 폴더명만 추출합니다.
function getTopLevelFolders(files) {
  const folders = new Set();
  for (const file of files || []) {
    const normalized = String(file || "").split(path.sep).join("/");
    const [folder] = normalized.split("/");
    if (folder && folder !== ".git" && folder !== ".programmers-helper") {
      folders.add(folder);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

// 삭제/수정 미리보기 임시 파일명에 사용할 수 없는 문자를 제거합니다.
function sanitizeFileName(value) {
  return String(value || "preview").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80) || "preview";
}

// 삭제/수정 충돌 미리보기 문서에 표시할 안내 문구를 만듭니다.
function formatDeleteModifyMessage(files) {
  const folders = getTopLevelFolders(files);
  const target = folders.length > 1
    ? `${folders.length}개 문제`
    : folders[0] || "문제";
  return [
    `${target}에서 삭제와 수정이 동시에 발생했습니다.`,
    "문제를 유지할지, 삭제를 유지할지 선택하세요.",
    ...folders.map((folder) => `- ${folder}`),
  ].join("\n");
}

// Webview HTML에 삽입할 텍스트를 escape합니다.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Webview data-* attribute에 넣을 값을 HTML escape합니다.
function escapeAttribute(value) {
  return escapeHtml(value);
}

module.exports = {
  formatDeleteModifyMessage,
  getConflictAbortLabel,
  getConflictContinueLabel,
  getTopLevelFolders,
  groupFilesByTopLevelFolder,
  normalizeConflictOperation,
  renderConflictResolverCompleteHtml,
  renderConflictResolverHtml,
  sanitizeFileName,
};
