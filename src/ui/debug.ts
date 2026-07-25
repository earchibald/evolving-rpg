import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld } from '../core/commands.js';
import { playerStep, playerWait, runWorldTurns, buryIfDead, isGrave } from '../play/session.js';
import { isAlive } from '../core/entity.js';
import { outcome, toHit, hitChance } from '../core/commands.js';
import { itemAt } from '../core/item.js';
import { save, load, clear, emptySession } from '../play/store.js';
import { WALL, EXIT, idx, tileAt } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { Refs } from '../log/refs.js';
import type { Entity } from '../core/entity.js';
import type { GameEvent } from '../core/events.js';

const SEED = 20260724;
const WIDTH = 24;
const HEIGHT = 16;
const WALLS = 60;
const MAIN = 'main';

let log: EventLog = emptyLog();
let refs: Refs = emptyRefs();
let active = MAIN;
let forkCount = 0;
let booted = '';

function freshWorld(): void {
  const session = emptySession(MAIN);
  const first = append(session.log, null, createWorld(SEED, WIDTH, HEIGHT, WALLS));
  log = first.log;
  refs = createRef(session.refs, MAIN, first.event.id, 0, 'opening run');
  active = MAIN;
}

// Restore before anything else. A refused save is worth saying out loud rather
// than silently starting over — losing a run quietly is how you stop trusting
// that anything is being kept.
try {
  const restored = load();
  if (restored === null) {
    freshWorld();
    booted = 'new world';
  } else {
    log = restored.log;
    refs = restored.refs;
    active = restored.active;
    booted = `restored ${refs.byName.size} world(s), ${log.events.size} events`;
  }
} catch (error) {
  freshWorld();
  booted = `save refused (${String(error)}) — started over`;
}

/**
 * Writes the session to localStorage and mirrors it to the dev server, so a
 * round played here is readable from the repository afterwards.
 *
 * The mirror is coalesced rather than fired per action. Unawaited posts race,
 * and the first version of this wrote snapshots of 26, 41 and then 36 events —
 * leaving a *stale* chronicle on disk. Handing back an out-of-date history is
 * worse than handing back none, because nothing about it looks wrong.
 *
 * At most one request is in flight; whatever happened most recently is what
 * goes next, and intermediate states are simply skipped. The save is a
 * snapshot of everything, so skipping one loses nothing.
 */
let inFlight = false;
let pendingSnapshot: ReturnType<typeof save> = null;

function flushChronicle(): void {
  if (inFlight || pendingSnapshot === null) return;

  const body = JSON.stringify(pendingSnapshot);
  pendingSnapshot = null;
  inFlight = true;

  void fetch('/__chronicle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
    .catch(() => {
      // No dev server, or a build. The localStorage copy is what matters for
      // continuing to play; this one is for reading afterwards.
    })
    .finally(() => {
      inFlight = false;
      flushChronicle();
    });
}

/** What the session is, compressed to a line. Cheap to compare, and it changes
 *  whenever anything worth saving has. */
function signature(): string {
  const worlds = [...refs.byName.values()].map((r) => `${r.name}:${String(r.head)}`).join(',');
  return `${log.events.size}|${active}|${worlds}`;
}

let lastSaved = '';

function persist(): void {
  // A finished run still accepts keypresses that produce no events, and the
  // first version wrote 27 identical snapshots in a row because of it. Saving
  // the same thing repeatedly is not harmful, but a chronicle whose history is
  // mostly noise is harder to read — and reading it is the whole point.
  const now = signature();
  if (now === lastSaved) return;
  lastSaved = now;

  const snapshot = save(log, refs, active, new Date().toISOString());
  if (snapshot === null) return;
  pendingSnapshot = snapshot;
  flushChronicle();
}

const KEYS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node;
}

function say(message: string): void {
  el('status').textContent = message;
}

function render(): void {
  const head = getRef(refs, active).head;
  const state = fold(log, head);
  const player = state.entities[0];

  // Living creatures win the tile over corpses, so a body never hides a threat.
  const occupant = new Map<number, Entity>();
  for (const e of state.entities) {
    const key = idx(state.grid, e.pos.x, e.pos.y);
    const standing = occupant.get(key);
    if (standing === undefined || (!isAlive(standing) && isAlive(e))) occupant.set(key, e);
  }

  const grid = el('grid');
  grid.style.gridTemplateColumns = `repeat(${state.grid.width}, 20px)`;
  grid.textContent = '';
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const tile = state.grid.tiles[idx(state.grid, x, y)];
      const here = occupant.get(idx(state.grid, x, y));

      // Whoever is standing there wins the square. The item sits on a guard by
      // design, so painting the item over the creature hid the guard every
      // single time — and a risk you cannot see is not a decision you can weigh.
      if (here !== undefined) {
        if (!isAlive(here)) cell.classList.add('dead');
        else if (here.kind === 'you') cell.classList.add('player');
        else cell.classList.add('foe');
      } else if (tile === WALL) {
        cell.classList.add('wall');
      } else if (tile === EXIT) {
        cell.classList.add('exit');
      } else if (itemAt(state.items, x, y) !== undefined) {
        cell.classList.add('item');
      }

      // A guarded prize still needs to read as a prize, so mark the square even
      // when something is standing on it.
      if (here !== undefined && itemAt(state.items, x, y) !== undefined) {
        cell.classList.add('guarding');
      }
      grid.appendChild(cell);
    }
  }

  const rows: Array<[string, string]> = [
    ['world', active],
    ['outcome', outcome(state)],
    ['turn', String(state.turn)],
    ['way out', (() => {
      if (player === undefined) return '—';
      const at = state.grid.tiles.indexOf(EXIT);
      if (at < 0) return 'none';
      const ex = at % state.grid.width;
      const ey = Math.floor(at / state.grid.width);
      return `${Math.abs(ex - player.pos.x) + Math.abs(ey - player.pos.y)} away, at ${ex}, ${ey}`;
    })()],
    ['position', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`],
    ['hit points', player === undefined ? '—' : `${player.stats.hp}`],
    ['might / wits / speed', player === undefined ? '—'
      : `${player.stats.might} / ${player.stats.wits} / ${player.stats.speed}`],
    ['your damage', player === undefined ? '—' : `1–${player.stats.might}`],
    ['seed', String(state.seed)],
    ['rng counter', String(state.rngCounter)],
    ['events in chain', String(chain(log, head).length)],
    ['events in log', String(log.events.size)],
  ];

  for (const i of state.items) {
    rows.push([i.kind, `at ${i.pos.x}, ${i.pos.y}`]);
  }

  // Every creature states the two numbers that decide whether to fight it: what
  // you need to hit it, and what it needs to hit you. Without these, "is this
  // fight worth taking" is a guess dressed up as a decision.
  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    const label = e.id;
    if (!isAlive(e)) {
      rows.push([label, `dead at ${e.pos.x}, ${e.pos.y}`]);
      continue;
    }
    const away = player === undefined
      ? '?'
      : String(Math.abs(e.pos.x - player.pos.x) + Math.abs(e.pos.y - player.pos.y));
    const yours = player === undefined ? '' : `you hit on ${toHit(player, e)}+ (${hitChance(player, e)}/20)`;
    const theirs = player === undefined ? '' : `it hits on ${toHit(e, player)}+ for 1–${e.stats.might}`;
    rows.push([label, `hp ${e.stats.hp} · ${away} away · ${yours} · ${theirs}`]);
  }
  const readout = el('readout');
  readout.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    readout.append(dt, dd);
  }

  const list = el('refs');
  list.textContent = '';
  for (const ref of listRefs(refs)) {
    const li = document.createElement('li');
    const marker = ref.name === active ? '→ ' : '  ';
    const kind = isGrave(ref.name) ? ' — a grave' : '';
    li.textContent = `${marker}${ref.name} @ ${String(ref.head).slice(0, 10)}${kind}`;
    if (isGrave(ref.name)) li.classList.add('grave');
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      active = ref.name;
      persist();
      say(`switched to ${ref.name}`);
      render();
    });
    list.appendChild(li);
  }
}

/** Turns the events one keypress produced into a line a person can read. */
function narrate(fresh: readonly GameEvent[]): string {
  const lines: string[] = [];

  for (const event of fresh) {
    if (event.type === 'MOVE_BLOCKED') {
      lines.push(`blocked: ${event.payload.reason} — no turn spent`);
      continue;
    }
    if (event.type === 'WAIT') { lines.push('you hold still'); continue; }
    if (event.type === 'ITEM_TAKEN') {
      // Naming the change, not just the acquisition. A +2 might edge raises
      // damage per turn by about three quarters and read as nothing at all,
      // because the number moved in a corner of the readout and never spoke.
      const g = event.payload.grants;
      const deltas = [
        g.might === 0 ? '' : `might +${g.might}`,
        g.hp === 0 ? '' : `hp +${g.hp}`,
        g.wits === 0 ? '' : `wits +${g.wits}`,
        g.speed === 0 ? '' : `speed +${g.speed}`,
      ].filter((d) => d !== '');
      lines.push(`you take ${event.payload.itemId} — ${deltas.join(', ')}`);
      continue;
    }
    if (event.type !== 'STRIKE') continue;

    const p = event.payload;
    const mine = p.attackerId === 'player';
    const who = mine ? `you hit ${p.targetId}` : `${p.attackerId} hits you`;
    const missed = mine ? `you miss ${p.targetId}` : `${p.attackerId} misses you`;
    lines.push(p.hit ? `${who} for ${p.damage} (${p.roll} vs ${p.needed})` : `${missed} (${p.roll} vs ${p.needed})`);
  }

  return lines.join('  ·  ');
}

function finish(before: number, head: string): void {
  const told = narrate(chain(log, head).slice(before));

  // Death is handled here rather than inside the step, because it is not a move
  // — it is what the world does about a move that went badly.
  const burial = buryIfDead(log, refs, active);
  refs = burial.refs;

  persist();
  say(burial.grave === null
    ? told
    : `${told}${told === '' ? '' : '  ·  '}you die. your body stays in ${burial.grave}; the world begins again`);
  render();
}

function step(dx: number, dy: number): void {
  const head = getRef(refs, active).head;
  if (head === null) return;

  const before = chain(log, head).length;

  // One keypress is your action *and* everything the world does in reply. The
  // turn loop lives in play/session so this view and the golden generator drive
  // the game the same way — they drifted once when it was duplicated.
  const acted = playerStep({ log, head }, 'player', dx, dy);
  const after = runWorldTurns(acted.position, 'player');
  log = after.log;
  refs = setHead(refs, active, after.head);

  finish(before, after.head);
}

function hold(): void {
  const head = getRef(refs, active).head;
  if (head === null) return;

  const before = chain(log, head).length;
  const waited = playerWait({ log, head }, 'player');
  const after = runWorldTurns(waited.position, 'player');
  log = after.log;
  refs = setHead(refs, active, after.head);

  finish(before, after.head);
}

window.addEventListener('keydown', (event) => {
  if (event.key === '.' || event.key === ' ') {
    event.preventDefault();
    hold();
    return;
  }
  const move = KEYS[event.key];
  if (move === undefined) return;
  event.preventDefault();
  step(move[0], move[1]);
});

el('verify').addEventListener('click', () => {
  const divergence = verifyChain(log, getRef(refs, active).head);
  say(divergence === null
    ? 'chain verified: every hash recomputes, every counter lines up'
    : `divergence at seq ${divergence.seq}: ${divergence.reason}`);
});

el('fork').addEventListener('click', () => {
  forkCount += 1;
  const name = `${active}-${forkCount}`;
  refs = fork(log, refs, active, name, null, 'forked from the debug view');
  active = name;
  persist();
  say(`forked to ${name} — no events were copied`);
  render();
});

el('rewind').addEventListener('click', () => {
  const events = chain(log, getRef(refs, active).head);
  const target = events[Math.max(0, events.length - 11)];
  if (target === undefined) { say('nothing to rewind to'); return; }
  refs = reset(log, refs, active, target.id);
  persist();
  say(`reset to seq ${target.seq} — the abandoned events are still in the log`);
  render();
});

el('newrun').addEventListener('click', () => {
  clear();
  freshWorld();
  persist();
  say('new world — the old save is gone');
  render();
});

render();
persist();
say(booted);
