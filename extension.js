const vscode = require("vscode");
const cp = require("child_process");
const {
  ProgrammersSidebarProvider,
} = require("./src/sidebarProvider");

let sidebarProvider;
let problemCommands;
let testRunner;
let outputChannel;
let diagnosticCollection;

// 확장 진입점을 초기화하고 명령을 등록합니다.
function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Programmers Helper");
  diagnosticCollection = vscode.languages.createDiagnosticCollection("programmers-helper");
  sidebarProvider = new ProgrammersSidebarProvider(context, {
    create: async (message) => {
      const { problemCommands } = ensureServices(context);
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
    stopTests: async () => {
      testRunner?.stop();
    },
    openLast: async () => {
      const { problemCommands } = ensureServices(context);
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
    openSolutionSnapshot: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.openSolutionSnapshot(String(message.problemDir || ""), String(message.snapshotPath || ""));
    },
    deleteSolutionSnapshot: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.deleteSolutionSnapshot(String(message.problemDir || ""), String(message.snapshotPath || ""));
    },
    openProblem: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.openProblemFromDir(String(message.problemDir || ""));
    },
    deleteProblem: async (message) => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.deleteProblem(String(message.problemDir || ""));
    },
  });

  context.subscriptions.push(
    outputChannel,
    diagnosticCollection,
    vscode.window.registerWebviewViewProvider("programmersHelper.sidebar", sidebarProvider),
    vscode.commands.registerCommand("programmersHelper.createProblem", async () => {
      const { problemCommands } = ensureServices(context);
      await problemCommands.createProblemFromInput();
    }),
    vscode.commands.registerCommand("programmersHelper.runSamples", async () => {
      const { problemCommands, testRunner } = ensureServices(context);
      await testRunner.runFromCommand(context, "", undefined, () => problemCommands.getProblemDir());
    })
  );
}

// Webview 표시 전 activation 경로를 가볍게 유지하기 위해 명령 구현은 실제 사용 시점에 로드합니다.
function ensureServices(context) {
  if (problemCommands && testRunner) {
    return { problemCommands, testRunner };
  }

  const {
    ProblemCommands,
  } = require("./src/problemCommands");
  const {
    TestRunner,
  } = require("./src/testRunner");

  testRunner = new TestRunner({
    outputChannel,
    diagnosticCollection,
    extensionDir: __dirname,
    execCommand,
    postStatus: (message) => sidebarProvider?.post(message),
  });
  problemCommands = new ProblemCommands({
    context,
    extensionDir: __dirname,
    execCommand,
    postMessage: (message) => sidebarProvider?.post(message),
    refreshProblems: async (options) => sidebarProvider?.refreshProblems(options),
    runTests: async (customTestsText, providedProblemDir) => {
      await testRunner.runFromCommand(context, customTestsText, providedProblemDir, () => problemCommands.getProblemDir());
    },
  });

  return { problemCommands, testRunner };
}

// 확장 종료 시 테스트를 중지하고 Docker 정리는 백그라운드에 맡깁니다.
async function deactivate() {
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

// 외부 명령을 실행하고 stdout/stderr를 모읍니다.
function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, { cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;
    const timeout = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 1000);
      }
    }, options.timeoutMs) : undefined;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const result = { code, signal, stdout, stderr };
      if (timedOut) {
        reject(new Error(`${command} ${args.join(" ")} 시간이 초과되었습니다.`));
        return;
      }
      if (options.allowNonZeroExit || code === 0) {
        resolve(result);
        return;
      }

      const detail = (stderr || stdout || "").trim();
      reject(new Error(`${command} ${args.join(" ")} 실패${detail ? `\n${detail}` : ""}`));
    });
  });
}

module.exports = {
  activate,
  deactivate,
};
