const https = require("https");
const {
  MAX_FETCH_BYTES,
  MAX_REDIRECTS,
  PROGRAMMERS_HOST,
} = require("../core/config");

const FETCH_RETRY_DELAYS_MS = [300, 800];
const RETRYABLE_HTTP_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

// problem.md 본문에서 입출력 예 표를 찾아 테스트 예제로 변환합니다.
function extractExamplesFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tableStart = lines.findIndex((line, index) => {
    return /입출력 예/.test(lines.slice(Math.max(0, index - 3), index + 1).join("\n")) && line.trim().startsWith("|");
  });

  if (tableStart < 0) {
    return [];
  }

  const tableLines = [];
  for (let i = tableStart; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) break;
    tableLines.push(lines[i]);
  }

  if (tableLines.length < 3) {
    return [];
  }

  const header = parseMarkdownRow(tableLines[0]);
  return tableLines.slice(2).map((line) => {
    const row = parseMarkdownRow(line);
    return {
      inputs: row.slice(0, header.length - 1).map(cleanCell),
      expected: cleanCell(row[header.length - 1] || ""),
    };
  });
}

// Markdown 표 한 줄을 셀 단위로 나눕니다.
function parseMarkdownRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  let code = false;

  for (const ch of trimmed) {
    if (ch === "`" && !escaped) code = !code;
    if (ch === "|" && !escaped && !code) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    escaped = ch === "\\" && !escaped;
    if (ch !== "\\") escaped = false;
  }
  cells.push(current.trim());
  return cells;
}

// 표 셀 안의 코드 마크업과 HTML entity를 테스트 입력값 형태로 정리합니다.
function cleanCell(value) {
  return decodeHtml(value).replace(/^`|`$/g, "").replace(/\\\|/g, "|").trim();
}

// Programmers 문제 페이지를 가져오고 일시적 실패는 짧게 재시도합니다.
async function fetchText(targetUrl, redirects = 0) {
  let lastError;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchTextOnce(targetUrl, redirects);
    } catch (error) {
      lastError = error;

      if (!shouldRetryFetchError(error) || attempt >= FETCH_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await delay(FETCH_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

// HTTP/HTTPS 요청을 한 번 수행하고 redirect와 오류 상태를 처리합니다.
function fetchTextOnce(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!isAllowedProgrammersUrl(targetUrl)) {
      reject(new Error(`허용되지 않은 프로그래머스 URL입니다: ${targetUrl}`));
      return;
    }

    const request = https.get(
      targetUrl,
      {
        headers: {
          "user-agent": "Mozilla/5.0 problem-template-generator",
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error("프로그래머스 페이지 redirect가 너무 많습니다."));
            response.resume();
            return;
          }

          const redirectUrl = new URL(response.headers.location, targetUrl);
          if (!isAllowedProgrammersUrl(redirectUrl.toString())) {
            reject(new Error(`허용되지 않은 redirect URL입니다: ${redirectUrl.toString()}`));
            response.resume();
            return;
          }

          resolve(fetchText(redirectUrl.toString(), redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          const error = new Error(`HTTP ${response.statusCode}: ${targetUrl}`);
          error.statusCode = response.statusCode;
          reject(error);
          response.resume();
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk, "utf8");
          if (bytes > MAX_FETCH_BYTES) {
            request.destroy(new Error("프로그래머스 페이지 응답이 너무 큽니다."));
            return;
          }
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
    request.setTimeout(15000, () => {
      const error = new Error("프로그래머스 페이지 요청 시간이 초과되었습니다.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
  });
}

// 네트워크/서버 일시 오류인지 판단해 문제 생성 재시도 여부를 결정합니다.
function shouldRetryFetchError(error) {
  return (
    RETRYABLE_HTTP_STATUS_CODES.has(error?.statusCode) ||
    RETRYABLE_NETWORK_ERROR_CODES.has(error?.code)
  );
}

// fetch 재시도 사이에 짧은 대기 시간을 둡니다.
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 문제 생성 fetch가 Programmers 도메인을 벗어나지 않도록 제한합니다.
function isAllowedProgrammersUrl(targetUrl) {
  return new URL(targetUrl).hostname === PROGRAMMERS_HOST;
}

// 여러 정규식 중 처음 매칭되는 캡처 값을 반환합니다.
function matchFirst(source, ...patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

// 문제 제목을 폴더명에 넣을 수 있는 안전한 문자열로 바꿉니다.
function slugify(text) {
  return text
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Programmers HTML 설명 영역을 problem.md에 저장할 Markdown으로 변환합니다.
function htmlToMarkdown(htmlText) {
  let text = htmlText.replace(/\u001d/g, "");

  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const depth = Math.max(2, Number(level));
    return `\n${"#".repeat(depth)} ${inline(inner)}\n`;
  });

  text = text.replace(/<p>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>\s*<\/p>/gi, (_m, src, alt) => {
    return `\n![${decodeHtml(alt || "image")}](${decodeHtml(src)})\n`;
  });

  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, table) => tableToMarkdown(table));
  text = text.replace(/<ul>\s*([\s\S]*?)\s*<\/ul>/gi, (_m, list) => listToMarkdown(list));
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `\n${inline(inner)}\n`);

  return decodeHtml(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// HTML table을 Markdown table로 변환해 문제 설명과 예제를 보존합니다.
function tableToMarkdown(table) {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
    return [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => inline(cell[1]).replace(/\|/g, "\\|"));
  });

  if (rows.length === 0) {
    return "";
  }

  const [head, ...body] = rows;
  return [
    "",
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");
}

// HTML 목록을 Markdown 목록으로 변환합니다.
function listToMarkdown(list) {
  const items = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => {
    const nested = item[1].match(/<ul>\s*([\s\S]*?)\s*<\/ul>/i)?.[1];
    const itemText = inline(item[1].replace(/<ul>[\s\S]*<\/ul>/i, "")).trim();
    const lines = [`- ${itemText}`];

    if (nested) {
      for (const nestedItem of [...nested.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]) {
        lines.push(`  - ${inline(nestedItem[1]).trim()}`);
      }
    }

    return lines.join("\n");
  });

  return `\n${items.join("\n")}\n`;
}

// HTML inline 태그를 Markdown 안에서 읽기 좋은 텍스트로 정리합니다.
function inline(value) {
  return decodeHtml(
    value
      .replace(/\s+/g, " ")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

// HTML entity와 숫자 entity를 실제 문자로 디코딩합니다.
function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

module.exports = {
  decodeHtml,
  extractExamplesFromMarkdown,
  fetchText,
  htmlToMarkdown,
  matchFirst,
  slugify,
};
