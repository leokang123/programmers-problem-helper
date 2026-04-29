const TIMER_STATE_KEY = "problemTimers";
const TIMER_TARGETS = [30, 60, 90, 120];
const DEFAULT_TARGET_MINUTES = 60;

class TimerManager {
  constructor(context) {
    this.context = context;
  }

  getTimer(problemDir) {
    if (!problemDir) {
      return undefined;
    }
    return this.normalizeTimer(this.getTimers()[problemDir], problemDir);
  }

  async start(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const timers = this.getTimers();
    const now = Date.now();
    const timer = this.normalizeTimer(timers[problemDir], problemDir);

    for (const key of Object.keys(timers)) {
      if (key !== problemDir) {
        timers[key] = this.stopAndSettleTimer(this.normalizeTimer(timers[key], key), now);
      }
    }

    timers[problemDir] = {
      ...timer,
      isRunning: true,
      startedAt: timer.isRunning && timer.startedAt ? timer.startedAt : now,
      updatedAt: now,
    };
    await this.saveTimers(timers);
    return timers[problemDir];
  }

  async pause(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const timers = this.getTimers();
    const timer = this.normalizeTimer(timers[problemDir], problemDir);
    timers[problemDir] = this.stopAndSettleTimer(timer);
    await this.saveTimers(timers);
    return timers[problemDir];
  }

  async pauseRunningForProblemSwitch(nextProblemDir) {
    const timers = this.getTimers();
    let changed = false;
    const now = Date.now();
    for (const key of Object.keys(timers)) {
      const timer = this.normalizeTimer(timers[key], key);
      if (timer.isRunning && key !== nextProblemDir) {
        timers[key] = this.stopAndSettleTimer(timer, now);
        changed = true;
      }
    }
    if (changed) {
      await this.saveTimers(timers);
    }
  }

  async pauseAllRunning() {
    const timers = this.getTimers();
    let changed = false;
    const now = Date.now();
    for (const key of Object.keys(timers)) {
      const timer = this.normalizeTimer(timers[key], key);
      if (timer.isRunning) {
        timers[key] = this.stopAndSettleTimer(timer, now);
        changed = true;
      }
    }
    if (changed) {
      await this.saveTimers(timers);
    }
  }

  async reset(problemDir) {
    if (!problemDir) {
      return undefined;
    }

    const timers = this.getTimers();
    const previous = this.normalizeTimer(timers[problemDir], problemDir);
    timers[problemDir] = {
      ...previous,
      elapsedMs: 0,
      startedAt: null,
      isRunning: false,
      updatedAt: Date.now(),
    };
    await this.saveTimers(timers);
    return timers[problemDir];
  }

  async setTarget(problemDir, targetMinutes) {
    if (!problemDir) {
      return undefined;
    }

    const timers = this.getTimers();
    const timer = this.normalizeTimer(timers[problemDir], problemDir);
    timers[problemDir] = {
      ...timer,
      targetMinutes: normalizeTargetMinutes(targetMinutes),
      updatedAt: Date.now(),
    };
    await this.saveTimers(timers);
    return timers[problemDir];
  }

  getTimers() {
    const saved = this.context.workspaceState.get(TIMER_STATE_KEY);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? { ...saved } : {};
  }

  async saveTimers(timers) {
    await this.context.workspaceState.update(TIMER_STATE_KEY, timers);
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

function normalizeTargetMinutes(value) {
  const numeric = Number(value);
  return TIMER_TARGETS.includes(numeric) ? numeric : DEFAULT_TARGET_MINUTES;
}

module.exports = {
  DEFAULT_TARGET_MINUTES,
  TIMER_TARGETS,
  TimerManager,
};
