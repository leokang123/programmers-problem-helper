const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(mode = "docker") {
  const events = [];
  const notices = [];
  const messages = [];
  const problemDir = path.resolve("Programmers/1368_물대기");
  let last = problemDir;
  const context = { workspaceState: { get: () => last, update: async (_key, value) => { last = value; } } };
  const settings = { executionMode: mode, language: "python", tabResetMode: "onProblemChange" };
  const commands = {
    context,
    validateProblemDir: async () => problemDir,
    postMessage(message) { messages.push(message); },
    prepareDockerRuntimeOnOpen: async () => {
      events.push("runtime");
      return { kind: "ready" };
    },
    showOpenedProblemState: async (dir, status) => {
      events.push({ type: "state", status });
      commands.currentProblemInfo = { problemDir: dir };
    },
  };
  const vscode = {
    Uri: { file: (fsPath) => ({ fsPath }) }, workspace: {}, ProgressLocation: { Notification: 1 },
    window: {
      showInformationMessage: (message) => notices.push({ kind: "info", message }),
      showWarningMessage: (message) => notices.push({ kind: "warning", message }),
      showErrorMessage: (message) => notices.push({ kind: "error", message }),
      withProgress: async (_options, run) => run({ report() {} }),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/problems/problemCrudActions.js"), "utf8"), {
    module, setTimeout() {},
    require(id) {
      if (id === "vscode") return vscode;
      if (id === "path") return path;
      if (id === "../core/performance") return { measurePerformance: (_name, run) => run() };
      if (id === "../core/settings") return { getExecutionSettings: () => settings };
      if (id === "./problemEditor") return { openProblem: async () => events.push("editor") };
      if (id === "./problemStore") return {
        resolveProgrammersDir: async () => ({ fsPath: path.dirname(problemDir) }),
        createProblem: async () => ({ problemDir: { fsPath: problemDir } }),
        ensureSolutionForLanguage: async () => ({ solutionUri: { fsPath: path.join(problemDir, "solution.py") } }),
      };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  return { actions: new module.exports.ProblemCrudActions(commands), events, notices, messages, commands, problemDir };
}

test("problem editors and sidebar state are loaded before Docker preparation begins", async () => {
  const f = fixture();
  const status = await f.actions.openProblemFromDir(f.problemDir);
  assert.equal(f.events[0], "editor");
  assert.equal(f.events[1].type, "state");
  assert.equal(f.events[2], "runtime");
  assert.equal(status.kind, "ready");
  assert.equal(f.messages.at(-1).kind, "ready");
  assert.equal(f.events.filter((event) => event.type === "state").length, 1);
});

test("slow Docker leaves problem state usable and completion does not reset tests", async () => {
  const f = fixture();
  let finish, started;
  const runtimeStarted = new Promise((resolve) => { started = resolve; });
  f.commands.prepareDockerRuntimeOnOpen = () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  };
  const opening = f.actions.openProblemFromDir(f.problemDir);
  await runtimeStarted;
  assert.equal(f.events[1].type, "state");
  assert.equal(f.commands.currentProblemInfo.problemDir, f.problemDir);
  finish({ kind: "ready", detail: "Docker ready" });
  await opening;
  assert.equal(f.events.filter((event) => event.type === "state").length, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].type, "status");
});

test("Docker failure keeps the loaded problem and does not report another problem's completion", async () => {
  const f = fixture();
  f.commands.prepareDockerRuntimeOnOpen = async () => ({ kind: "error", detail: "Docker unavailable" });
  await f.actions.openProblemFromDir(f.problemDir);
  assert.equal(f.events[1].type, "state");
  assert.equal(f.messages[0].kind, "error");
  f.messages.length = 0;
  f.commands.prepareDockerRuntimeOnOpen = async () => {
    f.commands.currentProblemInfo = { problemDir: "another-problem" };
    return { kind: "ready" };
  };
  await f.actions.openProblemFromDir(f.problemDir);
  assert.equal(f.messages.length, 0);
});

test("new problem creation prepares Docker after publishing the problem", async () => {
  const f = fixture();
  await f.actions.createProblemFromId("1368");
  assert.equal(f.events[1].type, "state");
  assert.equal(f.events[2], "runtime");
  assert.equal(f.notices[0].kind, "info");
  assert.match(f.notices[0].message, /준비 완료/);
});

test("startup restore and local mode also publish the problem before checking runtime", async () => {
  for (const mode of ["docker", "local"]) {
    const f = fixture(mode);
    await f.actions.openLastProblemFromState();
    assert.equal(f.events[1].type, "state");
    assert.equal(f.events[2], "runtime");
  }
});
