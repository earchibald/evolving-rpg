import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld } from '../core/commands.js';
import { playerStep, playerWait, runWorldTurns, buryIfDead, isGrave } from '../play/session.js';
import { isAlive } from '../core/entity.js';
import { outcome, toHit, hitChance } from '../core/commands.js';
import { itemAt } from '../core/item.js';
import { save, load, clear, emptySession } from '../play/store.js';
import { Oracle, describeQuestion } from '../oracle/oracle.js';
import { cliTransport } from '../oracle/transports.js';
import { send } from '../channels/channels.js';
import type { Channel, Note } from '../channels/channels.js';
import { WALL, EXIT, idx, tileAt } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { Refs } from '../log/refs.js';
import type { Entity } from '../core/entity.js';
import type { GameEvent } from '../core/events.js';

const FIRST_SEED = 20260724;
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
  const first = append(session.log, null, createWorld(FIRST_SEED, WIDTH, HEIGHT, WALLS));
  log = first.log;
  refs = createRef(session.refs, MAIN, first.event.id, 0, 'opening run');
  active = MAIN;
}

/**
 * Another world, alongside the ones already here.
 *
 * Two things this is not. It is not the same world again — the first version
 * passed a fixed seed, so every "new world" was the identical map with the
 * identical creatures standing in the identical places, new only in the sense
 * of having an empty log. And it does not throw the old ones away: worlds are
 * refs over one shared store, so adding another costs a name, and discarding
 * your graves to make room would contradict the entire point of keeping them.
 *
 * The seed is chosen rather than derived, which is fine: it is an input, like a
 * keypress. It is recorded in WORLD_INIT, so the world remains exactly as
 * reproducible as every other — and it is on screen, so you can note one you
 * liked.
 */
function anotherWorld(): string {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const taken = new Set(listRefs(refs).map((r) => r.name));
  let n = 2;
  while (taken.has(`world-${n}`)) n += 1;
  const name = `world-${n}`;

  const born = append(log, null, createWorld(seed, WIDTH, HEIGHT, WALLS));
  log = born.log;
  refs = createRef(refs, name, born.event.id, 0, `seed ${seed}`);
  active = name;
  return name;
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

/**
 * The world's voice.
 *
 * Canon is kept beside the session, so a name survives a reload the same way a
 * world does — and a name once spoken is never asked about again, which is what
 * keeps the cost proportional to novelty rather than to how long you play.
 */
const CANON_KEY = 'evolving-rpg/canon/v1';

function rememberedCanon(): Record<string, never> {
  try {
    const raw = window.localStorage.getItem(CANON_KEY);
    return raw === null ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
}

const oracle = new Oracle({
  transport: cliTransport(),
  known: rememberedCanon(),
  onChange: () => {
    try {
      window.localStorage.setItem(CANON_KEY, JSON.stringify(oracle.known()));
    } catch { /* quota; the world keeps its names for this session at least */ }
    render();
  },
});

/**
 * Asks about everything on screen that has not been named yet.
 *
 * Per kind rather than per creature: a name is a fact about the world, not
 * about one of its occupants, so every `thing` shares one — and that is also
 * why naming three creatures costs one question instead of three.
 */
function nameWhatIsHere(state: ReturnType<typeof fold>): void {
  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    oracle.ask(describeQuestion('creature', e.kind, {
      hitPoints: e.stats.hp,
      might: e.stats.might,
      speed: e.stats.speed,
    }));
  }
  for (const i of state.items) {
    oracle.ask(describeQuestion('item', i.kind, { grants: i.grants }));
  }
}

/** What the world calls a kind of thing, whether or not it has answered yet. */
function calledCreature(kind: string, e: { stats: { hp: number; might: number; speed: number } }): string {
  return oracle.ask(describeQuestion('creature', kind, {
    hitPoints: e.stats.hp, might: e.stats.might, speed: e.stats.speed,
  })).name;
}

/** Everything said, newest last, kept in memory for the session and on disk
 *  for good. */
const notes: Note[] = [];

/** What the player can currently see, so the gamemaster is not answering blind. */
function scene(): Record<string, unknown> {
  const head = getRef(refs, active).head;
  const state = fold(log, head);
  const you = state.entities[0];
  return {
    turn: state.turn,
    you: you === undefined ? null : { at: you.pos, hitPoints: you.stats.hp, might: you.stats.might },
    around: state.entities.filter((e) => e.kind !== 'you' && isAlive(e)).map((e) => ({
      called: calledCreature(e.kind, e), at: e.pos, hitPoints: e.stats.hp,
    })),
    underfoot: state.items.map((i) => ({ at: i.pos })),
    named: Object.values(oracle.known()).filter((a) => a.line !== '').map((a) => a.name),
  };
}

async function speak(channel: Channel, said: string): Promise<void> {
  const head = getRef(refs, active).head;
  const state = fold(log, head);

  const note = await send(oracle, channel, said, {
    world: active, head, turn: state.turn, scene: scene(),
  }, new Date().toISOString(), async (n) => {
    await fetch('/__notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(n),
    });
  });

  notes.push(note);
  render();
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

  nameWhatIsHere(state);

  // ── what you decide on, beside the map ─────────────────────────────────
  const exitAt = state.grid.tiles.indexOf(EXIT);
  const exitPos = exitAt < 0 ? null : { x: exitAt % state.grid.width, y: Math.floor(exitAt / state.grid.width) };
  const toExit = player === undefined || exitPos === null
    ? '—'
    : `${Math.abs(exitPos.x - player.pos.x) + Math.abs(exitPos.y - player.pos.y)} away`;

  const hurt = player !== undefined && player.stats.hp <= 3;
  const done = outcome(state);

  const vitals: Array<[string, string, string]> = [
    ['hit points', player === undefined ? '—' : String(player.stats.hp), hurt ? 'urgent' : ''],
    ['you deal', player === undefined ? '—' : `1–${player.stats.might}`, ''],
    ['the way out', toExit, done === 'escaped' ? 'good' : ''],
    ['standing at', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`, ''],
    ['turn', String(state.turn), ''],
    ['world', active, ''],
  ];
  if (done !== 'playing') vitals.unshift(['this run', done, done === 'dead' ? 'urgent' : 'good']);

  const vitalsEl = el('vitals');
  vitalsEl.textContent = '';
  for (const [label, value, tone] of vitals) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (tone !== '') dd.className = tone;
    vitalsEl.append(dt, dd);
  }

  // ── what is here, and what it costs ────────────────────────────────────
  const threats = el('threats');
  threats.textContent = '';

  for (const i of state.items) {
    const called = oracle.ask(describeQuestion('item', i.kind, { grants: i.grants })).name;
    const li = document.createElement('li');
    li.style.borderLeftColor = 'var(--item)';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = called;
    const odds = document.createElement('span');
    odds.className = 'odds';
    const reach = player === undefined ? '?' : Math.abs(i.pos.x - player.pos.x) + Math.abs(i.pos.y - player.pos.y);
    odds.textContent = `${reach} away · +${i.grants.might} might`;
    li.append(who, odds);
    threats.appendChild(li);
  }

  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = calledCreature(e.kind, e);

    const odds = document.createElement('span');
    odds.className = 'odds';
    if (!isAlive(e)) {
      li.className = 'gone';
      odds.textContent = `dead at ${e.pos.x}, ${e.pos.y}`;
    } else {
      const away = player === undefined
        ? '?'
        : Math.abs(e.pos.x - player.pos.x) + Math.abs(e.pos.y - player.pos.y);
      odds.textContent = player === undefined
        ? `hp ${e.stats.hp}`
        : `hp ${e.stats.hp} · ${away} away · you hit ${toHit(player, e)}+ (${hitChance(player, e)}/20) · it hits ${toHit(e, player)}+ for 1–${e.stats.might}`;
    }
    li.append(who, odds);
    threats.appendChild(li);
  }

  // ── under the floorboards ──────────────────────────────────────────────
  const detail = el('detail');
  detail.textContent = '';
  for (const [label, value] of [
    ['seed', String(state.seed)],
    ['rng counter', String(state.rngCounter)],
    ['events in chain', String(chain(log, head).length)],
    ['events in log', String(log.events.size)],
  ] as Array<[string, string]>) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    detail.append(dt, dd);
  }

  // ── the world's own thinking, never hidden ─────────────────────────────
  // On screen at all times, idle or not. A model working invisibly is exactly
  // what this interface must not be.
  const queued = oracle.queue();
  const busy = queued.filter((c) => c.state === 'asking');
  const now = el('now');
  now.className = busy.length === 0 ? 'now' : 'now busy';
  now.textContent = busy.length === 0
    ? 'the world is not thinking about anything'
    : `thinking · ${busy.map((c) => `${c.subject} ${(c.ms / 1000).toFixed(0)}s`).join(' · ')}`;

  const asking = el('oracle');
  asking.textContent = '';
  if (queued.length === 0) {
    const li = document.createElement('li');
    li.className = 'idle';
    li.textContent = 'nothing asked yet';
    asking.appendChild(li);
  } else {
    for (const call of queued) {
      const li = document.createElement('li');
      li.className = call.state;
      li.textContent = `${call.state} · ${call.subject} · ${(call.ms / 1000).toFixed(1)}s · ${call.detail}`;
      asking.appendChild(li);
    }
  }

  // ── what the world has said, to be read rather than announced ──────────
  const spoken = el('names');
  spoken.textContent = '';
  const said = Object.values(oracle.known())
    .filter((a) => a.line !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
  if (said.length === 0) {
    const li = document.createElement('li');
    li.className = 'idle';
    li.textContent = 'nothing has been named yet';
    spoken.appendChild(li);
  } else {
    for (const a of said) {
      const li = document.createElement('li');
      const strong = document.createElement('span');
      strong.className = 'name';
      strong.textContent = a.name;

      // Canon is permanent, which is precisely why refusing has to be possible.
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'reject';
      no.textContent = 'no';
      no.title = `forget "${a.name}" and ask again`;
      no.addEventListener('click', () => {
        oracle.reject(a.name);
        say(`“${a.name}” refused — the world will think of something else`);
      });

      li.append(strong, document.createTextNode(` — ${a.line} `), no);
      spoken.appendChild(li);
    }
  }

  // ── what has been said to whom ─────────────────────────────────────────
  const saidList = el('notes');
  saidList.textContent = '';
  for (const n of notes.slice(-6)) {
    const li = document.createElement('li');
    li.className = n.channel;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = n.channel;
    const words = document.createElement('span');
    words.className = 'said';
    words.textContent = ` “${n.said}”`;
    li.append(who, words);
    if (n.reply !== null) li.append(document.createTextNode(` — ${n.reply}`));
    if (n.trouble !== null) {
      const bad = document.createElement('span');
      bad.className = 'trouble';
      bad.textContent = ` — no reply: ${n.trouble}`;
      li.append(bad);
    }
    saidList.appendChild(li);
  }

  const list = el('refs');
  list.textContent = '';
  for (const ref of listRefs(refs)) {
    const li = document.createElement('li');
    const kind = isGrave(ref.name) ? ' · a grave' : '';
    li.textContent = `${ref.name === active ? '▸ ' : '  '}${ref.name}${kind}`;
    if (ref.name === active) li.classList.add('here');
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

function wire(formId: string, inputId: string, channel: Channel): void {
  const form = el(formId) as HTMLFormElement;
  const input = el(inputId) as HTMLInputElement;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const said = input.value.trim();
    if (said === '') return;
    input.value = '';
    void speak(channel, said);
    render();
  });
}

wire('designer-form', 'designer-said', 'designer');
wire('gm-form', 'gm-said', 'gamemaster');

window.addEventListener('keydown', (event) => {
  // Typing into a channel is not playing. Without this, writing "search the
  // wall" walks you four squares west.
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

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

// Wiping is a separate, deliberate act, and it says what it destroys. Folding
// it into "new world" is how you lose a graveyard by accident.
el('wipe').addEventListener('click', () => {
  const worlds = listRefs(refs).length;
  clear(CANON_KEY);
  freshWorld();
  lastSaved = '';
  persist();
  say(`wiped — ${worlds} world(s) and every name discarded, back to one`);
  render();
});

el('newrun').addEventListener('click', () => {
  const name = anotherWorld();
  persist();
  say(`${name} — a different map, alongside the others, nothing discarded`);
  render();
});

render();
persist();
say(booted);
