const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const {
  setPerformanceOutput, setPerformanceEnabled, isPerformanceEnabled,
  logPerformance, measurePerformance,
} = require("../src/core/performance");

test("diagnostics default off, toggle live, and preserve results and errors", async () => {
  const logs = [];
  setPerformanceOutput({ appendLine: (line) => logs.push(line) });
  assert.equal(isPerformanceEnabled(), false);
  const result = {};
  assert.equal(await measurePerformance("off", async () => result), result);
  logPerformance("off");
  assert.equal(logs.length, 0);
  setPerformanceEnabled(true);
  assert.equal(await measurePerformance("on", async () => result), result);
  assert.match(logs[0], /on: .* ms \(ok\)/);
  const error = new Error("expected");
  await assert.rejects(measurePerformance("failed", async () => { throw error; }), (value) => value === error);
  assert.match(logs[1], /\(failed\)/);
  let finish;
  const pending = measurePerformance("pending", () => new Promise((resolve) => { finish = resolve; }));
  setPerformanceEnabled(false);
  finish(result);
  assert.equal(await pending, result);
  await assert.rejects(measurePerformance("off-error", () => { throw error; }), (value) => value === error);
  logPerformance("off-again");
  assert.equal(logs.length, 2);
});

test("webview skips clocks and messages while disabled but continues rendering", () => {
  const { buildSidebarClientListScript } = require("../src/ui/sidebarClientListScript");
  let clockCalls = 0;
  const messages = [];
  const context = vm.createContext({
    performanceDiagnosticsEnabled: false,
    performance: { now: () => ++clockCalls },
    vscode: { postMessage: (message) => messages.push(message) },
    renderedProblems: [1, 2], renderedSnapshots: [], renders: 0,
  });
  vm.runInContext(buildSidebarClientListScript(), context);
  vm.runInContext("renderProblemsContent = () => { renders++; }; renderProblems();", context);
  assert.equal(context.renders, 1);
  assert.equal(clockCalls, 0);
  assert.equal(messages.length, 0);
  vm.runInContext("performanceDiagnosticsEnabled = true; renderProblems();", context);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "performance");
  assert.equal(messages[0].count, 2);
  vm.runInContext("performanceDiagnosticsEnabled = false; renderProblems();", context);
  assert.equal(context.renders, 3);
  assert.equal(messages.length, 1);
  assert.equal(clockCalls, 2);
});
