const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");
const values = { language: "python", executionMode: "local", "sync.enabled": false };
const writes = [];
let gitExists = false;
let settingScope = {};
let lastTarget;
const uri = (fsPath) => ({ fsPath });
const vscode = {
  ExtensionMode: { Development: 2 }, FileType: { Directory: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
  workspace: {
    workspaceFolders: [{ uri: uri("/test") }],
    getConfiguration: () => ({ get: (key) => values[key], inspect: () => settingScope, update: async (key, value, target) => { lastTarget = target; writes.push(key); values[key] = value; } }),
    fs: { stat: async (target) => { if (target.fsPath.endsWith(".git") && !gitExists) throw Error("missing"); return { type: 2 }; } },
  },
  window: { showErrorMessage: () => {} },
};
const original = Module._load;
Module._load = function (id, ...args) { return id === "vscode" ? vscode : original.call(this, id, ...args); };
const { StartGuide } = require("../src/ui/startGuide");
const { SyncManager } = require("../src/sync/syncManager");
Module._load = original;
function fixture(mode = 2) {
  const state = new Map();
  const messages = [];
  const commands = [];
  const context = { extensionMode: mode, globalStorageUri: uri("/global"), globalState: { get: (k) => state.get(k), update: async (k, v) => state.set(k, v) } };
  const manager = { execCommand: async (cmd, args) => { commands.push([cmd, ...args]); return { code: 0, stdout: args[0] === "remote" ? "https://example.com/repo" : "" }; }, setupSync: async () => {} };
  const guide = new StartGuide(context, manager, (m) => messages.push(m));
  return { guide, messages, commands, context, manager, state };
}

test("first guide preserves existing preferences and requires no Git writes", async () => {
  const { guide, messages, commands } = fixture();
  await guide.refresh();
  assert.equal(messages[0].completed, false);
  assert.equal(messages[0].language, "python");
  assert.equal(messages[0].executionMode, "local");
  assert.equal(messages[0].configured, false);
  assert.equal(writes.length, 0);
  assert.equal(commands.length, 0);
});

test("configured but disabled sync is detected read-only", async () => {
  gitExists = true;
  const { guide, messages, commands } = fixture();
  await guide.refresh();
  assert.equal(messages[0].configured, true);
  assert.equal(messages[0].syncEnabled, false);
  assert.deepEqual(commands, [["git", "remote", "get-url", "origin"], ["git", "diff", "--name-only", "--diff-filter=U"]]);
  gitExists = false;
});

test("completion survives new guide instances and separates development from production", async () => {
  const { guide, context, manager } = fixture();
  await guide.handle({ action: "complete" });
  const messages = [];
  await new StartGuide(context, manager, (m) => messages.push(m)).refresh();
  assert.equal(messages[0].completed, true);
  context.extensionMode = 1;
  await new StartGuide(context, manager, (m) => messages.push(m)).refresh();
  assert.equal(messages[1].completed, false);
});

test("canceling setup does not complete guide; settings whitelist blocks unsupported edits", async () => {
  const { guide, messages } = fixture();
  await guide.handle({ action: "sync" });
  assert.equal(messages.at(-1).completed, false);
  const before = writes.length;
  await guide.handle({ action: "setting", key: "language", value: "invalid" });
  assert.equal(writes.length, before);
  await guide.handle({ action: "setting", key: "language", value: "java" });
  assert.equal(values.language, "java");
  values["sync.enabled"] = true;
  await guide.handle({ action: "local" });
  assert.equal(values["sync.enabled"], false);
});


test("guide and Sync Setup respect existing workspace overrides", async () => {
  settingScope = { workspaceValue: false };
  const { guide } = fixture();
  await guide.updateSetting("sync.enabled", true);
  assert.equal(lastTarget, vscode.ConfigurationTarget.Workspace);
  await SyncManager.prototype.updateConfig.call({}, "sync.enabled", false);
  assert.equal(lastTarget, vscode.ConfigurationTarget.Workspace);
  settingScope = {};
});


test("local choice persists without completing the entire guide", async () => {
  const { guide, context, manager, messages } = fixture();
  await guide.handle({ action: "local" });
  await new StartGuide(context, manager, m => messages.push(m)).refresh();
  assert.equal(messages.at(-1).localSelected, true);
  assert.equal(messages.at(-1).completed, false);
});

test("verified sync matches the current repository and exposes failures and conflicts", async () => {
  gitExists = true;
  values["sync.enabled"] = true;
  const { guide, state, messages, manager } = fixture();
  let root;
  manager.execCommand = async (cmd, args, options) => {
    root = options.cwd;
    return { code: 0, stdout: args[0] === "remote" ? "https://example.com/repo" : "" };
  };
  await guide.refresh();
  assert.equal(messages.at(-1).syncVerified, false);
  state.set("syncSuccessfulTarget.development", { cwd: root, remoteUrl: "https://example.com/repo", branch: "main" });
  await guide.refresh();
  assert.equal(messages.at(-1).syncVerified, true);
  values["sync.branch"] = "other";
  await guide.refresh();
  assert.equal(messages.at(-1).syncVerified, false);
  values["sync.branch"] = "main";
  manager.currentSyncState = "failed";
  await guide.refresh();
  assert.equal(messages.at(-1).syncError, "failed");
  manager.currentSyncState = "conflict";
  await guide.refresh();
  assert.equal(messages.at(-1).syncError, "conflict");
  state.set("syncSuccessfulTarget.development", { cwd: root, remoteUrl: "https://example.com/other" });
  await guide.refresh();
  assert.equal(messages.at(-1).syncVerified, false);
  gitExists = false;
  values["sync.enabled"] = false;
});

test("sync choices collapse on success, reopen on errors, and preserve manual expansion", () => {
  const vm = require("node:vm");
  const { buildStartGuideScript } = require("../src/ui/startGuideScript");
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, listeners: {}, setAttribute() {}, focus() {},
      addEventListener(type, cb) { this.listeners[type] = cb; },
    });
    return elements.get(id);
  };
  let receive;
  const posted = [];
  vm.runInNewContext(buildStartGuideScript(), {
    document: { getElementById: get },
    window: { addEventListener: (type, cb) => { receive = cb; } },
    vscode: { postMessage: m => posted.push(m) },
  });
  const send = extra => receive({ data: { type: "startGuideState", configured: true, syncEnabled: true, ...extra } });
  send({});
  assert.equal(get("guideSyncChoices").hidden, false);
  send({ syncVerified: true });
  assert.equal(get("guideSyncChoices").hidden, true);
  assert.equal(get("startGuide").hidden, false);
  get("guideChangeSync").listeners.click();
  send({ syncVerified: true });
  assert.equal(get("guideSyncChoices").hidden, false);
  for (const syncError of ["failed", "conflict"]) {
    send({ syncVerified: true, syncError });
    assert.equal(get("guideSyncChoices").hidden, false);
    assert.doesNotMatch(get("guideSyncState").textContent, /설정 완료/);
  }
  send({ syncVerified: true, checkFailed: true });
  assert.equal(get("guideSyncChoices").hidden, false);
  send({ syncEnabled: false });
  get("guideSyncPrimary").listeners.click();
  assert.equal(posted.at(-1).action, "enableSync");
  send({ syncEnabled: false, localSelected: true });
  assert.equal(get("guideSyncChoices").hidden, true);
  assert.equal(get("startGuide").hidden, false);
});


test("enabling sync suppresses background setup checks and preserves in-flight state", async () => {
  values["sync.enabled"] = true;
  let checks = 0;
  const statuses = [];
  const manager = {
    suppressAutoPull: true,
    getGitContext: async () => { checks++; return {}; },
    updateStatusBar: state => statuses.push(state),
  };
  await SyncManager.prototype.explainSetupAfterEnabled.call(manager);
  await SyncManager.prototype.autoPullOnActivate.call(manager);
  assert.equal(checks, 0);
  assert.deepEqual(statuses, []);
  manager.suppressAutoPull = false;
  let finish;
  manager.getGitContext = () => new Promise(resolve => { finish = resolve; });
  const pending = SyncManager.prototype.explainSetupAfterEnabled.call(manager);
  manager.syncInFlight = true;
  finish({});
  await pending;
  assert.deepEqual(statuses, []);
  values["sync.enabled"] = false;
});
