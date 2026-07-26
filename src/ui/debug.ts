import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld, ratifyRule } from '../core/commands.js';
import { playerStep, playerWait, runWorldTurns, buryIfDead, beginAgain, isGrave } from '../play/session.js';
import { isAlive } from '../core/entity.js';
import { outcome, hitChance } from '../core/commands.js';
import { itemAt } from '../core/item.js';
import { save, load, clear, emptySession } from '../play/store.js';
import {
  readRule, rangeOf, takesStat, takesNumber, needsTriggers,
  TRIGGERS, STATS, CONDITION_KINDS, EFFECT_KINDS,
  MAX_CONDITIONS, MAX_EFFECTS, MAX_TEXT, MAX_RULES, isRejected,
} from '../canon/rule.js';
import type { Rule } from '../canon/rule.js';
import { summariseRun, proposeRule, finalise } from '../canon/rulesmith.js';
import { assayRule } from '../assay/ruleAssay.js';
import type { RunSummary } from '../canon/rulesmith.js';
import { Oracle, describeQuestion } from '../oracle/oracle.js';
import { cliTransport } from '../oracle/transports.js';
import { send, loadNotes, saveNotes, NOTES_KEY } from '../channels/channels.js';
import { CachedCritic } from '../critic/memo.js';
import type { Channel, Note } from '../channels/channels.js';
import { WALL, EXIT, idx } from '../core/grid.js';
import type { EventLog } from '../log/chain.js';
import type { Refs } from '../log/refs.js';
import type { Entity } from '../core/entity.js';
import type { GameEvent } from '../core/events.js';

const WIDTH = 24;
const HEIGHT = 16;
const WALLS = 60;
const MAIN = 'main';

let log: EventLog = emptyLog();
let refs: Refs = emptyRefs();
let active = MAIN;
let forkCount = 0;
let booted = '';

/**
 * The first world, and the one a wipe leaves behind.
 *
 * The seed used to be a constant, which meant every player saw the same room
 * and — worse — a wipe handed back the identical map, creature for creature.
 * "Start over" that starts the same place is not starting over.
 *
 * Chosen rather than derived, which is fine: it is an input, like a keypress.
 * It is recorded in WORLD_INIT, so this world stays exactly as reproducible as
 * any other, and it is on screen so you can note one you liked.
 */
function freshWorld(): void {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const session = emptySession(MAIN);
  const first = append(session.log, null, createWorld(seed, WIDTH, HEIGHT, WALLS));
  log = first.log;
  refs = createRef(session.refs, MAIN, first.event.id, 0, `opening run · seed ${seed}`);
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
    watchTheClock();
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

/** Everything said, newest last. Restored on load, so a note outlives the tab
 *  it was typed into. */
const notes: Note[] = loadNotes();

/** The lenses, memoised by head — same history, same reading, no recompute. */
const critic = new CachedCritic();

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
  }, 'player');

  notes.push(note);
  // Kept beside the session rather than only in the sidecar, so the Rulesmith
  // can read what you said after a reload — and so can you.
  saveNotes(notes);
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

/**
 * What just happened, one fact per line.
 *
 * These used to be joined with a separator into a single run-on string, which
 * made the line's width a function of how eventful the turn was — and since the
 * board is sized by its widest child, an eventful turn widened the board and
 * shoved the panel beside it sideways. One line per fact, each clipped rather
 * than wrapped, and the box is the same size no matter what happens.
 */
function say(message: string | string[]): void {
  const lines = (typeof message === 'string' ? [message] : message).filter((l) => l !== '');
  const box = el('status');
  box.textContent = '';
  for (const line of lines) {
    const row = document.createElement('span');
    row.className = 'line';
    row.textContent = line;
    box.appendChild(row);
  }
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
        if (!isAlive(here)) cell.classList.add(here.kind === 'you' ? 'you-dead' : 'dead');
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

  // Always the same rows in the same order. A row that appears only sometimes —
  // "this run" used to be added on death — shifts every row beneath it, which
  // is the map jumping at the exact moment you most want it still.
  const vitals: Array<[string, string, string]> = [
    ['this run', done, done === 'dead' ? 'urgent' : done === 'escaped' ? 'good' : ''],
    ['hit points', player === undefined ? '—' : String(player.stats.hp), hurt ? 'urgent' : ''],
    ['you deal', player === undefined ? '—' : `1–${player.stats.might}`, ''],
    ['the way out', toExit, done === 'escaped' ? 'good' : ''],
    ['standing at', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`, ''],
    ['turn', String(state.turn), ''],
    ['world', active, ''],
  ];

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
      // Short enough to never reach the wrap point, and stated as the thing you
      // actually decide on. "hit 10+ (11/20)" made you convert a die target into
      // a chance in your head, every turn, for every creature.
      const pct = (a: Entity, b: Entity): string => `${hitChance(a, b) * 5}%`;
      odds.textContent = player === undefined
        ? `hp ${e.stats.hp}`
        : `hp ${e.stats.hp} · ${away} away · you ${pct(player, e)} 1–${player.stats.might} · it ${pct(e, player)} 1–${e.stats.might}`;
    }
    li.append(who, odds);
    threats.appendChild(li);
  }

  // ── what the lenses see ───────────────────────────────────────────────
  const scorecardEl = el('scorecard');
  scorecardEl.textContent = '';
  const report = critic.read(log, head);
  for (const r of report.readings) {
    const li = document.createElement('li');
    li.className = r.measured ? 'measured' : 'unmeasured';
    const title = document.createElement('span');
    title.className = 'lens-title';
    title.textContent = `#${r.lens} ${r.title} · ${r.figure}`;
    const verdict = document.createElement('span');
    verdict.className = 'lens-verdict';
    verdict.textContent = `${r.verdict} (${r.confidence})`;
    li.append(title, verdict);
    scorecardEl.appendChild(li);
  }

  // ── what this world has agreed to ─────────────────────────────────────
  const rulesEl = el('rules');
  rulesEl.textContent = '';
  if (state.rules.length === 0) {
    const li = document.createElement('li');
    li.className = 'idle';
    li.textContent = 'no rules yet — this world plays as it was born';
    rulesEl.appendChild(li);
  }
  for (const r of state.rules) {
    const li = document.createElement('li');
    const said = document.createElement('span');
    said.className = 'rule-said';
    said.textContent = readRule(r);
    const why = document.createElement('span');
    why.className = 'rule-why';
    why.textContent = r.provenance.because;
    li.append(said, why);
    rulesEl.appendChild(li);
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

/**
 * Turns the events one keypress produced into lines a person can read.
 *
 * `state` is the world as it stood *before* this turn, deliberately. An item is
 * removed from the world the moment you pick it up, so the state afterwards can
 * no longer say what kind of thing it was — and "you take item-0" is exactly the
 * naming failure this is meant to fix.
 */
function narrate(fresh: readonly GameEvent[], state: ReturnType<typeof fold>): string[] {
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
      lines.push(`you take ${calledItem(event.payload.itemId, state)} — ${deltas.join(', ')}`);
      continue;
    }
    if (event.type === 'RULE_FIRED') {
      // Named by what it did, not by which rule did it. "rule-3 fired" tells a
      // player nothing; "the world gives back 2" is the thing they can feel.
      // Outcomes are absolute — "health to 7" — so the readout says where a
      // thing ended up rather than by how much it moved. Less arithmetic for a
      // player mid-turn, and it cannot disagree with the sheet beside it.
      for (const o of event.payload.outcomes) {
        if (o.kind === 'said') { lines.push(`“${o.text}”`); continue; }
        const who = named(state, o.entityId);
        const subject = who === 'you' ? 'your' : `${who}'s`;
        if (o.kind === 'health') lines.push(`${subject} hit points now ${o.to}`);
        else if (o.kind === 'stat') lines.push(`${subject} ${o.stat} now ${o.to}`);
        else lines.push(`${who} is shoved to ${o.to.x}, ${o.to.y}`);
      }
      continue;
    }
    if (event.type !== 'STRIKE') continue;

    // The world gave these things names; the blow-by-blow was still printing
    // entity ids at them. "thing-3 hits you" undoes the naming entirely — the
    // one moment you are paying closest attention is the one that forgets.
    const p = event.payload;
    const mine = p.attackerId === 'player';
    const them = named(state, mine ? p.targetId : p.attackerId);
    const roll = `(${p.roll} vs ${p.needed})`;
    lines.push(mine
      ? (p.hit ? `you hit ${them} for ${p.damage} ${roll}` : `you miss ${them} ${roll}`)
      : (p.hit ? `${them} hits you for ${p.damage} ${roll}` : `${them} misses you ${roll}`));
  }

  return lines;
}

/** What the world calls the thing with this id, falling back to the id itself
 *  for anything it has never heard of. */
function named(state: ReturnType<typeof fold>, id: string): string {
  const e = state.entities.find((x) => x.id === id);
  if (e === undefined) return id;
  return e.kind === 'you' ? 'you' : calledCreature(e.kind, e);
}

function calledItem(id: string, state: ReturnType<typeof fold>): string {
  const i = state.items.find((x) => x.id === id);
  if (i === undefined) return id;
  return oracle.ask(describeQuestion('item', i.kind, { grants: i.grants })).name;
}

function finish(before: number, head: string): void {
  const events = chain(log, head);
  const priorEvent = events[before - 1];
  const priorState = priorEvent === undefined ? fold(log, head) : fold(log, priorEvent.id);
  const told = narrate(events.slice(before), priorState);

  // Death is handled here rather than inside the step, because it is not a move
  // — it is what the world does about a move that went badly.
  const burial = buryIfDead(log, refs, active);
  log = burial.log;
  refs = burial.refs;

  persist();
  if (burial.grave !== null) {
    // Says what is true now rather than what used to happen. The world no
    // longer restarts out from under you — you are lying on the map, and
    // beginning again is something you choose.
    told.push(`you die, and stay where you fell. kept as ${burial.grave} — press “run again” when you are ready`);
  }
  say(told);
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
const sheet = el('worlds-dialog') as HTMLDialogElement;
el('open-worlds').addEventListener('click', () => { sheet.showModal(); });

el('wipe').addEventListener('click', () => {
  const worlds = listRefs(refs).length;
  // In memory first, then on disk. The other order does not work: the Oracle
  // keeps its names in memory, so anything that clears only storage gets them
  // written straight back by the next ask.
  oracle.unlearn();
  notes.length = 0;
  clear(CANON_KEY, NOTES_KEY);
  freshWorld();
  lastSaved = '';
  persist();
  say(`wiped — ${worlds} world(s) and every name discarded, back to one`);
  sheet.close();
  render();
});

el('newrun').addEventListener('click', () => {
  const name = anotherWorld();
  persist();
  say(`${name} — a different map, alongside the others, nothing discarded`);
  sheet.close();
  render();
});

render();
persist();
say(booted);

/* ── the forge ────────────────────────────────────────────────────────────
 *
 * Where a proposal becomes a rule, or does not.
 *
 * Two things shape this. Asking costs real money and takes real seconds, so it
 * happens when you press the button and never on its own — a run ending offers
 * a proposal rather than demanding one, and the offer can be ignored forever.
 * And the editor is built out of the vocabulary itself: every control is a
 * select or a bounded number, so a rule you assemble by hand cannot be one the
 * validator would refuse. It still passes the validator regardless, because a
 * form is a convenience and the gate is the gate.
 */

const forge = el('forge') as HTMLDialogElement;
let pending: Rule | null = null;
/**
 * In flight, and the moment it started.
 *
 * The guard is not politeness. Every ask is a real call costing real money and
 * about forty seconds; a button that stays live through all of it invites the
 * entirely reasonable second click, and gets you billed twice for two answers
 * you did not want.
 */
let asking = false;
let askingSince = 0;
let lastRun: RunSummary | null = null;
/** Set while the editor is open; what accept ratifies instead of `pending`. */
let edited: Record<string, unknown> | null = null;

function rulesInForce(): readonly Rule[] {
  return fold(log, getRef(refs, active).head).rules;
}

function renderForge(): void {
  const state = fold(log, getRef(refs, active).head);
  const done = outcome(state);
  const inForce = state.rules.length;

  el('forge-state').textContent = inForce >= MAX_RULES
    ? `This world holds all ${MAX_RULES} rules it can. Fork it to keep going.`
    : done === 'playing'
      ? `This run is still going. The world proposes when a run ends — ${inForce} rule(s) in force.`
      : `This run ended: ${done}. The world can read it back and propose one rule — ${inForce} in force.`;

  const ask = el('ask-rule') as HTMLButtonElement;
  ask.disabled = asking || done === 'playing' || inForce >= MAX_RULES;
  ask.textContent = asking ? 'asking…' : 'ask the world for a rule';

  // Inside the dialog, because the status line under the map is behind it —
  // which is why asking looked like it did nothing at all.
  const spinner = el('asking');
  spinner.hidden = !asking;
  if (asking) {
    const secs = Math.round((Date.now() - askingSince) / 1000);
    el('asking-said').textContent =
      `reading the run back — ${secs}s${secs > 25 ? ', it usually takes about forty' : ''}`;
  }

  const box = el('proposal');
  if (pending === null) { box.hidden = true; return; }
  box.hidden = false;

  el('proposal-said').textContent = readRule(pending);
  el('proposal-why').textContent = pending.provenance.because;
  const cites = pending.provenance;
  const lensBit = cites.lenses.length === 0 ? ''
    : ` · citing lens${cites.lenses.length === 1 ? '' : 'es'} ${cites.lenses.map((n) => `#${n}`).join(', ')}`;
  el('proposal-cites').textContent =
    `answering ${cites.events.length} event(s) and ${cites.notes.length} of your note(s)${lensBit}`;

  // The trial's cautions, shown beside the proposal. Refusals never get this
  // far — finalise already turned them into a failed ask.
  const tried = assayRule(pending);
  el('proposal-assay').textContent = tried.findings.length === 0
    ? 'assay: sound — exploited for 240 actions without breaking anything'
    : `assay: ${tried.findings.join(' · ')}`;
}

/** One row of the editor: a kind, and whatever that kind needs. */
function control(
  kinds: readonly string[],
  current: Record<string, unknown>,
  when: string,
  onChange: (next: Record<string, unknown>) => void,
  onRemove: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'editor-row';

  const kindSel = document.createElement('select');
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    // Greyed rather than absent: seeing that "push" exists but needs a blow
    // teaches the vocabulary; silently hiding it teaches nothing.
    const only = needsTriggers(k);
    if (only !== undefined && !only.includes(when as never)) {
      opt.disabled = true;
      opt.textContent = `${k} (needs ${only.join('/')})`;
    }
    if (k === current['kind']) opt.selected = true;
    kindSel.appendChild(opt);
  }
  kindSel.addEventListener('change', () => { onChange({ kind: kindSel.value }); });
  row.appendChild(kindSel);

  const kind = String(current['kind']);

  if (takesStat(kind)) {
    const statSel = document.createElement('select');
    for (const st of STATS) {
      const opt = document.createElement('option');
      opt.value = st; opt.textContent = st;
      if (st === current['stat']) opt.selected = true;
      statSel.appendChild(opt);
    }
    statSel.addEventListener('change', () => { onChange({ ...current, stat: statSel.value }); });
    row.appendChild(statSel);
  }

  if (kind === 'speak') {
    const text = document.createElement('input');
    text.type = 'text';
    text.maxLength = MAX_TEXT;
    text.value = String(current['text'] ?? '');
    text.addEventListener('input', () => { onChange({ ...current, text: text.value }); });
    row.appendChild(text);
  } else if (takesNumber(kind)) {
    const range = rangeOf(kind)!;
    const num = document.createElement('input');
    num.type = 'number';
    num.min = String(range[0]); num.max = String(range[1]); num.step = '1';
    num.value = String(current['n'] ?? range[0]);
    num.addEventListener('input', () => {
      // Clamped here as well as validated later: a spinner that lets you type
      // 900 and then refuses the whole rule is a worse experience than one
      // that will not go past 20.
      const v = Math.max(range[0], Math.min(range[1], Math.round(Number(num.value) || range[0])));
      onChange({ ...current, n: v });
    });
    row.appendChild(num);
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = `${range[0]}–${range[1]}`;
    row.appendChild(hint);
  }

  const drop = document.createElement('button');
  drop.type = 'button'; drop.className = 'ghost'; drop.textContent = '×';
  drop.addEventListener('click', onRemove);
  row.appendChild(drop);
  return row;
}

function renderEditor(): void {
  if (edited === null) return;
  const host = el('editor');
  host.textContent = '';

  const when = String(edited['when']);
  const require = (edited['require'] as Record<string, unknown>[] | undefined) ?? [];
  const then = (edited['then'] as Record<string, unknown>[] | undefined) ?? [];

  const trigger = document.createElement('select');
  for (const t of TRIGGERS) {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === when) opt.selected = true;
    trigger.appendChild(opt);
  }
  trigger.addEventListener('change', () => {
    edited = { ...edited, when: trigger.value };
    renderEditor();
  });
  const wrap = document.createElement('div');
  wrap.className = 'editor-row';
  const lab = document.createElement('span');
  lab.className = 'hint'; lab.textContent = 'when';
  wrap.append(lab, trigger);
  host.appendChild(wrap);

  const section = (
    title: string, list: Record<string, unknown>[], kinds: readonly string[],
    cap: number, key: 'require' | 'then', blank: Record<string, unknown>,
  ): void => {
    const head = document.createElement('p');
    head.className = 'hint'; head.textContent = `${title} (${list.length}/${cap})`;
    host.appendChild(head);

    list.forEach((item, i) => {
      host.appendChild(control(kinds, item, when, (next) => {
        const copy = [...list];
        copy[i] = next;
        edited = { ...edited, [key]: copy };
        renderEditor();
      }, () => {
        edited = { ...edited, [key]: list.filter((_x, j) => j !== i) };
        renderEditor();
      }));
    });

    if (list.length < cap) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'ghost'; add.textContent = `add ${title.slice(0, -1)}`;
      add.addEventListener('click', () => {
        edited = { ...edited, [key]: [...list, blank] };
        renderEditor();
      });
      host.appendChild(add);
    }
  };

  section('conditions', require, CONDITION_KINDS, MAX_CONDITIONS, 'require', { kind: 'hpAtMost', n: 5 });
  section('effects', then, EFFECT_KINDS, MAX_EFFECTS, 'then', { kind: 'heal', n: 1 });

  // What it will actually say, live. A player editing a rule they cannot read
  // is not editing anything.
  const preview = document.createElement('p');
  preview.className = 'preview';
  const trial = finalise({ ...edited }, [], 'preview', undefined, { trial: false });
  preview.textContent = isRejected(trial) ? `not yet a rule — ${trial.rejected}` : readRule(trial);
  preview.classList.toggle('bad', isRejected(trial));
  host.appendChild(preview);
}

/**
 * Keeps elapsed times honest while anything is in flight.
 *
 * `render` only runs when something changes, so a call that takes forty
 * seconds displayed "0s" for all forty of them — the one number whose whole
 * job is to change was the one that never did. This ticks once a second and
 * only while there is something to tick for, so an idle page does no work.
 */
let ticker: number | null = null;

function watchTheClock(): void {
  const busy = oracle.queue().some((c) => c.state === 'asking' || c.state === 'waiting');
  if (busy && ticker === null) {
    ticker = window.setInterval(() => {
      if (forge.open) renderForge();
      render();
    }, 1000);
  } else if (!busy && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
}

el('open-forge').addEventListener('click', () => { renderForge(); forge.showModal(); });

// Beginning again without having to die for it. The rules stay; everything
// else goes back to the start.
el('again').addEventListener('click', () => {
  const kept = fold(log, getRef(refs, active).head).rules.length;
  const begun = beginAgain(log, refs, active);
  log = begun.log;
  refs = begun.refs;
  persist();
  say(kept === 0
    ? 'back to the start of this world'
    : `back to the start of this world, still under ${kept} rule(s)`);
  render();
});

el('ask-rule').addEventListener('click', () => {
  if (asking) return;
  asking = true;
  askingSince = Date.now();
  renderForge();

  const head = getRef(refs, active).head;
  const state = fold(log, head);
  lastRun = summariseRun(chain(log, head), state, notes, active);

  say('the world is reading the run back');
  void proposeRule(oracle, lastRun, state.rules, new Date().toISOString()).then((got) => {
    if (isRejected(got)) {
      pending = null;
      say(`no rule this time — ${got.rejected}`);
    } else {
      pending = got;
      edited = null;
      el('editor').hidden = true;
    }
    asking = false;
    renderForge();
    render();
  });
});

el('accept').addEventListener('click', () => {
  if (pending === null) return;
  // The edited draft when there is one, and through the same gate either way.
  const draft = edited ?? (pending as unknown as Record<string, unknown>);
  const settled = finalise(draft, rulesInForce(), new Date().toISOString(), lastRun ?? undefined);
  if (isRejected(settled)) { say(`refused — ${settled.rejected}`); return; }

  const head = getRef(refs, active).head;
  const done = append(log, head, ratifyRule(fold(log, head), settled));
  log = done.log;
  refs = setHead(refs, active, done.event.id);

  pending = null; edited = null;
  el('editor').hidden = true;
  persist();
  say(`ratified — ${readRule(settled)}`);
  forge.close();
  render();
});

el('edit').addEventListener('click', () => {
  if (pending === null) return;
  edited = JSON.parse(JSON.stringify(pending)) as Record<string, unknown>;
  el('editor').hidden = false;
  renderEditor();
});

el('reject').addEventListener('click', () => {
  // Writes nothing at all. The veto is meant to be cheaper than the acceptance.
  pending = null;
  edited = null;
  el('editor').hidden = true;
  say('rejected — nothing was written');
  renderForge();
});
