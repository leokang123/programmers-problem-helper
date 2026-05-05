# Programmers Problem Helper

프로그래머스 코딩테스트 문제를 VS Code에서 더 편하게 풀기 위한 확장입니다.

이 확장은 OpenAI Codex를 사용해서 만들었습니다.

문제 번호를 입력하면 프로그래머스 문제 페이지를 가져와서 `problem.md`와 현재 설정 언어의 풀이 파일을 만들고, 왼쪽에는 문제 미리보기, 오른쪽에는 풀이 파일을 열어줍니다. 샘플 테스트와 직접 추가한 커스텀 테스트도 실행할 수 있습니다.

## 주요 기능

- 왼쪽 Activity Bar에 `Programmers` 사이드바 추가
- `Programmers/<문제번호>_<문제이름>/problem.md` 생성
- `Programmers/<문제번호>_<문제이름>/solution.cpp`, `Solution.java` 또는 `solution.py` 생성
- 예제 정보를 담은 `.programmers-helper/programmers.json` 생성
- 왼쪽에는 `problem.md` Markdown Preview 열기
- 오른쪽에는 현재 언어 풀이 파일 에디터 열기
- 문제의 입출력 예를 기반으로 샘플 테스트 실행
- `+ 테스트 추가`로 Input / Expected Output을 직접 넣고 저장하거나 커스텀 테스트 실행
- 기본 단축키로 샘플 테스트 실행(`Ctrl+Alt+T`)과 실행 중지(`Ctrl+Alt+S`) 지원
- 샘플 테스트 실행, 실행 중지, 커스텀 테스트 실행, 메모 열기는 VS Code 키보드 설정에서 원하는 키로 지정 가능
- PASS/FAIL 모두 expected / actual 출력
- 문제 목록에서 `새풀이`를 눌러 현재 언어 풀이 파일을 이전 풀이로 보관
- `풀이기록` 필터에서 이전 풀이를 시간순으로 열거나 삭제
- 문제 목록에서 문제 번호, 난이도, 이전 풀이 수, 다시풀 상태를 작게 확인
- 다시풀 checkbox 변경과 문제 삭제 후에도 문제 목록 스크롤 위치 유지
- `programmersHelper.tabResetMode` 설정으로 풀이/풀이기록 탭 reset 방식을 선택
- 처음 받아온 풀이 원본을 `.programmers-helper/initial/initial-solution.<ext>`로 보관
- 현재 풀이 파일 코드를 클립보드에 복사하고 프로그래머스 웹 페이지 열기
- 문제별 풀이 타이머와 20/30/60/90/120분 목표 시간 표시
- GitHub 또는 직접 설정한 Git 원격 저장소로 문제 목록과 풀이 상태 동기화

## 지원 언어

`programmersHelper.language` 설정에서 기본 언어를 선택할 수 있습니다.

- C++: `solution.cpp`, `.programmers-helper/initial/initial-solution.cpp`, `clang++` 또는 `g++`
- Java: `Solution.java`, `.programmers-helper/initial/initial-solution.java`, `javac` / `java`
- Python: `solution.py`, `.programmers-helper/initial/initial-solution.py`, `python3`

기존 문제를 다른 언어로 열면 해당 언어의 풀이 템플릿이 없을 때만 프로그래머스 페이지를 다시 가져와 언어별 초기 파일을 추가합니다. 문제 설명 `problem.md`는 덮어쓰지 않습니다.

테스트 실행은 현재 활성 풀이 파일을 우선합니다. 예를 들어 Java가 기본 언어여도 C++ 풀이 기록을 열어둔 상태에서 실행하면 C++ runner로 실행됩니다.

풀이기록은 현재 언어 기록을 먼저 보여주고, 다른 언어 기록은 접힌 섹션에서 확인할 수 있습니다.

`programmersHelper.tabResetMode` 설정으로 문제와 풀이기록을 열 때 오른쪽 에디터 탭을 정리하는 방식을 고를 수 있습니다.

- `always`: 문제나 풀이기록을 열 때마다 현재 `problem.md`와 선택한 풀이 파일만 남깁니다.
- `onProblemChange`: 다른 문제로 전환할 때만 탭을 정리하고, 같은 문제의 현재 풀이와 풀이기록은 오른쪽 탭에 유지합니다.
- `never`: 문제를 바꿔도 오른쪽의 풀이/풀이기록 탭을 가능한 한 유지합니다.

## 필요 조건

- VS Code 1.85.0 이상
- Docker 실행 모드: Docker Desktop 또는 docker 엔진
- 로컬 실행 모드: 선택한 언어의 실행 명령

Docker 실행 모드에서는 테스트 실행 시 확장이 Docker 실행 컨테이너를 자동으로 준비하고, 그 안에서 현재 언어에 맞게 컴파일 또는 실행합니다.

```sh
docker version
```

로컬 실행 모드에서는 문제를 열 때 현재 언어의 명령어가 PATH에 있는지 확인합니다.

- C++: `clang++` 또는 `g++`
- Java: `javac`, `java`
- Python: `python3`

### Windows 실행 안내

Windows에서는 Docker 실행 모드를 권장합니다. Docker 모드는 확장이 준비한 Linux 컨테이너 안에서 컴파일하므로 Windows C++ toolchain 차이를 덜 탑니다.

로컬 실행 모드를 사용하려면 MinGW `g++` 또는 LLVM `clang++`처럼 `-std=c++17`, `-Wall`, `-O2` 형식의 옵션을 지원하는 컴파일러가 PATH에 있어야 합니다. Visual Studio의 `cl.exe`만 설치된 환경은 현재 로컬 실행 모드에서 지원하지 않습니다.

## 보안 안내

샘플/커스텀 테스트 실행은 현재 언어 풀이 파일을 컴파일 또는 실행합니다. Docker 실행 모드에서는 helper 컨테이너 안에서 실행되고, 로컬 실행 모드에서는 사용자 머신에서 직접 실행됩니다. 신뢰할 수 없는 코드는 실행하지 마세요.

## 개인정보 안내

이 확장은 사용자의 풀이 코드, 테스트 입력, 문제 기록을 별도 서버로 전송하지 않습니다. 문제 생성과 언어별 템플릿 갱신을 위해 사용자의 환경에서 프로그래머스 문제 페이지를 가져오며, 테스트 실행은 로컬 환경 또는 로컬 Docker 컨테이너에서 수행됩니다.

`웹` 버튼은 현재 풀이 파일 코드를 로컬 클립보드에 복사한 뒤 프로그래머스 문제 페이지를 엽니다. 사이트에 코드를 자동 제출하거나 입력하지 않습니다.

## Git 동기화

Git 동기화는 기본값이 꺼져 있습니다. Windows와 macOS처럼 여러 환경에서 같은 문제 폴더와 풀이 상태를 쓰고 싶을 때 설정에서 `programmersHelper.sync.enabled`를 켠 뒤 `Programmers: Setup Sync`를 실행합니다.

Setup Sync에서는 원격 저장소 URL과 브랜치를 입력합니다. HTTPS GitHub remote를 쓰는 경우 토큰을 입력할 수 있고, 입력한 토큰은 VS Code SecretStorage에 저장됩니다. SSH remote나 시스템 Git credential을 쓰는 경우 토큰을 비워둘 수 있습니다. 저장된 토큰은 `Programmers: Clear Stored GitHub Token` 명령으로 삭제할 수 있습니다.

`Programmers: Sync Now`는 현재 열려 있는 파일을 저장한 뒤 Git 저장소에서 다음 순서로 동작합니다.

```text
save all -> git add/commit -> fetch -> merge -> conflict marker 검사 -> push
```

충돌이 나면 conflict resolver Webview가 열립니다. 일반 수정 충돌은 파일을 열어 VS Code의 충돌 선택 UI로 해결하고, 삭제/수정 충돌은 문제 폴더를 유지할지 삭제를 유지할지 선택합니다. 모든 항목을 해결한 뒤 Webview에서 Finish Merge를 누르면 남은 Git 작업을 이어가고 다시 push합니다. 이전 버전에서 rebase 진행 중 상태가 남아 있는 경우에만 Continue Rebase fallback을 보여줄 수 있습니다.

확장이 종료될 때 자동 push는 하지 않습니다. 대신 설정에 따라 활성화 시 원격 변경사항을 pull-only 방식으로 가져오고, 상태 확인 interval은 동기화가 필요한지만 표시합니다. 실제 commit/fetch/merge/push는 `Sync Now`가 담당합니다.

동기화 저장소에는 풀이 파일, 문제 설명, 메모, 타이머, 커스텀 테스트, 풀이 기록 같은 사용자 상태가 들어갑니다. 테스트 실행 중 생성되는 파일은 `.gitignore` 대상입니다.

```gitignore
.programmers-helper/problem-index.json
**/.programmers-helper/generated/
```

이미 Git에 tracked 된 generated 파일은 `.gitignore`만 추가해도 자동으로 빠지지 않습니다. 그런 경우 storage folder에서 한 번만 index에서 제거해야 합니다.

## 면책 안내

이 확장은 있는 그대로 제공되며 어떠한 보증도 제공하지 않습니다. 사용자 코드는 로컬 환경 또는 로컬 Docker 컨테이너에서 실행되며, 실행 결과, 프로그래머스 페이지 접근 가능 여부, 사용자 코드 실행으로 인한 영향에 대해 보장하지 않습니다. 사용자는 본인의 책임 하에 확장을 사용해야 합니다.

## 설치하기

### 방법 1: VS Code Marketplace에서 설치

VS Code의 Extensions 화면에서 `Programmers Problem Helper`를 검색해 설치합니다.

명령 팔레트 또는 터미널에서는 다음 명령으로 설치할 수 있습니다.

```sh
code --install-extension leokang123.programmers-problem-helper
```

Marketplace 설치본은 VS Code의 확장 업데이트 설정에 따라 자동으로 업데이트됩니다.

### 방법 2: GitHub Releases에서 VSIX 다운로드

GitHub 저장소의 `Releases` 페이지에서 최신 `.vsix` 파일을 다운로드합니다.

다운로드한 뒤 VS Code에서 설치합니다.

```sh
code --install-extension <다운로드한-vsix-파일>
```

그 다음 VS Code를 다시 불러옵니다.

1. VS Code 실행
2. `Developer: Reload Window` 실행
3. 왼쪽 Activity Bar에서 `Programmers` 아이콘 열기

### 방법 3: 저장소를 clone해서 개발 실행

이 저장소를 clone합니다.

```sh
git clone https://github.com/leokang123/programmers-problem-helper.git
cd programmers-problem-helper
npm install
```

VS Code에서 clone한 폴더를 열고 `Run and Debug`의 `Run Extension`을 실행합니다.

1. VS Code 실행
2. 이 저장소 폴더 열기
3. `Run and Debug`에서 `Run Extension` 실행
4. 새 `[Extension Development Host]` 창에서 `Programmers` 아이콘 열기

## 업데이트

Marketplace 설치본은 VS Code가 일반 확장처럼 업데이트합니다.

GitHub Releases에서 설치한 경우 최신 `.vsix`를 다시 내려받아 설치합니다.

clone한 저장소를 개발판으로 실행하는 경우 최신 코드를 받고 `Run Extension`을 다시 시작하면 됩니다.

```sh
cd programmers-problem-helper
git pull
```

이미 떠 있는 `[Extension Development Host]` 창이 있다면 닫고 `Run Extension`을 다시 실행합니다.

## 직접 배포하기

새 GitHub 저장소를 만든 뒤, 이 확장 폴더를 저장소 루트로 push합니다.

```sh
cd vscode-programmers-helper
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_ID/programmers-problem-helper.git
git push -u origin main
```

GitHub Release에 설치 파일을 올리고 싶다면 버전 태그를 push합니다.

```sh
git tag v0.1.0
git push origin v0.1.0
```

태그가 올라가면 GitHub Actions가 `.vsix` 파일을 만들고 Release에 첨부합니다. Marketplace 배포는 별도의 `Publish Marketplace` workflow를 수동 실행해 GitHub Release에 첨부된 VSIX를 publish합니다.

## 사용 방법

1. VS Code에서 문제 풀이용 작업 폴더를 엽니다.
2. 왼쪽 Activity Bar의 `Programmers` 아이콘을 엽니다.
3. 프로그래머스 문제 번호를 입력합니다.
4. `문제 생성 및 열기`를 누르거나 `Enter`를 입력합니다.
5. 문제를 열면 현재 설정에 맞는 실행 환경이 준비됩니다. Docker 모드는 테스트 실행용 컨테이너를 확인하고, 로컬 모드는 선택 언어의 명령어를 확인합니다.
6. 오른쪽 풀이 파일에 코드를 작성합니다.
7. `샘플 테스트 실행` 또는 `커스텀 테스트 실행`을 누릅니다. 샘플 테스트는 `Ctrl+Alt+T`로도 실행할 수 있습니다.
   - 커스텀 테스트는 `저장` 버튼으로 보관할 수 있고, 실행할 때도 현재 입력값을 저장합니다.
8. 필요하면 현재 문제 버튼 아래의 타이머에서 목표 시간을 고르고 `시작`을 누릅니다. 문제를 전환하거나 VS Code를 닫으면 실행 중인 타이머는 저장 후 멈춥니다.
9. 다시 풀 때는 문제 목록의 `새풀이`를 눌러 현재 풀이를 보관하고 새 풀이를 시작합니다.
10. 보관된 코드는 `풀이기록` 필터에서 시간순으로 확인하거나 삭제합니다.

타이머 기록은 문제 폴더의 `.programmers-helper/timer.json`에 저장됩니다.

문제 목록의 새로고침 버튼은 실제 문제 폴더를 다시 스캔해 목록 인덱스를 재생성합니다. 일반적인 사이드바 복원과 문제 내부 상태 변경은 메모리 캐시와 `.programmers-helper/problem-index.json`을 먼저 사용해 불필요한 파일 읽기를 줄입니다.

### 키보드 단축키

기본 단축키:

- `Ctrl+Alt+T`: 샘플 테스트 실행
- `Ctrl+Alt+S`: 실행 중지

아래 명령은 VS Code의 Keyboard Shortcuts 화면에서 원하는 키를 지정할 수 있습니다.

- `Programmers: Run Sample Tests`
- `Programmers: Stop Tests`
- `Programmers: Run Custom Tests`
- `Programmers: Open Notes`

커스텀 테스트의 Input은 `solution(...)` 인자 순서대로 씁니다.

예:

```text
4, 5, 2, 2, [[0, 0], [3, 1]]
```

Expected Output:

```text
[2, 2]
```

## 개발

문법 확인:

```sh
npm run check
```

VSIX 패키징 확인:

```sh
npm run package
```

Marketplace 배포는 GitHub Actions의 `Publish Marketplace` workflow를 수동 실행합니다. `tag` 입력을 비워두면 최신 GitHub Release의 VSIX를 배포하고, `v0.5.0`처럼 값을 넣으면 해당 Release의 VSIX를 배포합니다.

Repository secrets에는 `VSCE_PAT`가 필요합니다.

`v*.*.*` 태그 push는 GitHub Release와 VSIX 첨부까지만 자동으로 처리합니다. Marketplace 배포는 Release asset을 직접 사이트에 업로드하지 않고, 수동 workflow가 같은 VSIX를 내려받아 `vsce publish --packagePath`로 배포합니다.

## 개발

기본 개발 방식은 로컬 VS Code의 `Run Extension`입니다.

- `Run Extension`은 현재 workspace를 `--extensionDevelopmentPath`로 로드하므로 별도의 확장 symlink를 만들지 않습니다.
- 개발용 Extension Host 창에서 만든 문제 폴더는 열린 workspace 아래 `Programmers/`에 저장되며 휘발되지 않습니다.
- 배포판은 문제 폴더를 확장의 `globalStorage/Programmers`에 저장합니다.
- Docker 실행 모드에서는 로컬 Docker daemon에 붙는 별도의 실행 컨테이너가 컴파일 또는 실행을 담당합니다.
- 로컬 실행 모드에서는 macOS에 설치된 `clang++`/`g++`, `javac`/`java`, `python3`를 사용합니다.

로컬 개발:

1. VS Code에서 이 저장소를 엽니다.
2. `npm install`을 실행합니다.
3. `Run and Debug`에서 `Run Extension`을 실행합니다.
4. 새 `[Extension Development Host]` 창에서 확장을 테스트합니다.

개발 편의:

- `package.json`에 `extensionKind: ["workspace"]`를 지정해 workspace extension host에서 실행되도록 명시했습니다.
- `.vscode/launch.json`의 `Run Extension`은 개발용 Extension Host가 현재 workspace를 열도록 설정되어 있습니다.

## 참고

테스트 러너는 프로그래머스 C++/Java/Python 함수형 문제에서 자주 쓰이는 타입을 지원합니다.

- `int`
- `long long`
- `string`
- `bool`
- `vector<int>`
- `vector<string>`
- `vector<vector<int>>`

특수한 사용자 정의 타입이나 복잡한 시그니처는 추가 구현이 필요할 수 있습니다.
Python은 `def solution(...):` 형태를 감지하고, 샘플/커스텀 테스트 값은 Python literal에 맞춰 실행합니다.

## Credits

This extension was built with OpenAI Codex.

---

## English Summary

Programmers Problem Helper is a local VS Code extension for solving Programmers coding-test problems.

It creates `problem.md`, a language-specific solution file, and `.programmers-helper/programmers.json` from a Programmers lesson number, opens the problem preview beside the solution file, and runs sample or custom tests. C++, Java, and Python are supported through the `programmersHelper.language` setting.

This project was built with OpenAI Codex.
