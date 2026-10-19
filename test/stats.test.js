import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleConnection, describePath } from '../src/stats.js';

function fakePeerConnection(entries, { iceState = 'connected' } = {}) {
  return {
    iceConnectionState: iceState,
    connectionState: iceState === 'connected' ? 'connected' : iceState,
    getStats: async () => new Map(Object.entries(entries)),
  };
}

const report = {
  inbound: {
    id: 'inbound',
    type: 'inbound-rtp',
    kind: 'video',
    frameWidth: 1280,
    frameHeight: 720,
    framesPerSecond: 29.7,
    packetsReceived: 1000,
    packetsLost: 10,
    jitter: 0.01,
    bytesReceived: 100000,
    freezeCount: 1,
    jitterBufferDelay: 0.5,
    jitterBufferEmittedCount: 20,
  },
  outbound: { id: 'outbound', type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'bandwidth' },
  local: { id: 'local', type: 'local-candidate', candidateType: 'srflx' },
  remote: { id: 'remote', type: 'remote-candidate', candidateType: 'relay' },
  pair: {
    id: 'pair',
    type: 'candidate-pair',
    selected: true,
    currentRoundTripTime: 0.042,
    localCandidateId: 'local',
    remoteCandidateId: 'remote',
  },
};

test('flattens the stats report', async () => {
  const sample = await sampleConnection(fakePeerConnection(report));
  assert.equal(sample.width, 1280);
  assert.equal(sample.height, 720);
  assert.equal(sample.fps, 30);
  assert.equal(sample.packetsReceived, 1000);
  assert.equal(sample.packetsLost, 10);
  assert.equal(sample.lossPct, 1);
  assert.equal(sample.jitterMs, 10);
  assert.equal(sample.jitterBufferMs, 25);
  assert.equal(sample.rttMs, 42);
  assert.equal(sample.qualityLimitation, 'bandwidth');
  assert.equal(sample.localType, 'srflx');
  assert.equal(sample.remoteType, 'relay');
});

test('computes bitrate against the previous sample', async () => {
  let clock = 0;
  const pc = fakePeerConnection(report);
  const previous = { t: 0, bytesReceived: 0 };
  const sample = await sampleConnection(pc, previous, () => {
    clock += 1000;
    return clock;
  });
  assert.equal(sample.bitrateKbps, 800);
});

test('describePath keeps the candidate pair in one token', async () => {
  const sample = await sampleConnection(fakePeerConnection(report));
  assert.equal(describePath(sample), 'srflx -> relay');
});

test('a failing getStats() returns an empty sample instead of throwing', async () => {
  const sample = await sampleConnection({
    iceConnectionState: 'connected',
    connectionState: 'connected',
    getStats: async () => {
      throw new Error('closed');
    },
  });
  assert.equal(sample.fps, null);
  assert.equal(sample.iceState, 'connected');
});
