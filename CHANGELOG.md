# Changelog

## 0.0.11

- Run sample tests from stored `programmers.json` examples, backfilling from `problem.md` only when needed.
- Require an explicitly opened current problem before running sidebar sample or custom tests.
- Cache Docker readiness checks during an extension session and retry with a fresh check if the cached path fails.
- Reuse compiled test runner binaries when the solution, generated runner code, and compile flags have not changed.
- Reduce test-run memory usage by counting results per test instead of accumulating all output.
- Cache sidebar problem summaries in memory and force a full rescan only after explicit refreshes or file-changing actions.
- Restore detailed `clang++` compile error output after the capture buffer fix.

## 0.0.10

- Add a sidebar memo action that opens per-problem `notes.md` files.
- Create new memo files with a problem-specific study note template.
- Lock the problem Markdown preview so opening memo files does not replace it.

## 0.0.9

- Make the problem open / current status sidebar section collapsible and show a status summary while collapsed.

## 0.0.8

- Show test execution time with two decimal places and include memory usage in result lines.
- Run C++ compilation and test execution in a Docker runtime container.
- Refactor extension runtime code into focused modules.
- Add per-problem solution history with new-attempt, open, delete, and reset flows.
- Run tests against the currently viewed C++ file when a saved solution is open.
- Clean up Docker runtime containers when the extension deactivates.
- Move current-problem actions out of the problem list and improve sidebar release metadata.

## 0.0.7

- Add a Dev Container workflow for isolated extension development while keeping the local installed build separate.
- Mark the extension to run in the workspace extension host for remote and container sessions.
- Add container-friendly debug tasks and launch settings for extension development.
- Save custom test cases per problem and restore them when reopening a problem.
- Add problem search in the sidebar and improve test action layout.
- Distinguish runtime errors from compile failures and show clearer `clang++` missing guidance.
- Wrap long sidebar status messages so long URLs do not break the layout.
- Improve problem deletion fallback when trash is unavailable.

## 0.0.6

- Use VS Code global storage as the default problem store when no local `Programmers` folder is available.
- Add a delete action for problem folders with confirmation and trash support.
- Validate active editor paths before using them as test targets.
- Restrict Programmers redirects and response size while crawling problem pages.
- Improve compile error summaries by hiding long local paths.
- Document that C++ tests run with the current user permissions.

## 0.0.5

- Add per-test-case timeouts and a stop button for running tests.
- Show concise compile error summaries in the sidebar while keeping full logs in the Output panel.
- Run generated test cases one at a time so timeouts do not block the whole suite.
- Compile `solution.cpp` before runner helper headers so missing includes are not hidden.
- Use the opened `Programmers` folder directly instead of creating `Programmers/Programmers`.

## 0.0.4

- Avoid crawling Programmers when an existing local problem already has `problem.md` and `solution.cpp`.
- Speed up problem-list refresh by loading local problems in parallel.
- Ignore stale last-problem paths that no longer contain problem files.
- Simplify ready and test completion sidebar feedback.

## 0.0.3

- Rework the sidebar into separate fixed, test, and problem-list areas.
- Add collapsible test and problem-list sections.
- Move review toggles into problem rows.
- Reduce ready status text and spacing.

## 0.0.2

- Add a current problem review checkbox backed by `.programmers-helper/review.json`.
- Add collapsible review and full problem lists in the sidebar.
- Open problems consistently from create, last problem, review list, and full list actions.
- Refresh custom test defaults and ready status whenever a problem is opened.

## 0.0.1

- Add Programmers sidebar view.
- Create `problem.md`, `solution.cpp`, and `programmers.json` from a Programmers lesson number.
- Open Markdown preview on the left and C++ solution on the right.
- Run sample tests parsed from `problem.md`.
- Run custom tests from Input / Expected Output fields.
