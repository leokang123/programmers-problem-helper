const path = require("path");
const vscode = require("vscode");
const {
  getExecutionSettings,
} = require("../core/settings");
const {
  getLanguage,
  inferLanguageFromRunnablePath,
  isSupportedSourceExtension,
} = require("./languages");

// 문제 설명과 풀이 파일을 좌/우 editor group에 엽니다.
async function openProblem(mdUri, solutionUri, options = {}) {
  const preserveRightProblemTabs = Boolean(options.preserveRightProblemTabs);
  const preserveRightProblemTabsAcrossProblems = Boolean(options.preserveRightProblemTabsAcrossProblems);

  await vscode.workspace.saveAll(false);
  await openLockedMarkdownPreview(mdUri, vscode.ViewColumn.One);
  await closeInactiveProblemTabs(mdUri, solutionUri);
  await showSolution(solutionUri);
  if (!preserveRightProblemTabs) {
    await closeStaleSolutionTabs(solutionUri);
  }
  await keepOnlyProblemLayoutTabs(mdUri, solutionUri, {
    preserveRightProblemTabs,
    preserveRightProblemTabsAcrossProblems,
  });
}

// 풀이 파일을 오른쪽 그룹에 보여주되 기존 탭은 닫지 않고 재사용합니다.
async function showSolution(solutionUri) {
  await vscode.workspace.saveAll(false);
  await vscode.window.showTextDocument(solutionUri, {
    viewColumn: vscode.ViewColumn.Two,
    preserveFocus: false,
    preview: false,
  });
}

// Markdown preview가 다른 Markdown 파일로 따라가지 않도록 잠급니다.
async function openLockedMarkdownPreview(mdUri, viewColumn) {
  try {
    await vscode.commands.executeCommand("vscode.openWith", mdUri, "vscode.markdown.preview.editor", {
      viewColumn,
      preview: false,
    });
  } catch {
    await vscode.commands.executeCommand("markdown.showPreview", mdUri, viewColumn);
    await vscode.commands.executeCommand("markdown.preview.toggleLock");
  }
}

// 같은 파일이 이미 열려 있으면 해당 탭만 닫습니다.
async function closeOpenTabsForUri(uri) {
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      if (tab.input?.uri && sameFsPath(tab.input.uri, uri)) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length === 0) {
    return false;
  }

  await vscode.window.tabGroups.close(tabs, true);
  return true;
}

// 현재 문제를 여는 동안 이전 문제의 비활성 problem.md 탭을 정리합니다.
async function closeInactiveProblemTabs(mdUri, solutionUri) {
  const keep = new Set([path.resolve(mdUri.fsPath), path.resolve(solutionUri.fsPath)]);
  const programmersRoot = path.dirname(path.dirname(mdUri.fsPath));
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      if (tab.isActive || !isProblemMarkdownTab(tab, programmersRoot, keep)) {
        continue;
      }
      tabs.push(tab);
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// URI가 없는 Markdown preview 탭은 label fallback으로 보수적으로 처리한다.
function isProblemMarkdownTab(tab, programmersRoot, keep) {
  const uris = getTabUris(tab);
  if (uris.length > 0) {
    return uris.some((uri) => {
      const target = path.resolve(uri.fsPath);
      return !keep.has(target)
        && target.endsWith(`${path.sep}problem.md`)
        && target.startsWith(path.resolve(programmersRoot) + path.sep);
    });
  }

  const label = String(tab.label || "").toLowerCase();
  return label.includes("problem.md");
}

// diff/custom editor 입력까지 고려해 탭이 참조하는 file URI들을 모읍니다.
function getTabUris(tab) {
  return [
    tab.input?.uri,
    tab.input?.modified,
    tab.input?.original,
  ].filter((uri) => uri?.scheme === "file");
}

// 현재 문제 풀이 파일 외에 같은 Programmers 루트의 오래된 풀이 탭을 정리합니다.
async function closeStaleSolutionTabs(solutionUri) {
  const keep = path.resolve(solutionUri.fsPath);
  const target = getRunTargetFromPath(solutionUri.fsPath);
  const programmersRoot = target ? path.dirname(target.problemDir) : path.dirname(path.dirname(solutionUri.fsPath));
  const tabs = [];
  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      const uris = getTabUris(tab);
      if (uris.some((uri) => {
        const target = path.resolve(uri.fsPath);
        return target !== keep
          && isSupportedSourceExtension(path.extname(target))
          && target.startsWith(path.resolve(programmersRoot) + path.sep);
      })) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// 문제 열기 후 좌/우 editor group의 문제 풀이 레이아웃을 정리합니다.
async function keepOnlyProblemLayoutTabs(mdUri, solutionUri, options = {}) {
  const keepLeft = path.resolve(mdUri.fsPath);
  const keepRight = path.resolve(solutionUri.fsPath);
  const keepProblemDir = path.resolve(path.dirname(mdUri.fsPath));
  const keepProgrammersRoot = path.resolve(path.dirname(keepProblemDir));
  const preserveRightProblemTabs = Boolean(options.preserveRightProblemTabs);
  const preserveRightProblemTabsAcrossProblems = Boolean(options.preserveRightProblemTabsAcrossProblems);
  const tabs = [];

  for (const group of vscode.window.tabGroups?.all || []) {
    for (const tab of group.tabs || []) {
      const uris = getTabUris(tab);
      if (uris.length === 0) {
        continue;
      }

      const hasLeft = uris.some((uri) => path.resolve(uri.fsPath) === keepLeft);
      const hasRight = uris.some((uri) => path.resolve(uri.fsPath) === keepRight);
      const hasCurrentProblemSource = preserveRightProblemTabs && uris.some((uri) => {
        const target = getRunTargetFromPath(uri.fsPath);
        return target && path.resolve(target.problemDir) === keepProblemDir;
      });
      const hasProgrammersSource = preserveRightProblemTabsAcrossProblems && uris.some((uri) => {
        const target = path.resolve(uri.fsPath);
        return isSupportedSourceExtension(path.extname(target))
          && target.startsWith(keepProgrammersRoot + path.sep);
      });

      if (!hasLeft && !hasRight) {
        if (group.viewColumn === vscode.ViewColumn.Two && (hasCurrentProblemSource || hasProgrammersSource)) {
          continue;
        }
        tabs.push(tab);
        continue;
      }

      if (group.viewColumn === vscode.ViewColumn.One && !hasLeft) {
        tabs.push(tab);
      }
      if (group.viewColumn === vscode.ViewColumn.Two && !hasRight) {
        tabs.push(tab);
      }
    }
  }

  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

// VS Code URI의 파일 경로를 정규화해서 비교합니다.
function sameFsPath(left, right) {
  return path.resolve(left.fsPath) === path.resolve(right.fsPath);
}

// 파일 경로에서 문제 폴더와 실행 풀이 파일을 추정합니다.
function getRunTargetFromPath(filePath) {
  const normalized = path.normalize(filePath);
  if (!isSupportedSourceExtension(path.extname(normalized))) {
    return undefined;
  }

  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf("Programmers");
  if (index < 0 || index + 1 >= parts.length) {
    return undefined;
  }

  const relativeParts = parts.slice(index + 2);
  const language = inferLanguageFromRunnablePath(relativeParts);
  if (!language) {
    return undefined;
  }

  return {
    problemDir: parts.slice(0, index + 2).join(path.sep),
    solutionPath: normalized,
    cppPath: normalized,
    language,
  };
}

// 같은 문제에서 현재 화면에 보이는 풀이/snapshot 중 실행 대상을 고릅니다.
function getVisibleCodeTarget(problemDir) {
  const safeDir = path.resolve(problemDir);
  const settings = getExecutionSettings();
  const defaultSolutionPath = path.resolve(safeDir, getLanguage(settings.language).solutionFileName);
  const visibleTargets = vscode.window.visibleTextEditors
    .map((editor) => getRunTargetFromPath(editor.document.uri.fsPath))
    .filter((target) => target && path.resolve(target.problemDir) === safeDir);

  const sameLanguageTargets = visibleTargets.filter((target) => target.language === settings.language);
  const snapshotTarget = sameLanguageTargets.find((target) => path.resolve(target.solutionPath) !== defaultSolutionPath);
  return snapshotTarget || sameLanguageTargets[0] || visibleTargets[0];
}

module.exports = {
  closeOpenTabsForUri,
  getRunTargetFromPath,
  getVisibleCodeTarget,
  openProblem,
  showSolution,
};
