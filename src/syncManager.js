const cp = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const {
  getSyncSettings,
} = require("./settings");
const {
  getDefaultProgrammersDir,
  resolveProgrammersDir,
} = require("./problemStore");

const TOKEN_KEY = "programmersHelper.github.token";
const REMOTE_URL_STATE_KEY = "programmersHelper.sync.remoteUrl";
const BACKGROUND_SYNC_STATUS_FILE = "programmers-sync-status.json";
const SIDEBAR_VIEW_ID = "programmersHelper.sidebar";

class SyncManager {
  constructor({ context, execCommand, outputChannel, refreshProblems }) {
    this.context = context;
    this.execCommand = execCommand;
    this.outputChannel = outputChannel;
    this.refreshProblems = refreshProblems;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.statusBar.command = "programmersHelper.syncNow";
    this.statusBar.tooltip = "Programmers Git sync";
    this.syncInFlight = false;
    this.suppressAutoPull = false;
    this.cachedToken = "";
    this.statusCheckTimer = undefined;
    this.conflictCursor = 0;
    this.updateStatusBar();
    this.configureStatusCheck();
    void this.prepareBackgroundSyncCredentials();
  }

  dispose() {
    this.clearStatusCheckTimer();
    this.statusBar.dispose();
  }

  configureStatusCheck() {
    this.clearStatusCheckTimer();
    const settings = getSyncSettings();
    if (!settings.enabled || settings.statusCheckIntervalMinutes <= 0) {
      return;
    }

    const intervalMs = settings.statusCheckIntervalMinutes * 60 * 1000;
    this.statusCheckTimer = setInterval(() => {
      void this.checkSyncStatus("periodic");
    }, intervalMs);
  }

  clearStatusCheckTimer() {
    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer);
      this.statusCheckTimer = undefined;
    }
  }

  updateStatusBar(state = "idle") {
    const settings = getSyncSettings();
    if (!settings.enabled) {
      this.statusBar.hide();
      return;
    }

    const labels = {
      idle: "$(sync) Programmers",
      syncing: "$(sync~spin) Programmers",
      dirty: "$(warning) Programmers Unsynced",
      conflict: "$(error) Programmers Conflict",
      failed: "$(error) Programmers Sync",
      synced: "$(check) Programmers Synced",
      setup: "$(gear) Programmers Sync",
    };
    this.statusBar.text = labels[state] || labels.idle;
    this.statusBar.show();
  }

  async setupSync() {
    const picked = await vscode.window.showQuickPick([
      {
        label: "Use existing GitHub repository",
        description: "Recommended",
        detail: "You create the repo on GitHub first, then paste its remote URL here. The extension runs git init, sets origin, stores an optional token, commits local Programmers data, pulls remote data, then pushes.",
        kind: "remote",
      },
      {
        label: "Local Git repo already configured",
        description: "I already ran git init and remote add",
        detail: "Use this when globalStorage/Programmers already has .git and origin configured. The extension only turns sync on and uses the existing Git/SSH/credential setup.",
        kind: "configured",
      },
      {
        label: "Manual setup",
        description: "Open the folder and do everything yourself",
        detail: "Opens the Programmers storage folder. After you configure Git manually, run Programmers: Sync Now to commit, pull, and push.",
        kind: "manual",
      },
    ], {
      title: "Programmers Sync 설정",
      placeHolder: "처음에는 GitHub repo를 직접 만든 뒤 remote URL을 입력하는 흐름입니다.",
    });

    if (!picked) {
      return;
    }

    if (picked.kind === "manual") {
      await this.openStorageFolder();
      await this.updateConfig("sync.enabled", true);
      vscode.window.showInformationMessage("Storage folder를 열었습니다. Git 설정 후 Programmers: Sync Now를 실행하세요.");
      this.updateStatusBar("setup");
      return;
    }

    if (picked.kind === "remote") {
      const remoteUrl = await vscode.window.showInputBox({
        title: "Programmers Sync: remote URL",
        prompt: "먼저 GitHub에서 private repo를 만든 뒤, 그 repo의 HTTPS 또는 SSH URL을 입력하세요. 아직 repo 생성 자동화는 하지 않습니다.",
        placeHolder: "https://github.com/you/programmers-state.git",
        validateInput(value) {
          return value.trim() ? undefined : "원격 저장소 URL을 입력해주세요.";
        },
      });
      if (!remoteUrl) {
        return;
      }

      const branch = await vscode.window.showInputBox({
        title: "Programmers Sync: branch",
        prompt: "동기화에 사용할 브랜치입니다. 보통 main을 쓰면 됩니다.",
        value: getSyncSettings().branch || "main",
        validateInput(value) {
          return value.trim() && !/[\s~^:?*[\\]/.test(value.trim())
            ? undefined
            : "Git 브랜치 이름으로 사용할 수 없는 값입니다.";
        },
      });
      if (!branch) {
        return;
      }

      await this.storeRemoteUrl(remoteUrl.trim());
      await this.updateConfig("sync.branch", branch.trim());
      if (isHttpsGitHubRemote(remoteUrl)) {
        await this.ensureTokenForHttpsRemote();
      }
      await this.initializeRepository();
      this.suppressAutoPull = true;
      try {
        await this.updateConfig("sync.enabled", true);
      } finally {
        this.suppressAutoPull = false;
      }
      await this.syncNow();
      return;
    }

    await this.initializeRepository();
    this.suppressAutoPull = true;
    try {
      await this.updateConfig("sync.enabled", true);
    } finally {
      this.suppressAutoPull = false;
    }
    vscode.window.showInformationMessage("Programmers Git sync가 켜졌습니다.");
    this.updateStatusBar("idle");
  }

  async explainSetupAfterEnabled() {
    const settings = getSyncSettings();
    if (!settings.enabled) {
      this.updateStatusBar();
      return;
    }

    let context;
    try {
      context = await this.getGitContext({ requireConfigured: false });
    } catch (error) {
      this.logError("Sync setup check failed", error);
      context = undefined;
    }
    if (context) {
      this.updateStatusBar("idle");
      return;
    }

    this.updateStatusBar("setup");
    const picked = await vscode.window.showInformationMessage(
      "Programmers Sync가 켜졌지만 아직 Git 저장소/원격 저장소가 설정되지 않았습니다. GitHub repo를 만든 뒤 Setup Sync에서 remote URL을 입력하거나, storage folder에서 직접 git init/remote add를 해주세요.",
      "Setup Sync",
      "Open Storage Folder"
    );
    if (picked === "Setup Sync") {
      await this.setupSync();
    } else if (picked === "Open Storage Folder") {
      await this.openStorageFolder();
    }
  }

  async ensureTokenForHttpsRemote() {
    const existing = await this.context.secrets.get(TOKEN_KEY);
    if (existing) {
      this.cachedToken = existing;
      const picked = await vscode.window.showQuickPick([
        {
          label: "Use saved token",
          description: "Keep the existing token stored in VS Code SecretStorage",
          action: "keep",
        },
        {
          label: "Replace token",
          description: "Enter a new token for HTTPS GitHub push/pull",
          action: "replace",
        },
        {
          label: "Use system Git credentials",
          description: "Do not use the saved token for this setup",
          action: "skip",
        },
      ], {
        title: "Programmers Sync: GitHub token",
        placeHolder: "HTTPS remote는 token 또는 기존 Git credential이 필요합니다.",
      });
      if (!picked || picked.action === "keep") {
        return;
      }
      if (picked.action === "skip") {
        return;
      }
    }

    await this.promptAndStoreToken();
  }

  async promptAndStoreToken() {
    const token = await vscode.window.showInputBox({
      title: "Programmers Sync: GitHub token",
      prompt: "HTTPS remote push/pull에 사용할 token입니다. Fine-grained token은 해당 repo의 Contents read/write 권한이 필요합니다. 토큰은 VS Code SecretStorage에만 저장됩니다.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "비워두면 기존 Git credential을 사용합니다.",
    });
    if (!token) {
      return false;
    }

    await this.context.secrets.store(TOKEN_KEY, token.trim());
    this.cachedToken = token.trim();
    vscode.window.showInformationMessage("Programmers GitHub token을 안전 저장소에 저장했습니다.");
    return true;
  }

  async clearGitHubToken() {
    const picked = await vscode.window.showWarningMessage(
      "저장된 Programmers GitHub token을 삭제할까요? HTTPS remote를 쓰는 경우 다음 Setup Sync에서 다시 입력할 수 있습니다.",
      { modal: true },
      "삭제"
    );
    if (picked !== "삭제") {
      return;
    }

    await this.context.secrets.delete(TOKEN_KEY);
    this.cachedToken = "";
    vscode.window.showInformationMessage("저장된 Programmers GitHub token을 삭제했습니다.");
  }

  async openStorageFolder() {
    const programmersDir = await this.getProgrammersDir({ create: true });
    await vscode.commands.executeCommand("revealFileInOS", programmersDir);
  }

  async autoPullOnActivate() {
    const settings = getSyncSettings();
    if (this.suppressAutoPull || !settings.enabled || !settings.autoPullOnActivate) {
      this.updateStatusBar();
      return;
    }

    try {
      await this.reportBackgroundSyncStatus();
      await this.pullOnly({ silent: true });
    } catch (error) {
      this.logError("Auto pull failed", error);
      this.updateStatusBar("failed");
    }
  }

  async pullOnly({ silent = false } = {}) {
    if (this.syncInFlight) {
      return;
    }

    const context = await this.getGitContext({ requireConfigured: false });
    if (!context) {
      this.updateStatusBar("setup");
      return;
    }

    const dirty = await this.hasChanges(context);
    await this.ensureNoGitOperationInProgress(context);
    if (dirty) {
      this.updateStatusBar("dirty");
      if (!silent) {
        vscode.window.showInformationMessage("로컬 변경사항이 있어 pull만 실행하지 않았습니다. Programmers: Sync Now를 실행하면 먼저 커밋한 뒤 동기화합니다.");
      }
      return;
    }

    this.syncInFlight = true;
    this.updateStatusBar("syncing");
    try {
      const fetched = await this.fetchRemote(context);
      if (fetched && await this.hasRemoteBranch(context)) {
        if (await this.hasLocalHead(context)) {
          await this.git(context, ["pull", "--ff-only", "origin", context.branch]);
        } else {
          await this.git(context, ["pull", "origin", context.branch]);
        }
        await this.refreshProblems?.({ invalidateCache: true, force: true });
      }
      this.updateStatusBar("synced");
      if (!silent) {
        vscode.window.showInformationMessage("Programmers pull 완료");
      }
    } catch (error) {
      this.updateStatusBar("failed");
      throw error;
    } finally {
      this.syncInFlight = false;
    }
  }

  async syncNow() {
    if (this.syncInFlight) {
      vscode.window.showInformationMessage("이미 Programmers sync를 실행 중입니다.");
      return;
    }

    const settings = getSyncSettings();
    if (!settings.enabled) {
      const picked = await vscode.window.showInformationMessage(
        "Programmers sync가 꺼져 있습니다.",
        "Setup Sync"
      );
      if (picked === "Setup Sync") {
        await this.setupSync();
      }
      return;
    }

    this.syncInFlight = true;
    this.updateStatusBar("syncing");
    try {
      await vscode.window.withProgress(
        {
          location: { viewId: SIDEBAR_VIEW_ID },
          title: "Programmers 동기화 중...",
          cancellable: false,
        },
        async (progress) => {
          const context = await this.getGitContext({ requireConfigured: true });
          progress.report({ message: "Git 상태를 확인하는 중..." });
          await this.ensureNoGitOperationInProgress(context);
          progress.report({ message: "로컬 변경사항을 커밋하는 중..." });
          await this.commitLocalChanges(context);
          progress.report({ message: "원격 변경사항을 가져오는 중..." });
          const fetched = await this.fetchRemote(context);
          if (fetched && await this.hasRemoteBranch(context)) {
            progress.report({ message: "원격 변경사항을 병합하는 중..." });
            await this.integrateRemote(context);
          }
          progress.report({ message: "원격 저장소로 푸시하는 중..." });
          await this.assertNoConflictMarkersInRepository(context);
          await this.git(context, ["push", "-u", "origin", context.branch]);
          await this.refreshProblems?.({ invalidateCache: true, force: true });
        }
      );
      this.updateStatusBar("synced");
      await this.clearBackgroundSyncStatus();
      vscode.window.showInformationMessage("Programmers sync 완료");
    } catch (error) {
      await this.handleSyncError(error);
    } finally {
      this.syncInFlight = false;
    }
  }

  async checkSyncStatus(reason = "manual") {
    if (this.syncInFlight) {
      return false;
    }

    const settings = getSyncSettings();
    if (!settings.enabled) {
      return false;
    }

    let context;
    try {
      context = await this.getGitContext({ requireConfigured: false });
      if (!context) {
        this.updateStatusBar("setup");
        return false;
      }
      await this.ensureNoGitOperationInProgress(context);
      const needsSync = await this.needsSync(context);
      this.updateStatusBar(needsSync ? "dirty" : "synced");
      this.outputChannel?.appendLine(`[Programmers Helper] ${reason} sync status check: ${needsSync ? "sync needed" : "up to date"}`);
      return needsSync;
    } catch (error) {
      this.logError(`${reason} sync check failed`, error);
      this.updateStatusBar("failed");
      return false;
    }
  }

  async needsSync(context) {
    if (await this.hasChanges(context)) {
      return true;
    }

    const fetched = await this.fetchRemote(context);
    if (!fetched || !(await this.hasRemoteBranch(context))) {
      return false;
    }

    const difference = await this.git(context, ["rev-list", "--left-right", "--count", `HEAD...origin/${context.branch}`], {
      allowNonZeroExit: true,
    });
    if (difference.code !== 0) {
      return true;
    }

    const [ahead, behind] = difference.stdout.trim().split(/\s+/).map((value) => Number(value));
    return ahead > 0 || behind > 0;
  }

  async syncInBackgroundOnDeactivate() {
    const settings = getSyncSettings();
    const statusPath = path.join(this.context.globalStorageUri.fsPath, BACKGROUND_SYNC_STATUS_FILE);
    if (!settings.enabled || !settings.autoSyncOnDeactivate || this.syncInFlight) {
      await writeBackgroundSyncStatus(statusPath, false, `skipped: enabled=${settings.enabled} autoSyncOnDeactivate=${settings.autoSyncOnDeactivate} syncInFlight=${this.syncInFlight}`);
      return false;
    }

    try {
      const context = this.getBackgroundGitContext(settings);
      const askpassPath = this.getAskpassScriptPath();
      const child = cp.spawn(process.execPath, ["-e", buildBackgroundSyncScript({
        cwd: context.cwd,
        branch: context.branch,
        askpassPath,
        statusPath,
        token: this.cachedToken || "",
      })], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    } catch (error) {
      this.logError("Background sync schedule failed", error);
      const message = error instanceof Error ? error.message : String(error);
      await writeBackgroundSyncStatus(statusPath, false, `schedule failed: ${message}`);
      return false;
    }
  }

  async prepareBackgroundSyncCredentials() {
    try {
      this.cachedToken = await this.context.secrets.get(TOKEN_KEY) || "";
    } catch {
      this.cachedToken = "";
    }
    try {
      await this.ensureAskpassScript();
    } catch (error) {
      this.logError("Askpass preparation failed", error);
    }
  }

  getBackgroundGitContext(settings) {
    const developmentRoot = this.context.extensionMode === vscode.ExtensionMode.Development
      ? this.context.extensionUri.fsPath
      : undefined;
    return {
      cwd: developmentRoot ? path.join(developmentRoot, "Programmers") : path.join(this.context.globalStorageUri.fsPath, "Programmers"),
      branch: settings.branch,
    };
  }

  async reportBackgroundSyncStatus() {
    const statusPath = path.join(this.context.globalStorageUri.fsPath, BACKGROUND_SYNC_STATUS_FILE);
    let status;
    try {
      status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    } catch {
      return;
    }

    if (!status || status.reported) {
      return;
    }

    if (status.ok) {
      await this.clearBackgroundSyncStatus();
      try {
        this.outputChannel?.appendLine(`[Programmers Helper] Background sync completed: ${status.detail || "ok"}`);
      } catch {
        // Output channels may be unavailable during fast reloads.
      }
      return;
    }

    await fs.writeFile(statusPath, `${JSON.stringify({ ...status, reported: true }, null, 2)}\n`, "utf8");

    this.updateStatusBar("failed");
    const detail = status.detail ? `\n${limitMessage(status.detail)}` : "";
    vscode.window.showWarningMessage(`지난 종료 시 Programmers background sync가 실패했습니다.${detail}`, "Sync Now")
      .then((picked) => {
        if (picked === "Sync Now") {
          void this.syncNow();
        }
      });
  }

  async clearBackgroundSyncStatus() {
    const statusPath = path.join(this.context.globalStorageUri.fsPath, BACKGROUND_SYNC_STATUS_FILE);
    try {
      await fs.rm(statusPath, { force: true });
    } catch {
      // A stale background status should not make a successful manual sync fail.
    }
  }

  async initializeRepository() {
    const context = await this.getBasicContext();
    await this.ensureGitAvailable(context);
    if (!(await exists(path.join(context.cwd, ".git")))) {
      await this.git(context, ["init"]);
    }
    await this.git(context, ["branch", "-M", context.branch], { allowNonZeroExit: true });
    if (context.remoteUrl) {
      const remote = await this.git(context, ["remote", "get-url", "origin"], { allowNonZeroExit: true });
      if (remote.code === 0) {
        await this.git(context, ["remote", "set-url", "origin", context.remoteUrl]);
      } else {
        await this.git(context, ["remote", "add", "origin", context.remoteUrl]);
      }
    }
    await this.ensureGitignore(context.cwd);
    await this.ensureConflictMarkerHooks(context.cwd);
  }

  async getGitContext({ requireConfigured }) {
    const context = await this.getBasicContext();
    await this.ensureGitAvailable(context);
    if (!(await exists(path.join(context.cwd, ".git")))) {
      if (requireConfigured) {
        throw new Error("Programmers storage folder가 아직 Git 저장소가 아닙니다. Programmers: Setup Sync를 먼저 실행하세요.");
      }
      return undefined;
    }

    if (context.remoteUrl) {
      const remote = await this.git(context, ["remote", "get-url", "origin"], { allowNonZeroExit: true });
      if (remote.code === 0 && remote.stdout.trim() !== context.remoteUrl) {
        await this.git(context, ["remote", "set-url", "origin", context.remoteUrl]);
      } else if (remote.code !== 0) {
        await this.git(context, ["remote", "add", "origin", context.remoteUrl]);
      }
    }

    const remote = await this.git(context, ["remote", "get-url", "origin"], { allowNonZeroExit: true });
    if (remote.code !== 0 && requireConfigured) {
      throw new Error("origin 원격 저장소가 설정되어 있지 않습니다. Programmers: Setup Sync를 먼저 실행하세요.");
    }
    context.remoteUrl = context.remoteUrl || remote.stdout.trim();
    await this.ensureConflictMarkerHooks(context.cwd);
    return remote.code === 0 ? context : undefined;
  }

  async getBasicContext() {
    const settings = getSyncSettings();
    const programmersDir = await this.getProgrammersDir({ create: true });
    return {
      cwd: programmersDir.fsPath,
      branch: settings.branch,
      remoteUrl: this.getStoredRemoteUrl(),
    };
  }

  async getProgrammersDir({ create }) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri, { create });
    return programmersDir || getDefaultProgrammersDir(this.context, workspaceFolder?.uri);
  }

  async ensureGitAvailable(context) {
    try {
      await this.git(context, ["--version"], { timeoutMs: 5000 });
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error("Git을 찾지 못했습니다. Git을 설치하고 PATH에 추가한 뒤 다시 시도해주세요.");
      }
      throw error;
    }
  }

  async ensureGitignore(cwd) {
    const gitignorePath = path.join(cwd, ".gitignore");
    if (await exists(gitignorePath)) {
      await appendGitignorePatterns(gitignorePath, [
        ".programmers-helper/problem-index.json",
        "**/.programmers-helper/generated/",
      ]);
      return;
    }

    await fs.writeFile(gitignorePath, [
      ".DS_Store",
      "Thumbs.db",
      ".programmers-helper/problem-index.json",
      "**/.programmers-helper/generated/",
      "",
    ].join(os.EOL), "utf8");
  }

  async ensureConflictMarkerHooks(cwd) {
    const hooksDir = path.join(cwd, ".git", "hooks");
    if (!(await exists(hooksDir))) {
      return;
    }

    const hookScript = buildConflictMarkerHookScript();
    for (const hookName of ["pre-commit", "pre-push"]) {
      const hookPath = path.join(hooksDir, hookName);
      if (await exists(hookPath)) {
        let existing = "";
        try {
          existing = await fs.readFile(hookPath, "utf8");
        } catch {
          existing = "";
        }
        if (existing.includes("Programmers Problem Helper conflict marker guard v2")) {
          continue;
        }
        await fs.writeFile(
          `${hookPath}.programmers-helper-disabled`,
          existing,
          "utf8"
        );
      }
      await fs.writeFile(hookPath, hookScript, "utf8");
      if (process.platform !== "win32") {
        await fs.chmod(hookPath, 0o755);
      }
    }
  }

  async commitLocalChanges(context) {
    await this.assertNoConflictMarkersInChangedFiles(context);
    await this.git(context, ["add", "-A"]);
    if (!(await this.hasChanges(context))) {
      return false;
    }

    await this.git(context, ["commit", "-m", "Sync programmers state"]);
    return true;
  }

  async hasChanges(context) {
    const status = await this.git(context, ["status", "--porcelain"], { allowNonZeroExit: true });
    return status.stdout.trim().length > 0;
  }

  async ensureNoGitOperationInProgress(context) {
    const gitDir = path.join(context.cwd, ".git");
    if (await exists(path.join(gitDir, "MERGE_HEAD"))) {
      const conflictFiles = await this.getConflictMarkerFiles(context);
      throw createGitOperationError(
        "merge",
        conflictFiles.length === 0
          ? "Git merge 충돌 선택은 끝났습니다. Finish Merge를 눌러 완료 커밋을 만드세요."
          : `Git merge 충돌을 해결해야 합니다.\n${conflictFiles.join("\n")}`,
        { canFinish: true, canAbort: true, files: conflictFiles }
      );
    }
    if (await exists(path.join(gitDir, "rebase-merge")) || await exists(path.join(gitDir, "rebase-apply"))) {
      const conflictFiles = await this.getConflictMarkerFiles(context);
      throw createGitOperationError(
        "rebase",
        conflictFiles.length === 0
          ? "Git rebase 충돌 선택은 끝났습니다. Continue Rebase를 눌러 다음 단계로 진행하세요."
          : `Git rebase 충돌을 해결해야 합니다.\n${conflictFiles.join("\n")}`,
        { canContinueRebase: true, canAbort: true, files: conflictFiles }
      );
    }
    if (await exists(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      throw new Error("Git cherry-pick이 아직 끝나지 않았습니다. Storage Folder에서 작업을 마친 뒤 다시 Sync Now를 실행하세요.");
    }
  }

  async stageResolvedFilesAndGetUnmerged(context, options = {}) {
    const unmergedBeforeStage = await this.getUnmergedFiles(context);
    const markerFiles = await this.findConflictMarkerFiles(context, await this.getRepositoryFiles(context));
    if (markerFiles.length > 0) {
      const operation = options.operation || "merge";
      throw createGitOperationError(
        operation,
        `충돌 마커가 아직 파일에 남아 있습니다.\n${markerFiles.join("\n")}`,
        operation === "rebase"
          ? { canContinueRebase: true, canAbort: true, files: markerFiles }
          : { canFinish: true, canAbort: true, files: markerFiles }
      );
    }
    await this.git(context, ["add", "-A"]);
    return this.getUnmergedFiles(context);
  }

  async getConflictMarkerFiles(context) {
    const markerFiles = await this.findConflictMarkerFiles(context, await this.getRepositoryFiles(context));
    return [...new Set(markerFiles)].sort((a, b) => a.localeCompare(b));
  }

  async openNextConflictFile(files) {
    let context;
    try {
      context = await this.getGitContext({ requireConfigured: true });
    } catch (error) {
      await this.handleSyncError(error);
      return;
    }

    await this.saveActiveConflictDocument(context);
    const currentFiles = await this.getConflictMarkerFiles(context);
    const candidates = currentFiles.length > 0
      ? currentFiles
      : await this.findConflictMarkerFiles(context, files || []);
    if (candidates.length === 0) {
      vscode.window.showInformationMessage("남은 충돌 마커가 없습니다. Continue Rebase 또는 Finish Merge를 눌러 동기화를 이어가세요.");
      return;
    }

    const file = candidates[this.conflictCursor % candidates.length];
    this.conflictCursor += 1;
    const filePath = path.resolve(context.cwd, file);
    if (!isPathInside(context.cwd, filePath)) {
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
  }

  async saveActiveConflictDocument(context) {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (!activeDocument || activeDocument.isUntitled || activeDocument.uri.scheme !== "file") {
      return;
    }

    if (!isPathInside(context.cwd, activeDocument.uri.fsPath)) {
      return;
    }

    if (activeDocument.isDirty) {
      await activeDocument.save();
    }
  }

  async getUnmergedFiles(context) {
    const result = await this.git(context, ["diff", "--name-only", "--diff-filter=U"], {
      allowNonZeroExit: true,
    });
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async assertNoConflictMarkersInChangedFiles(context) {
    const changedFiles = await this.getChangedFiles(context);
    const markerFiles = await this.findConflictMarkerFiles(context, changedFiles);
    if (markerFiles.length === 0) {
      return;
    }

    throw createConflictMarkerError(markerFiles);
  }

  async assertNoConflictMarkersInRepository(context) {
    const files = await this.getRepositoryFiles(context);
    const markerFiles = await this.findConflictMarkerFiles(context, files);
    if (markerFiles.length === 0) {
      return;
    }

    throw createConflictMarkerError(markerFiles);
  }

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

  async fetchRemote(context) {
    const result = await this.git(context, ["fetch", "origin", context.branch], {
      allowNonZeroExit: true,
      timeoutMs: 30000,
    });
    if (result.code === 0) {
      return true;
    }
    const detail = result.stderr || result.stdout || "";
    if (/couldn't find remote ref|could not find remote ref|fatal: couldn't find remote ref/i.test(detail)) {
      return false;
    }
    throw new Error(`git fetch origin ${context.branch} 실패${detail.trim() ? `\n${detail.trim()}` : ""}`);
  }

  async hasRemoteBranch(context) {
    const result = await this.git(context, ["rev-parse", "--verify", `refs/remotes/origin/${context.branch}`], {
      allowNonZeroExit: true,
    });
    return result.code === 0;
  }

  async integrateRemote(context) {
    if (!(await this.hasLocalHead(context))) {
      await this.git(context, ["pull", "origin", context.branch]);
      return;
    }

    const mergeBase = await this.git(context, ["merge-base", "HEAD", `origin/${context.branch}`], {
      allowNonZeroExit: true,
    });
    if (mergeBase.code === 0) {
      await this.git(context, ["pull", "--rebase", "origin", context.branch]);
      return;
    }

    await this.git(context, ["merge", `origin/${context.branch}`, "--allow-unrelated-histories", "--no-edit"]);
  }

  async hasLocalHead(context) {
    const result = await this.git(context, ["rev-parse", "--verify", "HEAD"], {
      allowNonZeroExit: true,
    });
    return result.code === 0;
  }

  async git(context, args, options = {}) {
    const token = await this.context.secrets.get(TOKEN_KEY);
    const askpassPath = token ? await this.ensureAskpassScript() : undefined;
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...(askpassPath ? { GIT_ASKPASS: askpassPath, PROGRAMMERS_GITHUB_TOKEN: token } : {}),
      ...(options.env || {}),
    };
    const gitArgs = args[0] === "--version"
      ? args
      : ["-c", "core.quotepath=false", ...args];
    const result = await this.execCommand("git", gitArgs, {
      cwd: context.cwd,
      env,
      allowNonZeroExit: options.allowNonZeroExit,
      timeoutMs: options.timeoutMs,
    });
    return {
      ...result,
      stdout: maskToken(result.stdout, token),
      stderr: maskToken(result.stderr, token),
    };
  }

  async ensureAskpassScript() {
    const scriptPath = this.getAskpassScriptPath();
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    if (process.platform === "win32") {
      await fs.writeFile(scriptPath, [
        "@echo off",
        "echo %1 | findstr /i \"Username\" >nul",
        "if %errorlevel%==0 (",
        "  echo x-access-token",
        "  exit /b 0",
        ")",
        "echo %1 | findstr /i \"Password\" >nul",
        "if %errorlevel%==0 (",
        "  echo %PROGRAMMERS_GITHUB_TOKEN%",
        "  exit /b 0",
        ")",
        "exit /b 0",
        "",
      ].join("\r\n"), "utf8");
    } else {
      await fs.writeFile(scriptPath, [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) echo \"x-access-token\" ;;",
        "  *Password*) echo \"$PROGRAMMERS_GITHUB_TOKEN\" ;;",
        "esac",
        "",
      ].join("\n"), "utf8");
      await fs.chmod(scriptPath, 0o700);
    }
    return scriptPath;
  }

  getAskpassScriptPath() {
    return process.platform === "win32"
      ? path.join(this.context.globalStorageUri.fsPath, "programmers-git-askpass.cmd")
      : path.join(this.context.globalStorageUri.fsPath, "programmers-git-askpass.sh");
  }

  async updateConfig(key, value) {
    await vscode.workspace.getConfiguration("programmersHelper").update(key, value, vscode.ConfigurationTarget.Global);
  }

  getStoredRemoteUrl() {
    const stored = this.context.globalState.get(REMOTE_URL_STATE_KEY);
    if (typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }

    const legacySetting = vscode.workspace.getConfiguration("programmersHelper").get("sync.remoteUrl");
    return typeof legacySetting === "string" ? legacySetting.trim() : "";
  }

  async storeRemoteUrl(remoteUrl) {
    await this.context.globalState.update(REMOTE_URL_STATE_KEY, remoteUrl);
  }

  async handleSyncError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logError("Sync failed", error);
    if (error?.conflictMarkers) {
      this.handleConflictMarkerError(error);
      return;
    }
    if (error?.gitOperation === "merge") {
      this.handleMergeInProgressError(error);
      return;
    }
    if (error?.gitOperation === "rebase") {
      this.handleRebaseInProgressError(error);
      return;
    }
    if (/CONFLICT|conflict|unmerged|Merge conflict/i.test(message)) {
      try {
        const context = await this.getGitContext({ requireConfigured: true });
        await this.ensureNoGitOperationInProgress(context);
      } catch (stateError) {
        if (stateError?.gitOperation === "merge") {
          this.handleMergeInProgressError(stateError);
          return;
        }
        if (stateError?.gitOperation === "rebase") {
          this.handleRebaseInProgressError(stateError);
          return;
        }
      }
      this.updateStatusBar("conflict");
      vscode.window.showErrorMessage(
        "Programmers sync 충돌이 발생했습니다. 충돌 파일을 해결한 뒤 Continue Rebase 또는 Finish Merge를 실행하세요.",
        "Next Conflict",
        "Open Storage Folder"
      ).then((picked) => {
        if (picked === "Next Conflict") {
          void this.openNextConflictFile();
        } else if (picked === "Open Storage Folder") {
          void this.openStorageFolder();
        }
      });
      return;
    }

    this.updateStatusBar("failed");
    vscode.window.showErrorMessage(`Programmers sync 실패\n${limitMessage(message)}`);
  }

  handleConflictMarkerError(error) {
    this.updateStatusBar("conflict");
    vscode.window.showErrorMessage(
      `충돌 마커가 남아 있어 sync를 중단했습니다.\n${limitMessage(error.message)}`,
      "Next Conflict",
      "Open Storage Folder"
    ).then((picked) => {
      if (picked === "Next Conflict") {
        void this.openNextConflictFile(error.files);
      } else if (picked === "Open Storage Folder") {
        void this.openStorageFolder();
      }
    });
  }

  handleMergeInProgressError(error) {
    this.updateStatusBar("conflict");
    const actions = error.files?.length
      ? ["Next Conflict", "Finish Merge", "Abort Merge", "Open Storage Folder"]
      : ["Finish Merge", "Abort Merge", "Open Storage Folder"];
    vscode.window.showErrorMessage(
      `Programmers sync가 merge 진행 중 상태에서 멈췄습니다.\n${limitMessage(error.message)}`,
      ...actions
    ).then((picked) => {
      if (picked === "Next Conflict") {
        void this.openNextConflictFile(error.files);
      } else if (picked === "Finish Merge") {
        void this.finishMergeAndSync();
      } else if (picked === "Abort Merge") {
        void this.abortGitOperation("merge");
      } else if (picked === "Open Storage Folder") {
        void this.openStorageFolder();
      }
    });
  }

  handleRebaseInProgressError(error) {
    this.updateStatusBar("conflict");
    const actions = error.files?.length
      ? ["Next Conflict", "Continue Rebase", "Abort Rebase", "Open Storage Folder"]
      : ["Continue Rebase", "Abort Rebase", "Open Storage Folder"];
    vscode.window.showErrorMessage(
      `Programmers sync가 rebase 진행 중 상태에서 멈췄습니다.\n${limitMessage(error.message)}`,
      ...actions
    ).then((picked) => {
      if (picked === "Next Conflict") {
        void this.openNextConflictFile(error.files);
      } else if (picked === "Continue Rebase") {
        void this.continueRebaseAndSync();
      } else if (picked === "Abort Rebase") {
        void this.abortGitOperation("rebase");
      } else if (picked === "Open Storage Folder") {
        void this.openStorageFolder();
      }
    });
  }

  async finishMergeAndSync() {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      const unmerged = await this.stageResolvedFilesAndGetUnmerged(context, { operation: "merge" });
      if (unmerged.length > 0) {
        vscode.window.showErrorMessage(`아직 해결되지 않은 충돌 파일이 있습니다.\n${limitMessage(unmerged.join("\n"))}`, "Next Conflict", "Open Storage Folder")
          .then((picked) => {
            if (picked === "Next Conflict") {
              void this.openNextConflictFile(unmerged);
            } else if (picked === "Open Storage Folder") {
              void this.openStorageFolder();
            }
          });
        return;
      }
      await this.git(context, ["commit", "--no-edit"]);
      await this.syncNow();
    } catch (error) {
      await this.handleSyncError(error);
    }
  }

  async continueRebaseAndSync() {
    try {
      const context = await this.getGitContext({ requireConfigured: true });
      const unmerged = await this.stageResolvedFilesAndGetUnmerged(context, { operation: "rebase" });
      if (unmerged.length > 0) {
        vscode.window.showErrorMessage(`아직 해결되지 않은 충돌 파일이 있습니다.\n${limitMessage(unmerged.join("\n"))}`, "Next Conflict", "Open Storage Folder")
          .then((picked) => {
            if (picked === "Next Conflict") {
              void this.openNextConflictFile(unmerged);
            } else if (picked === "Open Storage Folder") {
              void this.openStorageFolder();
            }
          });
        return;
      }
      await this.git(context, ["rebase", "--continue"], {
        env: { GIT_EDITOR: "true" },
      });
      await this.syncNow();
    } catch (error) {
      await this.handleSyncError(error);
    }
  }

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

  logError(prefix, error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      this.outputChannel?.appendLine(`[Programmers Helper] ${prefix}: ${limitMessage(message, 2000)}`);
    } catch {
      // Output channels may already be closed during extension deactivation.
    }
  }
}

function isHttpsGitHubRemote(remoteUrl) {
  return /^https:\/\/github\.com\//i.test(remoteUrl);
}

function maskToken(value, token) {
  if (!token || !value) {
    return value || "";
  }
  return String(value).split(token).join("<token>");
}

function limitMessage(value, max = 400) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function createGitOperationError(gitOperation, message, options = {}) {
  const error = new Error(message);
  error.gitOperation = gitOperation;
  Object.assign(error, options);
  return error;
}

function createConflictMarkerError(files) {
  const error = new Error(files.join("\n"));
  error.conflictMarkers = true;
  error.files = files;
  return error;
}

function hasConflictMarkers(content) {
  return /^<{7}(?:\s|$)/m.test(content)
    || /^={7}$/m.test(content)
    || /^>{7}(?:\s|$)/m.test(content);
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

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

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

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

async function writeBackgroundSyncStatus(statusPath, ok, detail) {
  try {
    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.writeFile(statusPath, `${JSON.stringify({
      ok,
      detail: String(detail || ""),
      finishedAt: new Date().toISOString(),
      reported: false,
    }, null, 2)}\n`, "utf8");
  } catch {
    // Shutdown paths should never fail because diagnostics could not be written.
  }
}

function buildBackgroundSyncScript({ cwd, branch, askpassPath, statusPath, token }) {
  return `
const cp = require("child_process");
const fs = require("fs");
const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: ${JSON.stringify(askpassPath)},
  PROGRAMMERS_GITHUB_TOKEN: ${JSON.stringify(token)},
};
function writeStatus(ok, detail) {
  try {
    fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
      ok,
      detail: String(detail || ""),
      finishedAt: new Date().toISOString(),
      reported: false,
    }, null, 2) + "\\n");
  } catch {}
}
function run(args, options = {}) {
  const gitArgs = args[0] === "--version" ? args : ["-c", "core.quotepath=false", ...args];
  return cp.spawnSync("git", gitArgs, {
    cwd: ${JSON.stringify(cwd)},
    env,
    encoding: "utf8",
    timeout: options.timeout || 30000,
  });
}
function ok(result) {
  return result && result.status === 0;
}
function hasConflictMarkers(content) {
  return /^<{7}(?:\\s|$)/m.test(content)
    || /^={7}$/m.test(content)
    || /^>{7}(?:\\s|$)/m.test(content);
}
function changedFiles() {
  const files = new Set();
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const result = run(args);
    if (!ok(result)) {
      continue;
    }
    for (const line of String(result.stdout || "").split(/\\r?\\n/)) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files];
}
function repositoryFiles() {
  const files = new Set();
  for (const args of [
    ["ls-files"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const result = run(args);
    if (!ok(result)) {
      continue;
    }
    for (const line of String(result.stdout || "").split(/\\r?\\n/)) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files];
}
function conflictMarkerFiles(files) {
  const markerFiles = [];
  for (const file of files) {
    const fullPath = require("path").resolve(${JSON.stringify(cwd)}, file);
    if (!fullPath.startsWith(require("path").resolve(${JSON.stringify(cwd)}) + require("path").sep)) {
      continue;
    }
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      if (hasConflictMarkers(fs.readFileSync(fullPath, "utf8"))) {
        markerFiles.push(file);
      }
    } catch {}
  }
  return markerFiles;
}
writeStatus(false, "started");
let result;
if (!fs.existsSync(${JSON.stringify(cwd)})) {
  writeStatus(false, "skipped: sync folder does not exist");
  process.exit(0);
}
if (!fs.existsSync(${JSON.stringify(path.join(cwd, ".git"))})) {
  writeStatus(false, "skipped: sync repository is not configured");
  process.exit(0);
}
for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD"]) {
  if (fs.existsSync(${JSON.stringify(path.join(cwd, ".git"))} + "/" + marker)) {
    writeStatus(false, "skipped: git operation in progress: " + marker);
    process.exit(0);
  }
}
if (fs.existsSync(${JSON.stringify(path.join(cwd, ".git", "rebase-merge"))}) || fs.existsSync(${JSON.stringify(path.join(cwd, ".git", "rebase-apply"))})) {
  writeStatus(false, "skipped: git rebase in progress");
  process.exit(0);
}
result = run(["remote", "get-url", "origin"]);
if (!ok(result)) {
  writeStatus(false, "skipped: origin remote is not configured");
  process.exit(0);
}
const markerFiles = conflictMarkerFiles(repositoryFiles());
if (markerFiles.length > 0) {
  writeStatus(false, "conflict markers remain\\n" + markerFiles.join("\\n"));
  process.exit(0);
}
result = run(["add", "-A"]);
if (!ok(result)) {
  writeStatus(false, "git add failed\\n" + ((result && (result.stderr || result.stdout)) || ""));
  process.exit(0);
}
const status = run(["status", "--porcelain"]);
if (!ok(status)) {
  writeStatus(false, "git status failed\\n" + ((status && (status.stderr || status.stdout)) || ""));
  process.exit(0);
}
if (String(status.stdout || "").trim()) {
  result = run(["commit", "-m", "Sync programmers state"]);
  if (!ok(result)) {
    writeStatus(false, "git commit failed\\n" + ((result && (result.stderr || result.stdout)) || ""));
    process.exit(0);
  }
}
const fetch = run(["fetch", "origin", ${JSON.stringify(branch)}]);
const fetchDetail = String((fetch && (fetch.stderr || fetch.stdout)) || "");
if (!ok(fetch) && !/couldn't find remote ref|could not find remote ref|fatal: couldn't find remote ref/i.test(fetchDetail)) {
  writeStatus(false, "git fetch failed\\n" + fetchDetail);
  process.exit(0);
}
const remote = run(["rev-parse", "--verify", "refs/remotes/origin/${branch}"]);
if (ok(remote)) {
  const mergeBase = run(["merge-base", "HEAD", "origin/${branch}"]);
  const integrated = ok(mergeBase)
    ? run(["pull", "--rebase", "origin", ${JSON.stringify(branch)}])
    : run(["merge", "origin/${branch}", "--allow-unrelated-histories", "--no-edit"]);
  if (!ok(integrated)) {
    writeStatus(false, "git integrate failed\\n" + ((integrated && (integrated.stderr || integrated.stdout)) || ""));
    process.exit(0);
  }
}
const ahead = run(["rev-list", "--count", "origin/${branch}..HEAD"]);
if (!ok(remote) || (ok(ahead) && Number(String(ahead.stdout || "0").trim()) > 0)) {
  result = run(["push", "-u", "origin", ${JSON.stringify(branch)}], { timeout: 60000 });
  if (!ok(result)) {
    writeStatus(false, "git push failed\\n" + ((result && (result.stderr || result.stdout)) || ""));
    process.exit(0);
  }
}
writeStatus(true, "synced");
`;
}

module.exports = {
  SyncManager,
};
