// C++ solution 함수 선언에서 반환 타입과 인자 목록을 추출합니다.
function parseSolutionSignature(cpp) {
  const match = cpp.match(/([A-Za-z_][\w:<>,\s&*]*?)\s+solution\s*\(([\s\S]*?)\)\s*\{/);
  if (!match) {
    return undefined;
  }

  const returnType = normalizeType(match[1]);
  const params = splitTopLevel(match[2], ",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param, index) => {
      const cleaned = param.replace(/\s*=\s*.*$/, "").trim();
      const nameMatch = cleaned.match(/([A-Za-z_]\w*)\s*$/);
      const name = nameMatch ? nameMatch[1] : `arg${index}`;
      const type = normalizeType(cleaned.slice(0, cleaned.length - name.length));
      return { type, name };
    });

  return { returnType, params };
}

// 샘플/커스텀 테스트를 실행할 C++ test_runner.cpp 코드를 생성합니다.
function buildRunner(signature, examples, solutionIncludePath = "../solution.cpp", options = {}) {
  const includePath = JSON.stringify(solutionIncludePath);
  const shouldMeasureMemory = shouldMeasureJudgeMemory(options);
  const memoryHeaderCode = buildMemoryHeaderCode(shouldMeasureMemory);
  const memorySupportCode = buildMemorySupportCode(shouldMeasureMemory);
  const memoryValueExpression = getMemoryValueExpression(options);
  const testBlocks = examples.map((example, index) => buildTestBlock(signature, example, index, memoryValueExpression));

  return `#include ${includePath}

#include <algorithm>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <queue>
#include <set>
#include <sstream>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
${memoryHeaderCode}
using namespace std;

string repr(const string& value) { return string("\\"") + value + "\\""; }
string repr(const char* value) { return repr(string(value)); }
string repr(bool value) { return value ? "true" : "false"; }

string toFixedMemory(double value) {
  ostringstream out;
  out << fixed << setprecision(2) << value;
  return out.str();
}
${memorySupportCode}

template <typename T>
typename enable_if<is_arithmetic<T>::value && !is_same<T, bool>::value, string>::type repr(T value) {
  return to_string(value);
}

template <typename T>
string repr(const vector<T>& value) {
  string out = "[";
  for (size_t i = 0; i < value.size(); ++i) {
    if (i) out += ", ";
    out += repr(value[i]);
  }
  out += "]";
  return out;
}

int main(int argc, char** argv) {
  int target = argc > 1 ? stoi(argv[1]) : 0;
  int failed = 0;
${testBlocks.join("\n")}
  if (target == 0 && failed == 0) {
    cerr << "All sample tests passed." << endl;
  }
  return 0;
}
`;
}

// judge-like 메모리 모드에서만 runner가 메모리 사용량을 측정하도록 판정합니다.
function shouldMeasureJudgeMemory(options) {
  return (options.memoryMode || "judge") === "judge";
}

// C++ runner의 메모리 측정에 필요한 header include 코드를 만듭니다.
function buildMemoryHeaderCode(shouldMeasureMemory) {
  return shouldMeasureMemory
    ? "#if !defined(_WIN32)\n#include <sys/resource.h>\n#endif"
    : "";
}

// C++ runner가 peak RSS를 읽어 출력할 helper 코드를 만듭니다.
function buildMemorySupportCode(shouldMeasureMemory) {
  if (!shouldMeasureMemory) {
    return "";
  }

  return `
long long readProcStatusKb(const string& key) {
#if defined(_WIN32)
  (void)key;
  return 0;
#else
  ifstream status("/proc/self/status");
  string line;
  const string prefix = key + ":";
  while (getline(status, line)) {
    if (line.rfind(prefix, 0) == 0) {
      istringstream value(line.substr(prefix.size()));
      long long kb = 0;
      value >> kb;
      return kb;
    }
  }
  return 0;
#endif
}

double currentJudgeMemoryMb() {
#if defined(_WIN32)
  return 0.0;
#else
  rusage usage {};
#if defined(__APPLE__) && defined(__MACH__)
  if (getrusage(RUSAGE_SELF, &usage) != 0) {
    return 0.0;
  }
  return static_cast<double>(usage.ru_maxrss) / 1024.0 / 1024.0;
#else
  long long peak_rss_kb = 0;
  if (getrusage(RUSAGE_SELF, &usage) == 0) {
    peak_rss_kb = usage.ru_maxrss;
  }
  const long long data_stack_kb = readProcStatusKb("VmData") + readProcStatusKb("VmStk");
  return static_cast<double>(max(peak_rss_kb, data_stack_kb)) / 1024.0;
#endif
#endif
}
`;
}

// 테스트 결과 출력에 넣을 메모리 값 표현식을 결정합니다.
function getMemoryValueExpression(options) {
  return (options.memoryMode || "judge") === "judge"
    ? 'toFixedMemory(currentJudgeMemoryMb()) + "MB"'
    : '"N/A(local)"';
}

// 예제 하나를 solution 호출 코드와 PASS/FAIL 출력 코드로 변환합니다.
function buildTestBlock(signature, example, index, memoryValueExpression) {
  if (example.inputs.length !== signature.params.length) {
    throw new Error(`입출력 예 #${index + 1}의 인자 수가 solution 시그니처와 다릅니다.`);
  }

  const declarations = signature.params.map((param, paramIndex) => {
    return `    ${param.type} arg${paramIndex} = ${toCppLiteral(param.type, example.inputs[paramIndex])};`;
  });
  const expected = `    ${signature.returnType} expected = ${toCppLiteral(signature.returnType, example.expected)};`;
  const callArgs = signature.params.map((_, paramIndex) => `arg${paramIndex}`).join(", ");

  return `  if (target == 0 || target == ${index + 1}) {
${declarations.join("\n")}
${expected}
    auto started_at = chrono::steady_clock::now();
    auto actual = solution(${callArgs});
    double elapsed_ms = chrono::duration<double, milli>(chrono::steady_clock::now() - started_at).count();
    const string memory_label = ${memoryValueExpression};
    if (actual == expected) {
      cerr << fixed << setprecision(2) << "[PASS] #" << ${index + 1} << " time=" << elapsed_ms << "ms memory=" << memory_label << " expected=" << repr(expected) << " actual=" << repr(actual) << endl;
    } else {
      cerr << fixed << setprecision(2) << "[FAIL] #" << ${index + 1} << " time=" << elapsed_ms << "ms memory=" << memory_label << " expected=" << repr(expected) << " actual=" << repr(actual) << endl;
      failed++;
    }
  }`;
}

// Programmers 예제 텍스트를 C++ 타입에 맞는 literal로 변환합니다.
function toCppLiteral(type, rawValue) {
  const value = rawValue.trim().replace(/^`|`$/g, "");
  if (/^vector\s*</.test(type)) {
    return value.replace(/\[/g, "{").replace(/\]/g, "}");
  }
  if (type === "string") {
    return /^".*"$/.test(value) ? value : JSON.stringify(value);
  }
  if (type === "bool") {
    return value.toLowerCase();
  }
  return value;
}

// JSON 커스텀 테스트 입력을 runner builder가 쓰는 예제 배열로 변환합니다.
function parseCustomTests(customTestsText) {
  let parsed;
  try {
    parsed = JSON.parse(customTestsText);
  } catch (error) {
    throw new Error(`커스텀 테스트 JSON 형식이 올바르지 않습니다.\n${error instanceof Error ? error.message : String(error)}`);
  }

  const tests = Array.isArray(parsed) ? parsed : [parsed];
  return tests.map((test, index) => {
    if (test && typeof test.inputsText === "string") {
      if (!test.inputsText.trim() || !String(test.expectedText || "").trim()) {
        throw new Error(`커스텀 테스트 #${index + 1}의 Input과 Expected Output을 모두 입력해주세요.`);
      }

      return {
        inputs: splitTopLevel(test.inputsText, ",").map((value) => value.trim()).filter(Boolean),
        expected: String(test.expectedText).trim(),
      };
    }

    if (!test || !Array.isArray(test.inputs) || !Object.prototype.hasOwnProperty.call(test, "expected")) {
      throw new Error(`커스텀 테스트 #${index + 1}은 Input과 Expected Output이 필요합니다.`);
    }

    return {
      inputs: test.inputs.map(valueToRawLiteral),
      expected: valueToRawLiteral(test.expected),
    };
  });
}

// 커스텀 테스트 JSON 값을 C++ literal 변환 전의 원시 문자열로 바꿉니다.
function valueToRawLiteral(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

// C++ 타입 문자열의 공백을 정리해 비교/분기하기 쉽게 만듭니다.
function normalizeType(type) {
  return type
    .replace(/\bconst\b/g, "")
    .replace(/[&*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*<\s*/g, "<")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

// 중첩 괄호 안 delimiter를 무시하고 최상위 항목만 나눕니다.
function splitTopLevel(value, delimiter) {
  const parts = [];
  let current = "";
  let angle = 0;
  let bracket = 0;
  let quote = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const prev = value[i - 1];
    if (ch === '"' && prev !== "\\") quote = !quote;
    if (!quote) {
      if (ch === "<") angle++;
      if (ch === ">") angle--;
      if (ch === "[") bracket++;
      if (ch === "]") bracket--;
      if (ch === delimiter && angle === 0 && bracket === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

module.exports = {
  buildRunner,
  parseCustomTests,
  parseSolutionSignature,
};
