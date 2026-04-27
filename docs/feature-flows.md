# Feature Flows

이 문서는 Codex나 개발자가 이 확장을 수정할 때 빠르게 흐름을 잡기 위한 작업자용 지도입니다.
사용자 설명보다 코드 진입점, 상태 저장 위치, 주요 부작용, 성능 주의점을 우선합니다.

## 전체 구조

### 진입점

- `extension.js`
  - `activate(context)`에서 Output 채널, 진단 컬렉션, `ProgrammersSidebarProvider`를 생성한다.
  - `TestRunner`와 `ProblemCommands`는 `ensureServices(context)`에서 명령이나 Webview 액션이 처음 실행될 때 lazy-load한다.
  - 사이드바 Webview 메시지를 실제 명령으로 연결한다.
  - VS Code 명령 `programmersHelper.createProblem`, `programmersHelper.runSamples`를 등록한다.
  - `programmersHelper.executionMode` 설정 변경을 감지해 실행 모드 전환 피드백과 Docker 컨테이너 정리를 처리한다.
  - `deactivate()`에서 실행 중인 테스트를 멈추고 helper Docker 컨테이너 정리를 백그라운드 프로세스에 맡긴다.

### 주요 모듈

- `src/sidebarProvider.js`
  - 사이드바 Webview HTML, 버튼 이벤트, 문제 목록 렌더링, 현재 문제 UI 상태를 담당한다.
  - Webview에서 확장으로 메시지를 보낼 때 `type`으로 명령을 구분한다.
- `src/problemCommands.js`
  - 문제 생성, 열기, 메모, 새풀이, 초기화, 삭제 같은 VS Code 동작을 조율한다.
  - 현재 문제를 열면 `showOpenedProblemState()`로 사이드바 상태를 갱신한다.
- `src/problemStore.js`
  - 파일 시스템 저장소 접근을 담당한다.
  - 문제 목록, 메타데이터, 예제, 커스텀 테스트, 풀이 기록, 초기 코드 파일을 읽고 쓴다.
- `src/testRunner.js`
  - 샘플/커스텀 테스트 러너 생성, Docker 컴파일, 테스트 바이너리 실행, 오류 진단을 담당한다.
- `src/dockerRuntime.js`
  - Docker CLI 확인, runtime image 확인/빌드, runtime container 생성/시작/정리를 담당한다.
- `src/cppRunnerBuilder.js`
  - `solution.cpp`의 `solution(...)` 시그니처를 파싱하고 C++ `test_runner.cpp` 코드를 만든다.
- `src/problemParsing.js`
  - Programmers HTML fetch, HTML to Markdown 변환, `problem.md` 입출력 예 fallback 파싱을 담당한다.
- `src/errorFormatting.js`
  - 컴파일/런타임 오류를 사용자에게 보일 메시지와 VS Code diagnostic으로 바꾼다.

### 저장 파일

문제 폴더 구조는 보통 아래와 같다.

```text
Programmers/
  <lessonId>_<slug>/
    problem.md
    solution.cpp
    .programmers-helper/
      programmers.json
      initial-solution.cpp
      custom-tests.json
      review.json
      notes.md
      solution-history.json
      solutions/
        solution-<timestamp>.cpp
      test_runner.cpp
      test_runner_fast
      test_runner_debug
```

중요한 source of truth:

- 샘플 테스트 원본: `.programmers-helper/programmers.json`의 `examples`
- 샘플 테스트 fallback: `problem.md`의 입출력 예 테이블
- 커스텀 테스트: `.programmers-helper/custom-tests.json`
- 현재 문제: Webview 내부 `currentProblemDir`
- 마지막 문제: `context.workspaceState.lastProblemDir`
- 초기 코드: `.programmers-helper/initial-solution.cpp`, 없으면 `programmers.json.initialCode`

## 사이드바 메시지 흐름

### Webview 생성

1. `extension.js`가 `vscode.window.registerWebviewViewProvider("programmersHelper.sidebar", sidebarProvider)`를 등록한다.
2. VS Code가 사이드바를 열면 `ProgrammersSidebarProvider.resolveWebviewView()`가 실행된다.
3. `webview.options.enableScripts = true`를 설정하고 `getHtml()`로 HTML을 주입한다.
4. `refreshProblems()`를 호출해 문제 목록을 보낸다.
5. Webview 내부 script도 마지막에 `vscode.postMessage({ type: "refreshProblems" })`를 보낸다.

### Webview에서 확장으로 가는 메시지

주요 메시지 타입과 핸들러:

- `create`
  - Webview: 문제 번호 입력 후 생성 버튼
  - Extension handler: `problemCommands.createProblemFromId(...)`
- `openLast`
  - Webview: 마지막 열기 버튼
  - Extension handler: `problemCommands.openLastProblem()`
- `openProblem`
  - Webview: 문제 목록 행 클릭
  - Extension handler: `problemCommands.openProblemFromDir(problemDir)`
- `runSamples`
  - Webview: 샘플 테스트 실행
  - Extension handler: `testRunner.runFromCommand(context, "", problemDir, () => undefined)`
  - 사이드바에서는 `currentProblemDir`이 없으면 버튼이 비활성화된다.
- `runCustom`
  - Webview: 커스텀 테스트 실행
  - Extension handler: `problemCommands.runCustomTestsFromMessage(tests, problemDir)`
  - 사이드바에서는 `currentProblemDir`이 없으면 버튼이 비활성화된다.
- `stopTests`
  - Extension handler: `testRunner.stop()`
- `openNotes`
  - Extension handler: `problemCommands.openNotes(problemDir)`
- `resetCurrentSolution`
  - Extension handler: `problemCommands.resetCurrentSolution(problemDir)`
- `startReviewAttempt`
  - Extension handler: `problemCommands.startReviewAttempt(problemDir)`
- `openSolutionSnapshot`
  - Extension handler: `problemCommands.openSolutionSnapshot(problemDir, snapshotPath)`
- `deleteSolutionSnapshot`
  - Extension handler: `problemCommands.deleteSolutionSnapshot(problemDir, snapshotPath)`
- `toggleReview`
  - Extension handler: `problemCommands.toggleReview(problemDir, review)`
- `deleteProblem`
  - Extension handler: `problemCommands.deleteProblem(problemDir)`
- `refreshProblems`
  - Extension handler: `sidebarProvider.refreshProblems()`

### 확장에서 Webview로 가는 메시지

- `problems`
  - 문제 목록 전체를 갱신한다.
- `currentProblem`
  - Webview의 `currentProblemDir`을 갱신하고 현재 문제 관련 버튼 상태를 바꾼다.
- `customTests`
  - 커스텀 테스트 입력 UI를 저장값 또는 샘플 첫 번째 값으로 채운다.
- `status`
  - 상단 상태 박스 텍스트와 상태 클래스를 갱신한다.
- `testRunning`
  - 실행 중지 버튼 활성/비활성을 갱신한다.

## 문제 생성 flow

### 사용자 흐름

1. 사이드바에서 문제 번호 입력
2. `생성 및 열기` 클릭
3. Programmers 페이지 fetch
4. `problem.md`, `solution.cpp`, `.programmers-helper/programmers.json`, `.programmers-helper/initial-solution.cpp` 생성
5. 문제를 열고 Docker runtime 준비
6. 사이드바 현재 문제 상태 갱신

### 코드 흐름

1. `sidebarProvider.js`
   - `create` 버튼이 `{ type: "create", lessonId }` 메시지를 보낸다.
2. `extension.js`
   - `create` 핸들러가 `problemCommands.createProblemFromId(...)`를 호출한다.
3. `problemCommands.js`
   - `createProblemFromId(rawLessonId)`
   - `resolveProgrammersDir(context, workspaceFolder?.uri, { create: true })`
   - `createProblem(programmersDir, lessonId)`
4. `problemStore.js`
   - `createProblem(programmersDir, lessonId)`
   - `findExistingProblem(...)`으로 같은 lessonId 문제를 먼저 찾는다.
   - 없으면 `fetchText(url)`로 Programmers HTML을 가져온다.
   - 제목, 본문, 난이도, 분류, 기본 C++ 템플릿을 추출한다.
   - `htmlToMarkdown(markdownHtml)`로 `problem.md` 본문을 만든다.
   - `extractExamplesFromMarkdown(problemMd)` 결과를 `programmers.json.examples`에 저장한다.
5. `problemCommands.js`
   - 생성 결과를 `openProblemFromDir(result.problemDir.fsPath)`로 연다.

### 생성되는 메타데이터

`programmers.json` 주요 필드:

```json
{
  "lessonId": "12906",
  "title": "같은 숫자는 싫어",
  "url": "https://school.programmers.co.kr/learn/courses/30/lessons/12906?language=cpp",
  "initialCode": "...",
  "initialCodePath": ".programmers-helper/initial-solution.cpp",
  "examples": [
    {
      "inputs": ["[1,1,3,3,0,1,1]"],
      "expected": "[1,3,0,1]"
    }
  ]
}
```

### 주의점

- `problem.md`는 사용자에게 보이는 문제 설명이고, 샘플 테스트의 primary source는 `programmers.json.examples`다.
- 기존 문제에 `examples`가 없으면 `loadProblemExamples()`가 `problem.md`에서 fallback 파싱 후 `programmers.json`에 backfill한다.
- `writeFileIfAbsent()`는 기존 `problem.md`, `solution.cpp`, `initial-solution.cpp`를 덮어쓰지 않는다.

## 문제 열기 flow

### 마지막 열기

1. Webview `openLast` 메시지
2. `ProblemCommands.openLastProblem()`
3. `getProblemDir()`로 실행 대상 문제를 결정한다.
   - 활성 에디터가 `Programmers/<문제>/...cpp`이면 그 문제를 우선한다.
   - 아니면 `workspaceState.lastProblemDir`을 검증한다.
   - 둘 다 없으면 문제 폴더 Quick Pick을 띄운다.
4. `openProblemFromDir(target.problemDir)`로 문제를 연다.

### 문제 목록에서 열기

1. Webview 문제 행 클릭
2. `{ type: "openProblem", problemDir }`
3. `ProblemCommands.openProblemFromDir(problemDir)`
4. `validateProblemDir(problemDir)`로 안전한 문제 폴더인지 확인한다.
5. `workspaceState.lastProblemDir`을 갱신한다.
6. `openProblem(problem.md, solution.cpp)` 호출
7. Docker runtime 준비
8. `showOpenedProblemState(problemDir, runtimeStatus)` 호출

### 에디터 열기 세부 동작

`openProblem(mdUri, cppUri)`:

1. `vscode.workspace.saveAll(false)`
2. `openLockedMarkdownPreview(mdUri, ViewColumn.One)`로 문제 Markdown preview를 왼쪽에 연다.
   - 우선 `vscode.openWith(..., "vscode.markdown.preview.editor")`를 사용한다.
   - 실패하면 `markdown.showPreview`와 `markdown.preview.toggleLock` fallback을 사용한다.
3. `closeInactiveProblemTabs(mdUri, cppUri)`로 같은 `Programmers` 루트의 비활성 `problem.md` 탭을 정리한다.
4. `showSolution(cppUri)`로 현재 풀이 C++ 파일을 `ViewColumn.Two`에 연다.
5. `closeStaleSolutionTabs(cppUri)`로 같은 `Programmers` 루트의 오래된 C++ 풀이 탭을 정리한다.
6. `keepOnlyProblemLayoutTabs(mdUri, cppUri)`로 현재 문제 레이아웃에 맞지 않는 탭을 정리한다.

주의:

- 현재 구현은 전체 에디터를 닫지 않고 필요한 문제 탭만 선별 정리한다.
- 저장된 풀이 스냅샷을 열 때는 오른쪽 C++ 파일이 `solution.cpp`가 아니라 `.programmers-helper/solutions/solution-*.cpp`일 수 있다.

### 사이드바 상태 갱신

`showOpenedProblemState(problemDir, runtimeStatus)`:

1. `loadProblemInfo(problemDir)`
2. `loadProblemExamples(problemDir)`
3. `loadSavedCustomTests(problemDir)`
4. `workspaceState.lastProblemDir` 갱신
5. Webview에 `currentProblem` 전송
6. Webview에 `customTests` 전송
   - 저장된 커스텀 테스트가 있으면 그것을 사용
   - 없으면 샘플 첫 번째 케이스를 커스텀 입력 기본값으로 사용
7. `refreshProblems()` 호출
8. Webview에 `status` 전송

### 현재 문제와 마지막 문제의 의미

- `currentProblemDir`
  - Webview가 현재 열려 있다고 보는 문제다.
  - 메모, 초기화, 새풀이, 사이드바 샘플/커스텀 테스트 버튼 활성 조건이다.
- `workspaceState.lastProblemDir`
  - 마지막 문제 후보를 저장한다.
  - `마지막 열기`나 VS Code 명령 fallback에 사용한다.
- 앱 시작 직후에는 `lastProblemDir`이 있어도 `currentProblemDir`은 비어 있을 수 있다.
  - 이 상태에서 메모와 사이드바 테스트 버튼은 비활성화된다.
  - 사용자가 `마지막 열기`나 문제 목록 클릭으로 현재 문제를 명시해야 한다.

## 문제 목록 flow

### 목록 로드

1. `sidebarProvider.refreshProblems()`
2. `resolveProgrammersDir(context, workspaceFolder?.uri)`
3. `loadProblems(programmersDir)`
4. Webview에 `{ type: "problems", problems }` 전송

### `loadProblems()` 세부 동작

1. `problem-index.json`이 있고 모든 항목이 현재 `programmersDir` 아래를 가리키면 인덱스를 우선 반환한다.
2. 인덱스가 없거나 현재 `programmersDir` 밖의 경로를 포함하면 전체 스캔으로 재생성한다.
3. `vscode.workspace.fs.readDirectory(programmersDir)`
4. 디렉터리만 필터링
5. 각 디렉터리에 대해 병렬로:
   - `hasProblemFiles(problemDir)`로 `problem.md`, `solution.cpp` 존재 확인
   - `loadProblemSummary(problemDir.fsPath)`
6. lessonId 숫자 순, 그 외 폴더명 순으로 정렬
7. 재생성한 목록을 `.programmers-helper/problem-index.json`에 저장한다.

### 문제 목록 summary가 읽는 파일

- `.programmers-helper/programmers.json`
- `.programmers-helper/review.json`
- `.programmers-helper/solution-history.json`

문제 목록에는 `solutionHistory` 전체가 아니라 `solutionHistoryCount`만 포함한다.
현재 열린 문제의 상세 정보가 필요할 때만 `loadProblemInfo()`가 같은 summary에 `solutionHistory`를 추가한다.

### 성능 주의점

- 문제 목록 새로고침은 문제 수만큼 metadata 파일을 여러 개 읽는다.
- 일반 새로고침은 사이드바 메모리 캐시를 우선 사용한다.
- 명시적 강제 새로고침은 전체 스캔으로 인덱스를 재생성한다.
- 문제 열기, 리뷰 토글, 삭제, 풀이기록 변경은 단일 문제 인덱스 갱신 결과로 사이드바 메모리 캐시를 교체한다.

## 샘플 테스트 flow

### 사용자 흐름

1. 문제를 명시적으로 연다.
2. 사이드바 `샘플 테스트 실행` 버튼이 활성화된다.
3. 버튼 클릭 시 현재 문제 경로가 메시지에 포함된다.
4. 저장된 샘플 예제로 `test_runner.cpp`를 만든다.
5. Docker runtime container 안에서 컴파일하고 테스트별로 실행한다.

### Webview에서 TestRunner까지

1. `sidebarProvider.js`
   - `runSamples` 버튼 클릭
   - `currentProblemDir`이 없으면 return
   - `{ type: "runSamples", problemDir: currentProblemDir }`
2. `extension.js`
   - `runSamples` 핸들러
   - `problemDir`이 없으면 "먼저 문제를 열어주세요."
   - `testRunner.runFromCommand(context, "", problemDir, () => undefined)`
3. `testRunner.js`
   - `runFromCommand(...)`
   - `normalizeRunTarget(providedProblemDir)`
   - `runSamples(target.problemDir, "", target.cppPath)`

### 실행 대상 C++ 결정

`ProblemCommands.getActiveCodeTarget(problemDir)`:

1. 활성 에디터가 실행 가능한 C++ 파일이면 그 파일을 우선한다.
2. 아니면 현재 문제에서 보이는 C++ 파일을 찾는다.
3. 둘 다 없으면 현재 문제의 `solution.cpp`를 사용한다.

실행 가능한 C++ 파일은 아래 둘만 허용한다.

- `Programmers/<problem>/solution.cpp`
- `Programmers/<problem>/.programmers-helper/solutions/solution-<timestamp>.cpp`

주의:

- `.programmers-helper/test_runner.cpp`는 내부 생성 파일이라 실행 대상으로 사용하지 않는다.
- 현재 문제 밖의 C++ 파일은 활성 에디터나 보이는 에디터에 있어도 무시한다.

### 테스트 데이터 결정

`TestRunner.runSamples(problemDir, customTestsText, selectedCppPath)`:

1. `solution.cpp` 또는 선택된 C++ 파일을 읽는다.
2. 샘플 테스트면 `loadProblemExamples(problemDir)`를 호출한다.
3. `loadProblemExamples()`:
   - `programmers.json.examples`가 있으면 즉시 반환
   - 없거나 비어 있으면 `problem.md`에서 `extractExamplesFromMarkdown(markdown)` fallback 파싱
   - fallback 결과가 있으면 `programmers.json.examples`로 저장
   - 실패하면 빈 배열 반환
4. 예제가 비어 있으면 테스트를 중단한다.
5. `parseSolutionSignature(cpp)`로 `solution(...)` 시그니처를 찾는다.

### runner 생성

1. `.programmers-helper` 폴더를 만든다.
2. `.programmers-helper/test_runner.cpp`를 쓴다.
3. `buildRunner(signature, examples, includePath)`가 생성하는 C++ 코드는:
   - `solution.cpp` 또는 현재 C++ 파일을 `#include`한다.
   - 각 예제별 블록을 만든다.
   - `argv[1]`의 테스트 번호와 일치하는 블록만 실행한다.
   - 결과는 `cerr`에 `[PASS]`, `[FAIL]` 형태로 출력한다.

### Docker 준비

`ensureDockerRuntimeReady(problemDir)`:

1. `programmersDir = path.dirname(problemDir)`
2. 컨테이너 이름: `programmers-helper-runtime-<hash(programmersDir)>`
3. 컨테이너 문제 경로: `/workspace/Programmers/<problemFolder>`
4. Docker CLI 확인: `docker version --format {{.Server.Version}}`
5. 이미지 확인: `docker image inspect programmers-helper-cpp-runtime:1`
6. 이미지가 없으면 Dockerfile로 build
7. 컨테이너 확인: `docker inspect --format {{.State.Running}} <containerName>`
8. 컨테이너가 없으면 create 후 start
9. 컨테이너가 멈춰 있으면 start

컨테이너 생성 명령의 핵심:

```text
docker create
  --name programmers-helper-runtime-<hash>
  --workdir /workspace/Programmers
  -v <Programmers host dir>:/workspace/Programmers
  --entrypoint tail
  programmers-helper-cpp-runtime:1
  -f /dev/null
```

`-v <host path>:/workspace/Programmers`는 bind mount다. 문제 폴더를 복사하지 않고 호스트 폴더를 컨테이너 안에 연결한다.

### 컴파일

빠른 실행용:

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  clang++ -std=c++17 -Wall -O2
  .programmers-helper/test_runner.cpp
  -o .programmers-helper/test_runner_fast
```

그 뒤:

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  chmod +x .programmers-helper/test_runner_fast
```

### 실행

각 테스트케이스는 별도 `docker exec`로 하나씩 실행한다.

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  timeout --signal=TERM --kill-after=1s 3s
  .programmers-helper/test_runner_fast
  <testIndex>
```

`TEST_TIMEOUT_MS` 기본값은 3000ms다.

### sanitizer 재시도

빠른 실행이 비정상 종료하고 `shouldRetryWithSanitizer(error)`가 true면:

1. 최초 한 번만 debug 바이너리를 컴파일한다.
2. debug flags:
   - `-O0`
   - `-g`
   - `-fno-omit-frame-pointer`
   - `-fsanitize=address,undefined`
   - `-fno-sanitize-recover=all`
3. 같은 테스트 번호를 sanitizer 환경변수와 함께 재실행한다.

### 성능 주의점

- 현재는 실행할 때마다 runner 파일을 쓰고 빠른 바이너리를 다시 컴파일한다.
- 같은 `solution.cpp`, 같은 예제, 같은 include path, 같은 compile flags라면 fingerprint 기반 compile skip을 고려할 수 있다.
- 현재는 테스트 결과 output 문자열을 누적한 뒤 PASS/FAIL/TIMEOUT을 센다.
  - 많은 테스트나 큰 출력에서는 count만 따로 누적하고 전체 문자열 보관을 줄일 수 있다.
- Docker runtime 준비는 매번 Docker CLI와 image/container 상태를 확인한다.
  - 세션 캐시와 실패 시 invalidation을 고려할 수 있다.

## 커스텀 테스트 flow

### Webview 입력

커스텀 테스트 카드는 아래 값을 가진다.

- `.test-input`: `solution(...)` 인자 순서대로 쉼표로 구분한 문자열
- `.test-expected`: 기대 결과를 C++ 리터럴 형태로 쓴 문자열

`collectTests()`는 빈 카드 제외 후 아래 형태로 모은다.

```json
[
  {
    "inputsText": "4, 5, 2, 2, [[0,0]]",
    "expectedText": "[2,2]"
  }
]
```

### 실행 흐름

1. Webview `runCustom` 버튼 클릭
2. `currentProblemDir`이 없으면 return
3. `{ type: "runCustom", problemDir, tests }` 메시지
4. `extension.js`
   - `problemCommands.runCustomTestsFromMessage(tests, problemDir)`
5. `problemCommands.js`
   - `validateProblemDir(problemDir)`
   - `saveCustomTests(problemDir, tests)`
   - `runTests(JSON.stringify(tests || []), target)`
6. `extension.js`에서 주입한 `runTests`
   - `testRunner.runFromCommand(context, customTestsText, providedProblemDir, ...)`
7. `testRunner.js`
   - `parseCustomTests(customTestsText)`로 내부 examples 형태로 변환
   - 이후 샘플 테스트와 동일하게 runner 생성, 컴파일, 실행

### 저장 위치

`.programmers-helper/custom-tests.json`

### 주의점

- 커스텀 테스트는 실행 직전에 저장된다.
- 커스텀 테스트는 `programmers.json.examples`를 사용하지 않는다.
- `parseCustomTests()`는 문자열 입력을 C++ 리터럴로 해석 가능한 형태라고 가정한다.

## 테스트 중지 flow

1. Webview `stopTests` 메시지
2. `testRunner.stop()`
3. `stopRequested = true`
4. 실행 중인 child process가 있으면 `SIGTERM`
5. 1초 뒤에도 살아 있으면 `SIGKILL`
6. Output 채널과 사이드바 상태에 중지 요청 표시
7. 실행 루프는 다음 체크 지점에서 "테스트 실행이 중지되었습니다." 오류를 던진다.

주의:

- 실제로 죽이는 대상은 현재 Node child process인 `docker exec`다.
- 컨테이너 자체를 stop하지는 않는다.

## 오류 처리 flow

### 컴파일 오류

1. `compileRunner()`의 `docker exec clang++`가 non-zero로 종료한다.
2. `execFile()`이 `buildProcessFailureError(...)`를 만든다.
3. `runSamples()` catch에서 `applyCompilerDiagnostics(problemDir, error)` 호출
4. `parseCompilerDiagnostics(vscode, message, solutionUri)` 결과를 diagnostic collection에 설정한다.
5. Output 채널과 사이드바 상태에 요약 표시

### 런타임 오류

1. `runTestBinary()`가 non-zero exit을 받는다.
2. sanitizer 재시도 대상이면 debug compile/run을 실행한다.
3. sanitizer output이 있으면 그 output을 포함한 실패로 처리한다.
4. 아니면 원래 오류를 던진다.

### Timeout

1. 컨테이너 안의 `timeout` 명령이 제한 시간을 관리한다.
2. exit code `124` 또는 `137`이면 `[TIMEOUT]` 결과를 만든다.
3. timeout은 실패 개수에 포함된다.

## 메모 flow

1. 사이드바 `메모` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. Webview가 `{ type: "openNotes", problemDir }` 메시지를 보낸다.
3. `ProblemCommands.openNotes(problemDir)`
4. `validateProblemDir(problemDir)`
5. `loadProblemInfo(safeDir)`로 제목과 lessonId를 얻는다.
6. `.programmers-helper/notes.md`가 없으면 `ensureNotesFile(notesUri, problem)`로 기본 템플릿 생성
7. 같은 notes 파일이 이미 열려 있으면 그 탭만 닫고 return
8. 열려 있지 않으면 `ViewColumn.Beside`에 연다.

주의:

- 메모 열기는 현재 문제를 모르면 하지 않는다.
- 문제 Markdown preview는 `openProblem()`에서 lock되므로 메모 파일을 열어도 preview가 notes로 따라가지 않는다.

## 새풀이 flow

1. 사이드바 `새풀이` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. Webview `startReviewAttempt` 메시지
3. `ProblemCommands.startReviewAttempt(problemDir)`
4. `validateProblemDir(problemDir)`
5. `vscode.workspace.saveAll(false)`
6. `createSolutionAttempt(safeDir)`
7. `.programmers-helper/review.json`에 review true 저장
8. 문제 다시 열기
9. Docker runtime 준비
10. 사이드바 현재 문제 상태 갱신

### `createSolutionAttempt()` 세부 동작

1. 현재 `solution.cpp`를 읽는다.
2. `.programmers-helper/solutions/solution-<timestamp>.cpp`로 저장한다.
3. `.programmers-helper/solution-history.json` 맨 앞에 새 attempt 기록을 추가한다.
4. 초기 코드가 있으면 `solution.cpp`를 초기 코드로 되돌린다.

## 초기화 flow

1. 사이드바 `초기화` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. `ProblemCommands.resetCurrentSolution(problemDir)`
3. `getActiveCodeTarget(problemDir)`
   - 활성 에디터가 해당 문제의 `.cpp`이면 그 파일을 대상으로 한다.
   - 아니면 현재 문제의 `solution.cpp`를 대상으로 한다.
4. 사용자 확인 모달
5. `vscode.workspace.saveAll(false)`
6. `resetSolutionToInitial(target.problemDir, target.cppPath)`
7. 대상 C++ 파일을 초기 코드로 덮어쓴다.
8. 문제를 다시 열고 사이드바 상태를 갱신한다.

주의:

- 초기화는 풀이 기록을 만들지 않는다.
- 보관하려면 먼저 새풀이를 사용해야 한다.

## 풀이 기록 flow

### 기록 목록

1. 문제 목록 refresh 때 `loadProblemInfo()`가 `solution-history.json`을 읽는다.
2. Webview `풀이기록` 필터는 현재 문제의 `solutionHistory`만 렌더링한다.
3. 기록은 `createdAt` 역순으로 정렬된다.
4. 스냅샷 경로가 안전한 풀이 기록만 목록에 포함한다.

스냅샷 경로 검증:

- 상대 경로여야 한다.
- `.programmers-helper/solutions/` 아래여야 한다.
- 파일명은 `solution-*.cpp` 형태여야 한다.
- `path.resolve()` 결과가 문제 폴더의 `.programmers-helper/solutions` 밖으로 나가면 무시한다.

### 이전 풀이 열기

1. Webview `openSolutionSnapshot`
2. `ProblemCommands.openSolutionSnapshot(problemDir, snapshotPath)`
3. `getSolutionSnapshotPath(safeDir, snapshotPath)`
4. `problem.md`와 snapshot C++ 파일을 나란히 연다.

### 이전 풀이 삭제

1. Webview `deleteSolutionSnapshot`
2. 사용자 확인
3. `deleteSolutionSnapshot(problemDir, snapshotPath)`
4. 실제 snapshot 파일 삭제 시도
   - 먼저 trash
   - 실패하면 직접 삭제
5. `solution-history.json`에서 해당 attempt 제거
6. 문제 목록 refresh

## 다시풀 toggle flow

1. 문제 목록의 다시풀 checkbox 클릭
2. Webview `toggleReview`
3. `ProblemCommands.toggleReview(problemDir, review)`
4. `validateProblemDir(problemDir)`
5. `.programmers-helper/review.json` 저장
6. `workspaceState.lastProblemDir` 갱신
7. 문제 목록 refresh

## 문제 삭제 flow

1. 문제 목록의 삭제 버튼 클릭
2. Webview `deleteProblem`
3. `ProblemCommands.deleteProblem(problemDir)`
4. `validateProblemDir(problemDir)`
5. 사용자 확인 모달
6. 문제 폴더 삭제
   - 먼저 trash 사용
   - 실패하면 직접 삭제
7. 삭제한 문제가 `lastProblemDir`이면:
   - `lastProblemDir` 제거
   - Webview `currentProblem`을 undefined로 보냄
   - 상태를 대기 중으로 변경
8. 문제 목록 refresh

## Docker runtime flow

### 이미지

- 이미지 이름: `programmers-helper-cpp-runtime:1`
- Dockerfile: `docker/cpp-runtime.Dockerfile`
- 없으면 `docker build -t programmers-helper-cpp-runtime:1 -f <Dockerfile> <extensionDir>`

### 컨테이너

- 컨테이너 이름 prefix: `programmers-helper-runtime-`
- hash 입력: `path.resolve(programmersDir)`
- 같은 Programmers root는 같은 runtime container를 재사용한다.

### 마운트

로컬:

- host source: `programmersDir`
- container target: `/workspace/Programmers`

Dev Container:

- `PROGRAMMERS_HELPER_HOST_WORKSPACE`와 workspace 상대 경로를 이용해 host source를 계산한다.

### 종료

`deactivate()`:

1. `testRunner.stop()`
2. `stopDockerRuntimeContainersInBackground()`를 호출한다.
3. 별도 detached Node 프로세스가 실행 중인 helper 컨테이너 목록을 찾아 `docker stop`한다.
4. 정리 예약에 실패하면 Output 채널에만 기록하고 extension 종료를 막지 않는다.

### 실행 모드 변경

`programmersHelper.executionMode`가 `docker`에서 `local`로 바뀌면:

1. 사이드바 상태 영역에 로컬 실행 전환을 즉시 표시한다.
2. 실행 중인 테스트가 있으면 `testRunner.stop()`으로 중지 요청한다.
3. `stopDockerRuntimeContainers({ execCommand })`로 실행 중인 helper Docker 컨테이너를 멈춘다.
4. 사이드바 상태 영역에 컨테이너 정리 결과를 다시 표시한다.

`local`에서 `docker`로 바뀌면:

1. 즉시 컨테이너를 만들지는 않는다.
2. 사이드바 상태 영역에 Docker 실행으로 전환됐고 다음 문제 열기/테스트 실행 때 컨테이너를 준비한다고 표시한다.

## 성능 점검 메모

### 이미 개선된 부분

- 샘플 테스트는 `programmers.json.examples`를 우선 사용한다.
- `problem.md` fallback 파싱은 저장된 예제가 없을 때만 실행한다.
- fallback 파싱 성공 시 `programmers.json`에 `examples`를 저장한다.
- 사이드바 테스트 버튼은 현재 문제가 없으면 비활성화되어, `lastProblemDir`로 몰래 테스트가 실행되지 않는다.
- Docker 사용 가능 여부와 runtime image 존재 여부는 확장 세션 동안 캐시한다.
- `solution.cpp` 내용, 생성된 `test_runner.cpp` 내용, 컴파일 플래그 fingerprint가 같으면 기존 `test_runner_fast` / `test_runner_debug` 바이너리를 재사용한다.
- 테스트 결과 요약은 전체 output 문자열을 누적하지 않고 케이스별 PASS/FAIL/TIMEOUT count로 집계한다.
- 사이드바 문제 목록은 메모리의 problem summary cache를 우선 사용하고, 명시적 강제 새로고침 때만 전체 스캔한다.
- 문제 목록 인덱스가 현재 `Programmers` 루트 밖의 항목을 포함하면 폐기하고 전체 스캔으로 재생성한다.
- 문제 열기, 리뷰 토글, 삭제, 풀이기록 변경은 단일 문제 인덱스 갱신 결과로 사이드바 메모리 캐시를 교체한다.
- 문제 검색 입력은 짧은 debounce 뒤에 렌더링해 연속 입력 중 불필요한 DOM 재생성을 줄인다.
- 문제 목록과 풀이기록 목록 클릭은 event delegation으로 처리해 렌더 때마다 행별 이벤트 리스너를 다시 붙이지 않는다.
- 문제 목록과 풀이기록 목록 row는 key 기반 cache로 재사용하고, 텍스트와 checkbox 상태만 갱신한다.

### 다음 최적화 후보

1. Webview 가상 스크롤
   - 위치: `src/sidebarProvider.js`의 inline script
   - 현재: row DOM은 재사용하지만 보이는 목록 전체를 순회하고 배치한다.
   - 방향: 문제 수가 수천 개 이상으로 커져 검색/스크롤 끊김이 확인되면 화면 근처 row만 렌더링한다.

## 작업 시 체크리스트

- 샘플 테스트 관련 수정 시:
  - `programmers.json.examples` 우선 사용을 유지한다.
  - 기존 문제 fallback으로 `problem.md` 파싱이 계속 되는지 확인한다.
  - 커스텀 테스트 경로와 샘플 테스트 경로를 혼동하지 않는다.

- 현재 문제 관련 수정 시:
  - Webview `currentProblemDir`과 `workspaceState.lastProblemDir`의 역할을 섞지 않는다.
  - 메모/초기화/새풀이/사이드바 테스트는 현재 문제가 있을 때만 동작해야 한다.
  - `마지막 열기`는 last problem을 current problem으로 승격하는 명시적 액션이다.

- Docker 관련 수정 시:
  - 로컬과 Dev Container의 mount source 계산을 모두 확인한다.
  - 컨테이너는 문제 폴더를 복사하지 않고 bind mount로 본다.
  - 실행 중지 버튼은 컨테이너 stop이 아니라 현재 `docker exec` child process 종료다.

- 문제 목록 관련 수정 시:
  - `loadProblems()`는 모든 문제를 다시 읽는다는 점을 감안한다.
  - 목록 summary에 필요한 필드가 `loadProblemInfo()`에 포함되어야 한다.
  - 풀이기록 필터는 전체 문제가 아니라 현재 문제의 기록만 보여준다.

- 릴리스 기록 수정 시:
  - 이미 배포한 버전 섹션에는 새 항목을 추가하지 않는다.
  - 다음 버전 섹션을 새로 만들고 변경분을 적는다.
  - 영어 `CHANGELOG.md`와 한국어 `CHANGELOG.ko.md`를 함께 갱신한다.
