const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const writes = [];
const uri = (fsPath) => ({ fsPath });
const vscode = {
  ExtensionMode: { Development: 2 },
  FileType: { Directory: 2 },
  Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
  workspace: {
    workspaceFolders: [{ uri: uri(path.resolve("fixture")) }],
    fs: {
      stat: async () => ({ type: 2 }),
      createDirectory: async () => {},
      writeFile: async (target, bytes) => writes.push(JSON.parse(bytes.toString())),
    },
  },
};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  return id === "vscode" ? vscode : originalLoad.call(this, id, ...args);
};
const { updateProblemIndexSummary } = require("../src/problems/problemStore");
const { ProgrammersSidebarProvider } = require("../src/ui/sidebarProvider");
const { SyncManager } = require("../src/sync/syncManager");
Module._load = originalLoad;

const root = uri(path.resolve("fixture/Programmers"));
const problem = {
  problemDir: path.join(root.fsPath, "123_sample"),
  folderName: "123_sample", lessonId: "123", title: "Sample",
  level: "1", category: "practice", review: false, solutionHistoryCount: 0,
};

test("opening unchanged details neither writes index nor republishes cached list", async () => {
  writes.length = 0;
  const cached = [problem];
  const result = await updateProblemIndexSummary(root, cached, { ...problem, solutionHistory: [], url: "https://example.com" });
  assert.equal(result, cached);
  assert.equal(writes.length, 0);
  const provider = new ProgrammersSidebarProvider({ extensionMode: 2, globalStorageUri: uri("unused") });
  const messages = [];
  provider.post = (message) => messages.push(message);
  provider.problemListCache = { cacheKey: root.fsPath, problems: cached };
  await provider.refreshProblems({ problems: result });
  assert.equal(messages.length, 0);
  // A fresh webview still receives the cached list through its normal refresh request.
  await provider.refreshProblems();
  assert.equal(messages.length, 1);
});

test("changed summary is persisted without detail fields and new problems are added", async () => {
  writes.length = 0;
  const cached = [problem];
  const next = await updateProblemIndexSummary(root, cached, { ...problem, review: true, solutionHistoryCount: 1, solutionHistory: [{ path: "snapshot" }] });
  assert.notEqual(next, cached);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].problems[0].review, true);
  assert.equal(writes[0].problems[0].solutionHistoryCount, 1);
  assert.equal("solutionHistory" in writes[0].problems[0], false);
  assert.equal(cached[0].review, false);
  const added = await updateProblemIndexSummary(root, next, { ...problem, problemDir: path.join(root.fsPath, "456_other"), lessonId: "456" });
  assert.equal(added.length, 2);
});

function syncFixture() {
  let saved;
  const calls = [];
  const manager = Object.create(SyncManager.prototype);
  manager.context = { globalState: { get: () => saved, update: async (key, value) => { saved = value; } } };
  manager.git = async () => ({ code: 0, stdout: "head-a\n" });
  manager.refreshProblems = async (options) => calls.push(options);
  return { manager, calls, saved: () => saved };
}

test("auto sync reuses only a previously indexed commit; changes and manual sync rebuild", async () => {
  const { manager, calls } = syncFixture();
  const context = { cwd: root.fsPath };
  await manager.refreshProblemsAfterSync(context);
  await manager.refreshProblemsAfterSync(context);
  await manager.refreshProblemsAfterSync(context, true);
  manager.git = async () => ({ code: 0, stdout: "head-b\n" });
  await manager.refreshProblemsAfterSync(context);
  await manager.refreshProblemsAfterSync({ cwd: path.resolve("other") });
  assert.deepEqual(calls.map((call) => call.force), [true, false, true, true, true]);
});

test("failed refresh never records a successful indexing baseline", async () => {
  const fixture = syncFixture();
  fixture.manager.refreshProblems = async () => { throw new Error("read failed"); };
  await assert.rejects(fixture.manager.refreshProblemsAfterSync({ cwd: root.fsPath }), /read failed/);
  assert.equal(fixture.saved(), undefined);
});

test("generated webview script remains valid JavaScript", () => {
  const { buildSidebarClientScript } = require("../src/ui/sidebarClientScript");
  assert.doesNotThrow(() => new Function(buildSidebarClientScript()));
});
