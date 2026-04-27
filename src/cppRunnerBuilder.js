// solution 함수의 반환 타입과 인자 목록을 읽습니다.
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

// 예제들을 실행하는 C++ 테스트 러너 코드를 만듭니다.
function buildRunner(signature, examples, solutionIncludePath = "../solution.cpp", options = {}) {
  const includePath = JSON.stringify(solutionIncludePath);
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
#include <sys/resource.h>
using namespace std;

string repr(const string& value) { return string("\\"") + value + "\\""; }
string repr(const char* value) { return repr(string(value)); }
string repr(bool value) { return value ? "true" : "false"; }

string toFixedMemory(double value) {
  ostringstream out;
  out << fixed << setprecision(2) << value;
  return out.str();
}

long long readProcStatusKb(const string& key) {
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
}

double currentJudgeMemoryMb() {
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
}

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

// 실행 환경별 메모리 표시식을 C++ 코드 문자열로 선택합니다.
function getMemoryValueExpression(options) {
  return (options.memoryMode || "judge") === "judge"
    ? 'toFixedMemory(currentJudgeMemoryMb()) + "MB"'
    : '"N/A(local)"';
}

// 한 개 예제를 실행하는 C++ if 블록을 만듭니다.
// buildRunner는 전체 파일 조립만, 이 함수는 테스트 케이스별 선언/호출/비교만 담당한다.
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

// 입력 값을 C++ 리터럴 형태로 바꿉니다.
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

// 커스텀 테스트 JSON을 내부 테스트 형식으로 바꿉니다.
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

// JS 값을 원본 C++ 리터럴 문자열로 바꿉니다.
function valueToRawLiteral(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

// 타입 문자열의 공백과 꺾쇠 표기를 정리합니다.
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

// 중첩 구조를 고려해 최상위 구분자로만 나눕니다.
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
