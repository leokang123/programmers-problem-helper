const {
  parseCustomTests,
} = require("./cppRunnerBuilder");

// Python solution 함수 정의에서 인자 목록을 추출합니다.
function parseSolutionSignature(pythonSource) {
  const match = pythonSource.match(/(?:^|\n)\s*def\s+solution\s*\(([\s\S]*?)\)\s*:/);
  if (!match) {
    return undefined;
  }

  const params = splitTopLevel(match[1], ",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param, index) => {
      const withoutDefault = param.replace(/\s*=.*$/, "").trim();
      const withoutAnnotation = withoutDefault.replace(/\s*:\s*.*$/, "").trim();
      const name = withoutAnnotation.replace(/^\*+/, "") || `arg${index}`;
      return { name };
    })
    .filter((param) => param.name !== "/" && param.name !== "*");

  return { params };
}

// 샘플/커스텀 테스트를 실행할 Python test_runner.py 코드를 생성합니다.
function buildRunner(signature, examples, solutionIncludePath = "../solution.py", options = {}) {
  const tests = examples.map((example, index) => buildTestCase(signature, example, index));
  const solutionPath = JSON.stringify(solutionIncludePath);
  const memorySupportCode = buildMemorySupportCode(options);
  return `import importlib.util
import pathlib
import sys
import time
${memorySupportCode}

SOLUTION_PATH = (pathlib.Path(__file__).resolve().parent / ${solutionPath}).resolve()
TESTS = [
${tests.join(",\n")}
]

spec = importlib.util.spec_from_file_location("user_solution", SOLUTION_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def repr_value(value):
    return repr(value)

def same(actual, expected):
    return actual == expected

def main():
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    failed = 0
    for index, test in enumerate(TESTS, start=1):
        if target not in (0, index):
            continue
        started_at = time.perf_counter()
        actual = mod.solution(*test["inputs"])
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        expected = test["expected"]
        memory_label = current_memory_label()
        if same(actual, expected):
            print(f"[PASS] #{index} time={elapsed_ms:.2f}ms memory={memory_label} expected={repr_value(expected)} actual={repr_value(actual)}", file=sys.stderr)
        else:
            print(f"[FAIL] #{index} time={elapsed_ms:.2f}ms memory={memory_label} expected={repr_value(expected)} actual={repr_value(actual)}", file=sys.stderr)
            failed += 1
    if target == 0 and failed == 0:
        print("All sample tests passed.", file=sys.stderr)

if __name__ == "__main__":
    main()
`;
}

// 예제 하나를 Python solution 호출과 PASS/FAIL 출력 코드로 변환합니다.
function buildTestCase(signature, example, index) {
  if (example.inputs.length !== signature.params.length) {
    throw new Error(`입출력 예 #${index + 1}의 인자 수가 solution 시그니처와 다릅니다.`);
  }

  return `  {"inputs": [${example.inputs.map(toPythonLiteral).join(", ")}], "expected": ${toPythonLiteral(example.expected)}}`;
}

// Python runner가 tracemalloc 기반 메모리 값을 출력할 helper 코드를 만듭니다.
function buildMemorySupportCode(options) {
  if ((options.memoryMode || "judge") !== "judge") {
    return `
def current_memory_label():
    return "N/A(local)"
`;
  }

  return `import resource

def current_memory_label():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    if sys.platform == "darwin":
        used_mb = usage.ru_maxrss / 1024.0 / 1024.0
    else:
        used_mb = usage.ru_maxrss / 1024.0
    return f"{used_mb:.2f}MB"
`;
}

// Programmers 예제 텍스트를 Python literal로 변환합니다.
function toPythonLiteral(rawValue) {
  const value = String(rawValue || "").trim().replace(/^`|`$/g, "");
  if (!value) {
    return "None";
  }

  try {
    return jsValueToPythonLiteral(JSON.parse(value));
  } catch {
    // Programmers examples are usually JSON-compatible, but custom text may be Python-like.
  }

  if (/^true$/i.test(value)) return "True";
  if (/^false$/i.test(value)) return "False";
  if (/^null$/i.test(value)) return "None";

  if (/^(?:-?\d+(?:\.\d+)?|"[\s\S]*"|'[\s\S]*'|\[[\s\S]*\]|\{[\s\S]*\}|True|False|None)$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

// 커스텀 테스트 JSON 값을 Python literal 문자열로 변환합니다.
function jsValueToPythonLiteral(value) {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsValueToPythonLiteral).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${jsValueToPythonLiteral(item)}`).join(", ")}}`;
  }
  return "None";
}

// 중첩 리스트 안 delimiter를 무시하고 최상위 항목만 나눕니다.
function splitTopLevel(value, delimiter) {
  const parts = [];
  let current = "";
  let bracket = 0;
  let paren = 0;
  let brace = 0;
  let quote;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const prev = value[index - 1];
    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") {
        quote = undefined;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[") bracket++;
    if (char === "]") bracket--;
    if (char === "(") paren++;
    if (char === ")") paren--;
    if (char === "{") brace++;
    if (char === "}") brace--;
    if (char === delimiter && bracket === 0 && paren === 0 && brace === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current || value.endsWith(delimiter)) {
    parts.push(current);
  }
  return parts;
}

module.exports = {
  buildRunner,
  parseCustomTests,
  parseSolutionSignature,
};
