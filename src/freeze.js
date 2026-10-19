/**
 * Freeze watchdog.
 *
 * `requestVideoFrameCallback` is the only browser API that reports frames the
 * compositor actually produced. ICE state, `currentTime`, and even
 * `getStats().framesPerSecond` can all look healthy while the picture on screen
 * is a still image, so this watches the callback and nothing else, with a
 * polled fallback for browsers that lack it.
 */

function defaultTimer() {
  return {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id),
  };
}

export function watchFrames(video, options = {}) {
  const {
    staleMs = 2000,
    checkMs = 1000,
    onStall = () => {},
    onResume = () => {},
    hasMedia = () => !!video.srcObject,
    now = () => performance.now(),
    timer = defaultTimer(),
  } = options;

  let lastFrameAt = now();
  let stalledSince = null;
  let stopped = false;
  let pollTimer = null;

  const markFrame = () => {
    if (stopped) return;
    lastFrameAt = now();
    if (stalledSince !== null) {
      const stalledForMs = lastFrameAt - stalledSince;
      stalledSince = null;
      onResume({ stalledForMs });
    }
  };

  const useFrameCallback = typeof video.requestVideoFrameCallback === 'function';
  if (useFrameCallback) {
    const tick = () => {
      markFrame();
      if (!stopped) video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  } else {
    // Without the callback, a moving currentTime is the closest available proxy.
    let lastTime = video.currentTime;
    const poll = () => {
      pollTimer = null;
      if (stopped) return;
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        markFrame();
      }
      pollTimer = timer.set(poll, checkMs);
    };
    pollTimer = timer.set(poll, checkMs);
  }

  let watchdog = null;
  const check = () => {
    watchdog = null;
    if (stopped) return;
    // Before there is media there is nothing to judge; a viewer that has not
    // connected yet would otherwise be reported frozen on every page load.
    if (hasMedia() && stalledSince === null && now() - lastFrameAt > staleMs) {
      stalledSince = lastFrameAt;
      onStall({ idleMs: now() - lastFrameAt });
    }
    watchdog = timer.set(check, checkMs);
  };
  watchdog = timer.set(check, checkMs);

  return {
    stop() {
      stopped = true;
      if (watchdog !== null) timer.clear(watchdog);
      if (pollTimer !== null) timer.clear(pollTimer);
      watchdog = null;
      pollTimer = null;
    },
    isStalled() {
      return stalledSince !== null;
    },
    lastFrameAt() {
      return lastFrameAt;
    },
    /** Called on teardown so the next session does not inherit a stale clock. */
    reset() {
      lastFrameAt = now();
      stalledSince = null;
    },
  };
}
