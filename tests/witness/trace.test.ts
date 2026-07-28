import { describe, expect, it } from 'vitest';
import { createTrace } from '../../src/witness/trace.js';
import type { Standing } from '../../src/witness/trace.js';

const HERE: Standing = { world: 'main', turn: 7, depth: 2, seq: 41 };

/** A clock that ticks exactly when told to, so stamps are provable. */
function ticking(start: number, step: number): () => number {
  let at = start - step;
  return () => { at += step; return at; };
}

describe('the trace', () => {
  it('stamps both clocks and the standing on every mark', () => {
    const trace = createTrace(10, ticking(1_753_000_000_000, 250));
    trace.mark('journal', 'you hold still', HERE, null);
    trace.mark('action', 'MOVE', HERE, { take: 't1', ms: 1200 });

    const marks = trace.drain();
    expect(marks).toHaveLength(2);
    expect(marks[0]!.atMs).toBe(1_753_000_000_000);
    expect(marks[0]!.wall).toBe(new Date(1_753_000_000_000).toISOString());
    expect(marks[0]!.audioMs).toBeNull();
    expect(marks[0]!.take).toBeNull();
    expect(marks[0]!.turn).toBe(7);
    expect(marks[0]!.depth).toBe(2);
    expect(marks[0]!.seq).toBe(41);
    expect(marks[1]!.audioMs).toBe(1200);
    expect(marks[1]!.take).toBe('t1');
  });

  it('caps by dropping the oldest, and says how many it lost', () => {
    const trace = createTrace(3, ticking(0, 1));
    for (let i = 0; i < 5; i += 1) trace.mark('action', `beat-${String(i)}`, HERE, null);

    expect(trace.size()).toBe(3);
    expect(trace.dropped()).toBe(2);
    const kept = trace.drain();
    // The oldest went first — a trace that forgot its newest would be a lie
    // about the run's end, which is the part the listener reads hardest.
    expect(kept.map((m) => m.text)).toEqual(['beat-2', 'beat-3', 'beat-4']);
  });

  it('drains to empty and resets the loss count — the submit boundary', () => {
    const trace = createTrace(2, ticking(0, 1));
    trace.mark('action', 'a', HERE, null);
    trace.mark('action', 'b', HERE, null);
    trace.mark('action', 'c', HERE, null);
    expect(trace.drain()).toHaveLength(2);
    expect(trace.size()).toBe(0);
    expect(trace.dropped()).toBe(0);
    trace.mark('action', 'd', HERE, null);
    expect(trace.drain().map((m) => m.text)).toEqual(['d']);
  });
});
