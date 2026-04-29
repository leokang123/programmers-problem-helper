const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const {
  ProgrammersSidebarProvider,
} = require("./src/sidebarProvider");

let sidebarProvider;
let problemCommands;
let testRunner;
let timerManager;
let outputChannel;
let diagnosticCollection;
let lastExecutionMode;
let latestStatusMessage;

const RELOAD_PROMPT_VERSION_STATE_KEY = "programmersHelper.reloadPromptVersion";

function postSidebarMessage(message) {
  const nextMessage = message?.type === "status"
    ? { ...message, text: formatStatusText(message) }
    : message;
  if (message?.type === "status") {
    latestStatusMessage = {
      type: "status",
      kind: nextMessage.kind || "",
      text: String(nextMessage.text || ""),
    };
  }
  return sidebarProvider?.post(nextMessage) || false;
}

function formatStatusText(message) {
  const text = String(message?.text || "");
  const problemDir = typeof message?.problemDir === "string" ? message.problemDir : "";
  if (!problemDir) {
    return text;
  }

  const problemLabel = path.basename(problemDir);
  if (!problemLabel || text.includes(problemLabel)) {
    return text;
  }

  const separator = "\n\n";
  const separatorIndex = text.indexOf(separator);
  if (separatorIndex === -1) {
    return `${text}${separator}${problemLabel}`;
  }

  const title = text.slice(0, separatorIndex);
  const detail = text.slice(separatorIndex + separator.length);
  return `${title}${separator}${problemLabel}${detail ? `\n${detail}` : ""}`;
}

function replayLatestStatusMessage() {
  if (latestStatusMessage) {
    sidebarProvider?.post(latestStatusMessage);
  }
}

// 확장 진입점을 초기화하고 명령을 등록합니다.
function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Programmers Helper");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("programmers-helper");
  lastExecutionMode = getConfiguredExecutionMode();
  registerExtensionUpdateReloadPrompt(context);
  sidebarProvider = new ProgrammersSidebarProvider(context, {
    create: async (message) => {
      const { problemCommands, timerManager } = ensureServices(context);
      await timerManager.pauseAllRunning();
      await problemCommands.createProblemFromId(String(message.lessonId || ""));
    },
    runSamples: async (message) => {
      const { problemCommands, testRunner } = ensureServices(context);
      const problemDir = String(message.problemDir || "");
      if (!problemDir) {
        vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
        return;
      }
      const target = await problemCommands.getActiveCodeTarget(problemDir);
      if (!target) {
        vscode.window.showInformationMessage("먼저 문제를 열어주세요.");
        return;
      }
      await testRunner.runFromCommand(context, "", target, () => undefined);
    },
    runCustom: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.runCustomTestsFromMessage(message.tests || [], String(message.problemDir || ""));
    },
    saveCustomTests: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.saveCustomTestsFromMessage(message.tests || [], String(message.problemDir || ""));
    },
    stopTests: async () => {
      testRunner?.stop();
    },
    openLast: async () => {
      const { problemCommands, timerManager } = ensureServices(context);
      await timerManager.pauseAllRunning();
      await problemCommands.openLastProblem();
    },
    toggleReview: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.toggleReview(String(message.problemDir || ""), Boolean(message.review));
    },
    resetCurrentSolution: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.resetCurrentSolution(String(message.problemDir || ""));
    },
    startReviewAttempt: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.startReviewAttempt(String(message.problemDir || ""));
    },
    openNotes: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.openNotes(String(message.problemDir || ""));
    },
    openWebsite: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.openWebsite(String(message.problemDir || ""));
    },
    openSolutionSnapshot: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.openSolutionSnapshot(String(message.problemDir || ""), String(message.snapshotPath || ""));
    },
    deleteSolutionSnapshot: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.deleteSolutionSnapshot(String(message.problemDir || ""), String(message.snapshotPath || ""));
    },
    openProblem: async (message) => {
      const { problemCommands, timerManager } = ensureServices(context);
      const problemDir = String(message.problemDir || "");
      await timerManager.pauseRunningForProblemSwitch(problemDir);
      await problemCommands.openProblemFromDir(problemDir);
    },
    deleteProblem: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.deleteProblem(String(message.problemDir || ""));
    },
    getTimer: async (message) => {
      const { timerManager } = ensureServices(context);
      postSidebarMessage({ type: "timerState", timer: await timerManager.getTimer(String(message.problemDir || "")) });
    },
    startTimer: async (message) => {
      const { timerManager } = ensureServices(context);
      postSidebarMessage({ type: "timerState", timer: await timerManager.start(String(message.problemDir || "")) });
    },
    pauseTimer: async (message) => {
      const { timerManager } = ensureServices(context);
      postSidebarMessage({ type: "timerState", timer: await timerManager.pause(String(message.problemDir || "")) });
    },
    resetTimer: async (message) => {
      const { timerManager } = ensureServices(context);
      postSidebarMessage({ type: "timerState", timer: await timerManager.reset(String(message.problemDir || "")) });
    },
    setTimerTarget: async (message) => {
      const { timerManager } = ensureServices(context);
      postSidebarMessage({
        type: "timerState",
        timer: await timerManager.setTarget(String(message.problemDir || ""), message.targetMinutes),
      });
    },
    timerNotification: async (message) => {
      const text = String(message.text || "").trim();
      if (text) {
        vscode.window.showInformationMessage(text);
      }
    },
  }, {
    onDidResolveView: replayLatestStatusMessage,
  });

  context.subscriptions.push(
    outputChannel,
    diagnosticCollection,
    vscode.window.registerWebviewViewProvider("programmersHelper.sidebar", sidebarProvider),
    vscode.commands.registerCommand("programmersHelper.createProblem", async () => {
      const { problemCommands, timerManager } = ensureServices(context);
      await timerManager.pauseAllRunning();
      await problemCommands.createProblemFromInput();
    }),
    vscode.commands.registerCommand("programmersHelper.runSamples", async () => {
      const { problemCommands, testRunner } = ensureServices(context);
      await testRunner.runFromCommand(context, "", undefined, () => problemCommands.getProblemDir());
    }),
    vscode.commands.registerCommand("programmersHelper.stopTests", async () => {
      const { testRunner } = ensureServices(context);
      testRunner.stop();
    }),
    vscode.commands.registerCommand("programmersHelper.runCustomTests", async () => {
      if (!postSidebarMessage({ type: "runCustomRequest" })) {
        vscode.window.showInformationMessage("사이드바에서 커스텀 테스트를 실행해주세요.");
      }
    }),
    vscode.commands.registerCommand("programmersHelper.openNotes", async () => {
      const { problemCommands } = ensureServices(context);
      const target = await problemCommands.getProblemDir();
      if (target) {
        await problemCommands.openNotes(target.problemDir);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("programmersHelper.executionMode")) {
        await handleExecutionModeChange();
      }
    }),
  );
}

// Webview 표시 전 activation 경로를 가볍게 유지하기 위해 명령 구현은 실제 사용 시점에 로드합니다.
function ensureServices(context) {
  if (problemCommands && testRunner && timerManager) {
    return { problemCommands, testRunner, timerManager };
  }

  const {
    ProblemCommands,
  } = require("./src/problemCommands");
  const {
    TestRunner,
  } = require("./src/testRunner");
  const {
    TimerManager,
  } = require("./src/timerManager");

  timerManager = timerManager || new TimerManager(context);
  testRunner = new TestRunner({
    outputChannel,
    diagnosticCollection,
    extensionDir: __dirname,
    execCommand,
    postStatus: postSidebarMessage,
  });
  problemCommands = new ProblemCommands({
    context,
    extensionDir: __dirname,
    execCommand,
    postMessage: postSidebarMessage,
    refreshProblems: async (options) => sidebarProvider?.refreshProblems(options),
    runTests: async (customTestsText, providedProblemDir) => {
      await testRunner.runFromCommand(context, customTestsText, providedProblemDir, () => problemCommands.getProblemDir());
    },
  });

  return { problemCommands, testRunner, timerManager };
}

function registerExtensionUpdateReloadPrompt(context) {
  const runningVersion = getExtensionPackageVersion(context.extension);
  const extensionId = context.extension?.id;
  if (!runningVersion || !extensionId) {
    return;
  }

  const checkForInstalledUpdate = () => {
    notifyReloadIfInstalledVersionChanged(context, extensionId, runningVersion).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel?.appendLine(`[Programmers Helper] Update reload notification skipped: ${message}`);
    });
  };

  context.subscriptions.push(vscode.extensions.onDidChange(checkForInstalledUpdate));
  checkForInstalledUpdate();
}

async function notifyReloadIfInstalledVersionChanged(context, extensionId, runningVersion) {
  const installedExtension = vscode.extensions.getExtension(extensionId);
  const installedVersion = getExtensionPackageVersion(installedExtension);
  if (!installedVersion || installedVersion === runningVersion) {
    return;
  }

  const promptedVersion = context.globalState.get(RELOAD_PROMPT_VERSION_STATE_KEY);
  if (promptedVersion === installedVersion) {
    return;
  }
  await context.globalState.update(RELOAD_PROMPT_VERSION_STATE_KEY, installedVersion);

  const action = await vscode.window.showInformationMessage(
    `Programmers Helper ${installedVersion} 버전이 설치되었습니다. VS Code를 다시 로드하면 새 버전이 적용됩니다.`,
    "Reload VS Code"
  );
  if (action === "Reload VS Code") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function getExtensionPackageVersion(extension) {
  const version = extension?.packageJSON?.version;
  return typeof version === "string" && version ? version : undefined;
}

// 확장 종료 시 테스트를 중지하고 Docker 정리는 백그라운드에 맡깁니다.
async function deactivate() {
  await timerManager?.pauseAllRunning();
  testRunner?.stop();
  try {
    const {
      stopDockerRuntimeContainersInBackground,
    } = require("./src/dockerRuntime");
    const scheduled = stopDockerRuntimeContainersInBackground();
    if (!scheduled) {
      outputChannel?.appendLine("[Programmers Helper] Docker runtime cleanup schedule skipped");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[Programmers Helper] Docker runtime cleanup skipped: ${message}`);
  }
}

async function handleExecutionModeChange() {
  const nextExecutionMode = getConfiguredExecutionMode();
  const previousExecutionMode = lastExecutionMode;
  lastExecutionMode = nextExecutionMode;

  if (previousExecutionMode === nextExecutionMode) {
    return;
  }

  if (previousExecutionMode === "local" && nextExecutionMode === "docker") {
    postSidebarMessage({
      type: "status",
      kind: "",
      text: "Docker 실행으로 전환됨\n\n문제를 열거나 테스트를 실행하면 Docker 컨테이너를 준비합니다.",
    });
    return;
  }

  if (previousExecutionMode !== "docker" || nextExecutionMode !== "local") {
    return;
  }

  postSidebarMessage({
    type: "status",
    kind: "ready",
    text: "로컬 실행으로 전환됨\n\nDocker 컨테이너를 정리하고 있습니다.",
  });

  try {
    testRunner?.stop();
    const {
      stopDockerRuntimeContainers,
    } = require("./src/dockerRuntime");
    const stopped = await stopDockerRuntimeContainers({ execCommand });
    const detail = stopped.length > 0
      ? `${stopped.length}개 컨테이너 중지\n${stopped.join("\n")}`
      : "실행 중인 helper Docker 컨테이너가 없습니다.";
    outputChannel?.appendLine(`[Programmers Helper] Switched executionMode to local. ${detail.replace(/\n/g, " ")}`);
    postSidebarMessage({
      type: "status",
      kind: "ready",
      text: `로컬 실행으로 전환됨\n\n${detail}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[Programmers Helper] Docker cleanup after local switch failed: ${message}`);
    postSidebarMessage({
      type: "status",
      kind: "error",
      text: `로컬 실행으로 전환됨\n\nDocker 컨테이너 정리에 실패했습니다.\n${message}`,
    });
  }
}

function getConfiguredExecutionMode() {
  return vscode.workspace.getConfiguration("programmersHelper").get("executionMode") === "local"
    ? "local"
    : "docker";
}

// child_process timeout 처리를 한 곳에 모읍니다.
function startKillTimer(child, timeoutMs) {
  if (!timeoutMs) {
    return { timeout: undefined, getTimedOut: () => false };
  }

  let timedOut = false;
  let killTimer;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!child.killed) {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1000);
    }
  }, timeoutMs);

  return {
    timeout,
    getTimedOut: () => timedOut,
    clear: () => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    },
  };
}

// execCommand의 성공/실패 정책을 child_process 이벤트 처리에서 분리합니다.
function settleExecCommand({ command, args, options, code, signal, stdout, stderr, timedOut }) {
  const result = { code, signal, stdout, stderr };
  if (timedOut) {
    throw new Error(`${command} ${args.join(" ")} 시간이 초과되었습니다.`);
  }
  if (options.allowNonZeroExit || code === 0) {
    return result;
  }

  const detail = (stderr || stdout || "").trim();
  throw new Error(`${command} ${args.join(" ")} 실패${detail ? `\n${detail}` : ""}`);
}

// 외부 명령을 실행하고 stdout/stderr를 모읍니다.
function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, { cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    const timeoutState = startKillTimer(child, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      timeoutState.clear?.();
      reject(error);
    });
    child.on("close", (code, signal) => {
      timeoutState.clear?.();
      try {
        resolve(settleExecCommand({ command, args, options, code, signal, stdout, stderr, timedOut: timeoutState.getTimedOut() }));
      } catch (error) {
        reject(error);
      }
    });
  });
}

module.exports = {
  activate,
  deactivate,
};
