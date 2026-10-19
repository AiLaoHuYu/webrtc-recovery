/**
 * Wiring a viewer to the ladder, end to end. This is the shape to copy; the
 * signaling client and the server are yours.
 */
import { createRecoveryLadder, watchFrames, sampleConnection, diagnose } from 'webrtc-recovery';

export function attachViewer({ video, signaling, room, onDiagnosis }) {
  let pc = null;
  let previous = null;
  let iceServers = [];

  const ladder = createRecoveryLadder({
    restart: () => signaling.send({ type: 'restart' }),
    rejoin: () => {
      if (pc) {
        pc.close();
        pc = null;
      }
      video.srcObject = null;
      previous = null;
      frames.reset();
      signaling.reconnect();
    },
    maxRejoins: 6,
    onEvent: (event) => {
      if (event.type === 'gaveup') onDiagnosis({ code: 'gaveup', severity: 'bad', text: 'Could not reconnect. Reload the page.' });
    },
  });

  const frames = watchFrames(video, {
    onStall: () => ladder.onIceState('failed'),
    onResume: () => ladder.markHealthy(),
  });

  function createPeerConnection() {
    const connection = new RTCPeerConnection({ iceServers });

    connection.onicecandidate = (event) => {
      if (event.candidate) signaling.send({ type: 'candidate', candidate: event.candidate.toJSON() });
    };

    connection.ontrack = (event) => {
      // event.streams can be empty after a renegotiation, so build the stream
      // from the track itself when that happens.
      const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
    };

    connection.oniceconnectionstatechange = () => ladder.onIceState(connection.iceConnectionState);
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') ladder.onIceState('failed');
    };

    return connection;
  }

  async function onOffer(sdp) {
    if (!pc) pc = createPeerConnection();
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    signaling.send({ type: 'answer', sdp: pc.localDescription.sdp });
  }

  async function onMessage(message) {
    switch (message.type) {
      case 'welcome':
        iceServers = (message.iceConfig && message.iceConfig.iceServers) || [];
        break;
      case 'offer':
        await onOffer(message.sdp);
        break;
      case 'answer':
        if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        break;
      case 'candidate':
        if (pc && message.candidate) await pc.addIceCandidate(message.candidate).catch(() => {});
        break;
      case 'publisher':
        if (!message.live) {
          if (pc) {
            pc.close();
            pc = null;
          }
          video.srcObject = null;
          previous = null;
          frames.reset();
        }
        break;
      default:
        break;
    }
  }

  // Frames are the only signal that clears the ladder; the stats sample is only
  // there to produce a sentence for the operator.
  const ticker = setInterval(async () => {
    if (!pc) return;
    const sample = await sampleConnection(pc, previous);
    previous = sample;
    onDiagnosis(diagnose(sample, { stalled: frames.isStalled() }));
  }, 1000);

  return {
    onMessage,
    room,
    stop() {
      clearInterval(ticker);
      frames.stop();
      ladder.stop();
      if (pc) pc.close();
    },
  };
}
