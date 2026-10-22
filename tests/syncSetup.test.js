const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const vscode = { ExtensionMode: { Development: 2 }, window: {}, workspace: {} };
const original = Module._load;
Module._load = function (id, ...args) { return id === "vscode" ? vscode : original.call(this, id, ...args); };
const { SyncManager } = require("../src/sync/syncManager");
Module._load = original;

function fixture() {
  const state = new Map(), secrets = new Map();
  const settings = { "sync.branch": "main" };
  const inputs = [], picks = [], observed = [];
  let syncs = 0;
  vscode.workspace.getConfiguration = () => ({ get: (key) => settings[key] });
  vscode.window.showInformationMessage = () => {};
  vscode.window.showInputBox = async (options) => {
    observed.push(options);
    // Model the window losing focus while the user copies information from GitHub.
    assert.equal(options.ignoreFocusOut, true, `Focus loss cancels ${options.title}`);
    assert.ok(inputs.length, `Unexpected input: ${options.title}`);
    return inputs.shift();
  };
  vscode.window.showQuickPick = async (items, options) => {
    observed.push(options);
    assert.equal(options.ignoreFocusOut, true, `Focus loss cancels ${options.title}`);
    assert.ok(picks.length, `Unexpected picker: ${options.title}`);
    const key = picks.shift();
    return items.find((item) => item.kind === key || item.action === key);
  };
  const manager = Object.create(SyncManager.prototype);
  manager.context = {
    extensionMode: 1,
    globalState: { get: (key) => state.get(key), update: async (key, value) => state.set(key, value) },
    secrets: { get: async (key) => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async (key) => secrets.delete(key) },
  };
  manager.updateConfig = async (key, value) => { settings[key] = value; };
  manager.initializeRepository = async () => {};
  manager.ensureGitIdentity = async () => true;
  manager.syncNow = async () => { syncs++; };
  return { manager, state, secrets, settings, inputs, picks, observed, syncs: () => syncs };
}

test("repository, branch and token inputs survive focus changes and keep secrets out of ordinary state", async () => {
  const f = fixture();
  f.picks.push("remote");
  f.inputs.push("https://github.com/example/boj.git", "main", "test-only-token");
  await f.manager.setupSync();
  assert.equal(f.syncs(), 1);
  assert.equal(f.manager.getStoredRemoteUrl(), "https://github.com/example/boj.git");
  assert.equal(f.secrets.get("programmersHelper.github.token"), "test-only-token");
  assert.ok(!JSON.stringify([...f.state]).includes("test-only-token"));
  assert.equal(f.observed.find((item) => item.password)?.password, true);
  assert.equal(f.manager.setupInFlight, false);
});

test("canceling token entry retains repository and branch for the next setup", async () => {
  const f = fixture();
  f.picks.push("remote");
  f.inputs.push("https://github.com/example/boj.git", "practice", undefined);
  await f.manager.setupSync();
  assert.equal(f.syncs(), 0);
  f.observed.length = 0;
  f.picks.push("remote");
  f.inputs.push("https://github.com/example/boj.git", "practice", "test-only-token");
  await f.manager.setupSync();
  assert.equal(f.observed.find((item) => item.title.endsWith("remote URL")).value, "https://github.com/example/boj.git");
  assert.equal(f.observed.find((item) => item.title.endsWith("branch")).value, "practice");
  assert.equal(f.syncs(), 1);
});

test("canceling branch entry retains the accepted URL without changing the configured remote", async () => {
  const f = fixture();
  await f.manager.storeRemoteUrl("https://github.com/example/old.git");
  f.picks.push("remote");
  f.inputs.push("https://github.com/example/new.git", undefined);
  await f.manager.setupSync();
  assert.equal(f.manager.getStoredRemoteUrl(), "https://github.com/example/old.git");
  f.observed.length = 0;
  f.picks.push("remote");
  f.inputs.push(undefined);
  await f.manager.setupSync();
  assert.equal(f.observed.find((item) => item.title.endsWith("remote URL")).value, "https://github.com/example/new.git");
  assert.equal(f.syncs(), 0);
});

test("saved-token selection survives focus changes and reuses the secret without reentry", async () => {
  const f = fixture();
  f.secrets.set("programmersHelper.github.token", "already-stored");
  f.picks.push("remote", "keep");
  f.inputs.push("https://github.com/example/boj.git", "main");
  await f.manager.setupSync();
  assert.equal(f.syncs(), 1);
  assert.equal(f.secrets.get("programmersHelper.github.token"), "already-stored");
  assert.equal(f.observed.some((item) => item.password), false);
});

test("missing Git identity prompts also remain open across focus changes", async () => {
  const f = fixture();
  const gitWrites = [];
  f.manager.getBasicContext = async () => ({ cwd: "/test" });
  f.manager.git = async (_context, args) => {
    if (args[1] === "--get") return { code: 1, stdout: "" };
    gitWrites.push(args);
    return { code: 0, stdout: "" };
  };
  f.inputs.push("Example User", "example@example.com");
  assert.equal(await SyncManager.prototype.ensureGitIdentity.call(f.manager), true);
  assert.equal(gitWrites.length, 2);
});
