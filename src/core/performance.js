const { performance } = require("perf_hooks");

let output;
let sequence = 0;
let enabled = false;

function setPerformanceEnabled(value) {
  enabled = value === true;
}

function isPerformanceEnabled() {
  return enabled;
}

function setPerformanceOutput(channel) {
  output = channel;
}

function logPerformance(message) {
  if (!enabled) {
    return;
  }
  try {
    output?.appendLine(`[perf] ${message}`);
  } catch {
    // 종료 중 Output이 먼저 닫혀도 원래 작업의 결과를 유지합니다.
  }
}

// 실제 작업의 반환값과 예외를 유지하면서 대기 시간을 포함해 기록합니다.
async function measurePerformance(name, action) {
  if (!enabled) {
    return action();
  }
  const id = ++sequence;
  const started = performance.now();
  let result = "failed";
  try {
    const value = await action();
    result = "ok";
    return value;
  } finally {
    logPerformance(`${id} ${name}: ${(performance.now() - started).toFixed(1)} ms (${result})`);
  }
}

module.exports = { setPerformanceOutput, setPerformanceEnabled, isPerformanceEnabled, logPerformance, measurePerformance };
