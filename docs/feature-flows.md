# Feature Flows

이 문서는 Codex나 개발자가 이 확장을 수정할 때 빠르게 흐름을 잡기 위한 작업자용 지도입니다.
사용자 설명보다 코드 진입점, 상태 저장 위치, 주요 부작용, 성능 주의점을 우선합니다.

## 전체 구조

### 진입점

- `extension.js`
  - `activate(context)`에서 Output 채널, 진단 컬렉션, `ProgrammersSidebarProvider`를 생성한다.
  - `TestRunner`와 `ProblemCommands`는 `ensureServices(context)`에서 명령이나 Webview 액션이 처음 실행될 때 lazy-load한다.
  - `TimerManager`도 `ensureServices(context)`에서 생성하며 문제별 풀이 타이머 상태를 관리한다.
  - 사이드바 Webview 메시지를 실제 명령으로 연결한다.
  - VS Code 명령 `programmersHelper.createProblem`, `programmersHelper.runSamples`, `programmersHelper.stopTests`, `programmersHelper.runCustomTests`, `programmersHelper.openNotes`를 등록한다.
  - `programmersHelper.executionMode` 설정 변경을 감지해 실행 모드 전환 피드백과 Docker 컨테이너 정리를 처리한다.
  - `deactivate()`에서 실행 중인 테스트와 타이머를 멈추고 helper Docker 컨테이너 정리를 백그라운드 프로세스에 맡긴다.

### 주요 모듈

`src/`는 역할별 폴더로 나뉜다.

- `src/core/`: 확장 전역 설정, 실행 환경 구분, 기본값
- `src/problems/`: 문제 생성/열기/저장소/언어 메타데이터/Programmers 페이지 파싱
- `src/runners/`: 테스트 실행, Docker/local runtime, 언어별 runner builder, 오류 포맷팅
- `src/ui/`: 사이드바 Webview
- `src/sync/`: Git 기반 Programmers 저장소 동기화와 충돌 해결 Webview
- `src/timers/`: 문제별 풀이 타이머

- `src/ui/sidebarProvider.js`
  - 사이드바 Webview lifecycle, 메시지 핸들링, 문제 목록 로딩/캐시를 담당한다.
  - Webview에서 확장으로 메시지를 보낼 때 `type`으로 명령을 구분한다.
- `src/ui/sidebarHtml.js`
  - 사이드바 Webview HTML, 스타일, 클라이언트 스크립트를 만든다.
- `src/ui/sidebarStyles.js`
  - 사이드바 Webview CSS를 담당한다.
- `src/ui/sidebarClientScript.js`, `src/ui/sidebarClient*Script.js`
  - Webview 내부 상태, 문제 목록 렌더링, 커스텀 테스트/이벤트 처리를 담당한다.
- `src/problems/problemCommands.js`
  - VS Code 명령에서 호출하는 public facade다.
  - 문제 CRUD, 풀이 action, 테스트 action은 아래 목적별 action 객체로 위임한다.
  - 현재 문제를 열면 `showOpenedProblemState()`로 사이드바 상태를 갱신한다.
- `src/problems/problemCrudActions.js`
  - 문제 생성, 마지막 문제 열기, 문제 폴더 열기, 문제 삭제를 담당한다.
- `src/problems/problemSolutionActions.js`
  - 새풀이, 메모, 웹 열기, 초기화, 풀이 기록 열기/삭제, 다시풀 상태를 담당한다.
- `src/problems/problemTestActions.js`
  - 커스텀 테스트 저장/실행 요청과 현재 테스트 대상 탐색을 담당한다.
- `src/problems/problemEditor.js`
  - 문제 설명/풀이 파일 열기, 탭 정리, 현재 실행 대상 추정을 담당한다.
- `src/problems/problemStore.js`
  - 파일 시스템 저장소 접근을 담당한다.
  - 문제 목록, 메타데이터, 예제, 커스텀 테스트, 풀이 기록, 초기 코드 파일을 읽고 쓴다.
- `src/problems/solutionHistoryStore.js`
  - 풀이 snapshot 생성/삭제/조회와 초기 코드 reset을 담당한다.
- `src/problems/problemStoreUtils.js`
  - problem store 계층의 JSON/text 파일 읽기와 경로 검증 helper를 담당한다.
- `src/core/environment.js`
  - VS Code `context.extensionMode`로 개발판과 패키징 설치본을 구분한다.
  - Docker 실행 상태 메시지의 런타임 라벨을 만든다.
- `src/runners/testRunner.js`
  - 샘플/커스텀 테스트 실행 순서를 조율하는 orchestrator다.
- `src/runners/testRunnerRuntime.js`
  - Docker/local runtime 준비와 child process 실행을 담당한다.
- `src/runners/testRunnerCompiler.js`
  - 언어별 runner 컴파일과 compiler diagnostic 반영을 담당한다.
- `src/runners/testRunnerExecutor.js`
  - 컴파일된 artifact 또는 script runner를 테스트 케이스 단위로 실행한다.
- `src/runners/testRunnerArtifacts.js`
  - 생성 runner 파일, fingerprint, 컴파일 artifact cache를 담당한다.
- `src/runners/testRunnerOutput.js`
  - 테스트 출력 축약, PASS/FAIL 집계, sanitizer 재시도 판단을 담당한다.
- `src/runners/testRunTarget.js`
  - 명령/사이드바에서 넘어온 실행 대상을 problemDir/solutionPath/language로 정규화한다.
- `src/problems/languages.js`
  - 지원 언어의 Programmers 파라미터, 풀이 파일명, 초기 템플릿 파일명, runner 파일명, snapshot 확장자를 정의한다.
- `src/runners/languageRunnerRegistry.js`
  - 현재 언어에 맞는 runner builder를 선택한다.
- `src/runners/dockerRuntime.js`
  - Docker CLI 확인, runtime image 확인/빌드, runtime container 생성/시작/정리를 담당한다.
- `src/sync/syncManager.js`
  - Git 저장소 설정, fetch/merge/push 흐름, status bar 상태를 조율한다.
- `src/sync/syncConflictActions.js`
  - `SyncConflictController`로 Git 충돌 상태 수집, conflict resolver Webview 메시지 처리, merge finish와 이전 rebase 상태 continue를 담당한다.
- `src/sync/conflictResolverView.js`
  - Git 충돌 해결 Webview HTML과 충돌 항목 표시 helper를 담당한다.
- `src/sync/syncUtils.js`
  - Git 오류 생성, token masking, conflict marker hook, gitignore 보조 함수를 담는다.
- `src/timers/timerManager.js`
  - 문제별 풀이 타이머 상태를 `.programmers-helper/timer.json`에 저장한다.
  - 시작/중지/초기화/목표 시간 변경을 처리하고, 문제 전환이나 확장 종료 시 실행 중인 타이머를 정산 후 중지한다.
  - 기존 `context.workspaceState.problemTimers` 데이터는 해당 문제를 다시 열 때 `timer.json`으로 옮기고 legacy 값을 제거한다.
- `src/runners/cppRunnerBuilder.js`
  - `solution.cpp`의 `solution(...)` 시그니처를 파싱하고 C++ `test_runner.cpp` 코드를 만든다.
- `src/runners/javaRunnerBuilder.js`
  - `Solution.java`의 `solution(...)` 시그니처를 파싱하고 Java `TestRunner.java` 코드를 만든다.
- `src/runners/pythonRunnerBuilder.js`
  - `solution.py`의 `def solution(...)` 시그니처를 파싱하고 Python `test_runner.py` 코드를 만든다.
- `src/problems/problemParsing.js`
  - Programmers HTML fetch, HTML to Markdown 변환, `problem.md` 입출력 예 fallback 파싱을 담당한다.
  - `502`, `503`, `504`와 일시적인 네트워크 오류는 짧게 재시도하고, `403`, `404` 같은 확정 실패는 즉시 오류로 올린다.
- `src/runners/errorFormatting.js`
  - 컴파일/런타임 오류를 사용자에게 보일 메시지와 VS Code diagnostic으로 바꾼다.

### 저장 파일

문제 폴더 구조는 보통 아래와 같다.

```text
Programmers/
  <lessonId>_<slug>/
    problem.md
    solution.cpp
    Solution.java
    solution.py
    .programmers-helper/
      programmers.json
      custom-tests.json
      review.json
      notes.md
      solution-history.json
      initial/
        initial-solution.cpp
        initial-solution.java
        initial-solution.py
      solutions/
        solution-<timestamp>.cpp
        solution-<timestamp>.java
        solution-<timestamp>.py
      generated/
        runners/
          test_runner.cpp
          TestRunner.java
          test_runner.py
        artifacts/
          cpp-fast
          cpp-debug
          java-classes/
        fingerprints/
          cpp-fast.json
          cpp-debug.json
          java.json
          python.json
```

중요한 source of truth:

- 샘플 테스트 원본: `.programmers-helper/programmers.json`의 `examples`
- 샘플 테스트 fallback: `problem.md`의 입출력 예 테이블
- 커스텀 테스트: `.programmers-helper/custom-tests.json`
- 현재 문제: Webview 내부 `currentProblemDir`
- 마지막 문제: `context.workspaceState.lastProblemDir`
- 문제별 타이머: `<problemDir>/.programmers-helper/timer.json`
- 현재 언어: VS Code 설정 `programmersHelper.language`
- 초기 코드: `.programmers-helper/initial/initial-solution.<ext>`, 없으면 기존 호환용 `.programmers-helper/initial-solution.<ext>`나 `programmers.json.initialCode`

문제 저장소 루트:

- 개발판, 즉 `context.extensionMode === vscode.ExtensionMode.Development`: 열린 workspace 아래 `Programmers/`
- 패키징 설치본: `context.globalStorageUri/Programmers`
- 이 분기는 `src/problems/problemStore.js`의 `getDevelopmentRootUri()`, `getDefaultProgrammersDir()`, `getProgrammersDirCandidates()`가 담당한다.

## Git 동기화 flow

Git 동기화는 기본값이 꺼져 있고, 설정이 켜진 뒤 `Programmers: Setup Sync` 또는 사용자가 직접 구성한 Git 저장소를 통해 동작한다.

### 설정 흐름

1. `extension.js`
   - activation 시 `SyncManager`를 생성하고 status bar, 설정 변경 listener, sync 명령을 등록한다.
   - `programmersHelper.sync.enabled`가 켜져 있으면 setup 상태를 확인하고 `autoPullOnActivate()`를 시도한다.
2. `SyncManager.setupSync()`
   - 기존 GitHub repo URL을 입력하거나, 이미 설정된 로컬 Git repo를 사용하거나, storage folder를 열어 수동 설정하도록 분기한다.
   - HTTPS GitHub remote면 필요할 때 token을 입력받아 VS Code SecretStorage에 저장한다.
   - `initializeRepository()`가 `git init`, branch 설정, origin 설정, `.gitignore`, conflict marker hook을 준비한다.
3. 초기 sync
   - setup 중 sync 설정을 켠 뒤 `syncNow()`를 호출한다.

### Sync Now 흐름

`SyncManager.syncNow()`는 아래 순서로 동작한다.

1. 열려 있는 파일을 `saveAll(false)`로 저장한다.
2. merge/rebase/cherry-pick 진행 중인지 확인한다.
3. local 변경사항을 `git add -A`와 sync commit으로 묶는다.
4. `git fetch origin <branch>`를 실행한다.
5. remote branch가 있으면 `merge origin/<branch> --no-edit`로 통합한다. 공통 조상이 없으면 `--allow-unrelated-histories`를 붙인다.
6. conflict marker가 남아 있는지 repository 전체를 다시 검사한다.
7. `git push -u origin <branch>`를 실행한다.
8. 문제 목록 cache를 강제 갱신한다.

### 충돌 해결 흐름

- `SyncConflictController`는 `SyncManager`가 만든 controller이며, Git 충돌 상태 수집과 conflict resolver Webview를 담당한다.
- 일반 수정 충돌은 충돌 파일을 오른쪽 editor에 열고, 사용자가 VS Code 충돌 UI로 직접 해결한다.
- 삭제/수정 충돌은 문제 폴더 단위로 묶어 보여주고, Webview에서 문제 유지 또는 삭제 유지를 선택한다.
- 모든 충돌 항목이 사라지면 사용자가 Finish Merge를 누른다. 이전 버전에서 rebase 진행 중 상태가 남아 있을 때만 Continue Rebase fallback을 쓴다.
- controller는 `SyncManager.stageResolvedFilesAndGetUnmerged()` wrapper를 통해 해결된 파일을 stage하고, merge는 `commit --no-edit`, rebase fallback은 `rebase --continue` 후 다시 `syncNow()`로 이어간다.

### Git hook과 제외 파일

- `initializeRepository()`와 `getGitContext()`는 `.git/hooks/pre-commit`, `.git/hooks/pre-push`에 conflict marker guard를 보장한다.
- hook은 tracked 파일과 `.gitignore`에 걸리지 않은 untracked 파일에서 `<<<<<<<`, `=======`, `>>>>>>>` marker 조합을 찾으면 commit/push를 중단한다.
- 기존 hook이 있으면 `<hook>.programmers-helper-disabled`로 백업하고 helper hook으로 교체한다. 기존 hook과 자동 chaining하지는 않는다.
- `.programmers-helper/problem-index.json`과 `**/.programmers-helper/generated/`는 `.gitignore`에 들어간다.

## 다중 언어 flow

지원 언어는 `src/problems/languages.js`가 source of truth다. 새 언어를 추가할 때는 최소한 아래 값을 정의한다.

- `programmersParam`: Programmers URL의 `?language=` 값
- `solutionFileName`: 문제 폴더의 현재 풀이 파일명
- `initialSolutionFileName`: `.programmers-helper/initial` 아래 초기 템플릿 파일명
- `runnerFileName`: 생성되는 테스트 러너 파일명
- `snapshotExtension`: 풀이 기록 snapshot 확장자

현재 지원 언어:

- `cpp`: `solution.cpp`, `.programmers-helper/initial/initial-solution.cpp`, `.programmers-helper/generated/runners/test_runner.cpp`
- `java`: `Solution.java`, `.programmers-helper/initial/initial-solution.java`, `.programmers-helper/generated/runners/TestRunner.java`
- `python`: `solution.py`, `.programmers-helper/initial/initial-solution.py`, `.programmers-helper/generated/runners/test_runner.py`

문제를 열 때 `ProblemCommands.openProblemFromDir()`는 `getExecutionSettings().language`를 읽고 `ensureSolutionForLanguage(problemDir, language)`를 먼저 호출한다.

`ensureSolutionForLanguage()`:

1. 현재 언어의 풀이 파일과 초기 템플릿 파일이 있는지 확인한다.
2. 둘 중 하나가 없으면 `?language=<current>` URL로 Programmers 페이지를 다시 가져온다.
3. 문제 설명은 덮어쓰지 않고 현재 언어의 풀이 파일과 초기 템플릿만 없을 때 생성한다.
4. `programmers.json.languages[language]`에 언어별 `url`을 기록한다. 풀이 파일명과 초기 템플릿 경로는 `src/problems/languages.js`에서 계산한다.

기존 C++ 문제는 `programmers.json.languages`가 없어도 계속 동작한다. Java로 전환 후 문제를 열면 Java 템플릿이 추가된다.

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
- `openWebsite`
  - Extension handler: `problemCommands.openWebsite(problemDir)`
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
- `getTimer`
  - Extension handler: `timerManager.getTimer(problemDir)` 결과를 `timerState`로 보낸다.
- `startTimer`
  - Extension handler: 현재 문제 타이머를 시작한다. 다른 문제에서 실행 중인 타이머는 먼저 정산 후 중지한다.
- `pauseTimer`
  - Extension handler: 현재 문제 타이머를 정산 후 중지한다.
- `resetTimer`
  - Extension handler: 현재 문제 타이머를 0으로 초기화한다.
- `setTimerTarget`
  - Extension handler: 현재 문제 목표 시간을 20/30/60/90/120분 중 하나로 저장한다.

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
- `timerState`
  - 현재 문제의 타이머 표시, 목표 시간 select, 시작/중지/초기화 버튼 상태를 갱신한다.

## 타이머 flow

### 사용자 흐름

1. 문제를 연다.
2. 필요하면 목표 시간을 20/30/60/90/120분 중 선택한다.
3. `시작` 버튼을 누른 경우에만 타이머가 실행된다.
4. `중지`를 누르거나 다른 문제를 열거나 VS Code가 종료되면 현재 경과 시간을 정산해 저장하고 멈춘다.
5. `초기화`는 사용자가 직접 누를 때만 수행한다.

### 성능 규칙

- 시간의 source of truth는 `elapsedMs + (Date.now() - startedAt)` 계산이다. `setInterval`은 UI refresh 용도로만 쓴다.
- Webview의 1초 interval은 현재 문제 타이머가 실행 중일 때만 생성하고, 중지되면 즉시 해제한다.
- 타이머 저장은 시작/중지/초기화/목표 변경/문제 전환/확장 종료 같은 이벤트 시점에 수행한다.
- 실행 중에는 VS Code 종료 시 비동기 저장이 끊기는 상황에 대비해 30초마다 `timer.json`에 정산 checkpoint를 남긴다.
- 저장되는 `elapsedMs`는 화면 표시와 맞도록 초 단위로 내림한다. 실행 중 checkpoint는 초 미만 나머지를 `startedAt`에 반영해 checkpoint마다 시간이 누락되지 않게 한다.
- 다음에 문제를 열 때 `isRunning: true`가 남아 있으면 마지막 `updatedAt` 기준으로 멈춘 상태로 복구한다.
- 현재 열린 문제 하나의 타이머만 매초 계산한다.

## 문제 생성 flow

### 사용자 흐름

1. 사이드바에서 문제 번호 입력
2. `생성 및 열기` 클릭 또는 `Enter` 입력
3. Programmers 페이지 fetch
4. 현재 언어 기준으로 `problem.md`, 풀이 파일, `.programmers-helper/programmers.json`, 언어별 초기 템플릿 생성
5. 문제를 열고 현재 실행 모드에 맞는 실행 환경 준비
6. 사이드바 현재 문제 상태 갱신

### 코드 흐름

1. `sidebarHtml.js`
   - `create` 버튼 클릭이나 문제 번호 입력창 `Enter`가 `{ type: "create", lessonId }` 메시지를 보낸다.
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
   - 제목, 본문, 난이도, 분류, 현재 언어 기본 템플릿을 추출한다.
   - `htmlToMarkdown(markdownHtml)`로 `problem.md` 본문을 만든다.
   - `extractExamplesFromMarkdown(problemMd)` 결과를 `programmers.json.examples`에 저장한다.
5. `problemCommands.js` / `problemEditor.js`
   - 생성 결과를 `openProblemFromDir(result.problemDir.fsPath)`로 연다.

### 생성되는 메타데이터

`programmers.json` 주요 필드:

```json
{
  "lessonId": "12906",
  "title": "같은 숫자는 싫어",
  "languages": {
    "cpp": {
      "url": "https://school.programmers.co.kr/learn/courses/30/lessons/12906?language=cpp"
    }
  },
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
- 기존 호환을 위해 오래된 `url`, `initialCode`, `initialCodePath`, `language`, `solutionFile`, `languages.*.initialCode`는 읽을 수 있지만 새로 저장할 때는 제거한다.
- `writeFileIfAbsent()`는 기존 `problem.md`, 풀이 파일, 초기 템플릿을 덮어쓰지 않는다.

## 문제 열기 flow

### 문제 목록에서 열기

1. Webview 문제 행 클릭
2. `{ type: "openProblem", problemDir }`
3. `ProblemCommands.openProblemFromDir(problemDir)`
4. `validateProblemDir(problemDir)`로 안전한 문제 폴더인지 확인한다.
5. `workspaceState.lastProblemDir`을 갱신한다.
6. 현재 언어 풀이 파일을 보장한 뒤 `openProblem(problem.md, solutionFile, options)` 호출
7. 현재 실행 모드에 맞는 실행 환경 준비
8. `showOpenedProblemState(problemDir, runtimeStatus)` 호출

### 에디터 열기 세부 동작

`openProblem(mdUri, solutionUri, options)`:

1. `vscode.workspace.saveAll(false)`
2. `openLockedMarkdownPreview(mdUri, ViewColumn.One)`로 문제 Markdown preview를 왼쪽에 연다.
   - 우선 `vscode.openWith(..., "vscode.markdown.preview.editor")`를 사용한다.
   - 실패하면 `markdown.showPreview`와 `markdown.preview.toggleLock` fallback을 사용한다.
3. `closeInactiveProblemTabs(mdUri, solutionUri)`로 같은 `Programmers` 루트의 비활성 `problem.md` 탭을 정리한다.
4. `showSolution(solutionUri)`로 현재 언어 풀이 파일이나 풀이기록 snapshot을 `ViewColumn.Two`에 연다.
5. `options.preserveRightProblemTabs`가 꺼져 있으면 `closeStaleSolutionTabs(solutionUri)`로 같은 `Programmers` 루트의 오래된 풀이 탭을 정리한다.
6. `keepOnlyProblemLayoutTabs(mdUri, solutionUri, options)`로 현재 문제 레이아웃에 맞지 않는 탭을 정리한다.

주의:

- 현재 구현은 전체 에디터를 닫지 않고 필요한 문제 탭만 선별 정리한다.
- `programmersHelper.tabResetMode`가 `onProblemChange`이면 다른 문제로 전환할 때는 오른쪽 풀이 탭을 정리하고, 같은 문제에서 현재 풀이와 풀이기록을 오갈 때는 오른쪽 탭을 유지한다.
- `programmersHelper.tabResetMode=always`는 현재 `problem.md`와 선택한 풀이 파일만 남기고, `never`는 문제를 바꿔도 오른쪽 풀이/풀이기록 탭을 가능한 한 유지한다.
- 저장된 풀이 스냅샷을 열 때는 오른쪽 풀이 파일이 기본 파일이 아니라 `.programmers-helper/solutions/solution-*.<ext>`일 수 있다.

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
  - VS Code 명령 fallback에서 실행 대상 후보로 사용한다.
- 앱 시작 직후에는 `lastProblemDir`이 있어도 `currentProblemDir`은 비어 있을 수 있다.
  - 이 상태에서 메모와 사이드바 테스트 버튼은 비활성화된다.
  - 사용자가 문제 목록 클릭으로 현재 문제를 명시해야 한다.

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
   - `hasProblemFiles(problemDir)`로 `problem.md`와 지원 언어 중 하나의 풀이 파일 존재 확인
   - `loadProblemSummary(problemDir.fsPath)`
6. lessonId 숫자 순, 그 외 폴더명 순으로 정렬
7. 재생성한 목록을 `.programmers-helper/problem-index.json`에 저장한다.

### 문제 목록 summary가 읽는 파일

- `.programmers-helper/programmers.json`
- `.programmers-helper/review.json`
- `.programmers-helper/solution-history.json`

문제 목록에는 `solutionHistory` 전체가 아니라 `solutionHistoryCount`만 포함한다.
현재 열린 문제의 상세 정보가 필요할 때만 `loadProblemInfo()`가 같은 summary에 현재 언어 `solutionHistory`와 다른 언어 `otherSolutionHistory`를 추가한다.
`problem-index.json`의 `review`와 `solutionHistoryCount`는 목록 렌더링을 위한 캐시다. 원본 상태는 각각 문제 폴더의 `review.json`과 `solution-history.json`이고, 인덱스가 없거나 범위를 벗어나면 전체 스캔으로 다시 만든다.

### 사이드바 목록 UI 상태

- 문제 목록의 필터, 새로고침, 검색 영역은 고정하고 `problemList` row 영역만 스크롤한다.
- 현재 열린 문제 row와 풀이기록에서 선택한 snapshot row는 `현재` 배지와 왼쪽 표시선으로 구분한다.
- 필터 변경 시 `전체`/`다시풀`은 현재 문제 row로, `풀이기록`은 선택된 snapshot row로 스크롤한다. 해당 항목이 없으면 스크롤하지 않는다.
- 다시풀 토글, 삭제, 목록 refresh처럼 사용자가 목록 위치를 유지하길 기대하는 갱신에서는 자동 포커스를 수행하지 않는다.
- 사이드바 Webview state에는 선택된 snapshot key, 선택한 필터, 문제 목록 `scrollTop`을 저장한다. 스크롤 위치는 마지막 scroll 이벤트 이후 500ms 동안 멈추면 저장하고, 사이드바를 다시 열어 목록 렌더가 끝난 뒤 한 번 복원한다.

### 성능 주의점

- 문제 목록 새로고침은 문제 수만큼 metadata 파일을 여러 개 읽는다.
- 일반 새로고침은 사이드바 메모리 캐시를 우선 사용한다.
- 명시적 강제 새로고침은 전체 스캔으로 인덱스를 재생성한다.
- 문제 열기, 리뷰 토글, 삭제, 풀이기록 변경은 단일 문제 인덱스 갱신 결과로 사이드바 메모리 캐시를 교체한다.

## 샘플 테스트 flow

### 사용자 흐름

1. 문제를 명시적으로 연다.
2. 사이드바 `샘플 테스트 실행` 버튼이 활성화된다.
3. 버튼 클릭 또는 VS Code 명령 `programmersHelper.runSamples` 실행
   - 기본 keybinding: `Ctrl+Alt+T`
4. 사이드바 버튼 경로는 현재 문제 경로를 메시지에 포함한다.
5. VS Code 명령 경로는 `ProblemCommands.getProblemDir()`로 실행 대상을 찾는다.
6. 저장된 샘플 예제로 현재 언어 runner를 만든다.
7. 현재 실행 모드에 맞게 언어별로 컴파일하고 테스트별로 실행한다.
   - Docker 모드는 helper runtime container 안에서 실행한다.
   - local 모드는 사용자 환경의 `clang++`/`g++`, `javac`/`java`, `python3`를 사용한다.

### Webview에서 TestRunner까지

1. `sidebarHtml.js`
   - `runSamples` 버튼 클릭
   - `currentProblemDir`이 없으면 return
   - `{ type: "runSamples", problemDir: currentProblemDir }`
2. `extension.js`
   - `runSamples` 핸들러
   - `problemDir`이 없으면 "먼저 문제를 열어주세요."
   - `testRunner.runFromCommand(context, "", problemDir, () => undefined)`
3. VS Code command 경로
   - `programmersHelper.runSamples`
   - `testRunner.runFromCommand(context, "", undefined, () => problemCommands.getProblemDir())`
4. `testRunner.js`
   - `runFromCommand(...)`
   - `normalizeRunTarget(providedProblemDir)`
   - `runSamples(target.problemDir, "", target.solutionPath, target.language)`
   - `TestRunnerRuntime`으로 실행 환경을 준비한다.
   - `TestRunnerCompiler`로 runner를 컴파일하거나 cache를 재사용한다.
   - `TestRunnerExecutor`로 각 테스트 케이스를 실행한다.

### 실행 대상 풀이 파일 결정

`ProblemCommands.getActiveCodeTarget(problemDir)`:

1. 활성 에디터가 실행 가능한 지원 언어 풀이 파일이면 그 파일을 우선한다.
2. 아니면 현재 문제에서 보이는 현재 언어 풀이 파일을 찾는다.
3. 둘 다 없으면 현재 설정 언어의 기본 풀이 파일을 보장하고 사용한다.

실행 가능한 풀이 파일은 아래 형태만 허용한다.

- `Programmers/<problem>/solution.cpp`
- `Programmers/<problem>/Solution.java`
- `Programmers/<problem>/solution.py`
- `Programmers/<problem>/.programmers-helper/solutions/solution-<timestamp>.cpp`
- `Programmers/<problem>/.programmers-helper/solutions/solution-<timestamp>.java`
- `Programmers/<problem>/.programmers-helper/solutions/solution-<timestamp>.py`

주의:

- `.programmers-helper/generated/runners/*`와 `.programmers-helper/generated/artifacts/*`는 내부 생성 파일이라 실행 대상으로 사용하지 않는다.
- 현재 문제 밖의 풀이 파일은 활성 에디터나 보이는 에디터에 있어도 무시한다.

### 테스트 데이터 결정

`TestRunner.runSamples(problemDir, customTestsText, selectedCppPath)`:

1. 현재 언어 기본 풀이 파일 또는 선택된 풀이 파일을 읽는다.
2. 샘플 테스트면 `loadProblemExamples(problemDir)`를 호출한다.
3. `loadProblemExamples()`:
   - `programmers.json.examples`가 있으면 즉시 반환
   - 없거나 비어 있으면 `problem.md`에서 `extractExamplesFromMarkdown(markdown)` fallback 파싱
   - fallback 결과가 있으면 `programmers.json.examples`로 저장
   - 실패하면 빈 배열 반환
4. 예제가 비어 있으면 테스트를 중단한다.
5. 언어별 runner builder의 `parseSolutionSignature()`로 `solution(...)` 시그니처를 찾는다.

### runner 생성

1. `.programmers-helper` 폴더를 만든다.
2. 현재 언어의 runner 파일을 쓴다.
3. C++ `buildRunner(signature, examples, includePath)`가 생성하는 코드는:
   - `solution.cpp` 또는 현재 C++ 파일을 `#include`한다.
   - 각 예제별 블록을 만든다.
   - `argv[1]`의 테스트 번호와 일치하는 블록만 실행한다.
   - 결과는 `cerr`에 `[PASS]`, `[FAIL]` 형태로 출력한다.
4. Java `buildRunner(signature, examples)`가 생성하는 코드는:
   - `new Solution().solution(...)`을 호출한다.
   - 각 예제별 블록을 만든다.
   - `args[0]`의 테스트 번호와 일치하는 블록만 실행한다.
   - 결과는 `System.err`에 `[PASS]`, `[FAIL]` 형태로 출력한다.
5. Python `buildRunner(signature, examples, solutionPath)`가 생성하는 코드는:
   - `importlib.util.spec_from_file_location()`으로 `solution.py` 또는 선택된 Python snapshot을 로드한다.
   - `mod.solution(...)`을 호출한다.
   - 각 예제를 `TESTS`에 Python literal로 넣고, `sys.argv[1]`의 테스트 번호와 일치하는 케이스만 실행한다.
   - 결과는 `sys.stderr`에 `[PASS]`, `[FAIL]` 형태로 출력한다.

### 실행 환경 준비

문제를 열 때 `ProblemCommands.prepareDockerRuntimeOnOpen(problemDir)`가 실행 모드를 확인한다.

- `programmersHelper.executionMode=docker`
  - `dockerRuntime.prepareDockerRuntimeOnOpen(...)`으로 Docker CLI, image, container를 확인한다.
- `programmersHelper.executionMode=local`
  - 현재 언어의 실행 명령어를 `--version` 또는 `-version`으로 확인한다.
  - C++: 설정된 `clang++` 또는 `g++`
  - Java: `javac`, `java`
  - Python: `python3`
  - 명령어가 없거나 non-zero exit이면 `준비 실패` 상태를 사이드바에 표시한다.

테스트 실행 직전에도 `TestRunner.ensureRuntimeReady(...)`가 같은 실행 모드 기준으로 한 번 더 확인한다.

### Docker 준비

`ensureDockerRuntimeReady(problemDir)`:

1. `programmersDir = path.dirname(problemDir)`
2. 컨테이너 이름: `programmers-helper-runtime-v3-<hash(programmersDir)>`
3. 컨테이너 문제 경로: `/workspace/Programmers/<problemFolder>`
4. Docker CLI 확인: `docker version --format {{.Server.Version}}`
5. 이미지 확인: `docker image inspect kangjung/programmers-helper-runtime:3`
6. 이미지가 없으면 `docker pull kangjung/programmers-helper-runtime:3`
7. pull이 실패하면 Dockerfile로 `programmers-helper-runtime:3`을 build한 뒤 `kangjung/programmers-helper-runtime:3`으로 tag
8. 컨테이너 확인: `docker inspect --format {{.State.Running}} <containerName>`
9. 컨테이너가 없으면 create 후 start
10. 컨테이너가 멈춰 있으면 start

컨테이너 생성 명령의 핵심:

```text
  docker create
  --name programmers-helper-runtime-v3-<hash>
  --workdir /workspace/Programmers
  -v <Programmers host dir>:/workspace/Programmers
  --entrypoint tail
  kangjung/programmers-helper-runtime:3
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
  .programmers-helper/generated/runners/test_runner.cpp
  -o .programmers-helper/generated/artifacts/cpp-fast
```

Java 실행용:

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  javac -encoding UTF-8
  -d .programmers-helper/generated/artifacts/java-classes
  Solution.java
  .programmers-helper/generated/runners/TestRunner.java
```

Python은 별도 컴파일 단계가 없다. `compileRunner()`에서는 생성된 `.programmers-helper/generated/runners/test_runner.py`를 그대로 실행 대상으로 보고 컴파일을 생략한다.

그 뒤:

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  chmod +x .programmers-helper/generated/artifacts/cpp-fast
```

### 실행

각 테스트케이스는 별도 `docker exec`로 하나씩 실행한다.

```text
docker exec -i
  -w /workspace/Programmers/<problemFolder>
  <containerName>
  timeout --signal=TERM --kill-after=1s 3s
  .programmers-helper/generated/artifacts/cpp-fast
  <testIndex>
```

Java는 같은 timeout wrapper 안에서 아래 형태로 실행한다.

```text
java -cp .programmers-helper/generated/artifacts/java-classes TestRunner <testIndex>
```

Python:

```text
python3 .programmers-helper/generated/runners/test_runner.py <testIndex>
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
- 같은 풀이 파일, 같은 예제, 같은 include path, 같은 언어/compile flags라면 fingerprint 기반 compile skip을 고려할 수 있다.
- 현재는 테스트 결과 output 문자열을 누적한 뒤 PASS/FAIL/TIMEOUT을 센다.
  - 많은 테스트나 큰 출력에서는 count만 따로 누적하고 전체 문자열 보관을 줄일 수 있다.
- Docker runtime 준비는 매번 Docker CLI와 image/container 상태를 확인한다.
  - 세션 캐시와 실패 시 invalidation을 고려할 수 있다.

## 커스텀 테스트 flow

### Webview 입력

커스텀 테스트 카드는 아래 값을 가진다.

- `.test-input`: `solution(...)` 인자 순서대로 쉼표로 구분한 문자열
- `.test-expected`: 기대 결과를 현재 언어 리터럴 형태로 쓴 문자열

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

1. Webview `runCustom` 버튼 클릭 또는 VS Code 명령 `programmersHelper.runCustomTests`
2. Webview 경로는 `currentProblemDir`이 없으면 return
3. `{ type: "runCustom", problemDir, tests }` 메시지
4. `extension.js`
   - `problemCommands.runCustomTestsFromMessage(tests, problemDir)`
   - VS Code 명령 경로는 Webview에 `{ type: "runCustomRequest" }`를 보내 현재 입력된 테스트를 실행하게 한다.
   - Webview가 없으면 사이드바에서 실행하라는 안내를 표시한다.
5. `problemCommands.js`
   - `ProblemTestActions.runCustomTestsFromMessage(...)`로 위임한다.
   - action 안에서 `validateProblemDir(problemDir)`, `saveCustomTests(problemDir, tests)`, `runTests(JSON.stringify(tests || []), target)`를 수행한다.
6. `extension.js`에서 주입한 `runTests`
   - `testRunner.runFromCommand(context, customTestsText, providedProblemDir, ...)`
7. `testRunner.js`
   - `parseCustomTests(customTestsText)`로 내부 examples 형태로 변환
   - 이후 샘플 테스트와 동일하게 runtime 준비, runner 생성, 컴파일, 실행

### 저장 흐름

1. Webview `saveCustomTests` 버튼 클릭
2. `{ type: "saveCustomTests", problemDir, tests }` 메시지
3. `problemCommands.saveCustomTestsFromMessage(tests, problemDir)`
4. `.programmers-helper/custom-tests.json` 저장
5. Webview에 `{ type: "customTestsSaved", tests }`를 보내 저장됨 상태를 갱신한다.

### 저장 위치

`.programmers-helper/custom-tests.json`

### 주의점

- 커스텀 테스트는 저장 버튼을 누르거나 실행 직전에 저장된다.
- Webview state에는 마지막 저장본만 보관하고, 저장 전 textarea 입력값은 토글 복원용으로 저장하지 않는다.
- 커스텀 테스트는 `programmers.json.examples`를 사용하지 않는다.
- `parseCustomTests()`는 문자열 입력을 현재 runner builder가 리터럴로 변환 가능한 형태라고 가정한다.

## 테스트 중지 flow

1. Webview `stopTests` 메시지 또는 VS Code 명령 `programmersHelper.stopTests`
   - 기본 keybinding: `Ctrl+Alt+S`
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

1. `compileRunner()`의 언어별 컴파일 명령이 non-zero로 종료한다.
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
   - VS Code 명령 `programmersHelper.openNotes`도 같은 동작을 제공해 사용자가 키를 지정할 수 있다.
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

## 웹사이트 열기 flow

1. 사이드바 `웹` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. Webview가 `{ type: "openWebsite", problemDir }` 메시지를 보낸다.
3. `ProblemCommands.openWebsite(problemDir)`이 문제 폴더를 검증한다.
4. `loadProblemInfo(problemDir, currentLanguage)`에서 현재 언어 URL을 읽는다.
5. `programmers.json.languages[currentLanguage].url`이 있으면 우선 사용하고, 없으면 기존 `programmers.json.url`이나 `lessonId` 기반 계산 URL을 사용한다.
6. `getActiveCodeTarget(problemDir)`로 실행 대상과 같은 기준의 풀이 파일을 찾는다.
7. 활성/보이는 snapshot이 있으면 그 파일을 우선하고, 없으면 현재 설정 언어의 기본 풀이 파일을 사용한다.
8. 파일 저장 후 코드를 읽어 `vscode.env.clipboard.writeText()`로 클립보드에 복사한다.
9. `vscode.env.openExternal()`로 브라우저에서 Programmers 원문 페이지를 연다.

## 새풀이 flow

1. 사이드바 `새풀이` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. Webview `startReviewAttempt` 메시지
3. `ProblemCommands.startReviewAttempt(problemDir)`
4. `validateProblemDir(problemDir)`
5. `vscode.workspace.saveAll(false)`
6. `createSolutionAttempt(safeDir)`
7. `.programmers-helper/review.json`에 `{ "review": true }` 저장
8. 문제 다시 열기
9. 현재 실행 모드에 맞는 실행 환경 준비
10. 사이드바 현재 문제 상태 갱신

### `createSolutionAttempt()` 세부 동작

1. 현재 언어 풀이 파일을 읽는다.
2. `.programmers-helper/solutions/solution-<timestamp>.<ext>`로 저장한다.
3. `.programmers-helper/solution-history.json` 맨 앞에 새 attempt 기록을 추가한다.
4. 초기 코드가 있으면 현재 언어 풀이 파일을 초기 코드로 되돌린다.

## 초기화 flow

1. 사이드바 `초기화` 버튼은 `currentProblemDir`이 있을 때만 활성화된다.
2. `ProblemCommands.resetCurrentSolution(problemDir)`
3. `getActiveCodeTarget(problemDir)`
   - 활성 에디터가 해당 문제의 지원 언어 풀이 파일이면 그 파일을 대상으로 한다.
   - 아니면 현재 문제의 현재 언어 풀이 파일을 대상으로 한다.
4. 사용자 확인 모달
5. `vscode.workspace.saveAll(false)`
6. `resetSolutionToInitial(target.problemDir, target.solutionPath, target.language)`
7. 대상 풀이 파일을 초기 코드로 덮어쓴다.
8. 문제를 다시 열고 사이드바 상태를 갱신한다.

주의:

- 초기화는 풀이 기록을 만들지 않는다.
- 보관하려면 먼저 새풀이를 사용해야 한다.

## 풀이 기록 flow

### 기록 목록

1. 문제 목록 refresh 때 `loadProblemInfo()`가 `solution-history.json`을 읽는다.
2. Webview `풀이기록` 필터는 현재 문제의 현재 언어 `solutionHistory`를 먼저 렌더링한다.
3. 다른 언어 기록은 `otherSolutionHistory`로 받아 `다른 언어 풀이` 접힘 섹션에 렌더링한다.
4. 기록은 `createdAt` 역순으로 정렬된다.
5. 스냅샷 경로가 안전한 풀이 기록만 목록에 포함한다.

스냅샷 경로 검증:

- 상대 경로여야 한다.
- `.programmers-helper/solutions/` 아래여야 한다.
- 파일명은 `solution-*.<supported ext>` 형태여야 한다.
- `path.resolve()` 결과가 문제 폴더의 `.programmers-helper/solutions` 밖으로 나가면 무시한다.

### 이전 풀이 열기

1. Webview `openSolutionSnapshot`
2. `ProblemCommands.openSolutionSnapshot(problemDir, snapshotPath)`
3. `getSolutionSnapshotPath(safeDir, snapshotPath)`
4. 왼쪽 `problem.md`는 유지하고, 오른쪽 editor group에 snapshot 풀이 파일을 열거나 이미 있으면 해당 탭으로 포커스한다.

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

- 이미지 이름: `kangjung/programmers-helper-runtime:3`
- 로컬 build fallback 이미지 이름: `programmers-helper-runtime:3`
- Dockerfile: `docker/cpp-runtime.Dockerfile`
- 없으면 `docker pull kangjung/programmers-helper-runtime:3`
- pull이 실패하면 `docker build -t programmers-helper-runtime:3 -f <Dockerfile> <extensionDir>` 후 `docker tag programmers-helper-runtime:3 kangjung/programmers-helper-runtime:3`

### 컨테이너

- 컨테이너 이름 prefix: `programmers-helper-runtime-v3-`
- hash 입력: `path.resolve(programmersDir)`
- 같은 Programmers root는 같은 runtime container를 재사용한다.

### 마운트

- host source: `programmersDir`
- container target: `/workspace/Programmers`

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

### Local runtime flow

문제를 열 때 local 실행 모드이면 `ProblemCommands.prepareLocalRuntimeOnOpen(settings, problemDir)`가 현재 언어의 명령어를 확인한다.

- C++: `settings.compilerCommand --version`
- Java: `javac -version`, `java -version`
- Python: `python3 --version`

확인 결과:

- exit code `0`: 준비 완료
- non-zero exit: 준비 실패
- `ENOENT`: 명령어 없음으로 준비 실패
- timeout 또는 child process error: 준비 실패

준비 실패여도 문제 파일은 열리며, 사이드바 상태에 실패 이유를 표시한다. 테스트 실행 시에도 같은 local 명령어 확인이 다시 수행되어 PATH 변경이나 설치 이후 상태를 반영한다.

## Development Host flow

- 기본 개발 방식은 로컬 VS Code의 `Run Extension`이다.
- `.vscode/launch.json`은 `--extensionDevelopmentPath=${workspaceFolder}`와 `${workspaceFolder}`를 함께 넘겨 개발용 Extension Host가 현재 저장소를 workspace로 열도록 한다.
- 개발 모드에서는 문제 폴더를 현재 workspace 아래 `Programmers/`에 저장한다.
- 패키징 설치본은 문제 폴더를 `globalStorage/Programmers`에 저장한다.
- `programmersHelper.executionMode=docker`이면 로컬 Docker daemon에 붙는 실행 컨테이너를 준비한다.
- `programmersHelper.executionMode=local`이면 로컬 머신의 `clang++`/`g++`, `javac`/`java` 또는 `python3`로 실행한다.

## 성능 점검 메모

### 전체 구조 기준

- 기본 activation은 가볍게 유지한다.
  - `activate(context)`에서는 Output 채널, Diagnostic collection, Webview provider, 명령, 설정 listener, 확장 변경 listener만 등록한다.
  - `ProblemCommands`, `TestRunner`, `TimerManager`는 `ensureServices(context)`에서 실제 명령이나 Webview 액션이 들어올 때 lazy-load한다.
  - Docker 확인, 문제 폴더 전체 스캔, runner 생성, 컴파일은 activation 시점에 하지 않는다.
- 대기 상태의 상시 작업은 최소화한다.
  - 설정 변경 listener 외에는 workspace watcher나 반복 스캔을 두지 않는다.
  - Webview 타이머 interval과 `TimerManager` checkpoint interval은 타이머 실행 중일 때만 켠다.
- 무거운 작업은 사용자 액션 시점에만 수행한다.
  - 문제 생성은 Programmers HTML fetch와 파일 생성 때문에 네트워크/I/O 비용이 있다.
  - 테스트 실행은 Docker, 컴파일, 프로세스 실행, diagnostic 파싱이 포함되므로 확장 내에서 가장 무거운 흐름이다.
  - 문제 목록 강제 새로고침은 문제 수만큼 metadata를 읽을 수 있으므로 캐시와 인덱스를 우선한다.

### 사이드바와 Webview

- 사이드바 문제 목록은 메모리의 problem summary cache를 우선 사용하고, 명시적 강제 새로고침 때만 전체 스캔한다.
- 문제 검색 입력은 짧은 debounce 뒤에 렌더링해 연속 입력 중 불필요한 DOM 재생성을 줄인다.
- 문제 목록과 풀이기록 목록 클릭은 event delegation으로 처리해 렌더 때마다 행별 이벤트 리스너를 다시 붙이지 않는다.
- 문제 목록과 풀이기록 목록 row는 key 기반 cache로 재사용하고, 텍스트와 checkbox 상태만 갱신한다.
- Webview `vscode.setState()`는 사이드바 UI 복원용이다.
  - 현재 문제, 필터, 접힘 상태, 타이머 표시 상태, 알림 기록, 저장된 커스텀 테스트 값을 보관한다.
  - 문제 번호 입력값, 문제 검색어, 저장 전 커스텀 테스트 textarea 입력값은 보관하지 않는다.
  - 상태 메시지는 Webview state가 아니라 extension host의 `latestStatusMessage`에 최신 1개만 보관하고, Webview가 `webviewReady`를 보내면 다시 전송한다.
  - 실제 타이머 기록의 source of truth는 `.programmers-helper/timer.json`이다.
- 사이드바가 열릴 때 문제 목록 로드는 Webview 초기화 이후 `refreshProblems` 메시지 하나로 요청한다.
- 특정 문제에서 발생한 상태 메시지는 `problemDir`을 함께 보내고, extension host가 `path.basename(problemDir)`으로 문제 폴더명을 붙인다. 파일을 다시 읽지는 않는다.

### 타이머

- 시간의 source of truth는 `elapsedMs + (Date.now() - startedAt)` 계산이다.
- Webview의 1초 interval은 화면 refresh 용도이며, 현재 문제 타이머가 실행 중일 때만 생성하고 중지되면 즉시 해제한다.
- 타이머 알림은 1초 UI refresh 중 남은 시간 구간을 숫자 비교로 확인한다.
  - 3분/2분/1분/타임오버 mark는 `Set`으로 한 번만 보낸다.
  - 알림 기록은 현재 문제와 목표 시간 key를 기준으로 유지하고, 목표 시간 변경/초기화/문제 전환 때 초기화한다.
- 타이머 저장은 시작/중지/초기화/목표 변경/문제 전환/확장 종료 같은 이벤트 시점에 수행한다.
- 실행 중에는 VS Code 종료 시 비동기 저장이 끊기는 상황에 대비해 30초마다 `timer.json`에 정산 checkpoint를 남긴다.
- 다음에 문제를 열 때 `isRunning: true`가 남아 있으면 마지막 `updatedAt` 기준으로 멈춘 상태로 복구한다.
- 현재 열린 문제 하나의 타이머만 매초 계산한다.

### 테스트 실행과 Docker

- 샘플 테스트는 `programmers.json.examples`를 우선 사용한다.
- `problem.md` fallback 파싱은 저장된 예제가 없을 때만 실행한다.
- fallback 파싱 성공 시 `programmers.json`에 `examples`를 저장한다.
- 사이드바 테스트 버튼은 현재 문제가 없으면 비활성화되어, `lastProblemDir`로 몰래 테스트가 실행되지 않는다.
- Docker 사용 가능 여부와 runtime image 존재 여부는 확장 세션 동안 캐시한다.
- 풀이 파일 내용, 생성된 runner 내용, 언어, 컴파일 플래그 fingerprint가 같으면 기존 실행 산출물을 재사용한다.
- 테스트 결과 요약은 전체 output 문자열을 누적하지 않고 케이스별 PASS/FAIL/TIMEOUT count로 집계한다.
- Docker 컨테이너 정리는 사용자 데이터 보존 작업이 아니므로 extension deactivate에서 백그라운드 정리에 맡긴다.
- 실행 중지 버튼은 컨테이너 stop이 아니라 현재 `docker exec` 또는 로컬 child process 종료다.
- Docker 준비 메시지가 테스트 상태를 덮은 뒤에는 실제 컴파일/실행 단계로 넘어가며 다시 `샘플/커스텀 테스트 실행 중...` 상태를 전송한다.

### 문제 저장소와 인덱스

- 문제 목록 인덱스가 현재 `Programmers` 루트 밖의 항목을 포함하면 폐기하고 전체 스캔으로 재생성한다.
- 문제 열기, 리뷰 토글, 삭제, 풀이기록 변경은 단일 문제 인덱스 갱신 결과로 사이드바 메모리 캐시를 교체한다.
- `problem-index.json`은 목록 렌더링용 캐시이고, 원본 상태는 각 문제 폴더의 `.programmers-helper` 파일들이다.

### 메모리와 상시 리소스

- 상시 메모리 상태는 서비스 singleton, 사이드바 provider, 문제 목록 cache, row cache, 현재 타이머 객체, 알림 `Set`, interval id 정도로 제한한다.
- row cache는 렌더 결과에서 빠진 key를 prune해 검색/삭제 후 DOM 참조가 계속 남지 않게 한다.
- OutputChannel 로그는 장시간 테스트를 많이 돌리는 경우 누적될 수 있지만, 현재는 테스트 실행 흐름의 보조 로그로 둔다.

### 다음 최적화 후보

1. Timer checkpoint read 생략
   - 위치: `src/timers/timerManager.js`
   - 현재: 30초마다 `timer.json`을 읽고 정산 후 다시 쓴다.
   - 방향: 실행 중 타이머 상태를 메모리에 유지해 checkpoint에서 read를 생략할 수 있다. 다만 현재 비용은 작다.
2. Webview 가상 스크롤
   - 위치: `src/ui/sidebarClientListScript.js`
   - 현재: row DOM은 재사용하지만 보이는 목록 전체를 순회하고 배치한다.
   - 방향: 문제 수가 수천 개 이상으로 커져 검색/스크롤 끊김이 확인되면 화면 근처 row만 렌더링한다.
3. 문제 인덱스 rebuild 병렬 제한
   - 위치: `src/problems/problemStore.js`
   - 현재: 전체 스캔 시 여러 문제 metadata를 병렬로 읽는다.
   - 방향: 문제 수가 매우 많아져 순간 I/O가 부담되면 concurrency limit을 둔다.
4. OutputChannel 로그 관리
   - 위치: `src/runners/testRunner.js`
   - 현재: 테스트 실행 로그를 OutputChannel에 누적한다.
   - 방향: 장시간 사용에서 로그량이 문제가 되면 요약 중심 출력이나 clear 정책을 검토한다.

## 작업 시 체크리스트

- 샘플 테스트 관련 수정 시:
  - `programmers.json.examples` 우선 사용을 유지한다.
  - 기존 문제 fallback으로 `problem.md` 파싱이 계속 되는지 확인한다.
  - 커스텀 테스트 경로와 샘플 테스트 경로를 혼동하지 않는다.

- 현재 문제 관련 수정 시:
  - Webview `currentProblemDir`과 `workspaceState.lastProblemDir`의 역할을 섞지 않는다.
  - 메모/초기화/새풀이/사이드바 테스트는 현재 문제가 있을 때만 동작해야 한다.
  - 앱 시작 직후에는 문제 목록 클릭 전까지 `lastProblemDir`이 있어도 Webview 현재 문제로 취급하지 않는다.

- Docker 관련 수정 시:
  - 로컬 Docker bind mount source가 `programmersDir`로 유지되는지 확인한다.
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
