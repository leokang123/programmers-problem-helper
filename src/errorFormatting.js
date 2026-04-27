const path = require("path");

// 상태 영역에 보여줄 테스트 오류 문구를 만듭니다.
function formatTestErrorForStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) {
    return "알 수 없는 오류";
  }

  if (isCompilerFailureMessage(message)) {
    return summarizeCompilerError(message);
  }

  if (message.startsWith("런타임 에러")) {
    return summarizeRuntimeError(message);
  }

  return limitStatusText(message);
}

// 출력 패널에 보여줄 테스트 오류 문구를 만듭니다.
function formatTestErrorForPanel(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) {
    return "알 수 없는 오류";
  }

  if (isCompilerFailureMessage(message)) {
    return message.trim();
  }

  if (message.startsWith("런타임 에러")) {
    return summarizeRuntimeErrorForPanel(message);
  }

  return message.trim();
}

// 컴파일러 오류를 VS Code 진단 목록으로 바꿉니다.
function parseCompilerDiagnostics(vscode, message, solutionUri) {
  const diagnostics = [];
  const targetName = path.basename(solutionUri.fsPath);
  const lines = message.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/([^:\s]+):(\d+):(\d+):\s+(fatal\s+)?(error|warning|note):\s+(.*)$/);
    if (!match) {
      continue;
    }

    const [, fileName, lineNo, columnNo, , severityText, detail] = match;
    if (path.basename(fileName) !== targetName) {
      continue;
    }

    const lineIndex = Math.max(0, Number(lineNo) - 1);
    const columnIndex = Math.max(0, Number(columnNo) - 1);
    const range = new vscode.Range(lineIndex, columnIndex, lineIndex, columnIndex + 1);
    const severity = severityText === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : severityText === "note"
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, detail.trim(), severity);
    diagnostic.source = "Programmers Helper";
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

// 컴파일 오류를 짧게 요약합니다.
function summarizeCompilerError(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /\b(fatal )?error:/.test(line));
  if (!errorLine) {
    return "컴파일 실패";
  }

  return limitStatusText(`컴파일 실패\n${shortenCompilerPaths(errorLine)}`);
}

// 런타임 오류를 상태 영역용으로 요약합니다.
function summarizeRuntimeError(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] || "런타임 에러";
  const detail = lines.slice(1).find((line) => (
    /AddressSanitizer:/i.test(line)
    || /UndefinedBehaviorSanitizer/i.test(line)
    || /runtime error:/i.test(line)
    || /stack-overflow/i.test(line)
    || /buffer-overflow/i.test(line)
    || /Segmentation fault/i.test(line)
    || /killed by signal/i.test(line)
  )) || lines[1];
  if (!detail) {
    return header;
  }
  return limitStatusText(`${header}\n${translateRuntimeDiagnosticLine(shortenRuntimeDiagnosticLine(detail))}`);
}

// 런타임 오류를 패널용으로 정리합니다.
function summarizeRuntimeErrorForPanel(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] || "런타임 에러";
  const reason = lines[1] || "";
  const condensed = condenseRuntimeOutput(lines.slice(2).join("\n"));
  const detailLines = condensed
    ? condensed.split(/\r?\n/).map((line) => translateRuntimeDiagnosticLine(shortenRuntimeDiagnosticLine(line)))
    : [];
  return uniqueLines([header, reason, ...detailLines].filter(Boolean)).join("\n");
}

// 컴파일 오류의 긴 경로를 짧게 줄입니다.
function shortenCompilerPaths(line) {
  const sourceMatch = line.match(/([^/\\:\s]+\.cpp:\d+:\d+:\s+(?:fatal\s+)?error:\s+.*)$/);
  if (sourceMatch) {
    return sourceMatch[1];
  }

  const includedMatch = line.match(/([^/\\:\s]+\.cpp:\d+:\d+:)$/);
  if (includedMatch) {
    return includedMatch[1];
  }

  return line.replace(/.*[\/\\]([^\/\\:]+:\d+:\d+:)/, "$1");
}

// 상태 메시지 길이를 제한합니다.
function limitStatusText(text, maxLength = 180) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

// 프로세스 실패를 사용자 친화적 Error로 만듭니다.
function buildProcessFailureError(command, options, code, signal, stderr, stdout, elapsedMs = 0) {
  const output = (stderr || stdout || "").trim();
  const label = options.label || path.basename(command);
  const commandName = path.basename(command);

  if ((typeof label === "string" && label.includes("컴파일")) || isCompilerCommand(commandName)) {
    const detail = output ? `\n${output}` : "";
    return new Error(`컴파일 실패${detail}`);
  }

  const reason = signal
    ? `시그널 ${signal}`
    : typeof code === "number"
      ? `종료 코드 ${code}`
      : "비정상 종료";
  const runtimeOutput = condenseRuntimeOutput(output);
  const outputBlock = runtimeOutput ? `\n${runtimeOutput}` : output ? `\n${output}` : "";
  const error = new Error(`런타임 에러\n${label} 실행 중 ${reason}로 종료되었습니다.${elapsedMs > 0 ? ` (${elapsedMs}ms)` : ""}${outputBlock}`);
  error.exitCode = typeof code === "number" ? code : undefined;
  error.signal = signal || undefined;
  return error;
}

function isCompilerCommand(commandName) {
  return commandName === "clang++" || commandName === "g++";
}

// Error message prefix만 보고 컴파일 실패인지 빠르게 판정합니다.
function isCompilerFailureMessage(message) {
  return String(message || "").startsWith("컴파일 실패");
}

// 긴 런타임 출력을 핵심 줄 위주로 줄입니다.
function condenseRuntimeOutput(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const userFrame = extractUserRuntimeFrame(lines);

  const summary = buildRuntimeSummary(userFrame, lines.filter((line) => /^SUMMARY: /i.test(line)));
  if (summary) return summary;

  const runtime = buildRuntimeSummary(userFrame, lines.filter((line) => /runtime error:/i.test(line)));
  if (runtime) return runtime;

  const sanitizer = buildRuntimeSummary(userFrame, lines.filter((line) => /^==\d+==ERROR: /i.test(line) || /AddressSanitizer:/i.test(line) || /UndefinedBehaviorSanitizer/i.test(line)));
  if (sanitizer) return sanitizer;

  const compact = lines.filter((line) => !/^#\d+\s/.test(line) && !/\(BuildId:/.test(line) && !/^==\d+==ABORTING/i.test(line));
  return buildRuntimeSummary(userFrame, compact);
}

// user frame과 후보 진단 줄을 상태/패널 공용 요약 형식으로 압축합니다.
function buildRuntimeSummary(userFrame, lines) {
  if (lines.length === 0) {
    return "";
  }

  return uniqueLines([
    ...(userFrame ? [userFrame] : []),
    ...lines.map((line) => translateRuntimeDiagnosticLine(shortenRuntimeDiagnosticLine(line))),
  ]).slice(0, 2).join("\n");
}

// 런타임 출력에서 사용자 코드 위치를 찾습니다.
function extractUserRuntimeFrame(lines) {
  const frame = lines.find((line) => /solution\.cpp:\d+:\d+/.test(line));
  if (!frame) {
    return "";
  }

  const match = frame.match(/solution\.cpp:\d+:\d+/);
  if (!match) {
    return "";
  }

  return `사용자 코드 위치(user code): ${match[0]}`;
}

// 런타임 진단 한 줄을 짧게 줄입니다.
function shortenRuntimeDiagnosticLine(line) {
  let next = String(line || "").trim();
  next = next.replace(/\s*\(BuildId: [^)]+\)/g, "");
  next = next.replace(/\/usr\/bin\/\.\.\/lib\/gcc\/aarch64-linux-gnu\/\d+\/\.\.\/\.\.\/\.\.\/\.\.\/include\/c\+\+\/\d+\/bits\/([^:\s]+:\d+:\d+:)/g, "$1");
  next = next.replace(/SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior\s+.*\/([^\/:\s]+:\d+:\d+)/, "SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior $1");
  next = next.replace(/SUMMARY: AddressSanitizer:\s+([^\s]+)\s+.*\/([^\/)\s]+)(?:\+0x[0-9a-f]+)/i, "SUMMARY: AddressSanitizer: $1 $2");
  return next;
}

// 런타임 진단 문구를 일부 한국어로 바꿉니다.
function translateRuntimeDiagnosticLine(line) {
  let next = String(line || "").trim();
  if (!next) {
    return next;
  }

  next = next.replace(/\breference binding to misaligned address\b/gi, "잘못 정렬된 주소에 대한 참조 바인딩(reference binding to misaligned address)");
  next = next.replace(/\bmisaligned address\b/gi, "잘못된 메모리 정렬(misaligned address)");
  next = next.replace(/\bruntime error:\b/gi, "런타임 오류(runtime error):");
  next = next.replace(/UndefinedBehaviorSanitizer:\s*undefined-behavior/gi, "정의되지 않은 동작(undefined-behavior)");
  next = next.replace(/AddressSanitizer:\s*stack-overflow/gi, "스택 오버플로우(stack-overflow)");
  next = next.replace(/AddressSanitizer:\s*heap-buffer-overflow/gi, "힙 버퍼 범위 초과(heap-buffer-overflow)");
  next = next.replace(/AddressSanitizer:\s*stack-buffer-overflow/gi, "스택 버퍼 범위 초과(stack-buffer-overflow)");
  next = next.replace(/\bdivision by zero\b/gi, "0으로 나누기(division by zero)");
  next = next.replace(/\bsigned integer overflow\b/gi, "정수 오버플로우(signed integer overflow)");
  next = next.replace(/\buse-after-free\b/gi, "해제 후 사용(use-after-free)");
  next = next.replace(/\bSegmentation fault\b/gi, "잘못된 메모리 접근(segmentation fault)");
  return next;
}

// 중복 줄을 제거합니다.
function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    if (!line || seen.has(line)) {
      return false;
    }
    seen.add(line);
    return true;
  });
}

module.exports = {
  buildProcessFailureError,
  condenseRuntimeOutput,
  formatTestErrorForPanel,
  formatTestErrorForStatus,
  limitStatusText,
  parseCompilerDiagnostics,
  uniqueLines,
};
