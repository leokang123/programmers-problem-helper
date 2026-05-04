const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const {
  getSyncSettings,
} = require("../core/settings");
const {
  isDevelopmentExtension,
} = require("../core/environment");
const {
  getDefaultProgrammersDir,
  resolveProgrammersDir,
} = require("../problems/problemStore");
const {
  formatDeleteModifyMessage,
} = require("./conflictResolverView");
const {
  appendGitignorePatterns,
  buildConflictMarkerHookScript,
  createGitOperationError,
  exists,
  isHttpsGitHubRemote,
  limitMessage,
  maskToken,
} = require("./syncUtils");
const {
  SyncConflictController,
} = require("./syncConflictActions");

const TOKEN_KEY = "programmersHelper.github.token";
const REMOTE_URL_STATE_KEY = "programmersHelper.sync.remoteUrl";
const SIDEBAR_VIEW_ID = "programmersHelper.sidebar";

// Programmers 저장소의 Git 설정, 동기화, 충돌 해결 UI를 총괄합니다.
class SyncManager {
  // Git sync 명령, 상태바, conflict resolver Webview 생명주기를 초기화합니다.
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
    this.statusCheckTimer = undefined;
    this.conflicts = new SyncConflictController(this);
    this.updateStatusBar();
    this.configureStatusCheck();
    void this.conflicts.cleanupConflictPreviewFiles();
  }

  // extension dispose 시 timer, Webview, status bar를 정리합니다.
  dispose() {
    this.clearStatusCheckTimer();
    void this.conflicts.dispose();
    this.statusBar.dispose();
  }

  // 설정된 주기에 따라 remote/local 변경 필요 여부만 확인하는 interval을 설정합니다.
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

  // 주기적 sync 상태 확인 interval을 해제합니다.
  clearStatusCheckTimer() {
    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer);
      this.statusCheckTimer = undefined;
    }
  }

  // sync 활성화 여부와 현재 상태를 왼쪽 status bar에 반영합니다.
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

  // 사용자가 설정 UI에서 Git sync를 처음 구성하는 흐름을 안내하고 초기 sync를 실행합니다.
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
        detail: "Use this when the Programmers storage folder already has .git and origin configured. The extension only turns sync on and uses the existing Git/SSH/credential setup.",
        kind: "configured",
      },
      {
        label: "Manual setup",
        description: "Open the folder and do everything yourself",
        detail: "Opens the Programmers storage folder. After you configure Git manually, run Programmers: Sync Now to commit, merge, and push.",
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
        // remote URL 입력이 비어 있으면 setup 흐름을 진행하지 않습니다.
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
        // Git이 허용하지 않는 브랜치 이름 문자를 설정 단계에서 걸러냅니다.
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

  // sync 설정만 켜져 있고 Git repo/remote가 없을 때 다음 행동을 안내합니다.
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

  // HTTPS GitHub remote에서 사용할 token을 유지/교체/삭제할지 사용자에게 묻습니다.
  async ensureTokenForHttpsRemote() {
    const existing = await this.context.secrets.get(TOKEN_KEY);
    if (existing) {
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

  // GitHub token을 입력받아 VS Code SecretStorage에 저장합니다.
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
    vscode.window.showInformationMessage("Programmers GitHub token을 안전 저장소에 저장했습니다.");
    return true;
  }

  // SecretStorage에 저장된 GitHub token을 제거합니다.
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
    vscode.window.showInformationMessage("저장된 Programmers GitHub token을 삭제했습니다.");
  }

  // 현재 Programmers 저장소 폴더를 VS Code에서 엽니다.
  async openStorageFolder() {
    const programmersDir = await this.getProgrammersDir({ create: true });
    await vscode.commands.executeCommand("revealFileInOS", programmersDir);
  }

  // 현재 sync 저장소, 브랜치, 원격 주소를 사용자와 Output에 표시합니다.
  async showSyncInfo() {
    const context = await this.getGitContext({ requireConfigured: false });
    if (!context) {
      const basic = await this.getBasicContext();
      this.logSyncInfo(basic, "Sync info");
      vscode.window.showInformationMessage(
        [
          "Programmers sync is not configured.",
          `Storage: ${basic.cwd}`,
          `Branch: ${basic.branch}`,
          "Remote: not configured",
        ].join("\n")
      );
      return;
    }

    this.logSyncInfo(context, "Sync info");
    vscode.window.showInformationMessage(
      [
        "Programmers sync info",
        `Storage: ${context.cwd}`,
        `Branch: ${context.branch}`,
        `Remote: ${context.remoteUrl || "not configured"}`,
      ].join("\n")
    );
  }

  // extension activate 시 local 변경이 없으면 remote 변경을 자동으로 가져옵니다.
  async autoPullOnActivate() {
    const settings = getSyncSettings();
    if (this.suppressAutoPull || !settings.enabled || !settings.autoPullOnActivate) {
      this.updateStatusBar();
      return;
    }

    try {
      await this.pullOnly({ silent: true });
    } catch (error) {
      this.logError("Auto pull failed", error);
      this.updateStatusBar("failed");
    }
  }

  // push 없이 fast-forward pull만 수행해 remote 상태를 local에 반영합니다.
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

  // 수동 Sync Now에서 저장, commit, fetch/merge, push, 목록 refresh를 순서대로 수행합니다.
  async syncNow() {
    if (this.syncInFlight) {
      vscode.window.showInformationMessage("이미 Programmers sync를 실행 중입니다.");
      return false;
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
      return false;
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
          this.logSyncInfo(context, "Sync target");
          progress.report({ message: "열려 있는 파일을 저장하는 중..." });
          await vscode.workspace.saveAll(false);
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
          await this.conflicts.assertNoConflictMarkersInRepository(context);
          await this.git(context, ["push", "-u", "origin", context.branch]);
          await this.refreshProblems?.({ invalidateCache: true, force: true });
        }
      );
      this.updateStatusBar("synced");
      vscode.window.showInformationMessage("Programmers sync 완료");
      return true;
    } catch (error) {
      await this.handleSyncError(error);
      return false;
    } finally {
      this.syncInFlight = false;
    }
  }

  // remote/local 차이를 확인해 status bar에 unsynced/synced 상태만 표시합니다.
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

  // Git 상태를 조회해 commit/merge/push가 필요한지 계산합니다.
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

  // Programmers 저장소에 Git repo, remote, branch, hook, gitignore 기본 구성을 준비합니다.
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

  // sync 작업에 필요한 cwd, branch, remote URL, token을 한 번에 수집합니다.
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

  // Git 설정 여부와 무관하게 Programmers 저장소 경로와 branch 설정을 수집합니다.
  async getBasicContext() {
    const settings = getSyncSettings();
    const programmersDir = await this.getProgrammersDir({ create: true });
    return {
      cwd: programmersDir.fsPath,
      branch: settings.branch,
      remoteUrl: this.getStoredRemoteUrl(),
    };
  }

  // sync 대상 정보를 Output에 남깁니다.
  logSyncInfo(context, label) {
    this.outputChannel?.appendLine(`[Programmers Helper] ${label}`);
    this.outputChannel?.appendLine(`[Programmers Helper]   Storage: ${context.cwd}`);
    this.outputChannel?.appendLine(`[Programmers Helper]   Branch: ${context.branch || "main"}`);
    this.outputChannel?.appendLine(`[Programmers Helper]   Remote: ${context.remoteUrl || "not configured"}`);
  }

  // sync 대상 Programmers 저장소 폴더를 찾거나 필요하면 생성합니다.
  async getProgrammersDir({ create }) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri, { create });
    return programmersDir || getDefaultProgrammersDir(this.context, workspaceFolder?.uri);
  }

  // sync를 시작하기 전에 git CLI와 .git 디렉터리 존재 여부를 확인합니다.
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

  // sync 저장소에 포함하지 않을 helper/generated 파일 패턴을 .gitignore에 보장합니다.
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

  // commit/push 전에 conflict marker가 남아 있으면 막는 Git hook을 설치합니다.
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

  // local 변경이 있으면 전체 저장소 상태를 sync commit으로 묶습니다.
  async commitLocalChanges(context) {
    await this.conflicts.assertNoConflictMarkersInChangedFiles(context);
    await this.git(context, ["add", "-A"]);
    if (!(await this.hasChanges(context))) {
      return false;
    }

    await this.git(context, ["commit", "-m", "Sync programmers state"]);
    return true;
  }

  // Git porcelain 출력으로 local working tree 변경 여부를 확인합니다.
  async hasChanges(context) {
    const status = await this.git(context, ["status", "--porcelain"], { allowNonZeroExit: true });
    return status.stdout.trim().length > 0;
  }

  // merge/rebase/cherry-pick 중이면 sync를 멈추고 resolver 흐름으로 안내합니다.
  async ensureNoGitOperationInProgress(context) {
    const gitDir = path.join(context.cwd, ".git");
    if (await exists(path.join(gitDir, "MERGE_HEAD"))) {
      const conflictFiles = await this.conflicts.getConflictMarkerFiles(context);
      const deleteModifyFiles = conflictFiles.length === 0 ? await this.conflicts.getDeleteModifyConflictFiles(context) : [];
      throw createGitOperationError(
        "merge",
        conflictFiles.length > 0
          ? `Git merge 충돌을 해결해야 합니다.\n${conflictFiles.join("\n")}`
          : deleteModifyFiles.length > 0
            ? formatDeleteModifyMessage(deleteModifyFiles)
            : "Git merge 충돌 선택은 끝났습니다. Finish Merge를 눌러 완료 커밋을 만드세요.",
        {}
      );
    }
    if (await exists(path.join(gitDir, "rebase-merge")) || await exists(path.join(gitDir, "rebase-apply"))) {
      const conflictFiles = await this.conflicts.getConflictMarkerFiles(context);
      const deleteModifyFiles = conflictFiles.length === 0 ? await this.conflicts.getDeleteModifyConflictFiles(context) : [];
      throw createGitOperationError(
        "rebase",
        conflictFiles.length > 0
          ? `Git rebase 충돌을 해결해야 합니다.\n${conflictFiles.join("\n")}`
          : deleteModifyFiles.length > 0
            ? formatDeleteModifyMessage(deleteModifyFiles)
            : "Git rebase 충돌 선택은 끝났습니다. Continue Rebase를 눌러 다음 단계로 진행하세요.",
        {}
      );
    }
    if (await exists(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      throw new Error("Git cherry-pick이 아직 끝나지 않았습니다. Storage Folder에서 작업을 마친 뒤 다시 Sync Now를 실행하세요.");
    }
  }

  // 사용자가 해결한 충돌 파일을 stage하고 아직 남은 unmerged 파일을 반환합니다.
  async stageResolvedFilesAndGetUnmerged(context, options = {}) {
    const markerFiles = await this.conflicts.findConflictMarkerFiles(context, await this.conflicts.getRepositoryFiles(context));
    const deleteModifyFiles = await this.conflicts.getDeleteModifyConflictFiles(context);
    if (markerFiles.length > 0) {
      const operation = options.operation || "merge";
      throw createGitOperationError(
        operation,
        `충돌 마커가 아직 파일에 남아 있습니다.\n${markerFiles.join("\n")}`,
        {}
      );
    }
    if (deleteModifyFiles.length > 0) {
      const operation = options.operation || "merge";
      throw createGitOperationError(
        operation,
        formatDeleteModifyMessage(deleteModifyFiles),
        {}
      );
    }
    await this.git(context, ["add", "-A"]);
    return this.conflicts.getUnmergedFiles(context);
  }

  // origin의 현재 branch 정보를 최신으로 가져옵니다.
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

  // origin/<branch>가 존재하는지 확인해 첫 push인지 판단합니다.
  async hasRemoteBranch(context) {
    const result = await this.git(context, ["rev-parse", "--verify", `refs/remotes/origin/${context.branch}`], {
      allowNonZeroExit: true,
    });
    return result.code === 0;
  }

  // remote branch가 있으면 merge로 remote 변경을 local sync commit과 통합합니다.
  async integrateRemote(context) {
    if (!(await this.hasLocalHead(context))) {
      await this.git(context, ["pull", "origin", context.branch]);
      return;
    }

    const mergeBase = await this.git(context, ["merge-base", "HEAD", `origin/${context.branch}`], {
      allowNonZeroExit: true,
    });
    const args = ["merge", "--no-edit"];
    if (mergeBase.code !== 0) {
      args.push("--allow-unrelated-histories");
    }
    args.push(`origin/${context.branch}`);
    await this.git(context, args);
  }

  // 저장소에 아직 첫 commit이 있는지 확인합니다.
  async hasLocalHead(context) {
    const result = await this.git(context, ["rev-parse", "--verify", "HEAD"], {
      allowNonZeroExit: true,
    });
    return result.code === 0;
  }

  // token askpass, 오류 마스킹, output 제한을 적용해 git 명령을 실행합니다.
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

  // HTTPS GitHub token을 Git credential prompt에 전달할 askpass 스크립트를 만듭니다.
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

  // OS에 맞는 askpass 스크립트 파일 경로를 계산합니다.
  getAskpassScriptPath() {
    return process.platform === "win32"
      ? path.join(this.context.globalStorageUri.fsPath, "programmers-git-askpass.cmd")
      : path.join(this.context.globalStorageUri.fsPath, "programmers-git-askpass.sh");
  }

  // sync 설정 변경을 VS Code global configuration에 저장합니다.
  async updateConfig(key, value) {
    await vscode.workspace.getConfiguration("programmersHelper").update(key, value, vscode.ConfigurationTarget.Global);
  }

  // setup 과정에서 저장해 둔 remote URL을 workspace/global state에서 읽습니다.
  getStoredRemoteUrl() {
    const isDevelopment = isDevelopmentExtension(this.context);
    const stored = this.context.globalState.get(this.getRemoteUrlStateKey());
    if (typeof stored === "string" && stored.trim()) {
      return stored.trim();
    }

    if (!isDevelopment) {
      const legacyStored = this.context.globalState.get(REMOTE_URL_STATE_KEY);
      if (typeof legacyStored === "string" && legacyStored.trim()) {
        return legacyStored.trim();
      }

      const legacySetting = vscode.workspace.getConfiguration("programmersHelper").get("sync.remoteUrl");
      return typeof legacySetting === "string" ? legacySetting.trim() : "";
    }

    return "";
  }

  // setup 과정에서 입력한 remote URL을 이후 sync 작업이 재사용하도록 저장합니다.
  async storeRemoteUrl(remoteUrl) {
    await this.context.globalState.update(this.getRemoteUrlStateKey(), remoteUrl);
  }

  // 개발판과 배포판이 같은 VS Code user data를 써도 remote 설정이 섞이지 않도록 분리합니다.
  getRemoteUrlStateKey() {
    return `${REMOTE_URL_STATE_KEY}.${isDevelopmentExtension(this.context) ? "development" : "production"}`;
  }

  // Git/sync 오류를 상태바, notification, conflict resolver 흐름으로 분기 처리합니다.
  async handleSyncError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logError("Sync failed", error);
    if (error?.conflictMarkers) {
      const context = await this.getGitContext({ requireConfigured: true });
      await this.conflicts.openConflictResolver(await this.conflicts.getGitOperationKind(context));
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
      const context = await this.getGitContext({ requireConfigured: true });
      await this.conflicts.openConflictResolver(await this.conflicts.getGitOperationKind(context));
      return;
    }

    this.updateStatusBar("failed");
    vscode.window.showErrorMessage(`Programmers sync 실패\n${limitMessage(message)}`);
  }

  // merge 진행 중 오류를 resolver를 여는 notification으로 안내합니다.
  handleMergeInProgressError(error) {
    this.updateStatusBar("conflict");
    void this.conflicts.openConflictResolver("merge");
  }

  // rebase 진행 중 오류를 resolver를 여는 notification으로 안내합니다.
  handleRebaseInProgressError(error) {
    this.updateStatusBar("conflict");
    void this.conflicts.openConflictResolver("rebase");
  }

  // 사용자에게 보여주기 전 상세 오류를 OutputChannel에 안전하게 남깁니다.
  logError(prefix, error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      this.outputChannel?.appendLine(`[Programmers Helper] ${prefix}: ${limitMessage(message, 2000)}`);
    } catch {
      // Output channels may already be closed during extension deactivation.
    }
  }
}

module.exports = {
  SyncManager,
};
