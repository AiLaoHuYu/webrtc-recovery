import { createBackoff } from './backoff.js';

/**
 * Recovery ladder for a WebRTC viewer.
 *
 * The problem this exists for: `iceConnectionState === 'connected'` does not
 * mean the viewer is seeing video. A candidate pair can be nominally usable
 * while delivering nothing, and a track can be live and frozen. In this module
 * "healthy" has exactly one meaning - frames are advancing - and every other
 * signal is treated as a guess.
 *
 * Escalation order:
 *   1. ICE restart      cheap; same session, renegotiated candidates
 *   2. full rejoin      new signaling socket, new offer, new PeerConnection
 *   3. repeat 2         with backoff, until it recovers or the caller stops it
 */

export const LadderState = {
  CONNECTED: 'connected',
  RESTARTING: 'restarting',
  REJOINING: 'rejoining',
  GAVE_UP: 'gaveup',
  STOPPED: 'stopped',
};

const defaultTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

export function createRecoveryLadder({
  restart,
  rejoin,
  backoff = createBackoff(),
  graceMs = 2500,
  restartDeadlineMs = 5000,
  rejoinDeadlineMs = 8000,
  maxRejoins = Infinity,
  timer = defaultTimer,
  onEvent = () => {},
} = {}) {
  if (typeof restart !== 'function') throw new TypeError('restart must be a function');
  if (typeof rejoin !== 'function') throw new TypeError('rejoin must be a function');

  let state = LadderState.CONNECTED;
  let stopped = false;
  let rejoins = 0;
  // One slot is enough: a grace timer, a restart deadline, a rejoin deadline and
  // a backoff wait can never be pending at the same time.
  let pending = null;

  // An observer that throws must not stall recovery, so this swallows by design.
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      /* ignore */
    }
  };

  function clearPending() {
    if (pending !== null) {
      timer.clear(pending);
      pending = null;
    }
  }

  function startRestart(reason) {
    if (stopped || state === LadderState.RESTARTING) return;
    clearPending();
    state = LadderState.RESTARTING;
    emit({ type: 'restart', reason });
    try {
      restart(reason);
    } catch (error) {
      emit({ type: 'error', stage: 'restart', error });
    }
    pending = timer.set(() => {
      pending = null;
      if (state === LadderState.RESTARTING) startRejoin('restart did not recover in ' + restartDeadlineMs + 'ms');
    }, restartDeadlineMs);
  }

  function startRejoin(reason) {
    if (stopped) return;
    clearPending();

    if (rejoins >= maxRejoins) {
      state = LadderState.GAVE_UP;
      emit({ type: 'gaveup', reason, attempts: rejoins });
      return;
    }

    rejoins += 1;
    state = LadderState.REJOINING;
    emit({ type: 'rejoin', attempt: rejoins, reason });
    try {
      rejoin(reason, rejoins);
    } catch (error) {
      emit({ type: 'error', stage: 'rejoin', error });
    }

    const onDeadline = () => {
      pending = null;
      if (state !== LadderState.REJOINING) return;
      const delayMs = backoff.next();
      emit({ type: 'backoff', attempt: rejoins + 1, delayMs });
      pending = timer.set(() => {
        pending = null;
        if (state === LadderState.REJOINING) startRejoin('still no frames');
      }, delayMs);
    };
    pending = timer.set(onDeadline, rejoinDeadlineMs);
  }

  return {
    /**
     * Feed iceConnectionState here. 'disconnected' is given graceMs to clear on
     * its own, because it is frequently transient; 'failed'/'closed' escalate
     * immediately.
     */
    onIceState(iceState) {
      if (stopped) return;
      if (iceState === 'failed' || iceState === 'closed') {
        startRestart('ice ' + iceState);
        return;
      }
      if (iceState === 'disconnected') {
        if (pending !== null) return;
        pending = timer.set(() => {
          pending = null;
          startRestart('ice stayed disconnected for ' + graceMs + 'ms');
        }, graceMs);
        return;
      }
      if (iceState === 'connected' || iceState === 'completed') {
        // Reachable again, but that is not proof of pictures. Only frames clear
        // the restart deadline.
        if (state === LadderState.CONNECTED) clearPending();
      }
    },

    /** Call whenever a frame renders. This is the only signal that ends escalation. */
    markHealthy(reason = 'frames') {
      if (stopped) return;
      const was = state;
      clearPending();
      state = LadderState.CONNECTED;
      rejoins = 0;
      backoff.reset();
      if (was !== LadderState.CONNECTED) emit({ type: 'recovered', via: was, reason });
    },

    /** Manual recovery, e.g. a "reconnect" button. */
    kick(reason = 'manual') {
      if (stopped) return;
      state = LadderState.CONNECTED;
      startRestart(reason);
    },

    stop() {
      stopped = true;
      clearPending();
      state = LadderState.STOPPED;
    },

    get state() {
      return state;
    },

    get rejoins() {
      return rejoins;
    },
  };
}
