# Changelog

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
