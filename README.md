# Programmers Problem Helper

VS Code extension for solving Programmers coding-test problems locally.

It creates a problem folder from a Programmers lesson number, opens the problem preview beside `solution.cpp`, and runs sample or custom C++ tests.

## Features

- Activity Bar sidebar named `Programmers`
- Create `Programmers/<lessonId>_<title>/problem.md`
- Create `Programmers/<lessonId>_<title>/solution.cpp`
- Create `programmers.json` metadata with parsed examples
- Open `problem.md` Markdown Preview on the left
- Open `solution.cpp` editor on the right
- Run sample tests parsed from the problem table
- Add custom tests with separate Input / Expected Output fields
- Show expected and actual values for PASS and FAIL results

## Requirements

- VS Code 1.85.0 or newer
- Node.js, only for packaging or publishing
- `clang++` for running C++ sample/custom tests

On macOS, `clang++` is usually available after installing Xcode Command Line Tools:

```sh
xcode-select --install
```

## Local Development

Open this extension folder in VS Code:

```sh
cd vscode-programmers-helper
code .
```

Then press `F5` to launch an Extension Development Host.

Run a syntax check:

```sh
npm run check
```

## Package As VSIX

From this folder:

```sh
npm run package
```

This creates a file like:

```text
programmers-problem-helper-0.0.1.vsix
```

Install it on another computer:

```sh
code --install-extension programmers-problem-helper-0.0.1.vsix
```

Then reload VS Code and open the `Programmers` icon in the Activity Bar.

## Publish To GitHub

Create a new GitHub repository, then push this extension folder as the repository root.

```sh
cd vscode-programmers-helper
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_ID/programmers-problem-helper.git
git push -u origin main
```

Before pushing, replace `YOUR_GITHUB_ID` in `package.json` with your GitHub username.

GitHub Actions will package a VSIX when you push a tag:

```sh
git tag v0.0.1
git push origin v0.0.1
```

Download the packaged VSIX from the workflow artifact.

## Publish To VS Code Marketplace

1. Create a publisher in the Visual Studio Marketplace.
2. Replace `"publisher": "local"` in `package.json` with your real publisher id.
3. Replace repository URLs in `package.json`.
4. Create a Marketplace access token.
5. Login and publish:

```sh
npx @vscode/vsce login YOUR_PUBLISHER_ID
npm run publish
```

## Usage

1. Open a PS workspace folder in VS Code.
2. Open the `Programmers` icon in the Activity Bar.
3. Enter a Programmers lesson number.
4. Click `문제 생성 및 열기`.
5. Write your solution in `solution.cpp`.
6. Click `샘플 테스트 실행` or add custom tests and click `커스텀 테스트 실행`.

Custom test Input is written in `solution(...)` argument order:

```text
4, 5, 2, 2, [[0, 0], [3, 1]]
```

Expected Output:

```text
[2, 2]
```

## Notes

The test runner supports common Programmers C++ function-style signatures such as:

- `int`
- `long long`
- `string`
- `bool`
- `vector<int>`
- `vector<string>`
- `vector<vector<int>>`

Very unusual custom types may require extending the runner.
