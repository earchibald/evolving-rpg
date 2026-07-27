import { emptyLog, append, chain, fold, verifyChain } from '../log/chain.js';
import { emptyRefs, createRef, getRef, setHead, fork, reset, listRefs } from '../log/refs.js';
import { createWorld, ratifyRule, foundWorld } from '../core/commands.js';
import { validateBible, isRefusedBible } from '../canon/bible.js';
import { playerStep, playerWait, playerUse, runWorldTurns, buryIfDead, beginAgain, descend, isGrave } from '../play/session.js';
import { isAlive } from '../core/entity.js';
import { outcome, hitChance } from '../core/commands.js';
import { damageDice, XP_TO_REACH, slotOf, critFloor, HEART_KIND } from '../core/tables.js';
import { itemAt } from '../core/item.js';
import { save, load, clear, emptySession } from '../play/store.js';
import {
  readRule, rangeOf, takesStat, takesMotif, takesNumber, needsTriggers,
  TRIGGERS, STATS, MOTIF_NAMES, CONDITION_KINDS, EFFECT_KINDS,
  MAX_CONDITIONS, MAX_EFFECTS, MAX_TEXT, MAX_RULES, isRejected, validateRule,
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
import { WALL, EXIT, SECRET, idx, makeGrid, tileAt } from '../core/grid.js';
import { fogAt } from './fov.js';
import type { EventLog } from '../log/chain.js';
import type { Refs } from '../log/refs.js';
import type { Entity } from '../core/entity.js';
import type { GameEvent } from '../core/events.js';

const WIDTH = 48;
const HEIGHT = 32;
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
/** Last seen vitals values, what each was before it changed, and the turn
 *  until which the change stays lit. Declared above the world-makers because
 *  they clear it: the before→after memory belongs to one character's run,
 *  and carrying it across a wipe showed a fresh game diffing its empty
 *  hands against a dead game's gear — "iron charm +4 hp → —". Descending
 *  keeps it (same character, same run); everything else forgets. */
const lastVitals = new Map<string, { value: string; was: string; until: number }>();

function freshWorld(): void {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const session = emptySession(MAIN);
  const first = append(session.log, null, createWorld(seed, WIDTH, HEIGHT));
  log = first.log;
  refs = createRef(session.refs, MAIN, first.event.id, 0, `opening run · seed ${seed}`);
  active = MAIN;
  lastVitals.clear();
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

  const born = append(log, null, createWorld(seed, WIDTH, HEIGHT));
  log = born.log;
  refs = createRef(refs, name, born.event.id, 0, `seed ${seed}`);
  active = name;
  lastVitals.clear();
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
 * Asks about everything in sight that has not been named yet.
 *
 * Per kind rather than per creature: a name is a fact about the world, not
 * about one of its occupants, so every `thing` shares one — and that is also
 * why naming three creatures costs one question instead of three.
 *
 * Gated by the fog since the fog exists: "the world names what you touch"
 * was always the premise, and asking the model to christen things three
 * rooms away both spends money on the unmet and spoils what the panel may
 * later reveal.
 */
/** World roots the Worldsmith has already been asked about, so an unfounded
 *  or refused world is asked once, not once per frame. */
const foundingTried = new Set<string>();
/** Roots with a founding call still in the air. Naming waits for these:
 *  the first floor is the most-seen floor, and letting it improvise names
 *  while the identity is being decided writes off-palette canon into the
 *  one place the palette matters most. A failed founding clears the root
 *  and the next render names bible-less — the world never blocks. */
const foundingInFlight = new Set<string>();
/** What the judge made of each founded bible, by world root. Opinion is
 *  displayed, never gating: GESTALT §4 — judge the bible once at birth
 *  rather than every name forever. */
const bibleVerdicts = new Map<string, string>();

/**
 * Founds an unfounded world: one Worldsmith call deciding its identity whole
 * (GESTALT.md). Lazy and render-driven, so restored old worlds gain an
 * identity too. The offer faces validateBible before it touches the log;
 * a refusal is said out loud and the world simply keeps improvising.
 */
function foundThisWorld(state: ReturnType<typeof fold>, head: string): void {
  if (state.bible !== null) return;
  const root = chain(log, head)[0]?.id ?? head;
  if (foundingTried.has(root)) return;
  foundingTried.add(root);

  const world = active;
  foundingInFlight.add(root);
  const kinds = [...new Set(state.entities.filter((e) => e.kind !== 'you').map((e) => e.kind))];
  const prizes = [...new Set(state.items.map((i) => i.kind))];
  oracle.consult({
    intent: 'worldsmith',
    subject: `world:${world}`,
    context: { story: state.story, kinds, prizes },
  }).then((said) => {
    const offered = validateBible(said.data);
    if (isRefusedBible(offered)) {
      say(`the worldsmith's offer was refused — ${offered.refused}`);
      return;
    }
    try {
      // The world may have moved on, switched away, or been wiped while the
      // call was out; append to where it stands NOW, or nowhere.
      const ref = getRef(refs, world);
      if (ref.head === null) return;
      const here = fold(log, ref.head);
      if (here.bible !== null) return;
      const done = append(log, ref.head, foundWorld(here, offered));
      log = done.log;
      refs = setHead(refs, world, done.event.id);
      persist();
      say(`the world is founded — ${said.name}`);
      render();

      // The judged pass, once per bible rather than once per name forever.
      // Haiku reads the whole identity against its own stated tone; the
      // verdict is shown beside the bible and gates nothing.
      oracle.consult({
        intent: 'judge',
        subject: `bible:${world}`,
        context: {
          text: [offered.anchor, offered.warden.line, ...offered.promises].join(' '),
          mechanics: `a dungeon world's founding bible; its own stated tone: ${offered.register.join(', ')}`,
        },
      }).then((verdict) => {
        bibleVerdicts.set(root, `${verdict.name} — ${verdict.line}`);
        render();
      }).catch(() => { /* the queue shows the failure; the bible stands unjudged */ });
    } catch {
      // The world it was for no longer exists; the queue already shows the
      // call, and canon was never touched.
    }
  }).catch(() => {
    // Failed calls are visible in the queue; the world plays unfounded.
  }).finally(() => {
    foundingInFlight.delete(root);
    // Whatever happened, naming may now proceed — with the palette or without.
    render();
  });
}

/** The active world's root event id — its true identity, and the scope its
 *  names are filed under. Content-addressing does the real work: forks and
 *  graves share their world's root, so they share its names by construction,
 *  while a wiped-and-remade world roots differently and names afresh.
 *  Memoised by head, because item names are asked for on every render. */
const rootMemo = new Map<string, string>();
function worldRoot(): string | undefined {
  const head = getRef(refs, active).head;
  if (head === null) return undefined;
  const remembered = rootMemo.get(head);
  if (remembered !== undefined) return remembered;
  const root = chain(log, head)[0]?.id;
  if (root !== undefined) {
    if (rootMemo.size > 4096) rootMemo.clear();
    rootMemo.set(head, root);
  }
  return root;
}

function nameWhatIsHere(state: ReturnType<typeof fold>): void {
  // The whole floor, fog or no fog, as ONE batched question. Naming used to
  // wait for line of sight and run one call per kind — and a fast player
  // outran it: two quick descents left whole rooms wearing placeholders
  // while the calls crawled home one by one. A name is a fact about a kind,
  // not a sighting — the fog still hides the thing itself; pre-naming it
  // spoils nothing and means it is already named when it steps into view.
  // Runs before any panel renders, so the singles the panels would raise
  // find the batch already in flight and stand down.
  // While this world's founding is in the air, hold the names: floor one is
  // the most-seen floor, and improvising its canon while the identity is
  // being decided puts off-palette names in the one place the palette
  // matters most. A settled founding — either way — re-renders and releases.
  const root = worldRoot();
  if (state.bible === null && root !== undefined && foundingInFlight.has(root)) return;

  // The bible rides in the context as prompt material — the cache key is
  // intent+subject alone, so a palette-guided name and an improvised one are
  // the same fact, asked once.
  const palette = state.bible === null ? {} : {
    bible: { anchor: state.bible.anchor, lexicon: state.bible.lexicon, register: state.bible.register },
  };
  const questions = [];
  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    questions.push(describeQuestion('creature', e.kind, {
      hitPoints: e.stats.hp,
      might: e.stats.might,
      speed: e.stats.speed,
      ...palette,
    }, root));
  }
  for (const i of state.items) {
    questions.push(describeQuestion('item', i.kind, { grants: i.grants, ...palette }, root));
  }
  oracle.askMany(questions);
}

/** What the world calls a kind of thing, whether or not it has answered yet. */
function calledCreature(kind: string, e: { stats: { hp: number; might: number; speed: number } }): string {
  return oracle.ask(describeQuestion('creature', kind, {
    hitPoints: e.stats.hp, might: e.stats.might, speed: e.stats.speed,
  }, worldRoot())).name;
}

/** Everything said, newest last. Restored on load, so a note outlives the tab
 *  it was typed into. */
const notes: Note[] = loadNotes();

/** The lenses, memoised by head — same history, same reading, no recompute. */
const critic = new CachedCritic();


/** What the player can currently see, so the gamemaster is not answering
 *  blind — and only what they can see, so it is not answering psychic. The
 *  character in there knows what the fog has shown them, nothing more. */
function scene(): Record<string, unknown> {
  const head = getRef(refs, active).head;
  const state = fold(log, head);
  const fog = fogAt(log, head, (p) => makeGrid(p.width, p.height, p.tiles));
  const you = state.entities[0];
  return {
    turn: state.turn,
    you: you === undefined ? null : { at: you.pos, hitPoints: you.stats.hp, might: you.stats.might },
    around: state.entities
      .filter((e) => e.kind !== 'you' && isAlive(e)
        && fog.visible.has(idx(state.grid, e.pos.x, e.pos.y)))
      .map((e) => ({ called: calledCreature(e.kind, e), at: e.pos, hitPoints: e.stats.hp })),
    underfoot: state.items
      .filter((i) => fog.seen.has(idx(state.grid, i.pos.x, i.pos.y)))
      .map((i) => ({ at: i.pos })),
    // This world's names only: the gamemaster quoting another world's canon
    // would be exactly the bleed scoping exists to end.
    named: (worldRoot() === undefined ? [] : oracle.namesIn(worldRoot()!))
      .filter((a) => a.line !== '').map((a) => a.name),
  };
}

async function speak(channel: Channel, said: string): Promise<void> {
  const head = getRef(refs, active).head;
  const state = fold(log, head);

  const note = await send(oracle, channel, said, {
    world: active, head, turn: state.turn, scene: scene(),
    // The gamemaster speaks FOR a world; the bible is which world.
    ...(state.bible === null ? {} : { bible: state.bible }),
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
 * The journal: what has happened, one fact per line, kept.
 *
 * This used to be a two-line box that each turn overwrote — combat lines were
 * clipped mid-sentence and history was gone the moment it happened, which the
 * player called out directly. Now every line appends, stamped with its turn,
 * into a fixed-height scroll (the box itself never resizes — the no-movement
 * rule holds). Newest at the bottom, auto-followed unless you have scrolled
 * up to read; PageUp/PageDown page through it from the keyboard.
 */
const journal: { turn: number; line: string }[] = [];
const JOURNAL_KEEP = 400;
/** Index of the first line of the latest batch — lit; everything before, dim. */
let freshFrom = 0;

function say(message: string | string[]): void {
  const lines = (typeof message === 'string' ? [message] : message).filter((l) => l !== '');
  if (lines.length === 0) return;
  const turn = fold(log, getRef(refs, active).head).turn;
  freshFrom = journal.length;
  for (const line of lines) journal.push({ turn, line });
  if (journal.length > JOURNAL_KEEP) {
    const dropped = journal.length - JOURNAL_KEEP;
    journal.splice(0, dropped);
    freshFrom = Math.max(0, freshFrom - dropped);
  }

  const box = el('status');
  // Follow the tail only if the reader was already at it — scrolling up to
  // read must not be yanked back down by the next footstep.
  const following = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.textContent = '';
  journal.forEach((entry, i) => {
    const row = document.createElement('span');
    row.className = i >= freshFrom ? 'line fresh' : 'line';
    const mark = document.createElement('span');
    mark.className = 'turn-mark';
    mark.textContent = `t${String(entry.turn)}`;
    row.append(mark, document.createTextNode(` ${entry.line}`));
    box.appendChild(row);
  });
  if (following) box.scrollTop = box.scrollHeight;
}

function render(): void {
  const head = getRef(refs, active).head;
  const state = fold(log, head);
  const player = state.entities[0];

  // The fog: what this timeline's player has seen, and sees. Derived from
  // the chain, so a rewind un-sees and a descent starts dark — plus whatever
  // the dead have lent: standing where you fell borrows that life's explored
  // map for this floor (knowledge, never power).
  const bare = fogAt(log, head, (p) => makeGrid(p.width, p.height, p.tiles));
  const lent = borrowedEyes.get(`${worldRoot() ?? ''}/${String(state.depth)}`);
  const fog = lent === undefined ? bare : { ...bare, seen: new Set([...bare.seen, ...lent]) };

  // Living creatures win the tile over corpses, so a body never hides a threat.
  const occupant = new Map<number, Entity>();
  for (const e of state.entities) {
    const key = idx(state.grid, e.pos.x, e.pos.y);
    const standing = occupant.get(key);
    if (standing === undefined || (!isAlive(standing) && isAlive(e))) occupant.set(key, e);
  }

  // Where earlier runs fell (WORLD_BODIES on the chain). A place rules can
  // read must be a place the eye can read — covenant L1.
  const lying = new Set(state.bodies.map((b) => idx(state.grid, b.x, b.y)));

  const grid = el('grid');
  grid.style.gridTemplateColumns = `repeat(${state.grid.width}, 15px)`;
  grid.textContent = '';
  for (let y = 0; y < state.grid.height; y += 1) {
    for (let x = 0; x < state.grid.width; x += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const at = idx(state.grid, x, y);
      const tile = state.grid.tiles[at];
      const here = occupant.get(at);

      // Three kinds of knowledge, three renders. Never seen: nothing at all —
      // not even the wall, because a mapped silhouette is knowledge too.
      // Seen but out of sight: the geometry and what lies on the floor,
      // dimmed — places and things hold still; creatures do not, so they
      // vanish from memory the moment they leave your sight.
      if (!fog.seen.has(at)) {
        cell.classList.add('veil');
        grid.appendChild(cell);
        continue;
      }
      const inView = fog.visible.has(at);

      // Whoever is standing there wins the square. The item sits on a guard by
      // design, so painting the item over the creature hid the guard every
      // single time — and a risk you cannot see is not a decision you can weigh.
      if (here !== undefined && inView) {
        if (!isAlive(here)) cell.classList.add(here.kind === 'you' ? 'you-dead' : 'dead');
        else if (here.kind === 'you') cell.classList.add('player');
        else cell.classList.add('foe');
      } else if (tile === WALL) {
        cell.classList.add('wall');
      } else if (tile === SECRET) {
        // An illusory wall paints as the wall it pretends to be until the
        // player has walked through it; after that, a passage, marked so
        // once found it is never mistaken for wall again.
        cell.classList.add(fog.revealed.has(at) ? 'passage' : 'wall');
      } else if (tile === EXIT) {
        cell.classList.add('exit');
      } else if (itemAt(state.items, x, y) !== undefined) {
        cell.classList.add('item');
      } else if (lying.has(at)) {
        // Bodies hold still like the floor does: remembered once seen,
        // dimmed out of sight, never vanishing the way creatures do.
        cell.classList.add('body');
      }

      // A guarded prize still needs to read as a prize, so mark the square even
      // when something is standing on it — but only while you can see them.
      if (inView && here !== undefined && itemAt(state.items, x, y) !== undefined) {
        cell.classList.add('guarding');
      }
      if (!inView) cell.classList.add('dim');
      grid.appendChild(cell);
    }
  }

  if (head !== null) foundThisWorld(state, head);
  nameWhatIsHere(state);

  // ── what you decide on, beside the map ─────────────────────────────────
  const exitAt = state.grid.tiles.indexOf(EXIT);
  const exitPos = exitAt < 0 ? null : { x: exitAt % state.grid.width, y: Math.floor(exitAt / state.grid.width) };
  // A compass to a place you have not found is knowledge you do not have.
  const toExit = player === undefined || exitPos === null
    ? '—'
    : fog.seen.has(exitAt)
      ? `${Math.abs(exitPos.x - player.pos.x) + Math.abs(exitPos.y - player.pos.y)} away`
      : 'not yet found';

  const hurt = player !== undefined && player.stats.hp <= 3;
  const done = outcome(state);

  // What a piece of gear does, said with its numbers — "whetted blade +2
  // might". The row exists because a prize refused ("why didn't I pick that
  // up?") is only explicable when what you already hold shows its worth.
  // Named by the WORLD's name for it, not the table's kind: you picked up a
  // "whetted blade", and a rail that calls it "keen edge" is two names for
  // one thing — the exact contradiction canon exists to prevent.
  const wornIn = (slot: string): string => {
    const g = player?.gear?.[slot];
    if (g === undefined) return '—';
    const called = oracle.ask(describeQuestion('item', g.kind, { grants: g.grants }, worldRoot())).name;
    const parts = [
      g.grants.might === 0 ? '' : `+${g.grants.might} might`,
      g.grants.hp === 0 ? '' : `+${g.grants.hp} hp`,
      g.grants.speed === 0 ? '' : `+${g.grants.speed} speed`,
      g.grants.wits === 0 ? '' : `+${g.grants.wits} wits`,
    ].filter((p) => p !== '');
    return `${called} ${parts.join(' ')}`;
  };

  // A row is either one value or independently-glowing segments. Segments
  // exist because the stats row glowed whole when any one stat rose — a +2
  // might edge lit speed and wits too, and a glow that lies is worse than no
  // glow at all.
  type Seg = { key: string; text: string };
  const vitals: Array<[string, string | Seg[], string]> = [
    ['this run', done, done === 'dead' ? 'urgent' : done === 'escaped' || done === 'won' ? 'good' : ''],
    ['hit points', player === undefined ? '—' : `${player.stats.hp} / ${player.maxHp}`, hurt ? 'urgent' : ''],
    ['level', (() => {
      const next = XP_TO_REACH[state.level + 1];
      return next === undefined ? `${state.level} · ${state.xp} xp` : `${state.level} · ${state.xp}/${next} xp`;
    })(), ''],
    ['you deal', player === undefined ? '—' : (() => { const d = damageDice(player.stats.might); return `${1 + d.flat}–${d.die + d.flat}`; })(), ''],
    ['might · speed · wits', player === undefined ? '—' : [
      { key: 'might', text: String(player.stats.might) },
      { key: 'speed', text: String(player.stats.speed) },
      { key: 'wits', text: String(player.stats.wits) },
    ], ''],
    ['wielding', wornIn('weapon'), ''],
    ['wearing', player === undefined ? '—' : [
      { key: 'armor', text: wornIn('armor') },
      { key: 'boots', text: wornIn('boots') },
      { key: 'trinket', text: wornIn('trinket') },
    ], ''],
    // The satchel: carried, not worn — under the world's name for it, with
    // the one thing to know (q spends it) said right there.
    ['satchel', player?.satchel === undefined ? 'empty' : `${
      oracle.ask(describeQuestion('item', player.satchel.kind, {}, worldRoot())).name
    } — q to use`, ''],
    ...(state.smoke !== null && state.turn < state.smoke.until
      ? [['the air', `smoke holds for ${state.smoke.until - state.turn} more turn(s) — hunts chase where you were`, 'good'] as [string, string, string]]
      : []),
    ['the way out', toExit, done === 'escaped' ? 'good' : ''],
    ['standing at', player === undefined ? '—' : `${player.pos.x}, ${player.pos.y}`, ''],
    ['turn', String(state.turn), ''],
    ['world', active, ''],
    ['depth', String(state.depth), ''],
  ];

  // A changed value shows its history for a few turns: what it was (orange),
  // then what it is (green) — "1–4 → 3–6" — so a pickup or a level explains
  // itself in place. Only rows that change rarely; position and the turn
  // counter change every step, and a glow that is always on means nothing.
  const NOTABLE = ['hit points', 'level', 'you deal', 'might · speed · wits', 'wielding', 'wearing', 'satchel', 'depth'];
  const remember = (key: string, value: string): { lit: boolean; was: string } => {
    const prior = lastVitals.get(key);
    if (prior === undefined) {
      lastVitals.set(key, { value, was: value, until: 0 });
      return { lit: false, was: value };
    }
    if (prior.value !== value) {
      lastVitals.set(key, { value, was: prior.value, until: state.turn + 3 });
    }
    const mark = lastVitals.get(key)!;
    return { lit: mark.until >= state.turn && mark.until > 0, was: mark.was };
  };
  const beforeAfter = (into: HTMLElement, was: string, now: string): void => {
    const old = document.createElement('span');
    old.className = 'was';
    old.textContent = was;
    const fresh = document.createElement('span');
    fresh.className = 'now';
    fresh.textContent = now;
    into.append(old, document.createTextNode(' → '), fresh);
  };

  // What each number IS, on hover — the derivation with today's values in it,
  // not a rulebook reference. Covenant L1 at the row level: a stat you cannot
  // interrogate is a stat you take on faith.
  const tips = new Map<string, string>();
  if (player !== undefined) {
    const p = player.stats;
    const d = damageDice(p.might);
    // The next damage band, found by asking the table rather than copying it.
    let nextAt = 0;
    for (let m = p.might + 1; m <= p.might + 8; m += 1) {
      const n = damageDice(m);
      if (n.die !== d.die || n.flat !== d.flat) { nextAt = m; break; }
    }
    const next = nextAt === 0 ? '' : (() => {
      const n = damageDice(nextAt);
      return ` might ${nextAt} reaches the next band: ${1 + n.flat}–${n.die + n.flat}.`;
    })();
    const gearHp = Object.values(player.gear ?? {}).reduce((n, g) => n + (g?.grants.hp ?? 0), 0);
    const levelHp = 2 * (state.level - 1);
    const born = player.maxHp - levelHp - gearHp;

    tips.set('might', `how hard you hit. sets your damage dice — now ${1 + d.flat}–${d.die + d.flat} — and what a blow of yours needs: 10 + their speed − ${p.might}, on a d20.`);
    tips.set('speed', `how hard you are to hit. a creature needs 10 + ${p.speed} − its might on a d20 to land a blow on you.`);
    tips.set('wits', `how wide your crit window is: you crit on ${critFloor(p.wits)}–20. a crit always lands and doubles its damage. the window widens one step per 4 wits.`);
    tips.set('hit points', `${p.hp} of a ceiling of ${player.maxHp}: ${born} at birth + ${levelHp} from levels + ${gearHp} from what you wear. wounds close whole at each level, and on the stairs of a cleared floor.`);
    tips.set('you deal', `1d${d.die}+${d.flat} each blow that lands — the band your might ${p.might} sits in.${next} a crit doubles the roll.`);
  }
  // The native title only. The first cut drew its own styled box as well,
  // and the two tooltips stacked — one popup per question is the rule.
  const tipped = (node: HTMLElement, key: string): void => {
    const text = tips.get(key);
    if (text === undefined) return;
    node.classList.add('tip');
    node.title = text;
  };

  const vitalsEl = el('vitals');
  vitalsEl.textContent = '';
  for (const [label, value, tone] of vitals) {
    const dt = document.createElement('dt');
    if (label === 'might · speed · wits') {
      // Three words, three tooltips — the row is one label but the stats are
      // not one stat.
      (['might', 'speed', 'wits'] as const).forEach((word, i) => {
        if (i > 0) dt.append(document.createTextNode(' · '));
        const span = document.createElement('span');
        span.textContent = word;
        tipped(span, word);
        dt.append(span);
      });
    } else {
      dt.textContent = label;
      tipped(dt, label);
    }
    const dd = document.createElement('dd');
    if (tone !== '') dd.className = tone;
    tipped(dd, label);

    if (typeof value === 'string') {
      if (NOTABLE.includes(label)) {
        const mark = remember(label, value);
        if (mark.lit) {
          dd.className = `${dd.className} changed`.trim();
          beforeAfter(dd, mark.was, value);
        } else {
          dd.textContent = value;
        }
      } else {
        dd.textContent = value;
      }
    } else {
      value.forEach((seg, i) => {
        if (i > 0) dd.append(document.createTextNode(' · '));
        const span = document.createElement('span');
        const mark = remember(`${label}#${seg.key}`, seg.text);
        if (mark.lit) {
          span.className = 'changed';
          beforeAfter(span, mark.was, seg.text);
        } else {
          span.textContent = seg.text;
        }
        tipped(span, seg.key);
        dd.append(span);
      });
    }
    vitalsEl.append(dt, dd);
  }

  // ── what is here, and what it costs ────────────────────────────────────
  // The play panel knows what the fog knows: items once seen (they hold
  // still), creatures only while in sight (they do not).
  const threats = el('threats');
  threats.textContent = '';

  for (const i of state.items) {
    if (!fog.seen.has(idx(state.grid, i.pos.x, i.pos.y))) continue;
    const called = oracle.ask(describeQuestion('item', i.kind, { grants: i.grants }, worldRoot())).name;
    const li = document.createElement('li');
    li.style.borderLeftColor = 'var(--item)';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = called;
    const odds = document.createElement('span');
    odds.className = 'odds';
    const reach = player === undefined ? '?' : Math.abs(i.pos.x - player.pos.x) + Math.abs(i.pos.y - player.pos.y);
    // Say what it actually grants — this row once printed "+0 might" on an
    // iron charm, which is the opposite of an explanation.
    const gives = [
      i.grants.might === 0 ? '' : `+${i.grants.might} might`,
      i.grants.hp === 0 ? '' : `+${i.grants.hp} hp`,
      i.grants.speed === 0 ? '' : `+${i.grants.speed} speed`,
      i.grants.wits === 0 ? '' : `+${i.grants.wits} wits`,
    ].filter((g) => g !== '').join(' ');
    odds.textContent = `${reach} away · ${gives}`;
    li.append(who, odds);
    threats.appendChild(li);
  }

  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    const standing = idx(state.grid, e.pos.x, e.pos.y);
    // A living creature is knowledge only while watched; a corpse stays
    // where it fell, so a seen tile is enough.
    if (isAlive(e) ? !fog.visible.has(standing) : !fog.seen.has(standing)) continue;
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
      const swing = (m: number): string => {
        const { die, flat } = damageDice(m);
        return `${1 + flat}–${die + flat}`;
      };
      // A coiled thing's stillness is the tell — the rail says it out loud,
      // and warns what the spring costs (one damage band harder).
      const coiled = e.tags.includes('ambush') ? ' · coiled — its first blow lands harder' : '';
      odds.textContent = player === undefined
        ? `hp ${e.stats.hp}`
        : `hp ${e.stats.hp} · ${away} away · you ${pct(player, e)} ${swing(player.stats.might)} · it ${pct(e, player)} ${swing(e.stats.might)}${coiled}`;
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
  // ── this world, decided whole — the bible, on screen (covenant L1) ─────
  const bibleEl = el('bible');
  bibleEl.textContent = '';
  const thisRoot = worldRoot();
  const judged = thisRoot === undefined ? undefined : bibleVerdicts.get(thisRoot);
  const bibleRows: Array<[string, string]> = state.bible === null
    ? [['identity', 'unfounded — the world improvises, name by name']]
    : [
      ['anchor', state.bible.anchor],
      ['speaks in', state.bible.lexicon.join(' · ')],
      ['the warden', `${state.bible.warden.name} — ${state.bible.warden.line}`],
      ...(state.bible.promises.length === 0 ? [] : [['promises', state.bible.promises.join(' · ')] as [string, string]]),
      ...(state.bible.register.length === 0 ? [] : [['tone', state.bible.register.join(' · ')] as [string, string]]),
      ...(judged === undefined ? [] : [['the judge reads', judged] as [string, string]]),
    ];
  for (const [name, value] of bibleRows) {
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    dd.textContent = value;
    bibleEl.append(dt, dd);
  }

  const detail = el('detail');
  detail.textContent = '';
  for (const [label, value] of [
    // The generator's own account of this floor — covenant L1. A map whose
    // shape cannot be read cannot be checked.
    ['this floor', state.story === '' ? '—' : state.story],
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

  // ── the ledger: the run's decision chain, read off the chain ───────────
  // Every floor's recorded generation account and every law with its why,
  // oldest first. Nothing here is tracked separately — it is the event log
  // wearing its reasoning on the outside, which is what makes it true for
  // any fork, any rewind, any replay.
  const ledger = el('ledger');
  ledger.textContent = '';
  for (const event of chain(log, head)) {
    if (event.type === 'WORLD_INIT') {
      const li = document.createElement('li');
      const said = document.createElement('span');
      said.className = 'rule-said';
      said.textContent = `depth ${String(event.payload.depth ?? 1)} born`;
      const why = document.createElement('span');
      why.className = 'rule-why';
      why.textContent = event.payload.story ?? 'a floor from before floors told their stories';
      li.append(said, why);
      ledger.appendChild(li);
    } else if (event.type === 'RULE_RATIFIED') {
      const li = document.createElement('li');
      const said = document.createElement('span');
      said.className = 'rule-said';
      said.textContent = `law — ${readRule(event.payload.rule)}`;
      const why = document.createElement('span');
      why.className = 'rule-why';
      why.textContent = event.payload.rule.provenance.because;
      li.append(said, why);
      ledger.appendChild(li);
    }
  }
  ledger.scrollTop = ledger.scrollHeight;

  // ── through the fog: the developer's eyes ──────────────────────────────
  // The play surfaces above honour the fog; this list does not, on purpose.
  // Someone building the game needs to see what the player cannot yet — and
  // needs it labelled, so a bug in the fog is visible as a disagreement
  // between this list and the map.
  const omni = el('omniscient');
  omni.textContent = '';
  for (const e of state.entities) {
    if (e.kind === 'you') continue;
    const li = document.createElement('li');
    const known = fog.visible.has(idx(state.grid, e.pos.x, e.pos.y));
    li.textContent = `${e.kind} at ${e.pos.x},${e.pos.y} · hp ${e.stats.hp}${known ? '' : ' · unseen by the player'}`;
    if (!known) li.className = 'idle';
    omni.appendChild(li);
  }
  for (const i of state.items) {
    const li = document.createElement('li');
    const known = fog.seen.has(idx(state.grid, i.pos.x, i.pos.y));
    li.textContent = `${i.kind} at ${i.pos.x},${i.pos.y}${known ? '' : ' · unseen by the player'}`;
    if (!known) li.className = 'idle';
    omni.appendChild(li);
  }
  if (exitPos !== null) {
    const li = document.createElement('li');
    const known = fog.seen.has(exitAt);
    li.textContent = `the way out at ${exitPos.x},${exitPos.y}${known ? '' : ' · unseen by the player'}`;
    if (!known) li.className = 'idle';
    omni.appendChild(li);
  }
  for (const b of state.bodies) {
    const li = document.createElement('li');
    const known = fog.seen.has(idx(state.grid, b.x, b.y));
    li.textContent = `a body — yours — at ${b.x},${b.y}${known ? '' : ' · unseen by the player'}`;
    if (!known) li.className = 'idle';
    omni.appendChild(li);
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
  // This world's voice, not the install's: each world names its own.
  const spokenScope = worldRoot();
  const said = (spokenScope === undefined ? [] : oracle.namesIn(spokenScope))
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
        oracle.reject(a.name, spokenScope);
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
      // Another world is another character's story: their gear diffed
      // against this one's would light nonsense.
      lastVitals.clear();
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
    if (event.type === 'MOVE' && event.payload.entityId === 'player'
        && tileAt(state.grid, event.payload.to.x, event.payload.to.y) === SECRET) {
      lines.push('the wall gives way — it was never a wall');
      continue;
    }
    // The coiled thing has committed: its first movement is the tell, and
    // the tell arrives before any blow can — a spring you were warned about.
    if (event.type === 'MOVE' && event.payload.entityId !== 'player') {
      const mover = state.entities.find((x) => x.id === event.payload.entityId);
      if (mover !== undefined && mover.tags.includes('ambush')) {
        lines.push(`${named(state, mover.id)} stirs from its stillness`);
      }
      continue;
    }
    if (event.type === 'VIGIL_KEPT') {
      lines.push(`${named(state, event.payload.entityId)} resumes its vigil — its wounds knit shut`);
      continue;
    }
    if (event.type === 'ITEM_USED') {
      const p = event.payload;
      const drunk = oracle.ask(describeQuestion('item', p.kind, {}, worldRoot())).name;
      if (p.effect.kind === 'draught') {
        lines.push(`you drink ${drunk} — whole again, and your ceiling rises to ${p.effect.ceilingTo}`);
      } else {
        lines.push(`${drunk} swallows the floor — the hunts chase where you were${
          p.effect.unfooled.length > 0 ? ', but what stands beside you is not fooled' : ''}`);
      }
      continue;
    }
    if (event.type === 'ITEM_TAKEN' && event.payload.satchel !== undefined) {
      const swapped = event.payload.satchel.swappedOut;
      const takenKind = state.items.find((i) => i.id === event.payload.itemId)?.kind;
      if (takenKind === HEART_KIND) {
        lines.push(`you take up ${calledItem(event.payload.itemId, state)} — your hands are full now, and the way out is the stair you came down by`);
        continue;
      }
      lines.push(`${calledItem(event.payload.itemId, state)} goes into your satchel${
        swapped === null ? '' : ` — your ${
          oracle.ask(describeQuestion('item', swapped, {}, worldRoot())).name
        } stays where this one lay`}`);
      continue;
    }
    if (event.type === 'WORLD_STIRRED') {
      const echoes = event.payload.opponents.filter((o) => o.kind === 'echo').length;
      const others = event.payload.opponents.length - echoes;
      if (echoes > 0) {
        lines.push(`the floor gives up its dead — ${echoes === 1 ? 'an echo of you rises' : `${echoes} echoes of you rise`} where the bodies lie`);
      }
      if (others > 0) lines.push('the world stirs — something rises in the far dark');
      continue;
    }
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
      // Say the swap when there is one: what came off matters as much as what
      // went on — under the world's name for it, same as the rail.
      const takerBefore = state.entities.find((x) => x.id === event.payload.entityId);
      const slotName = slotOf(event.payload.grants);
      const shed = takerBefore?.gear?.[slotName];
      const swap = shed === undefined ? '' : ` · your ${
        oracle.ask(describeQuestion('item', shed.kind, { grants: shed.grants }, worldRoot())).name
      } is set down`;
      lines.push(`you take up ${calledItem(event.payload.itemId, state)} — ${deltas.join(', ')}${swap}`);
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
    // A crit narrates as what it is; the register stays quiet about it.
    const clean = p.crit ? ' — clean through' : '';
    // The verbs narrate as themselves: the lunge's crossing, the spring's
    // release, the trample's shove. A mechanic nothing says is a mechanic
    // nobody feels — the whole reason the bestiary read as identical.
    const lunged = !mine && p.attackerTo !== undefined && p.targetTo === undefined ? `${them} lunges — ` : '';
    const sprung = p.ambush === true && !mine ? `${them} springs from its stillness — ` : '';
    const shoved = p.targetTo !== undefined && p.targetId === 'player'
      ? ` — the blow drives you back a pace and ${them} lumbers after`
      : '';
    lines.push(mine
      ? (p.hit ? `you hit ${them} for ${p.damage}${clean} ${roll}` : `you miss ${them} ${roll}`)
      : (p.hit
        ? `${sprung}${lunged}${them} hits you for ${p.damage}${clean} ${roll}${shoved}`
        : `${lunged}${them} misses you ${roll}`));
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
  return oracle.ask(describeQuestion('item', i.kind, { grants: i.grants }, worldRoot())).name;
}

function finish(before: number, head: string): void {
  const events = chain(log, head);
  const priorEvent = events[before - 1];
  const priorState = priorEvent === undefined ? fold(log, head) : fold(log, priorEvent.id);
  const told = narrate(events.slice(before), priorState);

  // A prize refused, explained. Stepping onto a relic no better than what you
  // hold produces no event at all — the one case where the engine's silence
  // reads as a bug ("why would I not pick this up?"), so the view says the
  // comparison out loud, with what you hold and its numbers.
  const nowHere = fold(log, head);
  const me = nowHere.entities[0];
  const fresh = events.slice(before);
  if (me !== undefined
    && fresh.some((e) => e.type === 'MOVE' && e.payload.entityId === 'player')
    && !fresh.some((e) => e.type === 'ITEM_TAKEN')) {
    const underfoot = itemAt(nowHere.items, me.pos.x, me.pos.y);
    const worn = underfoot === undefined ? undefined : me.gear?.[slotOf(underfoot.grants)];
    if (underfoot !== undefined && worn !== undefined) {
      told.push(`the ${calledItem(underfoot.id, nowHere)} is no better than your ${worn.kind} — it stays where it lies`);
    }
  }

  // Stairs are stairs: stepping onto the way out goes down, no button, no
  // pause. The rules re-ratify and the player crosses whole inside descend().
  const here = fold(log, head);
  if (outcome(here) === 'escaped') {
    const down = descend(log, refs, active, { width: WIDTH, height: HEIGHT });
    if (down !== null) {
      log = down.log;
      refs = down.refs;
      const cleared = !here.entities.some((e) => e.kind !== 'you' && e.stats.hp > 0);
      told.push(cleared
        ? `down. depth ${down.depth} — the floor was yours, and your wounds close on the stairs`
        : `down. depth ${down.depth} — it is colder here`);
      // The floor before each warden whispers its promise (2, 5, 8) — the
      // bible keeping its word on the way down.
      const landed = fold(log, getRef(refs, active).head);
      const whichPromise = down.depth === 2 ? 0 : down.depth === 5 ? 1 : down.depth === 8 ? 2 : null;
      if (whichPromise !== null) {
        const whispered = promiseLine(landed, whichPromise, 'whisper');
        if (whispered !== null) told.push(whispered);
      }
      persist();
      say(told);
      render();
      return;
    }
  }

  // The ease tooth, said out loud: growth and the full heal arrive together,
  // and a level a player does not notice buys no relief at all.
  const nowState = fold(log, head);
  if (nowState.level > priorState.level) {
    told.push(`you are level ${nowState.level}. your wounds close; something settles into place`);
  }

  // Finding your own body says so. What finding it CONFERS is deliberately
  // undecided — the designer marked that choice for later — and the line
  // says exactly that in the world's own voice, because this is a game
  // whose rules evolve: the Forge may yet be the one to answer it.
  // Read from the chain (state.bodies, laid by the rebirth and descent
  // ceremonies) — the same truth rules, bots and the map read, one source.
  const lying = new Set(nowState.bodies.map((b) => idx(nowState.grid, b.x, b.y)));
  if (lying.size > 0) {
    for (const e of events.slice(before)) {
      if (e.type === 'MOVE' && e.payload.entityId === 'player'
          && lying.has(idx(nowState.grid, e.payload.to.x, e.payload.to.y))) {
        // The graves' covenant, decided: knowledge, never power. Standing
        // where you fell borrows that life's eyes — its explored floor joins
        // your map — and at the bottom, the same dead will rise against you.
        const lent = borrowDeadEyes(nowState, { x: e.payload.to.x, y: e.payload.to.y });
        told.push(lent
          ? 'you stand where you fell. that life lends you its eyes — the floor it knew joins your map'
          : 'you stand where you fell. its eyes are already yours');
        break;
      }
    }
  }

  // A warden down is a promise kept (3, 6, 9) — the confirmation beat.
  if (nowState.depth % 3 === 0) {
    for (const e of events.slice(before)) {
      if (e.type !== 'STRIKE' || !e.payload.hit) continue;
      const victim = nowState.entities.find((x) => x.id === e.payload.targetId);
      if (victim === undefined || !victim.kind.startsWith('warden') || victim.stats.hp > 0) continue;
      const kept = promiseLine(nowState, nowState.depth / 3 - 1, 'kept');
      if (kept !== null) told.push(kept);
      break;
    }
  }

  // The ending, said the moment it happens: heart in hand, standing on the
  // stair you came down by.
  if (outcome(nowState) === 'won' && outcome(priorState) !== 'won') {
    told.push('the heart crosses the threshold. this world is won — it keeps your name');
  }

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
    told.push('the world is reading your death back');
    proposeFromDeath(burial.grave);
  }
  say(told);
  render();
}

/* ── the promises, kept ──────────────────────────────────────────────────
 *
 * The bible's foreshadowings pay out on the way down: a whisper on the
 * floor before each warden (2, 5, 8), the confirmation when the warden
 * falls (3, 6, 9). First delivery per world speaks the whole line; a
 * reborn run re-descending the same world hears nothing again — a promise
 * repeated on schedule is a recording, not a voice. */
const BEATS_KEY = 'evolving-rpg/promises-heard/v1';

function heardBeats(): Set<string> {
  try {
    const raw = window.localStorage.getItem(BEATS_KEY);
    return new Set(raw === null ? [] : JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function promiseLine(state: ReturnType<typeof fold>, which: number, phase: 'whisper' | 'kept'): string | null {
  if (state.bible === null) return null;
  const p = state.bible.promises[which];
  if (p === undefined) return null;
  const key = `${worldRoot() ?? ''}/${String(which)}/${phase}`;
  const heard = heardBeats();
  if (heard.has(key)) return null;
  try {
    window.localStorage.setItem(BEATS_KEY, JSON.stringify([...heard.add(key)]));
  } catch { /* quota; it may whisper twice, which is survivable */ }
  return phase === 'whisper' ? `something below keeps its word — “${p}”` : `the promise holds — “${p}”`;
}

/* Standing where you fell lends you that life's eyes: the floor as the dead
 * run knew it joins your map. Knowledge, never power — the graves' whole
 * covenant — and pure event-sourcing: the dead life's exploring is already
 * on its timeline, waiting to be read. Session-borrowed, per floor. */
const borrowedEyes = new Map<string, Set<number>>();

function borrowDeadEyes(state: ReturnType<typeof fold>, at: { x: number; y: number }): boolean {
  const key = `${worldRoot() ?? ''}/${String(state.depth)}`;
  for (const ref of listRefs(refs)) {
    if (!isGrave(ref.name) || !ref.name.startsWith(`${active}†`) || ref.head === null) continue;
    const gs = fold(log, ref.head);
    if (gs.depth !== state.depth) continue;
    const fallen = gs.entities.find((e) => e.kind === 'you');
    if (fallen === undefined || fallen.pos.x !== at.x || fallen.pos.y !== at.y) continue;
    const dead = fogAt(log, ref.head, (p) => makeGrid(p.width, p.height, p.tiles));
    const pool = borrowedEyes.get(key) ?? new Set<number>();
    const before = pool.size;
    for (const seen of dead.seen) pool.add(seen);
    borrowedEyes.set(key, pool);
    return pool.size > before;
  }
  return false;
}

/** Graves that have already provoked a proposal, so one death asks once —
 *  renders repeat, and a paid forty-second call must not. */
const provokedGraves = new Set<string>();

/**
 * Dying provokes the world: the run that just killed you is read back and a
 * rule is proposed, unasked. The one exception to "asking happens when you
 * press the button" — the designer ruled that a death is the button. The
 * summary is taken AT death, so beginning again while the world thinks
 * cannot blur which run it is reading; the Forge opens on its own only when
 * the offer actually arrives, so you stare at your corpse in peace first.
 */
function proposeFromDeath(grave: string): void {
  if (provokedGraves.has(grave) || asking) return;
  provokedGraves.add(grave);

  const head = getRef(refs, active).head;
  const state = fold(log, head);
  if (state.rules.length >= MAX_RULES) return;

  asking = true;
  askingSince = Date.now();
  lastRun = summariseRun(chain(log, head), state, notes, active);

  void proposeRule(oracle, lastRun, state.rules, new Date().toISOString()).then((got) => {
    asking = false;
    if (isRejected(got)) {
      pending = null;
      say(`no rule from this death — ${got.rejected}`);
      renderForge();
      render();
      return;
    }
    pending = got;
    pendingFromBench = false;
    edited = null;
    el('editor').hidden = true;
    renderForge();
    if (!forge.open) forge.showModal();
    render();
  });
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

function use(): void {
  const head = getRef(refs, active).head;
  if (head === null) return;

  const state = fold(log, head);
  const you = state.entities.find((e) => e.kind === 'you');
  if (you?.satchel === undefined) {
    say('your satchel is empty');
    return;
  }

  const before = chain(log, head).length;
  const spent = playerUse({ log, head }, 'player');
  if (spent.draft === null) {
    // Held, but not a tool — the heart, most likely.
    say(`what you carry is not a thing you use`);
    return;
  }
  const after = runWorldTurns(spent.position, 'player');
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

/**
 * Every key the page answers to, in one table. The table renders the help
 * sheet AND drives the dispatch, so the help cannot drift from the truth —
 * they are the same object. Covenant L1, applied to the keyboard.
 *
 * Button keys .click() the real button rather than calling its function, so
 * a key and a mouse take exactly one code path each.
 */
const KEYMAP: ReadonlyArray<{ shown: string; what: string; button?: string }> = [
  { shown: '← ↑ → ↓ · wasd', what: 'move — into a creature is a strike, into a wall is free' },
  { shown: '. · space', what: 'hold still (this is a turn)' },
  { shown: 'q', what: 'use what the satchel holds (this is a turn too)' },
  { shown: 'PgUp · PgDn', what: 'read back through the journal' },
  { shown: 'n', what: 'world… — begin again / another / wipe', button: 'open-worlds' },
  { shown: 'g', what: 'the forge — ask the world for a rule', button: 'open-forge' },
  { shown: 'm', what: 'the gamemaster’s screen — channels, lenses, rules, names, the ledger', button: 'open-screen' },
  { shown: '1 · 2', what: 'in the screen: write to the designer · to the gamemaster' },
  { shown: 'r', what: 'begin this world again, straight away', button: 'again' },
  { shown: 'v', what: 'verify every hash and counter in the chain', button: 'verify' },
  { shown: 'f', what: 'fork a new timeline from this moment', button: 'fork' },
  { shown: 'b', what: 'rewind 10 events (the log keeps them)', button: 'rewind' },
  { shown: '?', what: 'this sheet', button: 'open-help' },
  { shown: 'esc', what: 'close a sheet · leave a writing box' },
  { shown: 'enter', what: 'send, in a writing box' },
];

const BUTTON_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  KEYMAP.filter((k) => k.button !== undefined).map((k) => [k.shown, k.button!]),
);

window.addEventListener('keydown', (event) => {
  // Typing into a channel is not playing. Without this, writing "search the
  // wall" walks you four squares west. Escape steps back out of the box —
  // and only out of the box: inside a sheet it must not also close the
  // sheet, or one keypress destroys the draft and the room it was typed in.
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]') !== null) event.preventDefault();
      target.blur();
    }
    return;
  }

  // An open sheet owns the keyboard: Escape closes and Enter presses its
  // focused button natively. Game keys through a dialog would be play you
  // cannot see. The gamemaster's screen adds two of its own: a number picks
  // up a pen.
  if (document.querySelector('dialog[open]') !== null) {
    const screen = el('gm-screen') as HTMLDialogElement;
    if (screen.open && (event.key === '1' || event.key === '2')) {
      event.preventDefault();
      el(event.key === '1' ? 'designer-said' : 'gm-said').focus();
    }
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return;

  // Paging the journal — the log is readable history, and history needs keys.
  if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault();
    const box = el('status');
    box.scrollBy({ top: (event.key === 'PageUp' ? -1 : 1) * box.clientHeight });
    return;
  }

  if (event.key === '.' || event.key === ' ') {
    event.preventDefault();
    hold();
    return;
  }
  if (event.key === 'q') {
    event.preventDefault();
    use();
    return;
  }
  const move = KEYS[event.key];
  if (move !== undefined) {
    event.preventDefault();
    step(move[0], move[1]);
    return;
  }

  const pressed = BUTTON_KEYS[event.key];
  if (pressed !== undefined) {
    event.preventDefault();
    el(pressed).click();
  }
});

// The help sheet is the KEYMAP, rendered. Nothing to keep in sync.
const helpSheet = el('help') as HTMLDialogElement;
el('open-help').addEventListener('click', () => {
  const dl = el('keymap');
  dl.textContent = '';
  for (const k of KEYMAP) {
    const dt = document.createElement('dt');
    dt.textContent = k.shown;
    const dd = document.createElement('dd');
    dd.textContent = k.what;
    dl.append(dt, dd);
  }
  helpSheet.showModal();
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

/* The wardens' bench: laws proposed by the world during bot runs, trialled
 * sound, and judged worth offering (runs/endorsed/, served by the dev
 * server). They arrive as ordinary proposals in the ordinary slot — same
 * accept / edit… / reject, same finalise gate. The bench earns a hearing,
 * never a bypass. A refusal is remembered, so a law you turned down does
 * not knock again on every reload. */
const BENCH_PASSED_KEY = 'evolving-rpg/bench-passed/v1';
const bench: Rule[] = [];
let pendingFromBench = false;

function benchPassed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(BENCH_PASSED_KEY);
    return new Set(raw === null ? [] : JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function passBench(said: string): void {
  try {
    window.localStorage.setItem(BENCH_PASSED_KEY, JSON.stringify([...benchPassed().add(said)]));
  } catch { /* quota; the refusal holds for this session at least */ }
}

function fetchBench(): void {
  void fetch('/__endorsed')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: unknown) => {
      if (!Array.isArray(rows)) return;
      const passed = benchPassed();
      const already = new Set(rulesInForce().map((r) => readRule(r)));
      for (const row of rows) {
        const { file, draft } = row as { file?: unknown; draft?: unknown };
        // Bench files are bare drafts (the loop writes rules without
        // identity); the validator demands one. Named for their file, with
        // a fixed stamp — accept re-finalises with the real moment anyway.
        const rule = validateRule({
          id: `bench:${typeof file === 'string' ? file.replace(/\.rule\.json$/u, '') : 'law'}`,
          ratifiedAt: '2026-07-27T00:00:00.000Z',
          ...(typeof draft === 'object' && draft !== null ? draft : {}),
        });
        if (isRejected(rule)) continue;
        const said = readRule(rule);
        if (passed.has(said) || already.has(said)) continue;
        bench.push(rule);
      }
      if (bench.length > 0) {
        say(`the wardens left ${String(bench.length)} law(s) on the bench — the forge (g) will hear them`);
        // The forge opens when an offer lands — the death-proposal precedent.
        // Accepting stays a button; arriving does not.
        renderForge();
        if (!forge.open) forge.showModal();
        render();
      }
    })
    .catch(() => { /* no bench, no offers — the game does not care */ });
}

function renderForge(): void {
  const state = fold(log, getRef(refs, active).head);
  const done = outcome(state);
  const inForce = state.rules.length;

  el('forge-state').textContent = inForce >= MAX_RULES
    ? `This world holds all ${MAX_RULES} rules it can. Fork it to keep going.`
    : done === 'playing'
      ? `This run is still going. The world proposes when a run ends — ${inForce} rule(s) in force.`
      : `This run ended: ${done}. A death is read back on its own; you can also ask — ${inForce} in force.`;

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

  // The bench speaks only when nothing else is pending — same slot, same
  // gate, and a live ask or a death's own proposal always outranks it.
  if (pending === null && !asking && inForce < MAX_RULES) {
    const already = new Set(state.rules.map((r) => readRule(r)));
    let next = bench.shift();
    while (next !== undefined && already.has(readRule(next))) next = bench.shift();
    if (next !== undefined) {
      pending = next;
      pendingFromBench = true;
      edited = null;
      el('editor').hidden = true;
    }
  }

  const box = el('proposal');
  if (pending === null) { box.hidden = true; return; }
  box.hidden = false;

  el('proposal-said').textContent = readRule(pending);
  el('proposal-why').textContent = pending.provenance.because;
  const cites = pending.provenance;
  const lensBit = cites.lenses.length === 0 ? ''
    : ` · citing lens${cites.lenses.length === 1 ? '' : 'es'} ${cites.lenses.map((n) => `#${n}`).join(', ')}`;
  el('proposal-cites').textContent = pendingFromBench
    ? 'carried in from the wardens\' bench — proposed by the world over bot runs, trialled sound, endorsed by the rules-warden'
    : `answering ${cites.events.length} event(s) and ${cites.notes.length} of your note(s)${lensBit}`;

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

  if (takesMotif(kind)) {
    const motifSel = document.createElement('select');
    for (const m of MOTIF_NAMES) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      if (m === current['motif']) opt.selected = true;
      motifSel.appendChild(opt);
    }
    motifSel.addEventListener('change', () => { onChange({ ...current, motif: motifSel.value }); });
    row.appendChild(motifSel);
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

// The gamemaster's screen: everything behind the game — the two channels,
// the lenses, rules, names, the ask queue, worlds, the ledger, the
// floorboards, the fog's other side — one sheet, one key. The play surface
// keeps the map, the journal and you; the machinery waits behind m.
el('open-screen').addEventListener('click', () => {
  (el('gm-screen') as HTMLDialogElement).showModal();
});

// Beginning again without having to die for it. The rules stay; everything
// else goes back to the start. Lives in the world sheet, but the `r` key
// presses it directly — dying is frequent enough to deserve one keystroke.
el('again').addEventListener('click', () => {
  const kept = fold(log, getRef(refs, active).head).rules.length;
  const begun = beginAgain(log, refs, active);
  log = begun.log;
  refs = begun.refs;
  // A fresh run is a fresh sheet: diffing turn 1 against the death that
  // ended the last run would glow with borrowed history.
  lastVitals.clear();
  persist();
  say(kept === 0
    ? 'back to the start of this world'
    : `back to the start of this world, still under ${kept} rule(s)`);
  if (sheet.open) sheet.close();
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
      pendingFromBench = false;
      say(`no rule this time — ${got.rejected}`);
    } else {
      pending = got;
      pendingFromBench = false;
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

  pending = null; edited = null; pendingFromBench = false;
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
  // A bench law refused is remembered refused — it does not knock again.
  if (pendingFromBench && pending !== null) passBench(readRule(pending));
  pendingFromBench = false;
  pending = null;
  edited = null;
  el('editor').hidden = true;
  say('rejected — nothing was written');
  renderForge();
});

/* ── the agent's hatch ────────────────────────────────────────────────────
 *
 * A driving agent (or a curious human in the console) gets the same levers a
 * player has, through the same gates. `ratify` passes finalise — validator,
 * assay trials, duplicate check — exactly as the Forge's accept button does;
 * there is no side door through the Covenant. `note` speaks on the designer
 * channel and returns the note's timestamp so a rule can cite it. This
 * exists because the standing goal is that ANY agent can play the game
 * end-to-end: keys already work synthetically, and now so do the loop's
 * other two verbs.
 */
declare global {
  interface Window {
    evolve: {
      note: (said: string) => Promise<string>;
      ratify: (draft: Record<string, unknown>) => string;
      state: () => { turn: number; depth: number; rules: number; outcome: string };
    };
  }
}

window.evolve = {
  note: async (said: string): Promise<string> => {
    await speak('designer', said);
    const last = notes[notes.length - 1];
    return last === undefined ? '' : last.at;
  },
  ratify: (draft: Record<string, unknown>): string => {
    const settled = finalise(draft, rulesInForce(), new Date().toISOString());
    if (isRejected(settled)) {
      say(`refused — ${settled.rejected}`);
      return `refused — ${settled.rejected}`;
    }
    const head = getRef(refs, active).head;
    const done = append(log, head, ratifyRule(fold(log, head), settled));
    log = done.log;
    refs = setHead(refs, active, done.event.id);
    persist();
    say(`ratified — ${readRule(settled)}`);
    render();
    return `ratified — ${readRule(settled)}`;
  },
  state: () => {
    const s = fold(log, getRef(refs, active).head);
    return { turn: s.turn, depth: s.depth, rules: s.rules.length, outcome: outcome(s) };
  },
};

// Last, once everything above exists: ask the dev server whether the wardens
// left anything on the bench. Fire-and-forget — a world with no server, or no
// bench, plays exactly as before.
fetchBench();
