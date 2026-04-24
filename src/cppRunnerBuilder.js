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

function buildRunner(signature, examples) {
  const testBlocks = examples.map((example, index) => {
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
    auto elapsed_ms = chrono::duration_cast<chrono::milliseconds>(chrono::steady_clock::now() - started_at).count();
    if (actual == expected) {
      cout << "[PASS] #" << ${index + 1} << " time=" << elapsed_ms << "ms expected=" << repr(expected) << " actual=" << repr(actual) << endl;
    } else {
      cout << "[FAIL] #" << ${index + 1} << " time=" << elapsed_ms << "ms expected=" << repr(expected) << " actual=" << repr(actual) << endl;
      failed++;
    }
  }`;
  });

  return `#include "../solution.cpp"

#include <algorithm>
#include <chrono>
#include <cmath>
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
using namespace std;

string repr(const string& value) { return string("\\"") + value + "\\""; }
string repr(const char* value) { return repr(string(value)); }
string repr(bool value) { return value ? "true" : "false"; }

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
    cout << "All sample tests passed." << endl;
  }
  return 0;
}
`;
}

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

function valueToRawLiteral(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

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
