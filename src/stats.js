/**
 * getStats() -> one flat sample. Pass the previous sample back in to get rates.
 *
 * Flat on purpose: a sample is meant to be logged, compared and handed to
 * diagnose() without the caller knowing anything about the spec's object graph.
 */
export async function sampleConnection(pc, prev = null, now = () => performance.now()) {
  const t = now();
  const out = {
    t,
    iceState: pc.iceConnectionState,
    connectionState: pc.connectionState,
    bitrateKbps: null,
    width: 0,
    height: 0,
    fps: null,
    packetsReceived: null,
    packetsLost: null,
    lossPct: null,
    jitterMs: null,
    jitterBufferMs: null,
    rttMs: null,
    freezeCount: null,
    qualityLimitation: null,
    localType: null,
    remoteType: null,
    bytesReceived: null,
  };

  let report;
  try {
    report = await pc.getStats();
  } catch {
    return out;
  }

  const candidates = new Map();
  let pair = null;

  report.forEach((r) => {
    if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
      candidates.set(r.id, r);
    }
    if (r.type === 'candidate-pair' && (r.selected || r.state === 'succeeded') && r.currentRoundTripTime != null) {
      pair = r;
    }
    if (r.type === 'inbound-rtp' && r.kind === 'video') {
      out.width = r.frameWidth || 0;
      out.height = r.frameHeight || 0;
      out.fps = r.framesPerSecond != null ? Math.round(r.framesPerSecond) : null;
      out.packetsReceived = r.packetsReceived != null ? r.packetsReceived : null;
      out.packetsLost = r.packetsLost != null ? r.packetsLost : null;
      out.jitterMs = r.jitter != null ? Math.round(r.jitter * 1000) : null;
      out.freezeCount = r.freezeCount != null ? r.freezeCount : null;
      if (r.jitterBufferDelay != null && r.jitterBufferEmittedCount) {
        out.jitterBufferMs = Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000);
      }
      if (prev && prev.bytesReceived != null && r.bytesReceived != null && t > prev.t) {
        out.bitrateKbps = Math.round(((r.bytesReceived - prev.bytesReceived) * 8) / (t - prev.t));
      }
      out.bytesReceived = r.bytesReceived != null ? r.bytesReceived : null;
    }
    if (r.type === 'outbound-rtp' && r.kind === 'video') {
      out.qualityLimitation = r.qualityLimitationReason || null;
    }
  });

  if (out.packetsReceived != null && out.packetsLost != null) {
    const total = out.packetsReceived + out.packetsLost;
    if (total > 0) out.lossPct = Math.round((out.packetsLost / total) * 1000) / 10;
  }

  if (pair) {
    out.rttMs = Math.round(pair.currentRoundTripTime * 1000);
    const local = candidates.get(pair.localCandidateId);
    const remote = candidates.get(pair.remoteCandidateId);
    out.localType = local ? local.candidateType : null;
    out.remoteType = remote ? remote.candidateType : null;
  }

  return out;
}

/** The selected candidate pair as one token: "srflx -> relay". */
export function describePath(sample) {
  return sample && sample.localType ? sample.localType + ' -> ' + sample.remoteType : '-';
}
