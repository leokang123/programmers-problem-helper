const vscode = require("vscode");
const {
  buildSidebarHtml,
} = require("./sidebarHtml");

const SIDEBAR_VIEW_ID = "programmersHelper.sidebar";

// 사이드바 Webview와 메시지 핸들링을 관리합니다.
class ProgrammersSidebarProvider {
  // 컨텍스트와 메시지 핸들러를 저장합니다.
  constructor(context, handlers = {}, options = {}) {
    this.context = context;
    this.handlers = handlers;
    this.onDidResolveView = options.onDidResolveView;
    this.view = undefined;
    this.problemListCache = undefined;
    this.problemListRefreshPromise = undefined;
  }

  // Webview가 열릴 때 HTML과 메시지 핸들러를 설정합니다.
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "webviewReady") {
        this.onDidResolveView?.();
        return;
      }

      if (message.type === "refreshProblems") {
        await this.refreshProblems({ force: Boolean(message.force), progress: true });
        return;
      }

      const handler = this.handlers[message.type];
      if (handler) {
        await handler(message);
      }
    });
  }

  // Webview로 메시지를 보냅니다.
  post(message) {
    if (!this.view) {
      return false;
    }
    this.view.webview.postMessage(message);
    return true;
  }

  // 현재 Programmers 저장소에 대해 메모리에 들고 있는 문제 목록 cache를 반환합니다.
  getCachedProblems(cacheKey) {
    return this.problemListCache?.cacheKey === cacheKey ? this.problemListCache.problems : undefined;
  }

  // 문제 목록과 현재 문제 상태를 새로 보냅니다.
  async refreshProblems(options = {}) {
    if (options.progress) {
      return vscode.window.withProgress(
        {
          location: { viewId: SIDEBAR_VIEW_ID },
          title: "문제 목록 불러오는 중...",
        },
        () => this.refreshProblems({ ...options, progress: false })
      );
    }

    await Promise.resolve();
    const {
      loadProblems,
      resolveProgrammersDir,
    } = require("../problems/problemStore");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const programmersDir = await resolveProgrammersDir(this.context, workspaceFolder?.uri);
    const cacheKey = programmersDir?.fsPath || "";
    if (Array.isArray(options.problems)) {
      const problems = options.problems;
      this.problemListCache = { cacheKey, problems };
      if (this.problemListRefreshPromise?.cacheKey === cacheKey) {
        this.problemListRefreshPromise = undefined;
      }
      if (!options.silent) {
        this.post({ type: "problems", problems });
      }
      return;
    }

    if (options.invalidateCache && this.problemListCache?.cacheKey === cacheKey) {
      this.problemListCache = undefined;
    }
    if (options.invalidateCache && this.problemListRefreshPromise?.cacheKey === cacheKey) {
      this.problemListRefreshPromise = undefined;
    }

    if (!options.force && this.problemListCache?.cacheKey === cacheKey) {
      this.post({ type: "problems", problems: this.problemListCache.problems });
      return;
    }

    if (!options.force && this.problemListRefreshPromise?.cacheKey === cacheKey) {
      const problems = await this.problemListRefreshPromise.promise;
      this.post({ type: "problems", problems });
      return;
    }

    const promise = programmersDir ? loadProblems(programmersDir, { rebuildIndex: Boolean(options.force) }) : Promise.resolve([]);
    this.problemListRefreshPromise = { cacheKey, promise };
    try {
      const problems = await promise;
      if (this.problemListRefreshPromise?.promise !== promise) {
        return;
      }
      this.problemListCache = { cacheKey, problems };
      this.post({ type: "problems", problems });
    } finally {
      if (this.problemListRefreshPromise?.promise === promise) {
        this.problemListRefreshPromise = undefined;
      }
    }
  }

  // 사이드바 HTML을 생성합니다.
  getHtml() {
    return buildSidebarHtml(String(Date.now()));
  }
}

module.exports = {
  ProgrammersSidebarProvider,
};
