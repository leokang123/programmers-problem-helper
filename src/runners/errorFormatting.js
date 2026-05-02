const path = require("path");

// TestRunner 오류를 사이드바 status에 들어갈 짧은 사용자 메시지로 바꿉니다.
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

// TestRunner 오류를 OutputChannel에 남길 상세 메시지로 바꿉니다.
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

// 컴파일 오류 텍스트를 VS Code diagnostic 목록으로 변환합니다.
function parseCompilerDiagnostics(vscode, message, solutionUri, languageId = "cpp") {
  if (languageId === "java") {
    return parseJavaCompilerDiagnostics(vscode, message, solutionUri);
  }

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

// javac 오류 형식을 Java 풀이 파일 기준 diagnostic으로 변환합니다.
function parseJavaCompilerDiagnostics(vscode, message, solutionUri) {
  const diagnostics = [];
  const targetName = path.basename(solutionUri.fsPath);
  const lines = message.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/([^:\s]+\.java):(\d+):\s+(error|warning):\s+(.*)$/);
    if (!match) {
      continue;
    }

    const [, fileName, lineNo, severityText, detail] = match;
    if (path.basename(fileName) !== targetName) {
      continue;
    }

    const caretLine = lines[index + 2] || "";
    const caretColumn = caretLine.indexOf("^");
    const lineIndex = Math.max(0, Number(lineNo) - 1);
    const columnIndex = Math.max(0, caretColumn);
    const range = new vscode.Range(lineIndex, columnIndex, lineIndex, columnIndex + 1);
    const severity = severityText === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, detail.trim(), severity);
    diagnostic.source = "Programmers Helper";
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

// 긴 컴파일 로그에서 사용자가 바로 볼 핵심 오류 줄만 요약합니다.
function summarizeCompilerError(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /\b(fatal )?error:/.test(line));
  if (!errorLine) {
    return "컴파일 실패";
  }

  return limitStatusText(`컴파일 실패\n${shortenCompilerPaths(errorLine)}`);
}

// 런타임 오류 로그를 status bar에 보여줄 짧은 요약으로 줄입니다.
function summarizeRuntimeError(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] || "런타임 에러";
  const condensed = condenseRuntimeOutput(lines.slice(2).join("\n"));
  if (condensed) {
    return limitStatusText(`${header}\n${condensed}`);
  }

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

// 런타임 오류 로그를 OutputChannel용 상세 요약으로 정리합니다.
function summarizeRuntimeErrorForPanel(message) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] || "런타임 에러";
  const reason = lines[1] || "";
  const condensed = condenseRuntimeOutput(lines.slice(2).join("\n"));
  const detailLines = condensed
    ? condensed.split(/\r?\n/)
    : [];
  return uniqueLines([header, reason, ...detailLines].filter(Boolean)).join("\n");
}

// compiler 로그에 포함된 긴 경로를 사용자가 읽기 쉬운 파일명 중심으로 줄입니다.
function shortenCompilerPaths(line) {
  const javaMatch = line.match(/([^/\\:\s]+\.java:\d+:\s+(?:error|warning):\s+.*)$/);
  if (javaMatch) {
    return javaMatch[1];
  }

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

// status bar와 sidebar에 들어갈 텍스트가 너무 길지 않도록 제한합니다.
function limitStatusText(text, maxLength = 180) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

// child process 실패 결과를 TestRunner가 처리할 수 있는 Error 객체로 감쌉니다.
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

// 실패한 명령이 컴파일 단계인지 판단합니다.
function isCompilerCommand(commandName) {
  return commandName === "clang++" || commandName === "g++" || commandName === "javac";
}

// 오류 메시지가 컴파일 실패 계열인지 판단합니다.
function isCompilerFailureMessage(message) {
  return String(message || "").startsWith("컴파일 실패");
}

// 런타임 stdout/stderr에서 빈 줄과 중복을 줄여 핵심 로그만 남깁니다.
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

  const pythonException = buildRuntimeSummary(userFrame, extractPythonExceptionLines(lines));
  if (pythonException) return pythonException;

  const javaException = buildRuntimeSummary(userFrame, lines.filter((line) => /Exception\b|Error\b/.test(line) && !/^\[FAIL\]/.test(line)));
  if (javaException) return javaException;

  const sanitizer = buildRuntimeSummary(userFrame, lines.filter((line) => /^==\d+==ERROR: /i.test(line) || /AddressSanitizer:/i.test(line) || /UndefinedBehaviorSanitizer/i.test(line)));
  if (sanitizer) return sanitizer;

  const compact = lines.filter((line) => !/^#\d+\s/.test(line) && !/\(BuildId:/.test(line) && !/^==\d+==ABORTING/i.test(line));
  return buildRuntimeSummary(userFrame, compact);
}

// 사용자 코드 위치와 오류 줄을 조합해 런타임 오류 요약을 만듭니다.
function buildRuntimeSummary(userFrame, lines) {
  if (lines.length === 0) {
    return "";
  }

  return uniqueLines([
    ...(userFrame ? [userFrame] : []),
    ...lines.map((line) => translateRuntimeDiagnosticLine(shortenRuntimeDiagnosticLine(line))),
  ]).slice(0, 2).join("\n");
}

// stack trace에서 solution 파일을 가리키는 사용자 코드 프레임을 찾습니다.
function extractUserRuntimeFrame(lines) {
  const frame = lines.find((line) => /solution\.cpp:\d+:\d+/.test(line) || /Solution\.java:\d+/.test(line) || /solution\.py", line \d+/.test(line));
  if (!frame) {
    return "";
  }

  const pythonMatch = frame.match(/solution\.py", line (\d+)/);
  if (pythonMatch) {
    return `사용자 코드 위치(user code): solution.py:${pythonMatch[1]}`;
  }

  const match = frame.match(/solution\.cpp:\d+:\d+|Solution\.java:\d+/);
  if (!match) {
    return "";
  }

  return `사용자 코드 위치(user code): ${match[0]}`;
}

// Python traceback에서 예외 타입/메시지 줄을 추출합니다.
function extractPythonExceptionLines(lines) {
  if (!lines.some((line) => line === "Traceback (most recent call last):")) {
    return [];
  }

  const exceptionLine = [...lines].reverse().find((line) => /^(?:[A-Za-z_][\w.]*Error|[A-Za-z_][\w.]*Exception):/.test(line));
  return exceptionLine ? [exceptionLine] : [];
}

// 런타임 diagnostic 줄의 긴 경로와 runner 내부 정보를 줄입니다.
function shortenRuntimeDiagnosticLine(line) {
  let next = String(line || "").trim();
  next = next.replace(/\s*\(BuildId: [^)]+\)/g, "");
  next = next.replace(/\/usr\/bin\/\.\.\/lib\/gcc\/aarch64-linux-gnu\/\d+\/\.\.\/\.\.\/\.\.\/\.\.\/include\/c\+\+\/\d+\/bits\/([^:\s]+:\d+:\d+:)/g, "$1");
  next = next.replace(/SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior\s+.*\/([^\/:\s]+:\d+:\d+)/, "SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior $1");
  next = next.replace(/SUMMARY: AddressSanitizer:\s+([^\s]+)\s+.*\/([^\/)\s]+)(?:\+0x[0-9a-f]+)/i, "SUMMARY: AddressSanitizer: $1 $2");
  return next;
}

// sanitizer/runtime diagnostic의 일부 표현을 한국어 안내로 보강합니다.
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
  next = next.replace(/\bNullPointerException\b/g, "널 참조 오류(NullPointerException)");
  next = next.replace(/\bArrayIndexOutOfBoundsException\b/g, "배열 인덱스 범위 초과(ArrayIndexOutOfBoundsException)");
  next = next.replace(/\bStringIndexOutOfBoundsException\b/g, "문자열 인덱스 범위 초과(StringIndexOutOfBoundsException)");
  next = next.replace(/\bArithmeticException\b/g, "산술 오류(ArithmeticException)");
  next = next.replace(/\bZeroDivisionError\b/g, "0으로 나누기 오류(ZeroDivisionError)");
  next = next.replace(/\bIndexError\b/g, "인덱스 오류(IndexError)");
  next = next.replace(/\bKeyError\b/g, "키 오류(KeyError)");
  next = next.replace(/\bTypeError\b/g, "타입 오류(TypeError)");
  next = next.replace(/\bValueError\b/g, "값 오류(ValueError)");
  return next;
}

// 요약 메시지에서 같은 줄이 반복되지 않도록 중복을 제거합니다.
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
