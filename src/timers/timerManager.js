const path = require("path");
const vscode = require("vscode");
const {
  helperPath,
} = require("../problems/helperPaths");

const LEGACY_TIMER_STATE_KEY = "problemTimers";
const TIMER_TARGETS = [20, 30, 60, 90, 120];
const DEFAULT_TARGET_MINUTES = 60;
const TIMER_CHECKPOINT_INTERVAL_MS = 30000;

// 문제별 풀이 타이머의 파일 저장, legacy migration, checkpoint를 관리합니다.
class TimerManager {
  // VS Code workspaceState와 timer checkpoint 상태를 초기화합니다.
  constructor(context) {
    this.context = context;
    this.runningProblemDir = undefined;
    this.checkpointInterval = undefined;
    this.timerCache = new Map();
  }

  // 현재 문제의 타이머를 읽고 legacy 저장소 값이 있으면 파일 저장소로 옮깁니다.
  async getTimer(problemDir) {
    if (!problemDir) {
      return undefined;
    }
    const cacheKey = this.getCacheKey(problemDir);
    const saved = this.timerCache.get(cacheKey) || await this.readTimer(problemDir);
    const legacy = this.getLegacyTimer(problemDir);
    let timer = saved || legacy;
    if (!saved && legacy) {
      timer = this.stopAndSettleTimer(this.normalizeTimer(legacy, problemDir));
      await this.writeTimer(problemDir, timer);
      await this.deleteLegacyTimer(problemDir);
    }
    let normalized = this.normalizeTimer(timer, problemDir);
    if (normalized.isRunning && this.runningProblemDir !== problemDir) {
      normalized = this.stopAndSettleTimer(normalized, normalized.updatedAt);
      await this.writeTimer(problemDir, normalized);
    }
    if (normalized.isRunning) {
      this.runningProblemDir = problemDir;
    }
    this.timerCache.set(cacheKey, this.toStoredTimer(normalized));
    return normalized;
  }

  // 문제별 타이머를 running 상태로 전환하고 checkpoint를 시작합니다.
  async start(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    if (this.runningProblemDir && this.runningProblemDir !== problemDir) {
      await this.pause(this.runningProblemDir);
    }

    const now = Date.now();
    const timer = this.normalizeTimer(await this.getTimer(problemDir), problemDir);
    const next = {
      ...timer,
      isRunning: true,
      startedAt: timer.isRunning && timer.startedAt ? timer.startedAt : now,
      updatedAt: now,
    };
    this.runningProblemDir = problemDir;
    await this.writeTimer(problemDir, next);
    this.startCheckpointInterval();
    return next;
  }

  // 실행 중인 문제 타이머를 멈추고 누적 시간을 저장합니다.
  async pause(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const timer = this.normalizeTimer(await this.getTimer(problemDir), problemDir);
    const next = this.stopAndSettleTimer(timer);
    if (this.runningProblemDir === problemDir) {
      this.runningProblemDir = undefined;
      this.stopCheckpointInterval();
    }
    await this.writeTimer(problemDir, next);
    return next;
  }

  // 문제 전환 시 이전 문제의 실행 중 타이머를 자동 정산합니다.
  async pauseRunningForProblemSwitch(nextProblemDir) {
    if (this.runningProblemDir && this.runningProblemDir !== nextProblemDir) {
      await this.pause(this.runningProblemDir);
    }
  }

  // extension 종료/정리 시 현재 실행 중인 모든 타이머를 멈춥니다.
  async pauseAllRunning() {
    if (this.runningProblemDir) {
      await this.pause(this.runningProblemDir);
      return;
    }
    this.stopCheckpointInterval();

    const timers = this.getLegacyTimers();
    let changed = false;
    const now = Date.now();
    for (const [problemDir, timer] of Object.entries(timers)) {
      const normalized = this.normalizeTimer(timer, problemDir);
      if (normalized.isRunning) {
        timers[problemDir] = this.stopAndSettleTimer(normalized, now);
        changed = true;
      }
    }
    if (changed) {
      await this.context.workspaceState.update(LEGACY_TIMER_STATE_KEY, timers);
    }
  }

  // 문제별 타이머를 0초, 정지 상태로 초기화합니다.
  async reset(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const previous = this.normalizeTimer(await this.getTimer(problemDir), problemDir);
    const next = {
      ...previous,
      elapsedMs: 0,
      startedAt: null,
      isRunning: false,
      updatedAt: Date.now(),
    };
    if (this.runningProblemDir === problemDir) {
      this.runningProblemDir = undefined;
      this.stopCheckpointInterval();
    }
    await this.writeTimer(problemDir, next);
    return next;
  }

  // 목표 풀이 시간을 분 단위로 저장하고 현재 타이머 상태에 반영합니다.
  async setTarget(problemDir, targetMinutes) {
    if (!problemDir) {
      return undefined;
    }

    const timer = this.normalizeTimer(await this.getTimer(problemDir), problemDir);
    const next = {
      ...timer,
      targetMinutes: normalizeTargetMinutes(targetMinutes),
      updatedAt: Date.now(),
    };
    await this.writeTimer(problemDir, next);
    return next;
  }

  // 문제 helper 영역의 timer.json을 읽습니다.
  async readTimer(problemDir) {
    const timer = await readJson(this.getTimerUri(problemDir));
    return timer && typeof timer === "object" && !Array.isArray(timer) ? timer : undefined;
  }

  // 문제 helper 영역에 timer.json을 저장합니다.
  async writeTimer(problemDir, timer) {
    const uri = this.getTimerUri(problemDir);
    const stored = this.toStoredTimer(timer);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(stored, null, 2) + "\n", "utf8")
    );
    this.timerCache.set(this.getCacheKey(problemDir), stored);
  }

  // 실행 중 타이머를 주기적으로 파일에 반영하는 interval을 시작합니다.
  startCheckpointInterval() {
    this.stopCheckpointInterval();
    this.checkpointInterval = setInterval(() => {
      this.checkpointRunningTimer().catch(() => undefined);
    }, TIMER_CHECKPOINT_INTERVAL_MS);
    if (typeof this.checkpointInterval.unref === "function") {
      this.checkpointInterval.unref();
    }
  }

  // 실행 중 타이머가 없을 때 checkpoint interval을 정리합니다.
  stopCheckpointInterval() {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = undefined;
    }
  }

  // 현재 실행 중인 타이머의 누적 시간을 초 단위로 파일에 반영합니다.
  async checkpointRunningTimer() {
    const problemDir = this.runningProblemDir;
    if (!problemDir) {
      this.stopCheckpointInterval();
      return;
    }

    const timer = this.normalizeTimer(this.timerCache.get(this.getCacheKey(problemDir)) || await this.readTimer(problemDir), problemDir);
    if (!timer.isRunning) {
      this.runningProblemDir = undefined;
      this.stopCheckpointInterval();
      return;
    }

    const now = Date.now();
    const nextElapsedMs = timer.elapsedMs + Math.max(0, now - timer.startedAt);
    const settledElapsedMs = floorToSecondMs(nextElapsedMs);
    const remainderMs = nextElapsedMs - settledElapsedMs;
    await this.writeTimer(problemDir, {
      ...timer,
      elapsedMs: settledElapsedMs,
      startedAt: now - remainderMs,
      isRunning: true,
      updatedAt: now,
    });
  }

  // 문제별 timer.json 파일 URI를 계산합니다.
  getTimerUri(problemDir) {
    return vscode.Uri.file(helperPath(problemDir, "timer.json"));
  }

  getCacheKey(problemDir) {
    return path.resolve(problemDir);
  }

  // 이전 버전 workspaceState에 저장된 전체 timer map을 읽습니다.
  getLegacyTimers() {
    const saved = this.context.workspaceState.get(LEGACY_TIMER_STATE_KEY);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? { ...saved } : {};
  }

  // 특정 문제에 대한 legacy timer 값을 읽습니다.
  getLegacyTimer(problemDir) {
    return this.getLegacyTimers()[problemDir];
  }

  // 파일 저장소로 옮긴 legacy timer 값을 workspaceState에서 제거합니다.
  async deleteLegacyTimer(problemDir) {
    const timers = this.getLegacyTimers();
    if (!Object.prototype.hasOwnProperty.call(timers, problemDir)) {
      return;
    }
    delete timers[problemDir];
    await this.context.workspaceState.update(LEGACY_TIMER_STATE_KEY, timers);
  }

  // 저장된 timer payload를 현재 UI/계산이 기대하는 형태로 정규화합니다.
  normalizeTimer(timer, problemDir) {
    const now = Date.now();
    return {
      problemDir,
      elapsedMs: floorToSecondMs(Math.max(0, Number(timer?.elapsedMs) || 0)),
      startedAt: typeof timer?.startedAt === "number" ? timer.startedAt : null,
      isRunning: Boolean(timer?.isRunning && typeof timer?.startedAt === "number"),
      targetMinutes: normalizeTargetMinutes(timer?.targetMinutes),
      updatedAt: typeof timer?.updatedAt === "number" ? timer.updatedAt : now,
    };
  }

  // 메모리의 timer 상태를 파일에 저장할 최소 payload로 변환합니다.
  toStoredTimer(timer) {
    const normalized = this.normalizeTimer(timer, timer.problemDir);
    return {
      elapsedMs: normalized.elapsedMs,
      startedAt: normalized.startedAt,
      isRunning: normalized.isRunning,
      targetMinutes: normalized.targetMinutes,
      updatedAt: normalized.updatedAt,
    };
  }

  // running timer를 현재 시각 기준으로 정산하고 stopped 상태로 만듭니다.
  stopAndSettleTimer(timer, now = Date.now()) {
    const runningDelta = timer.isRunning && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
    const elapsedMs = floorToSecondMs(timer.elapsedMs + runningDelta);
    return {
      ...timer,
      elapsedMs,
      startedAt: null,
      isRunning: false,
      updatedAt: now,
    };
  }
}

// timer.json을 읽고 없거나 깨져 있으면 undefined로 처리합니다.
async function readJson(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
}

// 목표 시간 입력을 0 이상의 분 단위 숫자로 정리합니다.
function normalizeTargetMinutes(value) {
  const numeric = Number(value);
  return TIMER_TARGETS.includes(numeric) ? numeric : DEFAULT_TARGET_MINUTES;
}

// UI 흔들림을 줄이기 위해 밀리초 값을 초 단위로 내립니다.
function floorToSecondMs(value) {
  return Math.floor(Math.max(0, Number(value) || 0) / 1000) * 1000;
}

module.exports = {
  DEFAULT_TARGET_MINUTES,
  TIMER_TARGETS,
  TimerManager,
};
