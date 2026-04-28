# Programmers Problem Helper

프로그래머스 코딩테스트 문제를 VS Code에서 더 편하게 풀기 위한 로컬 확장입니다.

이 확장은 OpenAI Codex를 사용해서 만들었습니다.

문제 번호를 입력하면 프로그래머스 문제 페이지를 가져와서 `problem.md`와 현재 설정 언어의 풀이 파일을 만들고, 왼쪽에는 문제 미리보기, 오른쪽에는 풀이 파일을 열어줍니다. 샘플 테스트와 직접 추가한 커스텀 테스트도 실행할 수 있습니다.

## 주요 기능

- 왼쪽 Activity Bar에 `Programmers` 사이드바 추가
- `Programmers/<문제번호>_<문제이름>/problem.md` 생성
- `Programmers/<문제번호>_<문제이름>/solution.cpp` 또는 `Solution.java` 생성
- 예제 정보를 담은 `.programmers-helper/programmers.json` 생성
- 왼쪽에는 `problem.md` Markdown Preview 열기
- 오른쪽에는 현재 언어 풀이 파일 에디터 열기
- 문제의 입출력 예를 기반으로 샘플 테스트 실행
- `+ 테스트 추가`로 Input / Expected Output을 직접 넣어 커스텀 테스트 실행
- 기본 단축키로 샘플 테스트 실행(`Ctrl+Alt+T`)과 실행 중지(`Ctrl+Alt+S`) 지원
- 샘플 테스트 실행, 실행 중지, 커스텀 테스트 실행, 메모 열기는 VS Code 키보드 설정에서 원하는 키로 지정 가능
- PASS/FAIL 모두 expected / actual 출력
- 문제 목록에서 `새풀이`를 눌러 현재 언어 풀이 파일을 이전 풀이로 보관
- `풀이기록` 필터에서 이전 풀이를 시간순으로 열거나 삭제
- 처음 받아온 풀이 원본을 `.programmers-helper/initial-solution.<ext>`로 보관
- 현재 풀이 파일 코드를 클립보드에 복사하고 프로그래머스 웹 페이지 열기

## 지원 언어

`programmersHelper.language` 설정에서 기본 언어를 선택할 수 있습니다.

- C++: `solution.cpp`, `.programmers-helper/initial-solution.cpp`, `clang++` 또는 `g++`
- Java: `Solution.java`, `.programmers-helper/initial-solution.java`, `javac` / `java`

기존 문제를 다른 언어로 열면 해당 언어의 풀이 템플릿이 없을 때만 프로그래머스 페이지를 다시 가져와 언어별 초기 파일을 추가합니다. 문제 설명 `problem.md`는 덮어쓰지 않습니다.

테스트 실행은 현재 활성 풀이 파일을 우선합니다. 예를 들어 Java가 기본 언어여도 C++ 풀이 기록을 열어둔 상태에서 실행하면 C++ runner로 실행됩니다.

풀이기록은 현재 언어 기록을 먼저 보여주고, 다른 언어 기록은 접힌 섹션에서 확인할 수 있습니다.

## 필요 조건

- VS Code 1.85.0 이상
- Docker

테스트 실행 시 확장이 Docker 실행 컨테이너를 자동으로 준비하고, 그 안에서 현재 언어에 맞게 컴파일 및 실행합니다.

```sh
docker version
```

### Windows 실행 안내

Windows에서는 Docker 실행 모드를 권장합니다. Docker 모드는 확장이 준비한 Linux 컨테이너 안에서 컴파일하므로 Windows C++ toolchain 차이를 덜 탑니다.

로컬 실행 모드를 사용하려면 MinGW `g++` 또는 LLVM `clang++`처럼 `-std=c++17`, `-Wall`, `-O2` 형식의 옵션을 지원하는 컴파일러가 PATH에 있어야 합니다. Visual Studio의 `cl.exe`만 설치된 환경은 현재 로컬 실행 모드에서 지원하지 않습니다.

## 보안 안내

샘플/커스텀 테스트 실행은 Docker 컨테이너 안에서 현재 언어 풀이 파일을 컴파일하고 실행합니다. 신뢰할 수 없는 코드는 실행하지 마세요.

## GitHub에서 설치하기

방법은 두 가지입니다.

### 방법 1: GitHub Releases에서 VSIX 다운로드

GitHub 저장소의 `Releases` 페이지에서 최신 `.vsix` 파일을 다운로드합니다.

다운로드한 뒤 VS Code에서 설치합니다.

```sh
code --install-extension <다운로드한-vsix-파일>
```

그 다음 VS Code를 다시 불러옵니다.

1. VS Code 실행
2. `Developer: Reload Window` 실행
3. 왼쪽 Activity Bar에서 `Programmers` 아이콘 열기

### 방법 2: 저장소를 clone해서 연결

이 저장소를 clone합니다.

```sh
git clone https://github.com/leokang123/programmers-problem-helper.git
```

clone한 폴더를 VS Code 로컬 확장 폴더에 연결합니다.

macOS/Linux:

```sh
mkdir -p ~/.vscode/extensions
ln -s "$(pwd)/programmers-problem-helper" ~/.vscode/extensions/local.programmers-problem-helper
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.vscode\extensions"
New-Item -ItemType Junction "$HOME\.vscode\extensions\local.programmers-problem-helper" "$(Get-Location)\programmers-problem-helper"
```

그 다음 VS Code를 다시 불러옵니다.

1. VS Code 실행
2. `Developer: Reload Window` 실행
3. 왼쪽 Activity Bar에서 `Programmers` 아이콘 열기

## 업데이트

최신 코드를 받고 VS Code를 다시 불러오면 됩니다.

```sh
cd programmers-problem-helper
git pull
```

그 다음 `Developer: Reload Window`를 실행합니다.

## 이 프로젝트를 내 GitHub에 올리기

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

태그가 올라가면 GitHub Actions가 `.vsix` 파일을 만들고 Release에 첨부합니다.

## 사용 방법

1. VS Code에서 문제 풀이용 작업 폴더를 엽니다.
2. 왼쪽 Activity Bar의 `Programmers` 아이콘을 엽니다.
3. 프로그래머스 문제 번호를 입력합니다.
4. `문제 생성 및 열기`를 누르거나 `Enter`를 입력합니다.
5. 문제를 열면 컴파일 및 실행용 Docker 컨테이너가 자동으로 준비됩니다.
6. 오른쪽 풀이 파일에 코드를 작성합니다.
7. `샘플 테스트 실행` 또는 `커스텀 테스트 실행`을 누릅니다. 샘플 테스트는 `Ctrl+Alt+T`로도 실행할 수 있습니다.
8. 다시 풀 때는 문제 목록의 `새풀이`를 눌러 현재 풀이를 보관하고 새 풀이를 시작합니다.
9. 보관된 코드는 `풀이기록` 필터에서 시간순으로 확인하거나 삭제합니다.

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

배포는 `v*.*.*` 태그를 push하면 GitHub Actions가 `.vsix`를 만들고 Release에 첨부합니다.

## Dev Container 개발

이 저장소에는 Dev Container 설정이 포함되어 있습니다.

- 컨테이너 안에서는 현재 워크스페이스를 `~/.vscode-server/extensions/local.programmers-problem-helper`로 자동 symlink합니다.
- 개발판은 Dev Container 안에서 확장을 개발하고, Docker 실행 모드에서는 호스트 Docker daemon에 붙는 별도의 sibling 실행 컨테이너가 컴파일 및 실행을 담당합니다.
- 개발판 Dev Container에는 `clang`, `lldb`, 기본 JDK(`javac`, `java`)가 포함되어 있어 `programmersHelper.executionMode`를 `local`로 바꾸면 C++/Java를 컨테이너 내부에서 바로 실행할 수 있습니다.
- 즉 개발판은 "개발용 Dev Container 1개 + 실행용 컨테이너 1개" 구조이며, 실행용 컨테이너를 Dev Container 내부에 중첩 생성하지 않습니다.
- 로컬 macOS VS Code에는 배포판 `.vsix` 또는 마켓 설치본을 그대로 사용하면 됩니다.
- 즉 개발용 확장은 컨테이너 쪽 VS Code Server에서만 보이고, 로컬 배포판과 분리됩니다.

사용 순서:

1. VS Code에서 이 저장소를 엽니다.
2. `Dev Containers: Reopen in Container`를 실행합니다.
3. Docker 기능이 포함된 설정을 반영하려면 `Dev Containers: Rebuild Container`를 한 번 실행합니다.
4. 컨테이너가 올라오면 `Developer: Reload Window`를 한 번 실행합니다.
5. 컨테이너 안에서 확장 코드를 수정하고 테스트합니다.
6. `Run and Debug`에서 `Run Extension`을 실행하면 개발용 Extension Host 창으로 바로 확인할 수 있습니다.

확인용 명령:

```sh
ls -l ~/.vscode-server/extensions/local.programmers-problem-helper
```

주의:

- 개발판은 문제 폴더를 현재 워크스페이스 아래 `Programmers/`에 저장합니다.
- 배포판은 문제 폴더를 확장의 `globalStorage/Programmers`에 저장합니다.

개발 편의:

- `package.json`에 `extensionKind: ["workspace"]`를 지정해 이 확장이 원격/컨테이너 쪽에서 실행되도록 명시했습니다.
- `.vscode/launch.json`의 `Run Extension`으로 개발용 확장 창을 바로 띄울 수 있습니다.

## 참고

테스트 러너는 프로그래머스 C++/Java 함수형 문제에서 자주 쓰이는 타입을 지원합니다.

- `int`
- `long long`
- `string`
- `bool`
- `vector<int>`
- `vector<string>`
- `vector<vector<int>>`

특수한 사용자 정의 타입이나 복잡한 시그니처는 추가 구현이 필요할 수 있습니다.

## Credits

This extension was built with OpenAI Codex.

---

## English Summary

Programmers Problem Helper is a local VS Code extension for solving Programmers coding-test problems.

It creates `problem.md`, a language-specific solution file, and `.programmers-helper/programmers.json` from a Programmers lesson number, opens the problem preview beside the solution file, and runs sample or custom tests. Java is supported through the `programmersHelper.language` setting.

This project was built with OpenAI Codex.
