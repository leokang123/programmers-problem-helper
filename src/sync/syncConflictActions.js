const fs = require("fs/promises");
const path = require("path");
const vscode = require("vscode");
const {
  formatDeleteModifyMessage,
  getConflictAbortLabel,
  getConflictContinueLabel,
  getTopLevelFolders,
  groupFilesByTopLevelFolder,
  normalizeConflictOperation,
  renderConflictResolverCompleteHtml,
  renderConflictResolverHtml,
  sanitizeFileName,
} = require("./conflictResolverView");
const {
  createConflictMarkerError,
  exists,
  hasConflictMarkers,
  isPathInside,
  limitMessage,
} = require("./syncUtils");

class SyncConflictController {
  constructor(manager) {
    this.manager = manager;
    this.conflictPanel = undefined;
    this.conflictPreviewDocumentUri = undefined;
  }

  get context() {
    return this.manager.context;
  }

  git(...args) {
    return this.manager.git(...args);
  }

  getGitContext(...args) {
    return this.manager.getGitContext(...args);
  }

  syncNow(...args) {
    return this.manager.syncNow(...args);
  }

  handleSyncError(...args) {
    return this.manager.handleSyncError(...args);
  }

  updateStatusBar(...args) {
    return this.manager.updateStatusBar(...args);
  }

  stageResolvedFilesAndGetUnmerged(...args) {
    return this.manager.stageResolvedFilesAndGetUnmerged(...args);
  }

  async dispose() {
    await this.closeConflictPreviewDocument();
    this.conflictPanel?.dispose();
  }

  // 현재 Git 변경 파일 중 conflict marker가 남은 파일 목록을 찾습니다.
  async getConflictMarkerFiles(context) {
    const markerFiles = await this.findConflictMarkerFiles(context, await this.getRepositoryFiles(context));
    return [...new Set(markerFiles)].sort((a, b) => a.localeCompare(b));
  }


  // git status porcelain에서 unmerged 상태 항목을 파싱합니다.
  async getUnmergedEntries(context) {
    const status = await this.git(context, ["status", "--porcelain"], { allowNonZeroExit: true });
    return status.stdout.split(/\r?\n/)
      .map((line) => ({ status: line.slice(0, 2), file: line.slice(3).trim() }))
      .filter((entry) => entry.file && entry.status.includes("U"));
  }


  // 삭제/수정 계열 충돌 파일만 골라 resolver 선택지로 보여줍니다.
  async getDeleteModifyConflictFiles(context) {
    const entries = await this.getUnmergedEntries(context);
    return [...new Set(entries
      .filter((entry) => entry.status.includes("D"))
      .map((entry) => entry.file))]
      .sort((a, b) => a.localeCompare(b));
  }


  // 현재 저장소가 merge/rebase/cherry-pick 중인지 .git 상태로 판정합니다.
  async getGitOperationKind(context) {
    const gitDir = path.join(context.cwd, ".git");
    if (await exists(path.join(gitDir, "MERGE_HEAD"))) {
      return "merge";
    }
    if (await exists(path.join(gitDir, "rebase-merge")) || await exists(path.join(gitDir, "rebase-apply"))) {
      return "rebase";
    }
    return "sync";
  }


  // 삭제/수정 충돌을 사용자가 비교할 수 있도록 실제 파일 또는 임시 미리보기를 엽니다.
  async openDeleteModifyConflict(context, files) {
    await this.closeConflictPreviewDocument();
    const file = files[0];
    if (!file) {
      return;
    }
    const folder = getTopLevelFolders([file])[0] || path.dirname(file);
    const operation = await this.getGitOperationKind(context);
    const content = await this.readDeleteModifyPreviewContent(context, file, operation);
    const previewPath = await this.writeConflictPreviewFile(file, [
      `삭제/수정 충돌: ${folder}`,
      "",
      "한쪽 환경에서는 이 문제를 삭제했고, 다른 환경에서는 이 파일을 수정했습니다.",
      "원하는 결과를 충돌 해결 화면에서 선택하세요.",
      "",
      "- 문제 유지: 문제 폴더를 남깁니다.",
      "- 삭제 유지: 문제 폴더 삭제를 유지합니다.",
      "",
      `충돌 파일: ${file}`,
      "",
      "----- 수정본 미리보기 -----",
      content || "(수정본 내용을 찾지 못했습니다.)",
    ].join("\n"));
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(previewPath));
    this.conflictPreviewDocumentUri = document.uri.toString();
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Two });
  }


  // 삭제되어 working tree에 없는 충돌 파일 내용을 임시 미리보기 파일로 저장합니다.
  async writeConflictPreviewFile(file, content) {
    const previewDir = this.getConflictPreviewDir();
    await fs.mkdir(previewDir, { recursive: true });
    const basename = path.basename(file) || "preview.txt";
    const extension = path.extname(basename) || ".txt";
    const stem = basename.slice(0, basename.length - extension.length) || "preview";
    const previewPath = path.join(previewDir, `${sanitizeFileName(stem)}-${Date.now()}${extension}`);
    await fs.writeFile(previewPath, content, "utf8");
    return previewPath;
  }


  // 삭제/수정 충돌 미리보기 임시 파일을 저장할 디렉터리 경로를 반환합니다.
  getConflictPreviewDir() {
    return path.join(this.context.globalStorageUri.fsPath, "sync-conflict-previews");
  }


  // 열려 있는 삭제/수정 미리보기 문서를 닫고 임시 파일을 삭제합니다.
  async closeConflictPreviewDocument() {
    if (!this.conflictPreviewDocumentUri) {
      return;
    }

    const previewUri = this.conflictPreviewDocumentUri;
    this.conflictPreviewDocumentUri = undefined;
    let previewPath;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const inputUri = tab.input?.uri;
        if (inputUri && inputUri.toString() === previewUri) {
          previewPath = inputUri.fsPath;
          await vscode.window.tabGroups.close(tab);
          break;
        }
      }
    }
    if (!previewPath) {
      try {
        previewPath = vscode.Uri.parse(previewUri).fsPath;
      } catch {
        previewPath = undefined;
      }
    }
    if (previewPath) {
      await fs.rm(previewPath, { force: true });
    }
  }


  // 이전 extension 세션에서 남은 conflict preview 임시 폴더를 정리합니다.
  async cleanupConflictPreviewFiles() {
    try {
      await fs.rm(this.getConflictPreviewDir(), { recursive: true, force: true });
    } catch {
      // Preview files are disposable diagnostics.
    }
  }


  // 삭제/수정 충돌에서 현재 작업의 반대편 ref에 있는 파일 내용을 미리보기용으로 읽습니다.
  async readDeleteModifyPreviewContent(context, file, operation) {
    const filePath = path.resolve(context.cwd, file);
    if (isPathInside(context.cwd, filePath) && await exists(filePath)) {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        // Fall through to Git refs.
      }
    }

    const ref = await this.findRefContainingPath(context, file, operation)
      || await this.findRefContainingPath(context, file, operation === "rebase" ? "merge" : "rebase");
    if (!ref) {
      return "";
    }
    const result = await this.git(context, ["show", `${ref}:${file}`], {
      allowNonZeroExit: true,
    });
    return result.code === 0 ? result.stdout : "";
  }


  // unmerged status 항목에서 파일 경로만 중복 없이 추출합니다.
  async getUnmergedFiles(context) {
    const result = await this.git(context, ["diff", "--name-only", "--diff-filter=U"], {
      allowNonZeroExit: true,
    });
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }


  // commit 전 변경 파일에 conflict marker가 남아 있으면 sync를 중단합니다.
  async assertNoConflictMarkersInChangedFiles(context) {
    const changedFiles = await this.getChangedFiles(context);
    const markerFiles = await this.findConflictMarkerFiles(context, changedFiles);
    if (markerFiles.length === 0) {
      return;
    }

    throw createConflictMarkerError(markerFiles);
  }


  // push 전 추적/미추적 파일 전체에서 conflict marker 잔여물을 검사합니다.
  async assertNoConflictMarkersInRepository(context) {
    const files = await this.getRepositoryFiles(context);
    const markerFiles = await this.findConflictMarkerFiles(context, files);
    if (markerFiles.length === 0) {
      return;
    }

    throw createConflictMarkerError(markerFiles);
  }


  // Git working tree에서 변경되거나 추가된 파일 목록을 수집합니다.
  async getChangedFiles(context) {
    const commands = [
      ["diff", "--name-only"],
      ["diff", "--cached", "--name-only"],
      ["ls-files", "--others", "--exclude-standard"],
    ];
    const files = new Set();
    for (const args of commands) {
      const result = await this.git(context, args, { allowNonZeroExit: true });
      for (const line of result.stdout.split(/\r?\n/)) {
        const file = line.trim();
        if (file) {
          files.add(file);
        }
      }
    }
    return [...files];
  }


  // 추적 파일과 미추적 파일을 합쳐 marker scan 대상 목록을 만듭니다.
  async getRepositoryFiles(context) {
    const files = new Set();
    for (const args of [
      ["ls-files"],
      ["ls-files", "--others", "--exclude-standard"],
    ]) {
      const result = await this.git(context, args, { allowNonZeroExit: true });
      for (const line of result.stdout.split(/\r?\n/)) {
        const file = line.trim();
        if (file) {
          files.add(file);
        }
      }
    }
    return [...files];
  }


  // 파일 목록을 실제로 읽어 conflict marker가 들어 있는 파일만 반환합니다.
  async findConflictMarkerFiles(context, relativeFiles) {
    const markerFiles = [];
    for (const relativeFile of relativeFiles) {
      if (!relativeFile || relativeFile.includes("\0")) {
        continue;
      }
      const filePath = path.resolve(context.cwd, relativeFile);
      if (!isPathInside(context.cwd, filePath)) {
        continue;
      }
      let content;
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
          continue;
        }
        content = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      if (hasConflictMarkers(content)) {
        markerFiles.push(relativeFile);
      }
    }
    return markerFiles;
  }


  // 모든 editor를 저장/닫고 왼쪽에 conflict resolver Webview를 엽니다.
  async openConflictResolver(operation) {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      const normalizedOperation = operation || await this.getGitOperationKind(context);
      const state = await this.getConflictState(context, normalizedOperation);
      if (!this.conflictPanel) {
        await vscode.workspace.saveAll(false);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        this.conflictPanel = vscode.window.createWebviewPanel(
          "programmersConflictResolver",
          "Programmers Sync Conflicts",
          vscode.ViewColumn.One,
          { enableScripts: true, retainContextWhenHidden: true }
        );
        this.conflictPanel.onDidDispose(() => {
          this.conflictPanel = undefined;
        });
        this.conflictPanel.webview.onDidReceiveMessage((message) => {
          void this.handleConflictPanelMessage(message);
        });
      }
      this.conflictPanel.reveal(vscode.ViewColumn.One);
      this.conflictPanel.webview.html = this.renderConflictResolverHtml(state);
    } catch (error) {
      await this.handleSyncError(error);
    }
  }


  // 현재 Git 충돌 상태를 다시 읽어 resolver Webview를 갱신합니다.
  async refreshConflictResolver(operation) {
    if (!this.conflictPanel) {
      return;
    }
    const context = await this.getGitContext({ requireConfigured: true });
    const state = await this.getConflictState(context, operation || await this.getGitOperationKind(context));
    this.conflictPanel.webview.html = this.renderConflictResolverHtml(state);
  }


  // marker 충돌과 삭제/수정 충돌을 Webview 렌더링용 상태로 조립합니다.
  async getConflictState(context, operation) {
    const markerFiles = await this.getConflictMarkerFiles(context);
    const deleteModifyFiles = await this.getDeleteModifyConflictFiles(context);
    const deleteModifyGroups = groupFilesByTopLevelFolder(deleteModifyFiles);
    const items = [
      ...markerFiles.map((file) => ({
        id: `content:${file}`,
        type: "content",
        title: file,
        subtitle: "파일 안의 충돌 마커를 직접 해결하세요.",
        files: [file],
      })),
      ...deleteModifyGroups.map((group) => ({
        id: `delete-modify:${group.folder}`,
        type: "deleteModify",
        title: group.folder,
        subtitle: `${group.files.length}개 파일에서 삭제와 수정이 동시에 발생했습니다.`,
        files: group.files,
      })),
    ];
    return {
      operation,
      items,
      canContinue: items.length === 0,
      continueLabel: getConflictContinueLabel(operation),
      abortLabel: getConflictAbortLabel(operation),
    };
  }


  // conflict resolver Webview 버튼 명령을 Git 작업으로 변환해 처리합니다.
  async handleConflictPanelMessage(message) {
    const operation = normalizeConflictOperation(message?.operation);
    try {
      if (message?.command === "refresh") {
        await this.refreshConflictResolver(operation);
        return;
      }
      if (message?.command === "open") {
        await this.openConflictPanelItem(message);
        await this.refreshConflictResolver(operation);
        return;
      }
      if (message?.command === "keep-modification") {
        const context = await this.getGitContext({ requireConfigured: true });
        const resolved = await this.resolveDeleteModifyFiles(context, operation, "keep", message.files || []);
        await this.closeConflictPreviewDocument();
        await this.refreshConflictResolver(operation);
        if (!resolved) {
          vscode.window.showInformationMessage("이미 처리되었거나 현재 충돌 목록에 없는 항목입니다. 충돌 목록을 새로고침했습니다.");
        }
        return;
      }
      if (message?.command === "keep-delete") {
        const context = await this.getGitContext({ requireConfigured: true });
        const resolved = await this.resolveDeleteModifyFiles(context, operation, "delete", message.files || []);
        await this.closeConflictPreviewDocument();
        await this.refreshConflictResolver(operation);
        if (!resolved) {
          vscode.window.showInformationMessage("이미 처리되었거나 현재 충돌 목록에 없는 항목입니다. 충돌 목록을 새로고침했습니다.");
        }
        return;
      }
      if (message?.command === "continue") {
        let completed = false;
        if (operation === "rebase") {
          completed = await this.continueRebaseAndSync();
        } else if (operation === "merge") {
          completed = await this.finishMergeAndSync();
        } else {
          completed = await this.syncNow();
        }
        if (!completed) {
          await this.refreshConflictResolver(operation);
          return;
        }
        await this.showConflictResolverComplete(operation);
        return;
      }
      if (message?.command === "abort") {
        if (operation === "sync") {
          await this.closeConflictPreviewDocument();
          this.conflictPanel?.dispose();
          return;
        }
        await this.abortGitOperation(operation);
        await this.closeConflictPreviewDocument();
        this.conflictPanel?.dispose();
        return;
      }
      if (message?.command === "close") {
        await this.closeConflictPreviewDocument();
        this.conflictPanel?.dispose();
      }
    } catch (error) {
      await this.handleSyncError(error);
    }
  }


  // rebase/merge continue가 끝난 뒤 resolver Webview에 완료 화면을 표시합니다.
  async showConflictResolverComplete(operation) {
    if (!this.conflictPanel) {
      return;
    }
    await this.closeConflictPreviewDocument();
    this.conflictPanel.webview.html = this.renderConflictResolverCompleteHtml(operation);
  }


  // resolver 항목의 파일 열기/삭제수정 미리보기 요청을 처리합니다.
  async openConflictPanelItem(message) {
    const context = await this.getGitContext({ requireConfigured: true });
    const files = Array.isArray(message?.files) ? message.files : [];
    if (message?.type === "deleteModify") {
      await this.openDeleteModifyConflict(context, files);
      return;
    }
    const file = files[0];
    if (!file) {
      return;
    }
    const filePath = path.resolve(context.cwd, file);
    if (isPathInside(context.cwd, filePath)) {
      await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false, viewColumn: vscode.ViewColumn.Two });
    }
  }


  // conflict resolver 상태를 Webview HTML 문자열로 변환합니다.
  renderConflictResolverHtml(state) {
    return renderConflictResolverHtml(state);
  }


  // conflict resolver 완료 화면 HTML 문자열을 만듭니다.
  renderConflictResolverCompleteHtml(operation) {
    return renderConflictResolverCompleteHtml(operation);
  }


  // merge 충돌 해결 후 commit을 완료하고 남은 sync 흐름을 이어갑니다.
  async finishMergeAndSync() {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      await vscode.workspace.saveAll(false);
      const unmerged = await this.stageResolvedFilesAndGetUnmerged(context, { operation: "merge" });
      if (unmerged.length > 0) {
        await this.openConflictResolver("merge");
        return false;
      }
      await this.git(context, ["commit", "--no-edit"]);
      return await this.syncNow();
    } catch (error) {
      await this.handleSyncError(error);
      return false;
    }
  }


  // rebase 충돌 해결 후 rebase --continue를 수행하고 남은 sync 흐름을 이어갑니다.
  async continueRebaseAndSync() {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      await vscode.workspace.saveAll(false);
      const unmerged = await this.stageResolvedFilesAndGetUnmerged(context, { operation: "rebase" });
      if (unmerged.length > 0) {
        await this.openConflictResolver("rebase");
        return false;
      }
      await this.git(context, ["rebase", "--continue"], {
        env: { GIT_EDITOR: "true" },
      });
      return await this.syncNow();
    } catch (error) {
      await this.handleSyncError(error);
      return false;
    }
  }


  // 삭제/수정 충돌에서 문제 유지 또는 삭제 유지 선택을 실제 Git stage 상태로 반영합니다.
  async resolveDeleteModifyFiles(context, operation, decision, files = []) {
    const currentConflictFiles = await this.getDeleteModifyConflictFiles(context);
    const currentConflictFolders = new Set(getTopLevelFolders(currentConflictFiles));
    const requestedFolders = getTopLevelFolders(files);
    const problemFolders = requestedFolders.filter((folder) => currentConflictFolders.has(folder));
    if (requestedFolders.length === 0 || problemFolders.length === 0) {
      vscode.window.showInformationMessage("처리할 삭제/수정 충돌이 없습니다.");
      return false;
    }

    for (const folder of problemFolders) {
      if (decision === "keep") {
        await this.restoreProblemFolderForDeleteModify(context, operation, folder);
      } else {
        await this.git(context, ["rm", "-r", "--ignore-unmatch", "--", folder], { allowNonZeroExit: true });
      }
    }
    return true;
  }


  // 삭제/수정 충돌에서 문제 유지 선택 시 해당 문제 폴더를 가진 ref에서 복원합니다.
  async restoreProblemFolderForDeleteModify(context, operation, folder) {
    const restoreRef = await this.findRefContainingPath(context, folder, operation);
    if (!restoreRef) {
      throw new Error(`삭제/수정 충돌에서 문제 폴더를 복원하지 못했습니다.\n${folder} 폴더를 가진 Git 버전을 찾지 못했습니다.`);
    }

    const restored = await this.git(context, ["checkout", restoreRef, "--", folder], {
      allowNonZeroExit: true,
    });
    if (restored.code !== 0) {
      const detail = restored.stderr || restored.stdout || "";
      throw new Error(`삭제/수정 충돌에서 문제 폴더를 복원하지 못했습니다.\n${detail.trim()}`);
    }
    await this.git(context, ["add", "--", folder]);
  }


  // 삭제/수정 충돌 복원에 사용할 수 있는 ref 중 대상 경로가 존재하는 ref를 찾습니다.
  async findRefContainingPath(context, relativePath, operation) {
    const refs = operation === "rebase"
      ? ["REBASE_HEAD", "ORIG_HEAD", "HEAD", "MERGE_HEAD", `origin/${context.branch}`]
      : ["HEAD", "MERGE_HEAD", "ORIG_HEAD", "REBASE_HEAD", `origin/${context.branch}`];
    for (const ref of refs) {
      const existsInRef = await this.git(context, ["cat-file", "-e", `${ref}:${relativePath}`], {
        allowNonZeroExit: true,
      });
      if (existsInRef.code === 0) {
        return ref;
      }
    }
    return undefined;
  }


  // resolver에서 사용자가 선택한 merge/rebase abort를 실행하고 상태를 정리합니다.
  async abortGitOperation(operation) {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      const result = await this.git(context, [operation, "--abort"], {
        allowNonZeroExit: true,
      });
      if (result.code !== 0) {
        const detail = result.stderr || result.stdout || "";
        if (/no rebase in progress|no merge to abort|there is no merge to abort|no cherry-pick or revert in progress/i.test(detail)) {
          this.updateStatusBar("idle");
          vscode.window.showInformationMessage(`진행 중인 Git ${operation} 작업이 이미 없습니다.`);
          return;
        }
        throw new Error(`git ${operation} --abort 실패${detail.trim() ? `\n${detail.trim()}` : ""}`);
      }
      this.updateStatusBar("dirty");
      vscode.window.showInformationMessage(`Git ${operation}를 취소했습니다. 필요하면 다시 Programmers: Sync Now를 실행하세요.`);
    } catch (error) {
      await this.handleSyncError(error);
    }
  }
}

module.exports = {
  SyncConflictController,
};
