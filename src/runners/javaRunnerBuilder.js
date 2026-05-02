const {
  parseCustomTests,
} = require("./cppRunnerBuilder");

// Java Solution 클래스의 solution 메서드 시그니처를 추출합니다.
function parseSolutionSignature(javaSource) {
  const match = javaSource.match(/(?:public\s+)?([A-Za-z_][\w<>\[\]\s,?]*?)\s+solution\s*\(([\s\S]*?)\)\s*(?:throws\s+[^{]+)?\{/);
  if (!match) {
    return undefined;
  }

  const returnType = normalizeType(match[1]);
  const params = splitTopLevel(match[2], ",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param, index) => {
      const cleaned = param.replace(/\bfinal\s+/g, "").trim();
      const nameMatch = cleaned.match(/([A-Za-z_]\w*)\s*$/);
      const name = nameMatch ? nameMatch[1] : `arg${index}`;
      const type = normalizeType(cleaned.slice(0, cleaned.length - name.length));
      return { type, name };
    });

  return { returnType, params };
}

// 샘플/커스텀 테스트를 실행할 Java TestRunner 코드를 생성합니다.
function buildRunner(signature, examples, _solutionIncludePath, options = {}) {
  const memorySupportCode = buildMemorySupportCode(options);
  const memoryValueExpression = getMemoryValueExpression(options);
  const testBlocks = examples.map((example, index) => buildTestBlock(signature, example, index, memoryValueExpression));

  return `import java.util.*;

public class TestRunner {
  private static String repr(Object value) {
    if (value == null) return "null";
    if (value instanceof int[]) return Arrays.toString((int[]) value);
    if (value instanceof long[]) return Arrays.toString((long[]) value);
    if (value instanceof double[]) return Arrays.toString((double[]) value);
    if (value instanceof boolean[]) return Arrays.toString((boolean[]) value);
    if (value instanceof String[]) return Arrays.toString((String[]) value);
    if (value instanceof Object[]) return Arrays.deepToString((Object[]) value);
    return String.valueOf(value);
  }

  private static boolean same(Object actual, Object expected) {
    return Objects.deepEquals(actual, expected);
  }
${memorySupportCode}

  public static void main(String[] args) {
    int target = args.length > 0 ? Integer.parseInt(args[0]) : 0;
    int failed = 0;
    Solution solution = new Solution();
${testBlocks.join("\n")}
    if (target == 0 && failed == 0) {
      System.err.println("All sample tests passed.");
    }
  }
}
`;
}

// Java runner가 메모리 사용량을 출력할 helper 코드를 만듭니다.
function buildMemorySupportCode(options) {
  if ((options.memoryMode || "judge") !== "judge") {
    return "";
  }

  return `
  private static String currentMemoryLabel() {
    Runtime runtime = Runtime.getRuntime();
    double usedMb = (runtime.totalMemory() - runtime.freeMemory()) / 1024.0 / 1024.0;
    return String.format(Locale.ROOT, "%.2fMB", usedMb);
  }
`;
}

// Java 테스트 결과 출력에 넣을 메모리 값 표현식을 결정합니다.
function getMemoryValueExpression(options) {
  return (options.memoryMode || "judge") === "judge"
    ? "currentMemoryLabel()"
    : "\"N/A(local)\"";
}

// 예제 하나를 Java solution 호출과 PASS/FAIL 출력 코드로 변환합니다.
function buildTestBlock(signature, example, index, memoryValueExpression) {
  if (example.inputs.length !== signature.params.length) {
    throw new Error(`입출력 예 #${index + 1}의 인자 수가 solution 시그니처와 다릅니다.`);
  }

  const declarations = signature.params.map((param, paramIndex) => {
    return `      ${param.type} arg${paramIndex} = ${toJavaLiteral(param.type, example.inputs[paramIndex])};`;
  });
  const expected = `      ${signature.returnType} expected = ${toJavaLiteral(signature.returnType, example.expected)};`;
  const callArgs = signature.params.map((_, paramIndex) => `arg${paramIndex}`).join(", ");

  return `    if (target == 0 || target == ${index + 1}) {
${declarations.join("\n")}
${expected}
      long startedAt = System.nanoTime();
      ${signature.returnType} actual = solution.solution(${callArgs});
      double elapsedMs = (System.nanoTime() - startedAt) / 1_000_000.0;
      String memoryLabel = ${memoryValueExpression};
      if (same(actual, expected)) {
        System.err.printf(Locale.ROOT, "[PASS] #%d time=%.2fms memory=%s expected=%s actual=%s%n", ${index + 1}, elapsedMs, memoryLabel, repr(expected), repr(actual));
      } else {
        System.err.printf(Locale.ROOT, "[FAIL] #%d time=%.2fms memory=%s expected=%s actual=%s%n", ${index + 1}, elapsedMs, memoryLabel, repr(expected), repr(actual));
        failed++;
      }
    }`;
}

// Programmers 예제 텍스트를 Java 타입에 맞는 literal로 변환합니다.
function toJavaLiteral(type, rawValue) {
  const value = rawValue.trim().replace(/^`|`$/g, "");
  if (type.endsWith("[]")) {
    return `new ${type}${toJavaArrayInitializer(value)}`;
  }
  if (type === "String") {
    return /^".*"$/.test(value) ? value : JSON.stringify(value);
  }
  if (type === "boolean") {
    return value.toLowerCase();
  }
  if (type === "char") {
    if (/^'.*'$/.test(value)) return value;
    return JSON.stringify(value).replace(/^"|"$/g, "'");
  }
  return value;
}

// 중괄호/대괄호 혼용 예제 값을 Java 배열 initializer로 정리합니다.
function toJavaArrayInitializer(rawValue) {
  return rawValue
    .replace(/\[/g, "{")
    .replace(/\]/g, "}");
}

// Java 타입 문자열의 공백을 정리해 비교/분기하기 쉽게 만듭니다.
function normalizeType(type) {
  return type
    .replace(/\bfinal\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\[\s*\]/g, "[]")
    .replace(/\s*<\s*/g, "<")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

// 중첩 배열 안 delimiter를 무시하고 최상위 항목만 나눕니다.
function splitTopLevel(value, delimiter) {
  const parts = [];
  let current = "";
  let squareDepth = 0;
  let angleDepth = 0;
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
    if (char === "[") squareDepth++;
    if (char === "]") squareDepth--;
    if (char === "<") angleDepth++;
    if (char === ">") angleDepth--;
    if (char === delimiter && squareDepth === 0 && angleDepth === 0) {
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
