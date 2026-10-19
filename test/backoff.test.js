import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackoff } from '../src/backoff.js';

test('doubles the ceiling and then caps it', () => {
  const backoff = createBackoff({ baseMs: 500, capMs: 8000, random: () => 0.5 });
  assert.deepEqual(
    [backoff.next(), backoff.next(), backoff.next(), backoff.next(), backoff.next(), backoff.next()],
    [375, 750, 1500, 3000, 6000, 6000],
  );
});

test('stays inside the jitter window', () => {
  const low = createBackoff({ baseMs: 100, random: () => 0 });
  const high = createBackoff({ baseMs: 100, random: () => 1 });
  assert.equal(low.next(), 50);
  assert.equal(high.next(), 100);
});

test('never returns zero, so a retry storm cannot start at T=0', () => {
  const backoff = createBackoff({ baseMs: 1, random: () => 0 });
  for (let i = 0; i < 10; i += 1) assert.ok(backoff.next() >= 1);
});

test('reset returns to the first ceiling', () => {
  const backoff = createBackoff({ baseMs: 100, random: () => 1 });
  backoff.next();
  backoff.next();
  backoff.reset();
  assert.equal(backoff.attempt, 0);
  assert.equal(backoff.next(), 100);
});
