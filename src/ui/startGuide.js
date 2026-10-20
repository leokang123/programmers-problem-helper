const vscode = require("vscode");
const { isDevelopmentExtension } = require("../core/environment");
const { getExecutionSettings, getSyncSettings } = require("../core/settings");
const { resolveProgrammersDir } = require("../problems/problemStore");

class StartGuide {
  constructor(context, syncManager, post) {
    this.context = context;
    this.syncManager = syncManager;
    this.post = post;
    this.stateKey = `startGuide.v1.${isDevelopmentExtension(context) ? "development" : "production"}`;
  }

  async refresh() {
    const revision = this.revision = (this.revision || 0) + 1;
    const root = await resolveProgrammersDir(this.context, vscode.workspace.workspaceFolders?.[0]?.uri);
    let configured = false;
    let checkFailed = false;
    let remoteUrl = "";
    let conflict = false;
    if (root) {
      let hasGit = false;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ".git"));
        hasGit = true;
      } catch {
        // 아직 Git을 설정하지 않은 저장소입니다.
      }
      if (hasGit) {
        try {
          const remote = await this.syncManager.execCommand("git", ["remote", "get-url", "origin"], {
            cwd: root.fsPath, allowNonZeroExit: true, timeoutMs: 5000,
          });
          remoteUrl = remote.code === 0 ? remote.stdout.trim() : "";
          configured = Boolean(remoteUrl);
          const unmerged = await this.syncManager.execCommand("git", ["diff", "--name-only", "--diff-filter=U"], {
            cwd: root.fsPath, allowNonZeroExit: true, timeoutMs: 5000,
          });
          conflict = unmerged.code === 0 && Boolean(unmerged.stdout.trim());
          checkFailed = unmerged.code !== 0;
        } catch {
          checkFailed = true;
        }
      }
    }
    if (revision !== this.revision) return;
    const settings = getExecutionSettings();
    const syncSettings = getSyncSettings();
    const syncEnabled = syncSettings.enabled;
    const success = this.context.globalState.get(`syncSuccessfulTarget.${isDevelopmentExtension(this.context) ? "development" : "production"}`);
    const syncState = this.syncManager.currentSyncState;
    const syncError = syncEnabled && (conflict || syncState === "conflict") ? "conflict"
      : syncEnabled && syncState === "failed" ? "failed" : "";
    this.post({
      type: "startGuideState", completed: this.context.globalState.get(this.stateKey) === true,
      language: settings.language, executionMode: settings.executionMode,
      syncEnabled, configured, checkFailed, syncError,
      syncing: syncEnabled && syncState === "syncing",
      syncVerified: configured && success?.cwd === root?.fsPath && success?.remoteUrl === remoteUrl && success?.branch === syncSettings.branch,
      localSelected: !syncEnabled && this.context.globalState.get(`${this.stateKey}.local`) === true,
    });
  }

  async handle(message) {
    try {
      if (message.action === "setting") {
        const allowed = { language: ["cpp", "java", "python"], executionMode: ["docker", "local"] };
        if (!allowed[message.key]?.includes(message.value)) return;
        await this.updateSetting(message.key, message.value);
      } else if (message.action === "sync") {
        await this.syncManager.setupSync();
      } else if (message.action === "enableSync") {
        this.syncManager.suppressAutoPull = true;
        try {
          await this.syncManager.updateConfig("sync.enabled", true);
        } finally {
          this.syncManager.suppressAutoPull = false;
        }
        await this.syncManager.syncNow();
      } else if (message.action === "syncNow") {
        await this.syncManager.syncNow();
      } else if (message.action === "syncInfo") {
        await this.syncManager.showSyncInfo();
      } else if (message.action === "local") {
        await this.updateSetting("sync.enabled", false);
        await this.context.globalState.update(`${this.stateKey}.local`, true);
      } else if (message.action === "complete") {
        await this.context.globalState.update(this.stateKey, true);
        this.post({ type: "startGuideCompleted" });
      } else if (message.action === "settings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:leokang123.programmers-problem-helper");
        return;
      } else if (message.action === "repository") {
        await vscode.env.openExternal(vscode.Uri.parse("https://github.com/new"));
        return;
      }
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`시작 설정을 적용하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      await this.refresh();
    }
  }

  async updateSetting(key, value) {
    const config = vscode.workspace.getConfiguration("programmersHelper");
    const current = config.inspect(key);
    const target = current?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
      : current?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
  }
}

module.exports = { StartGuide };
