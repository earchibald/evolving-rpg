/**
 * The witness: the microphone that listens while you play.
 *
 * Toggled by the indicator in the header (and its key). While live, every
 * Float32 chunk off an AudioWorklet is kept and counted — the sample count
 * IS the audio clock, so a trace mark knows exactly how many milliseconds
 * into the take it fell. Stopping encodes a 16-bit mono WAV client-side and
 * posts it to the dev server, which transcribes it locally.
 *
 * The trace runs whether or not the mic does: actions and journal lines are
 * marked with wall clocks always, so the listener can read hesitation even
 * from a silent run. Submitting a run drains everything — and if the mic
 * was live, the take is flushed first and a fresh one begins, so words
 * always ride with the run they were said in.
 *
 * Everything here fails into the journal, never out of it: a refused
 * microphone, a missing dev server, a failed upload are all lines, not
 * throws. Mechanics never wait on the witness.
 */

import { createTrace } from '../witness/trace.js';
import { concatChunks, encodeWav } from '../witness/wav.js';
import type { Standing, TraceMark } from '../witness/trace.js';

/** Inline so the worklet needs no separate served file. It copies each
 *  128-frame input buffer out (the engine reuses it) and stays silent on
 *  its output, which exists only so the graph has a pull. */
const WORKLET = `
class WitnessCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel !== undefined && channel.length > 0) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('witness-capture', WitnessCapture);
`;

interface Live {
  stream: MediaStream;
  ctx: AudioContext;
  node: AudioWorkletNode;
  chunks: Float32Array[];
  samples: number;
  take: string;
  startedWall: string;
}

export interface Witness {
  /** The indicator's click and its key both land here. */
  toggle(standing: Standing): void;
  recording(): boolean;
  /** Raw event types for one player action — the machine's view. */
  acted(types: readonly string[], standing: Standing): void;
  /** Journal lines as they are said — the narrated view. */
  heard(lines: readonly string[], standing: Standing): void;
  /** True if anything was spoken since the last submit (or is being). */
  hasVoice(): boolean;
  /** The submit boundary: flush a live take, hand over takes and marks,
   *  and turn a fresh page if the mic was on. */
  submitSnapshot(standing: Standing): Promise<{ takes: string[]; marks: TraceMark[] }>;
}

export function createWitness(hooks: {
  say(lines: string | string[]): void;
  onState(recording: boolean): void;
}): Witness {
  const trace = createTrace();
  let live: Live | null = null;
  let starting = false;
  /** Which start attempt is current. A permission prompt can hang forever
   *  (found live: an embedded pane whose prompt nobody can answer), so an
   *  attempt that timed out is invalidated — if its stream arrives late,
   *  it stands down instead of recording into a page that gave up on it. */
  let attempt = 0;
  /** Takes uploaded since the last submit, in order. */
  let uploaded: string[] = [];

  const stamp = (): string => new Date().toISOString().replace(/[:.]/gu, '-');

  const audioNow = (): { take: string; ms: number } | null =>
    (live === null
      ? null
      : { take: live.take, ms: Math.round((live.samples / live.ctx.sampleRate) * 1000) });

  const mark = (kind: 'action' | 'journal' | 'witness', text: string, standing: Standing): void => {
    trace.mark(kind, text, standing, audioNow());
  };

  async function start(standing: Standing, wanted: () => boolean = () => true): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!wanted()) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('stood down');
    }
    // 16 kHz is what speech models want; a device that refuses the rate gets
    // its native one, and the WAV header carries whichever is true.
    const ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.state === 'suspended') await ctx.resume();
    const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const node = new AudioWorkletNode(ctx, 'witness-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });

    const opened: Live = {
      stream, ctx, node, chunks: [], samples: 0,
      take: stamp(), startedWall: new Date().toISOString(),
    };
    node.port.onmessage = (event: MessageEvent<Float32Array>): void => {
      opened.chunks.push(event.data);
      opened.samples += event.data.length;
    };
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination); // silent output; the graph needs a pull
    live = opened;
    mark('witness', `the witness listens (take ${opened.take})`, standing);
    hooks.onState(true);
  }

  /** Tears the take down and posts it. Resolves once the server has it (or
   *  has refused it) — the submit path needs that ordering so transcription
   *  is already underway before the listener asks after it. */
  async function stopAndUpload(standing: Standing): Promise<void> {
    const was = live;
    if (was === null) return;
    live = null;
    hooks.onState(false);

    was.node.port.onmessage = null;
    was.node.disconnect();
    for (const track of was.stream.getTracks()) track.stop();
    const rate = was.ctx.sampleRate;
    void was.ctx.close().catch(() => { /* already closing */ });

    const seconds = Math.round(was.samples / rate);
    mark('witness', `the witness sets its pen down — ${String(seconds)}s kept (take ${was.take})`, standing);

    if (was.samples === 0) return; // nothing arrived; nothing to keep

    const wav = encodeWav(concatChunks(was.chunks), rate);
    try {
      const sent = await fetch('/__witness', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-witness-take': was.take,
          'x-witness-world': standing.world,
          'x-witness-started': was.startedWall,
        },
        body: new Blob([wav.buffer as ArrayBuffer]),
      });
      if (!sent.ok) throw new Error(String(sent.status));
      uploaded.push(was.take);
      hooks.say(`the witness has your words — ${String(seconds)}s, being written down`);
    } catch {
      hooks.say('the witness could not hand your words over — no dev server; the take is lost');
    }
  }

  /** Long enough for a person at the permission prompt; short enough that a
   *  prompt nobody can answer does not wedge the button forever. */
  const START_TIMEOUT_MS = 8000;

  function toggle(standing: Standing): void {
    if (starting) return;
    if (live !== null) {
      void stopAndUpload(standing);
      return;
    }
    starting = true;
    attempt += 1;
    const mine = attempt;
    const gaveUp = new Promise<never>((_done, refuse) => {
      window.setTimeout(() => { refuse(new Error('the prompt never answered')); }, START_TIMEOUT_MS);
    });
    Promise.race([start(standing, () => mine === attempt), gaveUp])
      .then(() => { hooks.say('the witness listens — speak your mind while you play'); })
      .catch(() => {
        attempt += 1; // a late-arriving stream must stand down, not haunt
        hooks.say('the witness cannot hear — the microphone was refused, or never answered');
      })
      .finally(() => { starting = false; hooks.onState(live !== null); });
  }

  return {
    toggle,
    recording: () => live !== null,
    acted: (types, standing): void => {
      if (types.length === 0) return;
      // Compact: "MOVE ×3, STRIKE" — counts, not repetition.
      const counts = new Map<string, number>();
      for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
      const text = [...counts.entries()]
        .map(([t, n]) => (n === 1 ? t : `${t} ×${String(n)}`))
        .join(', ');
      mark('action', text, standing);
    },
    heard: (lines, standing): void => {
      for (const line of lines) mark('journal', line, standing);
    },
    hasVoice: () => uploaded.length > 0 || live !== null,
    submitSnapshot: async (standing): Promise<{ takes: string[]; marks: TraceMark[] }> => {
      const wasLive = live !== null;
      await stopAndUpload(standing);
      const takes = uploaded;
      uploaded = [];
      const marks = trace.drain();
      if (wasLive) {
        // The page turns: same session, fresh take, no re-prompt — the
        // browser remembers the grant.
        start(standing)
          .then(() => { hooks.say('the witness turns a fresh page'); })
          .catch(() => { hooks.say('the witness cannot hear — the microphone was refused'); });
      }
      return { takes, marks };
    },
  };
}
