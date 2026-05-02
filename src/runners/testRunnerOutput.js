const MAX_DISPLAY_OUTPUT_CHARS = 20000;

// OutputChannel에 보여줄 stdout/stderr 길이를 제한하고 생략 안내를 붙입니다.
function formatDisplayOutput(output, captureTruncated = false) {
  const text = String(output || "");
  const captureNote = captureTruncated ? "\n[Programmers Helper] 출력이 너무 길어 일부를 캡처하지 않았습니다.\n" : "";
  if (text.length <= MAX_DISPLAY_OUTPUT_CHARS) {
    return text + captureNote;
  }

  return `${text.slice(0, MAX_DISPLAY_OUTPUT_CHARS)}\n[Programmers Helper] 출력이 너무 길어 이후 ${text.length - MAX_DISPLAY_OUTPUT_CHARS}자를 생략했습니다.${captureNote}`;
}


// 실행 중 capture buffer가 너무 커지지 않도록 chunk를 잘라 누적합니다.
function appendCapturedOutput(current, chunk, maxChars) {
  if (!maxChars) {
    return { text: current + chunk, truncated: false };
  }

  if (current.length >= maxChars) {
    return { text: current, truncated: true };
  }

  const remaining = maxChars - current.length;
  if (chunk.length <= remaining) {
    return { text: current + chunk, truncated: false };
  }

  return { text: current + chunk.slice(0, remaining), truncated: true };
}


// runner 출력에서 PASS/FAIL/TIMEOUT 개수를 집계합니다.
function countTestResultOutput(output) {
  const text = String(output || "");
  return {
    passed: (text.match(/\[PASS\]/g) || []).length,
    failed: (text.match(/\[FAIL\]/g) || []).length + (text.match(/\[TIMEOUT\]/g) || []).length,
  };
}


// 일반 실행 실패가 sanitizer 디버그 재시도 대상인지 판단합니다.
function shouldRetryWithSanitizer(error) {
  if (!error) {
    return false;
  }

  if (typeof error.signal === "string" && error.signal) {
    return true;
  }

  return typeof error.exitCode === "number" && error.exitCode !== 0;
}


// 디버그 실행 출력에 sanitizer 진단이 포함됐는지 확인합니다.
function hasSanitizerOutput(output) {
  return /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:/i.test(String(output || ""));
}


// sanitizer 자체를 사용할 수 없어 발생한 toolchain 오류인지 판단합니다.
function isSanitizerToolchainError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /libclang_rt\.asan|libclang_rt\.ubsan|cannot find -lasan|cannot find -lubsan|sanitizer/i.test(message);
}


// local sanitizer 실행에 필요한 환경 변수를 구성합니다.
function buildLocalExecutionEnv(options) {
  if (!options.debugEnv) {
    return undefined;
  }

  return {
    ASAN_OPTIONS: "symbolize=1:halt_on_error=1",
    UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1",
  };
}


// timeout 명령에 넘길 초 단위 값을 문자열로 정리합니다.
function formatTimeoutCommandSeconds(seconds) {
  return Number(seconds.toFixed(3)).toString();
}


// 사용자에게 표시할 테스트 timeout 제한 라벨을 만듭니다.
function formatTimeoutLimitLabel(timeoutMs) {
  return `${(timeoutMs / 1000).toFixed(1)}s`;
}


// OutputChannel에 표시할 메모리 측정 모드 설명을 만듭니다.
function describeMemoryOptions(memoryOptions) {
  if (memoryOptions.memoryMode === "judge") {
    return "judge-like";
  }
  return "N/A(local)";
}

module.exports = {
  formatDisplayOutput,
  appendCapturedOutput,
  countTestResultOutput,
  shouldRetryWithSanitizer,
  hasSanitizerOutput,
  isSanitizerToolchainError,
  buildLocalExecutionEnv,
  formatTimeoutCommandSeconds,
  formatTimeoutLimitLabel,
  describeMemoryOptions,
};
