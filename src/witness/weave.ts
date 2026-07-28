/**
 * Weaving: the trace and the transcripts, merged on the wall's clock.
 *
 * The trace knows what the game did and when; each transcript knows what was
 * said and how far into its take. A take's `startedWall` converts audio
 * seconds to wall milliseconds, and from there everything sorts onto one
 * line: the player's words land *between* the actions they were said
 * between, which is the entire point — "this fight drags" means something
 * different mid-fight than three rooms later.
 */

import type { TraceMark } from './trace.js';

export interface SpokenSegment {
  /** Seconds into the take. */
  start: number;
  end: number;
  text: string;
}

export interface TranscribedTake {
  take: string;
  /** ISO wall clock of the take's first sample. */
  startedWall: string;
  segments: readonly SpokenSegment[];
}

export interface WovenLine {
  atMs: number;
  voice: boolean;
  /** The turn the mark saw; null for speech (the wall clock places it). */
  turn: number | null;
  text: string;
}

/** A silence long enough to mean something, said out loud in the timeline. */
const LONG_PAUSE_MS = 20_000;

export function weave(
  marks: readonly TraceMark[],
  takes: readonly TranscribedTake[],
): WovenLine[] {
  const lines: WovenLine[] = [];

  for (const m of marks) {
    lines.push({
      atMs: m.atMs,
      voice: false,
      turn: m.turn,
      text: m.kind === 'action' ? `[${m.text}]` : m.text,
    });
  }
  for (const t of takes) {
    const began = Date.parse(t.startedWall);
    if (Number.isNaN(began)) continue;
    for (const s of t.segments) {
      lines.push({
        atMs: began + Math.round(s.start * 1000),
        voice: true,
        turn: null,
        text: s.text,
      });
    }
  }

  // Stable on ties, so two things in the same millisecond keep their
  // arrival order rather than shuffling per engine.
  return lines
    .map((line, i) => ({ line, i }))
    .sort((a, b) => a.line.atMs - b.line.atMs || a.i - b.i)
    .map((x) => x.line);
}

function clock(ms: number, epoch: number): string {
  const seconds = Math.max(0, Math.round((ms - epoch) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function said(line: WovenLine, epoch: number): string {
  return line.voice
    ? `${clock(line.atMs, epoch)} · you say: “${line.text}”`
    : `${clock(line.atMs, epoch)} · t${String(line.turn ?? 0)} ${line.text}`;
}

/**
 * Renders the weave for reading — the model's, mostly.
 *
 * `keepAll` writes every line (the on-disk timeline). Without it, the render
 * keeps every spoken line plus `context` beats either side, the first and
 * last few beats for framing, and elides the rest with an honest count — a
 * four-hundred-beat run around six sentences of speech is mostly the six
 * sentences. Long silences are annotated either way: the pause before a
 * word is part of the word.
 */
export function renderWoven(
  lines: readonly WovenLine[],
  opts: { keepAll?: boolean; context?: number } = {},
): string {
  if (lines.length === 0) return '(nothing marked)';
  const epoch = lines[0]!.atMs;
  const context = opts.context ?? 3;

  const keep = new Set<number>();
  if (opts.keepAll === true) {
    lines.forEach((_l, i) => keep.add(i));
  } else {
    lines.forEach((l, i) => {
      if (!l.voice) return;
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j += 1) {
        keep.add(j);
      }
    });
    // Framing: how the run opened and how it ended, even in silence.
    for (let j = 0; j < Math.min(2, lines.length); j += 1) keep.add(j);
    for (let j = Math.max(0, lines.length - 2); j < lines.length; j += 1) keep.add(j);
  }

  const out: string[] = [];
  let elided = 0;
  const flushElision = (): void => {
    if (elided === 0) return;
    out.push(`· · · (${String(elided)} beats pass)`);
    elided = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!keep.has(i)) {
      elided += 1;
      continue;
    }
    flushElision();
    if (i > 0 && line.atMs - lines[i - 1]!.atMs >= LONG_PAUSE_MS) {
      out.push(`(a long pause — ${String(Math.round((line.atMs - lines[i - 1]!.atMs) / 1000))}s)`);
    }
    out.push(said(line, epoch));
  }
  flushElision();

  return out.join('\n');
}
