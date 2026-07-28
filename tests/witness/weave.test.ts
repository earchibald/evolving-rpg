import { describe, expect, it } from 'vitest';
import { renderWoven, weave } from '../../src/witness/weave.js';
import type { TraceMark } from '../../src/witness/trace.js';

const T0 = Date.parse('2026-07-28T12:00:00.000Z');

function markAt(offsetMs: number, text: string, kind: TraceMark['kind'] = 'journal', turn = 1): TraceMark {
  return {
    wall: new Date(T0 + offsetMs).toISOString(),
    atMs: T0 + offsetMs,
    audioMs: null,
    take: null,
    world: 'main',
    turn,
    depth: 1,
    seq: 1,
    kind,
    text,
  };
}

describe('weave', () => {
  it('places spoken words between the beats they were said between', () => {
    const lines = weave(
      [markAt(0, 'first blow'), markAt(10_000, 'the reply')],
      [{
        take: 't1',
        startedWall: new Date(T0).toISOString(),
        segments: [{ start: 4, end: 6, text: 'that felt cheap' }],
      }],
    );
    expect(lines.map((l) => l.text)).toEqual(['first blow', 'that felt cheap', 'the reply']);
    expect(lines[1]!.voice).toBe(true);
    // The offset math is the correlation: take start + 4s of audio.
    expect(lines[1]!.atMs).toBe(T0 + 4000);
  });

  it('converts audio seconds against the TAKE start, not the trace start', () => {
    const lines = weave(
      [markAt(0, 'opening')],
      [{
        take: 't2',
        startedWall: new Date(T0 + 60_000).toISOString(), // mic came on a minute in
        segments: [{ start: 2, end: 3, text: 'late words' }],
      }],
    );
    expect(lines[1]!.atMs).toBe(T0 + 62_000);
  });

  it('keeps arrival order on millisecond ties instead of shuffling', () => {
    const lines = weave([markAt(5, 'a'), markAt(5, 'b'), markAt(5, 'c')], []);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('renderWoven', () => {
  it('renders every line with a relative clock when keepAll is set', () => {
    const rendered = renderWoven(weave(
      [markAt(0, 'born', 'journal', 0), markAt(61_000, 'MOVE', 'action', 2)],
      [],
    ), { keepAll: true });
    expect(rendered).toContain('00:00 · t0 born');
    expect(rendered).toContain('01:01 · t2 [MOVE]');
  });

  it('keeps speech with context and elides the rest with an honest count', () => {
    const marks = Array.from({ length: 40 }, (_x, i) => markAt(i * 1000, `beat ${String(i)}`, 'action', i));
    const rendered = renderWoven(weave(marks, [{
      take: 't1',
      startedWall: new Date(T0 + 20_000).toISOString(),
      segments: [{ start: 0.2, end: 1, text: 'this drags' }],
    }]));
    expect(rendered).toContain('you say: “this drags”');
    // Context around the word survives; the middle of the silence does not.
    expect(rendered).toContain('[beat 19]');
    expect(rendered).toContain('[beat 22]');
    expect(rendered).not.toContain('[beat 10]');
    expect(rendered).toMatch(/· · · \(\d+ beats pass\)/u);
  });

  it('says a long pause out loud — silence is evidence', () => {
    const rendered = renderWoven(weave(
      [markAt(0, 'a blow', 'journal', 3), markAt(45_000, 'the next blow', 'journal', 4)],
      [],
    ), { keepAll: true });
    expect(rendered).toContain('(a long pause — 45s)');
  });

  it('does not invent pauses across elided stretches it chose to keep apart', () => {
    const rendered = renderWoven(weave(
      [markAt(0, 'a'), markAt(1000, 'b')],
      [],
    ), { keepAll: true });
    expect(rendered).not.toContain('long pause');
  });

  it('has something to say about nothing', () => {
    expect(renderWoven([])).toBe('(nothing marked)');
  });
});
