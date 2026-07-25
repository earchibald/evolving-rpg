import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld } from '../core/commands.js';
import { playerStep, runWorldTurns } from '../play/session.js';
import { isAlive } from '../core/entity.js';
import { WALL, idx } from '../core/grid.js';
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

const first = append(log, null, createWorld(SEED, WIDTH, HEIGHT, WALLS));
log = first.log;
refs = createRef(refs, MAIN, first.event.id, 0, 'opening run');

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
      if (state.grid.tiles[idx(state.grid, x, y)] === WALL) cell.classList.add('wall');

      const here = occupant.get(idx(state.grid, x, y));
      if (here !== undefined) {
        if (!isAlive(here)) cell.classList.add('dead');
        else if (here.kind === 'you') cell.classList.add('player');
        else cell.classList.add('foe');
      }
      grid.appendChild(cell);
    }
  }

  const rows: Array<[string, string]> = [
    ['world', active],
    ['turn', String(state.turn)],
    ['position', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`],
    ['hp / might / wits / speed', player === undefined ? '—'
      : `${player.stats.hp} / ${player.stats.might} / ${player.stats.wits} / ${player.stats.speed}`],
    ['seed', String(state.seed)],
    ['rng counter', String(state.rngCounter)],
    ['events in chain', String(chain(log, head).length)],
    ['events in log', String(log.events.size)],
  ];

  for (const e of state.entities) {
    rows.push([
      `${e.id}${e.kind === 'you' ? '' : ' (' + e.kind + ')'}`,
      isAlive(e) ? `hp ${e.stats.hp} at ${e.pos.x}, ${e.pos.y}` : `dead at ${e.pos.x}, ${e.pos.y}`,
    ]);
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
    li.textContent = `${marker}${ref.name} @ ${String(ref.head).slice(0, 10)} (engine ${ref.engineVersion})`;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => { active = ref.name; say(`switched to ${ref.name}`); render(); });
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
    if (event.type !== 'STRIKE') continue;

    const p = event.payload;
    const mine = p.attackerId === 'player';
    const who = mine ? `you hit ${p.targetId}` : `${p.attackerId} hits you`;
    const missed = mine ? `you miss ${p.targetId}` : `${p.attackerId} misses you`;
    lines.push(p.hit ? `${who} for ${p.damage} (${p.roll} vs ${p.needed})` : `${missed} (${p.roll} vs ${p.needed})`);
  }

  return lines.join('  ·  ');
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

  say(narrate(chain(log, after.head).slice(before)));
  render();
}

window.addEventListener('keydown', (event) => {
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
  say(`forked to ${name} — no events were copied`);
  render();
});

el('rewind').addEventListener('click', () => {
  const events = chain(log, getRef(refs, active).head);
  const target = events[Math.max(0, events.length - 11)];
  if (target === undefined) { say('nothing to rewind to'); return; }
  refs = reset(log, refs, active, target.id);
  say(`reset to seq ${target.seq} — the abandoned events are still in the log`);
  render();
});

render();
say('ready');
