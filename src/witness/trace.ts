/**
 * The witness's trace: what the game did, and when, on the wall's clock.
 *
 * A sidecar on purpose. Events are content-addressed and deterministic; a
 * wall-clock stamp inside them would move every hash and break replay. So
 * correlation lives out here: every mark carries the moment it happened
 * (wall time), where the run stood (turn, depth, head seq), and — while the
 * microphone is listening — how far into the current take it fell
 * (`audioMs`, sample-accurate). Marks land whether or not the mic is on:
 * the gaps between marks are the hesitations, and hesitation is data.
 */

export type MarkKind = 'action' | 'journal' | 'witness';

export interface TraceMark {
  /** When, for humans. */
  wall: string;
  /** The same moment as epoch milliseconds, for sorting and gap math. */
  atMs: number;
  /** Milliseconds into the current take, or null while the mic is off. */
  audioMs: number | null;
  /** The take the audio clock belongs to, or null while the mic is off. */
  take: string | null;
  world: string;
  turn: number;
  depth: number;
  /** The head event's seq — the exact point on the chain this mark saw. */
  seq: number;
  kind: MarkKind;
  text: string;
}

export interface Standing {
  world: string;
  turn: number;
  depth: number;
  seq: number;
}

export interface Trace {
  mark(kind: MarkKind, text: string, standing: Standing, audio: { take: string; ms: number } | null): void;
  /** Hands over everything held and starts empty — the submit boundary. */
  drain(): TraceMark[];
  size(): number;
  /** Marks lost to the cap since the last drain. Silent truncation lies. */
  dropped(): number;
}

/**
 * A capped ring. A long session walks thousands of beats; the cap keeps the
 * browser honest and `dropped()` keeps the truncation honest — a trace that
 * quietly forgot its first hour must at least say so.
 */
export function createTrace(cap = 4000, now: () => number = Date.now): Trace {
  let marks: TraceMark[] = [];
  let lost = 0;

  return {
    mark(kind, text, standing, audio): void {
      const at = now();
      marks.push({
        wall: new Date(at).toISOString(),
        atMs: at,
        audioMs: audio === null ? null : audio.ms,
        take: audio === null ? null : audio.take,
        world: standing.world,
        turn: standing.turn,
        depth: standing.depth,
        seq: standing.seq,
        kind,
        text,
      });
      if (marks.length > cap) {
        marks.splice(0, marks.length - cap);
        lost += 1;
      }
    },
    drain(): TraceMark[] {
      const held = marks;
      marks = [];
      lost = 0;
      return held;
    },
    size: () => marks.length,
    dropped: () => lost,
  };
}
