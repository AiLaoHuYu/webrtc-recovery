# webrtc-recovery

Your viewer says `connected`. The picture is a still image.

`iceConnectionState === 'connected'` means a usable candidate pair exists. It does not
mean frames are arriving, and it does not mean the viewer is watching anything. A track
can be live and frozen for minutes while every state field reads healthy.

This package treats "frames are advancing" as the only proof of health, and spends
recovery effort in the order that costs the least:

```
1. ICE restart     same session, renegotiated candidates
       no frames within restartDeadlineMs (5s)
2. full rejoin     new socket -> new offer -> new PeerConnection
       no frames within rejoinDeadlineMs (8s)
3. backoff, then 2 equal jitter, exponential ceiling
       until maxRejoins, then "gaveup"
```

Zero dependencies. The state machine takes an injected clock, so every branch above is
covered by a test that runs in milliseconds.

## Install

```bash
npm install webrtc-recovery
```

ESM only. Node 18+ or any current browser.

## Quick start

```js
import { createRecoveryLadder, watchFrames } from 'webrtc-recovery';

const ladder = createRecoveryLadder({
  restart: () => signaling.send({ type: 'restart' }),
  rejoin: () => {
    pc.close();
    pc = null;
    signaling.reconnect();
  },
  onEvent: (e) => console.log('[recovery]', e.type, e.reason || ''),
});

pc.oniceconnectionstatechange = () => ladder.onIceState(pc.iceConnectionState);

watchFrames(video, {
  onStall: () => ladder.onIceState('failed'),
  onResume: () => ladder.markHealthy(),
});

video.requestVideoFrameCallback(function tick() {
  ladder.markHealthy('frame');
  video.requestVideoFrameCallback(tick);
});
```

`ladder.markHealthy()` is the only call that ends escalation. Nothing else clears the
restart deadline, on purpose.

## Why this order

**ICE restart first.** It reuses the existing `RTCPeerConnection` and the existing media
tracks. When a laptop changes Wi-Fi networks, that is nearly always enough, and it
recovers in about a second instead of rebuilding everything.

**Full rejoin second.** A rejoin throws away the socket, the offer and the peer
connection. It fixes the class of failure an ICE restart cannot: a server-side session
that went stale, a signaling socket that reconnected into a room the server no longer
knows about, or a publisher that republished.

**Backoff after that.** Repeat rejoins are the only step that can turn a client bug or a
dead server into a retry storm. The delay is exponential with equal jitter, and it never
returns zero.

## API

### `createRecoveryLadder(options)`

| Option | Default | Why that value |
|---|---|---|
| `restart` | required | Sends your ICE restart request. |
| `rejoin` | required | Tears down and re-opens the session. |
| `graceMs` | `2500` | `disconnected` is often transient; a short blip should not cost a restart. |
| `restartDeadlineMs` | `5000` | If no frame arrives in five seconds, the restart did not work. |
| `rejoinDeadlineMs` | `8000` | Allows for signaling reconnect plus a new offer and answer. |
| `maxRejoins` | `Infinity` | Set it when the UI should stop trying and offer a button instead. |
| `backoff` | `createBackoff()` | Replaceable. |
| `timer` | real timers | Inject a fake clock in tests. |
| `onEvent` | no-op | Observability. Exceptions thrown here are swallowed. |

Returns `{ onIceState, markHealthy, kick, stop, state, rejoins }`.

Events: `restart`, `rejoin`, `backoff`, `recovered`, `gaveup`, `error`.

### `watchFrames(video, options)`

Watches `requestVideoFrameCallback` and reports a stall when no frame has rendered for
`staleMs` (default `2000`). Falls back to polling `currentTime` where the callback is
missing. It reports a stall once, not once per tick, and reports how long it lasted when
frames come back.

Returns `{ stop, reset, isStalled, lastFrameAt }`.

Nothing is reported before `video.srcObject` is set. A viewer that has not connected yet
is not frozen, it is empty.

### `diagnose(sample, options)`

Turns one stats sample into one sentence. The check order is the point: a session with a
dead transport and 40% packet loss has one useful thing to say, and it is not the loss
number.

| Code | Severity | Fires when |
|---|---|---|
| `ice-failed` | bad | `iceState` is `failed`/`closed`, or `connectionState` is `failed` |
| `frozen` | bad | The frame watchdog says nothing is rendering |
| `packet-loss` | warn/bad | 5% loss, or 12% and above |
| `jitter-buffer` | warn | The receive buffer holds 400ms or more |
| `bandwidth-limited` | warn | The sender reports a bandwidth cap |
| `cpu-limited` | warn | The sender reports a CPU cap |
| `no-picture` | warn | Signaling is up but no frame dimensions have arrived |
| `relay` | ok | Media is relayed through TURN; it works, it costs a hop |
| `healthy` | ok | Frames are flowing |
| `unknown` | ok | No media statistics yet |

### `sampleConnection(pc, previous)`

Flattens `getStats()` into one object and computes bitrate and loss from the previous
sample. `describePath(sample)` returns the selected candidate pair as `srflx -> relay`.

### `createBackoff({ baseMs, capMs, random })`

Exponential ceiling, equal jitter. `next()` never returns zero: full jitter looks fairer
but lets a share of viewers retry at almost T=0 together, which is the spike jitter
exists to prevent.

## What it does not do

- It does not decide when a session is broken at the transport level; feed it your
  `iceconnectionstatechange` events.
- It does not renegotiate media or handle codec changes. That belongs to `rejoin`.
- It does not render anything. `diagnose()` returns text; where it goes is yours.

## Worth reading

The defaults here come from a viewer that runs in production, and the two failure
patterns that shaped them are written up at:

- <https://lowlatencykit.com/guides/frozen-video-ice-restart-ladder/>
- <https://lowlatencykit.com/guides/webrtc-getstats-six-numbers/>

If you would rather not assemble the other half - signaling, the SFU, the publisher and
the viewer - that is what <https://lowlatencykit.com> is.

## License

MIT.
