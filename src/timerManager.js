const path = require("path");
const vscode = require("vscode");
const {
  helperPath,
} = require("./helperPaths");

const LEGACY_TIMER_STATE_KEY = "problemTimers";
const TIMER_TARGETS = [20, 30, 60, 90, 120];
const DEFAULT_TARGET_MINUTES = 60;
const TIMER_CHECKPOINT_INTERVAL_MS = 30000;

class TimerManager {
  constructor(context) {
    this.context = context;
    this.runningProblemDir = undefined;
    this.checkpointInterval = undefined;
  }

  async getTimer(problemDir) {
    if (!problemDir) {
      return undefined;
    }
    const saved = await this.readTimer(problemDir);
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
    return normalized;
  }

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

  async pauseRunningForProblemSwitch(nextProblemDir) {
    if (this.runningProblemDir && this.runningProblemDir !== nextProblemDir) {
      await this.pause(this.runningProblemDir);
    }
  }

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

  async readTimer(problemDir) {
    const timer = await readJson(this.getTimerUri(problemDir));
    return timer && typeof timer === "object" && !Array.isArray(timer) ? timer : undefined;
  }

  async writeTimer(problemDir, timer) {
    const uri = this.getTimerUri(problemDir);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(this.toStoredTimer(timer), null, 2) + "\n", "utf8")
    );
  }

  startCheckpointInterval() {
    this.stopCheckpointInterval();
    this.checkpointInterval = setInterval(() => {
      this.checkpointRunningTimer().catch(() => undefined);
    }, TIMER_CHECKPOINT_INTERVAL_MS);
    if (typeof this.checkpointInterval.unref === "function") {
      this.checkpointInterval.unref();
    }
  }

  stopCheckpointInterval() {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = undefined;
    }
  }

  async checkpointRunningTimer() {
    const problemDir = this.runningProblemDir;
    if (!problemDir) {
      this.stopCheckpointInterval();
      return;
    }

    const timer = this.normalizeTimer(await this.readTimer(problemDir), problemDir);
    if (!timer.isRunning) {
      this.runningProblemDir = undefined;
      this.stopCheckpointInterval();
      return;
    }

    const now = Date.now();
    await this.writeTimer(problemDir, {
      ...timer,
      elapsedMs: timer.elapsedMs + Math.max(0, now - timer.startedAt),
      startedAt: now,
      isRunning: true,
      updatedAt: now,
    });
  }

  getTimerUri(problemDir) {
    return vscode.Uri.file(helperPath(problemDir, "timer.json"));
  }

  getLegacyTimers() {
    const saved = this.context.workspaceState.get(LEGACY_TIMER_STATE_KEY);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? { ...saved } : {};
  }

  getLegacyTimer(problemDir) {
    return this.getLegacyTimers()[problemDir];
  }

  async deleteLegacyTimer(problemDir) {
    const timers = this.getLegacyTimers();
    if (!Object.prototype.hasOwnProperty.call(timers, problemDir)) {
      return;
    }
    delete timers[problemDir];
    await this.context.workspaceState.update(LEGACY_TIMER_STATE_KEY, timers);
  }

  normalizeTimer(timer, problemDir) {
    const now = Date.now();
    return {
      problemDir,
      elapsedMs: Math.max(0, Number(timer?.elapsedMs) || 0),
      startedAt: typeof timer?.startedAt === "number" ? timer.startedAt : null,
      isRunning: Boolean(timer?.isRunning && typeof timer?.startedAt === "number"),
      targetMinutes: normalizeTargetMinutes(timer?.targetMinutes),
      updatedAt: typeof timer?.updatedAt === "number" ? timer.updatedAt : now,
    };
  }

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

  stopAndSettleTimer(timer, now = Date.now()) {
    const runningDelta = timer.isRunning && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
    return {
      ...timer,
      elapsedMs: timer.elapsedMs + runningDelta,
      startedAt: null,
      isRunning: false,
      updatedAt: now,
    };
  }
}

async function readJson(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
}

function normalizeTargetMinutes(value) {
  const numeric = Number(value);
  return TIMER_TARGETS.includes(numeric) ? numeric : DEFAULT_TARGET_MINUTES;
}

module.exports = {
  DEFAULT_TARGET_MINUTES,
  TIMER_TARGETS,
  TimerManager,
};
