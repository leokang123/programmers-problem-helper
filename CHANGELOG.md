# Changelog

## 0.2.3

- Publish tagged releases to the VS Code Marketplace from GitHub Actions using the `VSCE_PAT` repository secret.
- Verify that the `package.json` version matches the pushed `v*.*.*` tag before release packaging.
- Document the automated Marketplace release secret in the development release notes.
- Bump the extension manifest and lockfile to `0.2.3`.

## 0.2.2

- Prepare Marketplace metadata with the public publisher ID, package icon, banner color, and broader search keywords.
- Update the README with Marketplace installation guidance, update behavior, privacy notes, and warranty disclaimer.
- Tighten the VSIX ignore list so local problem workspaces and development-only files are not packaged.
- Bump the extension manifest and lockfile to `0.2.2`.

## 0.2.1

- Add a current-problem Website button that copies the active solution file to the clipboard and opens the original Programmers page.
- Install the default JDK in the development Dev Container so Java local execution works in development mode.
- Bump the extension manifest and lockfile to `0.2.1`.

## 0.2.0

- Add the `programmersHelper.language` setting and manage solution files, initial templates, and solution history by language.
- Add Java template fetching, `Solution.java`/`TestRunner.java` generation, and `javac`/`java` sample and custom test runs.
- Introduce language-specific runner builders and diagnostic parsing so future languages can be added more cleanly.
- Show current-language solution history first and keep other-language history available in a collapsed section.
- Rebuild the helper Docker runtime as `programmers-helper-runtime:2` with both C++ and Java tooling plus UTF-8 locale support for Korean problem paths.
- Bump the extension manifest and lockfile to `0.2.0`.

## 0.1.1

- Fix generated C++ test runners so local Windows runs build `.exe` binaries.
- Avoid POSIX-only memory measurement code in local test runners so Windows builds do not include `sys/resource.h`.
- Document that Docker mode is recommended on Windows and local Windows mode requires MinGW `g++` or LLVM `clang++`.
- Bump the extension manifest and lockfile to `0.1.1`.

## 0.1.0

- Add default keyboard shortcuts: `Ctrl+Alt+T` for sample tests and `Ctrl+Alt+S` for stopping the active test run.
- Expose commands for sample tests, stopping tests, custom tests, and notes so users can assign their own keybindings.
- Let the problem number input submit with `Enter`, matching the Create and Open button behavior.
- Refresh the sidebar problem-list cache from updated index data instead of invalidating and rereading after problem-level changes.
- Reuse keyed sidebar list rows during Webview rendering to reduce repeated HTML parsing and DOM recreation.
- Refactor JavaScript modules around clearer responsibilities and add comments for the main extension, store, runner, Docker, parsing, and rendering flows.
- Bump the extension manifest and lockfile to `0.1.0`.

## 0.0.18

- Bump the extension manifest and lockfile to `0.0.18`, correcting the missed package version update from the previous `0.0.17` deployment.
- Stop helper Docker containers automatically when `programmersHelper.executionMode` changes from `docker` to `local`, with bounded Docker cleanup timeouts and sidebar feedback.
- Show a lightweight sidebar notice when switching from `local` back to `docker`; the Docker container is still prepared lazily on the next problem open or test run.
- Restrict active C++ test targets to `solution.cpp` and saved `solution-*.cpp` snapshots so generated `test_runner.cpp` files are never run by mistake.
- Prevent stale problem layout cleanup from closing unrelated C++ tabs outside the active `Programmers` root.
- Validate problem-list index entries and saved solution snapshot paths before using them, rebuilding stale indexes and ignoring unsafe snapshot metadata.
- Debounce sidebar problem search rendering to reduce repeated DOM rebuilds while typing.
- Expand `docs/feature-flows.md` with the new execution-mode, target-selection, index, and snapshot-safety flows.

## 0.0.17

- Keep the right-side solution editor stable when resetting or starting a new attempt to reduce editor flash.
- Fix stale compile fingerprint reuse when running saved solution snapshots by including the selected source include path in the fingerprint.
- Tighten problem layout cleanup so switching problems keeps the current Markdown preview and C++ solution focused.

## 0.0.16

- Defer heavier extension initialization until commands are actually used so the sidebar appears faster.
- Remove the in-webview loading bar and use VS Code progress feedback while the sidebar is preparing.
- Cache the problem list in a single index file and refresh it immediately after create, delete, and review-state changes.
- Filter `.programmers-helper` internals out of the visible problem list.
- Reduce editor flicker on new-attempt and reset flows by keeping the right-side solution editor in place.
- Keep the problem layout focused on the current problem Markdown on the left and the current C++ solution on the right after problem switches.
- Run tests against the currently viewed saved C++ snapshot and include the source include path in the compile fingerprint to prevent stale binary reuse.

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
