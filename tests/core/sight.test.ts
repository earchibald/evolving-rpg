import { withinReach, clearShot } from '../../src/core/sight.js';
import { makeGrid, FLOOR, WALL, SECRET } from '../../src/core/grid.js';
import type { Grid } from '../../src/core/grid.js';
import type { Entity } from '../../src/core/entity.js';

/** Rows of '#' (wall), '.' (floor), 's' (secret) — tests read like maps. */
function grid(rows: readonly string[]): Grid {
  const tiles = rows.flatMap((row) => [...row].map((c) => (c === '#' ? WALL : c === 's' ? SECRET : FLOOR)));
  return makeGrid(rows[0]!.length, rows.length, tiles);
}

function body(id: string, x: number, y: number, hp = 3): Entity {
  return { id, kind: 'thing', pos: { x, y }, stats: { hp, might: 2, wits: 1, speed: 2 }, tags: [], maxHp: 3 };
}

describe('the reach disc — the fog\'s own circle', () => {
  it('holds the straight edge and refuses past it', () => {
    expect(withinReach({ x: 0, y: 0 }, { x: 5, y: 0 }, 5)).toBe(true);   // 25 ≤ 30
    expect(withinReach({ x: 0, y: 0 }, { x: 6, y: 0 }, 5)).toBe(false);  // 36 > 30
  });

  it('rounds the diagonal the way sight does', () => {
    expect(withinReach({ x: 0, y: 0 }, { x: 5, y: 2 }, 5)).toBe(true);   // 29 ≤ 30
    expect(withinReach({ x: 0, y: 0 }, { x: 4, y: 4 }, 5)).toBe(false);  // 32 > 30
  });
});

describe('the honest line — covenant M7', () => {
  const open = grid([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ]);

  it('flies clear over open floor, and the same both ways', () => {
    expect(clearShot(open, [], { x: 0, y: 0 }, { x: 6, y: 2 })).toBe(true);
    expect(clearShot(open, [], { x: 6, y: 2 }, { x: 0, y: 0 })).toBe(true);
  });

  it('is stopped by a wall square the line crosses', () => {
    const walled = grid([
      '.......',
      '.......',
      '...#...',
      '.......',
      '.......',
    ]);
    expect(clearShot(walled, [], { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(false);
    expect(clearShot(walled, [], { x: 6, y: 2 }, { x: 0, y: 2 })).toBe(false);
  });

  it('is stopped by a secret — the illusion is real enough to stop a stone, both ways', () => {
    const secret = grid([
      '.......',
      '.......',
      '...s...',
      '.......',
      '.......',
    ]);
    expect(clearShot(secret, [], { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(false);
    expect(clearShot(secret, [], { x: 6, y: 2 }, { x: 0, y: 2 })).toBe(false);
  });

  it('is stopped by a living body between, never by the dead, never by the ends', () => {
    const between = body('b', 3, 2);
    expect(clearShot(open, [between], { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(false);
    expect(clearShot(open, [body('b', 3, 2, 0)], { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(true);
    // attacker and target stand on their own tiles without blocking the shot
    const ends = [body('a', 0, 2), body('t', 6, 2)];
    expect(clearShot(open, ends, { x: 0, y: 2 }, { x: 6, y: 2 })).toBe(true);
  });

  it('slips a single corner but never two walls kissing', () => {
    // The diagonal from (0,2) to (2,0) crosses exactly two lattice corners:
    // first between cells (1,2) and (0,1), then between (2,1) and (1,0).
    const oneWall = grid([
      '...',
      '#..',
      '...',
    ]);
    // (0,2) → (2,0): corner at (1,1)'s lattice point between (0,1) and (1,2),
    // then between (1,0) and (2,1). Only (0,1) is wall — the shot slips by.
    expect(clearShot(oneWall, [], { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    const kissing = grid([
      '...',
      '#..',
      '.#.',
    ]);
    // Now (0,1) and (1,2) both stand — two walls kissing stop the stone.
    expect(clearShot(kissing, [], { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(false);
    expect(clearShot(kissing, [], { x: 2, y: 0 }, { x: 0, y: 2 })).toBe(false);
  });

  it('never lets a body block at a corner it merely clips', () => {
    // Same diagonal, a living body on (0,1): bodies block only where the
    // line truly crosses their tile, and a corner is not a crossing.
    const open3 = grid([
      '...',
      '...',
      '...',
    ]);
    expect(clearShot(open3, [body('b', 0, 1)], { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
  });
});
