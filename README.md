# Programmers Problem Helper

프로그래머스 코딩테스트 문제를 VS Code에서 더 편하게 풀기 위한 로컬 확장입니다.

이 확장은 OpenAI Codex를 사용해서 만들었습니다.

문제 번호를 입력하면 프로그래머스 문제 페이지를 가져와서 `problem.md`와 `solution.cpp`를 만들고, 왼쪽에는 문제 미리보기, 오른쪽에는 C++ 풀이 파일을 열어줍니다. 샘플 테스트와 직접 추가한 커스텀 테스트도 실행할 수 있습니다.

## 주요 기능

- 왼쪽 Activity Bar에 `Programmers` 사이드바 추가
- `Programmers/<문제번호>_<문제이름>/problem.md` 생성
- `Programmers/<문제번호>_<문제이름>/solution.cpp` 생성
- 예제 정보를 담은 `.programmers-helper/programmers.json` 생성
- 왼쪽에는 `problem.md` Markdown Preview 열기
- 오른쪽에는 `solution.cpp` 에디터 열기
- 문제의 입출력 예를 기반으로 샘플 테스트 실행
- `+ 테스트 추가`로 Input / Expected Output을 직접 넣어 커스텀 테스트 실행
- PASS/FAIL 모두 expected / actual 출력

## 필요 조건

- VS Code 1.85.0 이상
- C++ 테스트 실행용 `clang++`

macOS에서는 보통 Xcode Command Line Tools를 설치하면 `clang++`를 사용할 수 있습니다.

```sh
xcode-select --install
```

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
git tag v0.0.2
git push origin v0.0.2
```

태그가 올라가면 GitHub Actions가 `.vsix` 파일을 만들고 Release에 첨부합니다.

## 사용 방법

1. VS Code에서 문제 풀이용 작업 폴더를 엽니다.
2. 왼쪽 Activity Bar의 `Programmers` 아이콘을 엽니다.
3. 프로그래머스 문제 번호를 입력합니다.
4. `문제 생성 및 열기`를 누릅니다.
5. 오른쪽 `solution.cpp`에 풀이를 작성합니다.
6. `샘플 테스트 실행` 또는 `커스텀 테스트 실행`을 누릅니다.

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

## 참고

테스트 러너는 프로그래머스 C++ 함수형 문제에서 자주 쓰이는 타입을 지원합니다.

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

It creates `problem.md`, `solution.cpp`, and `.programmers-helper/programmers.json` from a Programmers lesson number, opens the problem preview beside the C++ solution file, and runs sample or custom C++ tests.

This project was built with OpenAI Codex.
