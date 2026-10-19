import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, Severity } from '../src/diagnose.js';

const healthy = { iceState: 'connected', width: 1280, fps: 30, lossPct: 0.2, remoteType: 'srflx' };

test('healthy session', () => {
  assert.equal(diagnose(healthy).code, 'healthy');
  assert.equal(diagnose(healthy).severity, Severity.OK);
});

test('a failed transport outranks every number in the sample', () => {
  const result = diagnose({ ...healthy, iceState: 'failed', lossPct: 40, fps: 0 });
  assert.equal(result.code, 'ice-failed');
  assert.equal(result.severity, Severity.BAD);
});

test('stall beats a cheerful fps reading', () => {
  assert.equal(diagnose(healthy, { stalled: true }).code, 'frozen');
});

test('loss is graded', () => {
  assert.equal(diagnose({ ...healthy, lossPct: 6 }).severity, Severity.WARN);
  assert.equal(diagnose({ ...healthy, lossPct: 15 }).severity, Severity.BAD);
});

test('sender-side limits are reported', () => {
  assert.equal(diagnose({ ...healthy, qualityLimitation: 'bandwidth' }).code, 'bandwidth-limited');
  assert.equal(diagnose({ ...healthy, qualityLimitation: 'cpu' }).code, 'cpu-limited');
});

test('connected with no frame dimensions is not called healthy', () => {
  assert.equal(diagnose({ ...healthy, width: 0 }).code, 'no-picture');
});

test('a relay path is reported but not treated as a failure', () => {
  const result = diagnose({ ...healthy, remoteType: 'relay' });
  assert.equal(result.code, 'relay');
  assert.equal(result.severity, Severity.OK);
});

test('an empty sample is unknown, not healthy', () => {
  assert.equal(diagnose({}).code, 'unknown');
});
