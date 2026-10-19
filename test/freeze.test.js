import test from 'node:test';
import assert from 'node:assert/strict';
import { watchFrames } from '../src/freeze.js';
import { createClock } from './helpers/clock.js';

function fakeVideo({ withCallback = true } = {}) {
  const callbacks = [];
  const video = { srcObject: {}, currentTime: 0 };
  if (withCallback) {
    video.requestVideoFrameCallback = (cb) => {
      callbacks.push(cb);
    };
    video.emitFrame = () => {
      const cb = callbacks.shift();
      if (cb) cb(0, {});
    };
  }
  return video;
}

test('reports a stall once frames stop', () => {
  const clock = createClock();
  const video = fakeVideo();
  const stalls = [];
  const watch = watchFrames(video, {
    staleMs: 2000,
    now: clock.now,
    timer: clock.timer,
    onStall: (e) => stalls.push(e),
  });

  clock.advance(1000);
  assert.equal(stalls.length, 0, 'one second of silence is not a stall');
  clock.advance(2500);
  assert.equal(stalls.length, 1);
  assert.equal(watch.isStalled(), true);

  clock.advance(5000);
  assert.equal(stalls.length, 1, 'a stall is reported once, not once per tick');
  watch.stop();
});

test('a frame clears the stall and reports how long it lasted', () => {
  const clock = createClock();
  const video = fakeVideo();
  const resumes = [];
  const watch = watchFrames(video, {
    staleMs: 2000,
    now: clock.now,
    timer: clock.timer,
    onResume: (e) => resumes.push(e),
  });

  clock.advance(4000);
  assert.equal(watch.isStalled(), true);
  clock.advance(1000);
  video.emitFrame();
  assert.equal(watch.isStalled(), false);
  assert.equal(resumes.length, 1);
  assert.ok(resumes[0].stalledForMs >= 4000);
  watch.stop();
});

test('nothing is judged before media is attached', () => {
  const clock = createClock();
  const video = fakeVideo();
  video.srcObject = null;
  const stalls = [];
  const watch = watchFrames(video, {
    staleMs: 1000,
    now: clock.now,
    timer: clock.timer,
    onStall: () => stalls.push(1),
  });
  clock.advance(30000);
  assert.equal(stalls.length, 0);
  watch.stop();
});

test('falls back to currentTime when requestVideoFrameCallback is missing', () => {
  const clock = createClock();
  const video = fakeVideo({ withCallback: false });
  const stalls = [];
  const watch = watchFrames(video, {
    staleMs: 2000,
    now: clock.now,
    timer: clock.timer,
    onStall: () => stalls.push(1),
  });

  for (let i = 0; i < 6; i += 1) {
    video.currentTime += 0.04;
    clock.advance(1000);
  }
  assert.equal(stalls.length, 0, 'advancing currentTime counts as frames');

  clock.advance(4000);
  assert.equal(stalls.length, 1);
  watch.stop();
});

test('stop() clears the watchdog', () => {
  const clock = createClock();
  const watch = watchFrames(fakeVideo(), { now: clock.now, timer: clock.timer });
  watch.stop();
  assert.equal(clock.pending(), 0);
});
