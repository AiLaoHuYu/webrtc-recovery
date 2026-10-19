/** Deterministic clock: timers only fire when the test advances time. */
export function createClock() {
  let now = 0;
  let seq = 0;
  const tasks = new Map();

  return {
    now: () => now,
    timer: {
      set(fn, ms) {
        const id = ++seq;
        tasks.set(id, { at: now + ms, fn });
        return id;
      },
      clear(id) {
        tasks.delete(id);
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextTask = null;
        for (const [id, task] of tasks) {
          if (task.at <= target && (nextTask === null || task.at < nextTask.at)) {
            nextId = id;
            nextTask = task;
          }
        }
        if (nextTask === null) break;
        tasks.delete(nextId);
        now = nextTask.at;
        nextTask.fn();
      }
      now = target;
    },
    pending: () => tasks.size,
  };
}
