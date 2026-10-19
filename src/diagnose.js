export const Severity = {
  OK: 'ok',
  WARN: 'warn',
  BAD: 'bad',
};

/**
 * Turn one stats sample plus a freeze verdict into one plain-English reason.
 *
 * The value here is the order of the checks. A session with 20% packet loss and
 * a failed ICE transport has one useful thing to say, and it is not the loss
 * number: the transport is gone, and loss is a symptom of that.
 *
 * @param {object} sample  flat stats, see sampleConnection()
 * @param {{stalled?: boolean}} [options]
 * @returns {{code: string, severity: string, text: string}}
 */
export function diagnose(sample = {}, { stalled = false } = {}) {
  const s = sample;

  if (s.iceState === 'failed' || s.iceState === 'closed' || s.connectionState === 'failed') {
    return {
      code: 'ice-failed',
      severity: Severity.BAD,
      text: 'The media transport failed. If UDP is blocked on this network, a TURN relay over TCP 443 is the only thing that will work.',
    };
  }

  if (stalled) {
    return {
      code: 'frozen',
      severity: Severity.BAD,
      text: 'Connected, but no new frames. The transport can stay up while the picture is stuck, so this is a stall, not a network drop - ask the publisher for a keyframe or restart the session.',
    };
  }

  if (s.lossPct != null && s.lossPct >= 5) {
    return {
      code: 'packet-loss',
      severity: s.lossPct >= 12 ? Severity.BAD : Severity.WARN,
      text:
        'Losing ' + s.lossPct + '% of packets. Lower the bitrate or resolution before assuming the network is broken - loss this high usually means the link is saturated.',
    };
  }

  if (s.jitterBufferMs != null && s.jitterBufferMs >= 400) {
    return {
      code: 'jitter-buffer',
      severity: Severity.WARN,
      text:
        'The jitter buffer is holding ' + s.jitterBufferMs + 'ms of video. Playback stays smooth but grows further behind live; the network is delivering frames unevenly.',
    };
  }

  if (s.qualityLimitation === 'bandwidth') {
    return {
      code: 'bandwidth-limited',
      severity: Severity.WARN,
      text: 'The sender is capping quality because the uplink cannot carry more. The picture will stay up but softer.',
    };
  }

  if (s.qualityLimitation === 'cpu') {
    return {
      code: 'cpu-limited',
      severity: Severity.WARN,
      text: 'The sender is capping quality because encoding is CPU-bound. Nothing on the network side will fix this.',
    };
  }

  if (s.width === 0) {
    return {
      code: 'no-picture',
      severity: Severity.WARN,
      text: 'Signaling is up but no video has arrived yet. Usually this is a wait for the first keyframe, or a firewall dropping the media UDP range.',
    };
  }

  if (s.remoteType === 'relay') {
    return {
      code: 'relay',
      severity: Severity.OK,
      text: 'Media is going through a TURN relay. It works, but it adds a hop - direct or STUN would be cheaper and lower latency.',
    };
  }

  if (s.fps == null && s.bitrateKbps == null) {
    return {
      code: 'unknown',
      severity: Severity.OK,
      text: 'No media statistics yet.',
    };
  }

  return {
    code: 'healthy',
    severity: Severity.OK,
    text: 'Frames are flowing' + (s.fps != null ? ' at ' + s.fps + ' fps' : '') + '.',
  };
}
