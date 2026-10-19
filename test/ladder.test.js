import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryLadder, LadderState } from '../src/ladder.js';
import { createClock } from './helpers/clock.js';

function setup(overrides = {}) {
  const clock = createClock();
  const events = [];
  const calls = { restart: 0, rejoin: 0 };
  const ladder = createRecoveryLadder({
    restart: () => {
      calls.restart += 1;
    },
    rejoin: () => {
      calls.rejoin += 1;
    },
    timer: clock.timer,
    onEvent: (e) => events.push(e),
    ...overrides,
  });
  return { clock, ladder, events, calls };
}

test('a short disconnected blip that clears inside the grace window does nothing', () => {
  const { clock, ladder, calls } = setup();
  ladder.onIceState('disconnected');
  clock.advance(1000);
  ladder.markHealthy('frames resumed');
  clock.advance(10000);
  assert.equal(calls.restart, 0);
  assert.equal(ladder.state, LadderState.CONNECTED);
});

test('disconnected past the grace window triggers exactly one restart', () => {
  const { clock, ladder, calls, events } = setup();
  ladder.onIceState('disconnected');
  clock.advance(2500);
  assert.equal(calls.restart, 1);
  assert.equal(ladder.state, LadderState.RESTARTING);
  assert.equal(events.filter((e) => e.type === 'restart').length, 1);
});

test('failed escalates without waiting for the grace window', () => {
  const { ladder, calls } = setup();
  ladder.onIceState('failed');
  assert.equal(calls.restart, 1);
});

test('a restart that produces no frames falls back to a full rejoin', () => {
  const { clock, ladder, calls } = setup();
  ladder.onIceState('failed');
  clock.advance(5000);
  assert.equal(calls.rejoin, 1);
  assert.equal(ladder.state, LadderState.REJOINING);
});

test('frames arriving inside the restart deadline end escalation', () => {
  const { clock, ladder, calls, events } = setup();
  ladder.onIceState('failed');
  clock.advance(2000);
  ladder.markHealthy('frames');
  clock.advance(60000);
  assert.equal(calls.rejoin, 0);
  assert.equal(events.filter((e) => e.type === 'recovered')[0].via, LadderState.RESTARTING);
});

test('a rejoin that still has no frames backs off and tries again', () => {
  const { clock, ladder, calls, events } = setup({ backoff: { next: () => 1000, reset() {} } });
  ladder.onIceState('failed');
  clock.advance(5000);
  assert.equal(calls.rejoin, 1);
  clock.advance(8000);
  assert.equal(events.filter((e) => e.type === 'backoff').length, 1);
  clock.advance(1000);
  assert.equal(calls.rejoin, 2);
});

test('gives up after maxRejoins instead of looping forever', () => {
  const { clock, ladder, events } = setup({ maxRejoins: 2, backoff: { next: () => 500, reset() {} } });
  ladder.onIceState('failed');
  clock.advance(5000);
  clock.advance(8000 + 500);
  clock.advance(8000 + 500);
  assert.equal(ladder.state, LadderState.GAVE_UP);
  assert.equal(events.filter((e) => e.type === 'gaveup').length, 1);
  assert.equal(ladder.rejoins, 2);
});

test('recovery resets the attempt counter', () => {
  const { clock, ladder } = setup({ backoff: { next: () => 500, reset() {} } });
  ladder.onIceState('failed');
  clock.advance(5000);
  ladder.markHealthy('frames');
  assert.equal(ladder.rejoins, 0);
  assert.equal(ladder.state, LadderState.CONNECTED);
});

test('stop() cancels every pending timer', () => {
  const { clock, ladder, calls } = setup();
  ladder.onIceState('disconnected');
  ladder.stop();
  clock.advance(60000);
  assert.equal(calls.restart, 0);
  assert.equal(clock.pending(), 0);
});

test('an observer that throws cannot stall recovery', () => {
  const clock = createClock();
  let restarts = 0;
  const ladder = createRecoveryLadder({
    restart: () => {
      restarts += 1;
    },
    rejoin: () => {},
    timer: clock.timer,
    onEvent: () => {
      throw new Error('observer bug');
    },
  });
  ladder.onIceState('failed');
  assert.equal(restarts, 1);
});

test('kick() escalates a session that claims to be connected', () => {
  const { ladder, calls } = setup();
  ladder.kick('user pressed reconnect');
  assert.equal(calls.restart, 1);
});
