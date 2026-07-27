import { append, fold, chain } from '../log/chain.js';
import { getRef, fork, setHead, listRefs } from '../log/refs.js';
import type { Refs } from '../log/refs.js';
import { attemptMove, advanceTurn, endsTurn, wait, takeUnderfoot, outcome, ratifyRule, foundWorld, createWorld, recordBodies, lungeStrike, vigilKept, useCarried, stirWorld, heartHeld, shoveAt, braceSelf, callOut } from '../core/commands.js';
import { BOTTOM_DEPTH, WAVE_EVERY } from '../core/tables.js';
import { u32 } from '../core/rng.js';
import { decide } from '../core/ai.js';
import { fireRules } from '../canon/interpret.js';
import type { Trigger } from '../canon/rule.js';
import type { Blow } from '../canon/interpret.js';
import { findEntity, isAlive } from '../core/entity.js';
import type { Action } from '../core/ai.js';
import type { EventLog } from '../log/chain.js';
import type { GameState } from '../core/state.js';
import type { DraftEvent } from '../core/events.js';

/**
 * The driver: the loop that turns intentions into events.
 *
 * A third layer on purpose. `core/` holds rules and knows nothing about
 * history; `log/` holds history and knows nothing about rules; this knows both
 * and is the only place that does. Without it the generator and the view each
 * grow their own copy of the turn loop, and they drift — which has already
 * happened once on this project.
 */
export interface Position {
  log: EventLog;
  head: string;
}

/**
 * What a rule sees when an action happens: which trigger, whose rules, and what
 * the blow was.
 *
 * Triggers are named from the *player's* side. A creature swinging at you is
 * STRUCK, not STRIKE — a rule reading "when something strikes you" has to fire
 * on somebody else's action, and it is still a rule about you.
 */
interface Firing {
  trigger: Trigger;
  actorId: string;
  blow: Blow;
}

function firingFor(draft: DraftEvent, actorId: string, playerId: string, state: GameState): Firing | null {
  switch (draft.type) {
    case 'WAIT':
      return actorId === playerId ? { trigger: 'WAIT', actorId, blow: {} } : null;
    case 'MOVE':
      return actorId === playerId ? { trigger: 'MOVE', actorId, blow: {} } : null;
    case 'MOVE_BLOCKED':
      return actorId === playerId ? { trigger: 'MOVE_BLOCKED', actorId, blow: {} } : null;
    case 'ITEM_TAKEN':
      return actorId === playerId ? { trigger: 'ITEM_TAKEN', actorId, blow: {} } : null;

    case 'STRIKE': {
      const p = draft.payload;
      const blow = { hit: p.hit };

      if (p.attackerId === playerId) {
        // A blow that finished something is a kill, and only a kill: firing
        // both would double every on-strike effect on the turn it mattered
        // most.
        const target = findEntity(state.entities, p.targetId);
        const finished = p.hit && target !== undefined && !isAlive(target);
        return { trigger: finished ? 'KILLED' : 'STRIKE', actorId: playerId, blow: { ...blow, otherId: p.targetId } };
      }

      // Somebody else swinging. Only your own skin is your business.
      if (p.targetId === playerId) {
        return { trigger: 'STRUCK', actorId: playerId, blow: { ...blow, otherId: p.attackerId } };
      }
      return null;
    }

    default: return null;
  }
}

/**
 * Appends a draft, then anything the world's rules have to say about it, then
 * the turn advance it earns.
 *
 * The order is the design. Rules fire *after* the action — so they see the
 * world it produced — and *before* the turn passes, so their effects belong to
 * that action rather than arriving out of nowhere on the next one.
 *
 * Crucially, whether a turn is earned is decided from `draft` alone and never
 * from what fired. A blocked move costs nothing; a rule firing on it must not
 * hand back the turn that bug once gave away for free.
 *
 * `rulesFor` is the entity whose rules apply, or null for none. Creatures pass
 * null: the player ratified a rule reading "you recover 2 hit points", and
 * firing it for everything on the map would both make that sentence false and
 * heal the things hunting them.
 */
function commit(position: Position, draft: DraftEvent, actorId: string, playerId: string): Position {
  const acted = append(position.log, position.head, draft);
  let current: Position = { log: acted.log, head: acted.event.id };

  // Read *after* the action, so a rule sees the world its trigger produced —
  // notably whether the thing you hit is still standing.
  const afterAction = fold(current.log, current.head);
  const firing = firingFor(draft, actorId, playerId, afterAction);
  if (firing !== null) {
    for (const event of fireRules(afterAction, firing.trigger, firing.actorId, firing.blow)) {
      const done = append(current.log, current.head, event);
      current = { log: done.log, head: done.event.id };
    }
  }

  if (!endsTurn(draft)) return current;
  return passTurn(current, playerId);
}

/**
 * Hands the turn on, and fires TURN_PASSED when the round wraps — once per
 * round, not once per creature. Shared by every path that advances the turn,
 * so a round completed by a forced advance still counts as a round.
 */
function passTurn(position: Position, playerId: string): Position {
  const before = fold(position.log, position.head);
  const turned = append(position.log, position.head, advanceTurn(before));
  let current: Position = { log: turned.log, head: turned.event.id };

  const after = fold(current.log, current.head);
  if (after.turn !== before.turn) {
    for (const event of fireRules(after, 'TURN_PASSED', playerId)) {
      const done = append(current.log, current.head, event);
      current = { log: done.log, head: done.event.id };
    }

    // The seized world answers back: every WAVE_EVERY turns while the heart
    // is carried across the bottom, something rises. Here, with the other
    // things a completed round means — the stir is the world's turn too.
    const now = fold(current.log, current.head);
    if (now.depth >= BOTTOM_DEPTH && heartHeld(now, playerId) && now.turn % WAVE_EVERY === 0) {
      const stirred = stirWorld(now, playerId);
      if (stirred !== null) {
        const done = append(current.log, current.head, stirred);
        current = { log: done.log, head: done.event.id };
      }
    }
  }
  return current;
}

/**
 * Turns a decision into a draft.
 *
 * A strike routes through `attemptMove` rather than having its own command:
 * bumping into something hostile *is* the attack, and giving creatures a
 * separate path would let their combat drift away from the player's. One rule,
 * one code path, whoever is swinging.
 */
export function draftFor(state: GameState, entityId: string, action: Action): DraftEvent | null {
  if (action.kind === 'wait') {
    // Ordinary waits are silence, not history. A staggered thing's wait is
    // different: the reel spends itself on this skipped action, and only an
    // event can clear the tag — so this one wait is a fact on the chain.
    const reeling = findEntity(state.entities, entityId)?.tags.includes('staggered') === true;
    return reeling ? wait(state, entityId) : null;
  }

  if (action.kind === 'step') return attemptMove(state, entityId, action.dx, action.dy);

  // The verbs that are their own commands: the skirmisher's two-tiles-and-
  // the-blow, the warden's knitting-shut at an unwatched post, the caller's
  // one cry into the dark.
  if (action.kind === 'lunge') return lungeStrike(state, entityId, action.targetId);
  if (action.kind === 'mend') return vigilKept(state, entityId);
  if (action.kind === 'call') return callOut(state, entityId);

  const self = findEntity(state.entities, entityId);
  const target = findEntity(state.entities, action.targetId);
  if (self === undefined || target === undefined) return null;

  // Only ever chosen at range 1, so exactly one axis is non-zero.
  return attemptMove(
    state,
    entityId,
    Math.sign(target.pos.x - self.pos.x),
    Math.sign(target.pos.y - self.pos.y),
  );
}

/** Picks up whatever the mover is now standing on. Rides along with the move
 *  that reached it rather than costing a turn of its own — stooping is not a
 *  decision, walking there was. */
function collect(position: Position, entityId: string): Position {
  const taken = takeUnderfoot(fold(position.log, position.head), entityId);
  return taken === null ? position : commit(position, taken, entityId, entityId);
}

export function playerStep(position: Position, playerId: string, dx: number, dy: number): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);

  // A finished run takes no more input. Without this you can walk off the exit
  // you just reached, or keep playing a corpse.
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = attemptMove(state, playerId, dx, dy);
  return { position: collect(commit(position, draft, playerId, playerId), playerId), draft };
}

/** Hold position and let the world come to you. */
export function playerWait(position: Position, playerId: string): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = wait(state, playerId);
  return { position: commit(position, draft, playerId, playerId), draft };
}

/** Spend what the satchel holds. Refusing quietly when it holds nothing —
 *  the keypress simply does not become a turn. */
export function playerUse(position: Position, playerId: string): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = useCarried(state, playerId);
  if (draft === null) return { position, draft: null };
  return { position: commit(position, draft, playerId, playerId), draft };
}

/** Take what is underfoot, deliberately — tradeoffs and downgrades
 *  included. Free like the walking take: stooping is not a turn;
 *  deciding was the work. */
export function playerTake(position: Position, playerId: string): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = takeUnderfoot(state, playerId, true);
  if (draft === null) return { position, draft: null };
  return { position: commit(position, draft, playerId, playerId), draft };
}

/** Drive an adjacent hostile one pace. Refuses quietly (no turn) when
 *  nothing hostile stands that way — a mispress, not a decision. */
export function playerShove(position: Position, playerId: string, dx: number, dy: number): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = shoveAt(state, playerId, dx, dy);
  if (draft === null) return { position, draft: null };
  return { position: commit(position, draft, playerId, playerId), draft };
}

/** Set against the coming round. Always a turn — a stance is a decision. */
export function playerBrace(position: Position, playerId: string): {
  position: Position;
  draft: DraftEvent | null;
} {
  const state = fold(position.log, position.head);
  if (outcome(state, playerId) !== 'playing') return { position, draft: null };

  const draft = braceSelf(state, playerId);
  return { position: commit(position, draft, playerId, playerId), draft };
}

/**
 * Runs every other creature until it is the player's turn again.
 *
 * Bounded rather than trusting the turn order to come back around: a creature
 * that waits forever, or an order that never reaches the player, would
 * otherwise hang the game with no clue why. The cap is generous enough that
 * hitting it means a bug, not a busy world.
 */
export function runWorldTurns(position: Position, playerId: string, maxSteps = 64): Position {
  let current = position;

  for (let i = 0; i < maxSteps; i += 1) {
    const state = fold(current.log, current.head);

    const player = findEntity(state.entities, playerId);
    if (player === undefined || !isAlive(player)) return current;
    // A reached exit ends the world's turn too — nothing gets a parting shot.
    if (outcome(state, playerId) !== 'playing') return current;

    const active = state.activeEntityId;
    if (active === null || active === playerId) return current;

    const draft = draftFor(state, active, decide(state, active));
    if (draft === null) {
      // Waiting still passes the turn, or the order never moves on.
      current = passTurn(current, playerId);
      continue;
    }
    // The creature acts, but the triggers are read from the player's side —
    // its swing at you is your STRUCK, its swing at something else is nothing.
    current = commit(current, draft, active, playerId);

    // A creature whose action earned no turn — a blocked move, walking into a
    // wall it cannot see past — must still yield. The *player's* blocked move
    // costing nothing is fairness; a creature's blocked move costing nothing
    // hangs the round-robin on the first pocketed creature, and the turn
    // counter freezes for the rest of the run. Found by the rule assay: a
    // TURN_PASSED rule read as unexploitable because the turn never passed.
    if (fold(current.log, current.head).activeEntityId === active) {
      current = passTurn(current, playerId);
    }
  }

  return current;
}

/** Marks a world nobody is playing any more. Visible in the name on purpose:
 *  a graveyard you have to consult a field to recognise is not a graveyard. */
export const GRAVE_MARK = '†';

export function isGrave(name: string): boolean {
  return name.includes(GRAVE_MARK);
}

/**
 * Where this world's dead lie at one depth: each grave timeline of `world`,
 * folded, yields the fallen player's tile if that run ended at this depth.
 * The same seed rebuilds the same floors, so a body's tile means the same
 * place in the run that walks after it. Deduplicated — two deaths on one
 * tile are one body to stand on, not a stack.
 */
export function fallenBodies(
  log: EventLog,
  refs: Refs,
  world: string,
  depth: number,
): { x: number; y: number }[] {
  const lying: { x: number; y: number }[] = [];
  for (const ref of listRefs(refs)) {
    if (!isGrave(ref.name) || !ref.name.startsWith(`${world}${GRAVE_MARK}`)) continue;
    if (ref.head === null) continue;
    const gs = fold(log, ref.head);
    if (gs.depth !== depth) continue;
    const fallen = gs.entities.find((e) => e.kind === 'you');
    if (fallen === undefined) continue;
    if (!lying.some((b) => b.x === fallen.pos.x && b.y === fallen.pos.y)) {
      lying.push({ x: fallen.pos.x, y: fallen.pos.y });
    }
  }
  return lying;
}

export interface Burial {
  /** Beginning again appends the world's rules onto the fresh chain, so the
   *  log grows — the caller must take this back, not just the refs. */
  log: EventLog;
  refs: Refs;
  /** The world your corpse is in, or null if you are still alive. */
  grave: string | null;
}

/**
 * What death does.
 *
 * The branch you died on is kept, under a new name, forever. The world you are
 * playing rewinds to its beginning. Nothing is deleted — `reset` moves a
 * pointer and the abandoned events stay exactly where they were, which is the
 * property increment 1 built and never had a reason to use until now.
 *
 * The cost is paid by construction rather than by bookkeeping. Rewinding
 * re-folds from the root, so anything you had picked up is un-picked-up: the
 * keen edge is back on the floor where it started, and the only version of you
 * that ever held it is the one lying dead on the other branch. No inventory
 * needs to be taken away, because state was never stored in the first place.
 *
 * This is the answer to "why fork". Until dying was something history had to
 * keep, forking was a devtool.
 */
/**
 * Starts the world over, keeping what it has agreed to.
 *
 * Rules live on the chain, which is what makes them forkable — but it also
 * means every "start again" resets to the world's root and leaves them behind.
 * Ratify a rule, die, and the rule died with you: the loop this whole increment
 * exists to build could not close.
 *
 * So a fresh run is the root followed by the rules that were in force,
 * re-appended. They are genuinely on the new chain rather than carried in some
 * side channel — the new run replays exactly, forks exactly, and verifies
 * exactly, like any other. And because events are content-addressed, beginning
 * again twice from the same rules produces the same ids both times.
 */
export function beginAgain(
  log: EventLog,
  refs: Refs,
  active: string,
): { log: EventLog; refs: Refs } {
  const ref = getRef(refs, active);
  const was = fold(log, ref.head);
  const root = chain(log, ref.head)[0];
  if (root === undefined) return { log, refs };

  let current = log;
  let head = root.id;
  // Identity, then the dead, then law: the world is still itself before it
  // re-agrees to anything, and the graveyard is fact before rules can read it.
  if (was.bible !== null) {
    const done = append(current, head, foundWorld(fold(current, head), was.bible));
    current = done.log;
    head = done.event.id;
  }
  const lying = fallenBodies(current, refs, active, fold(current, head).depth);
  if (lying.length > 0) {
    const done = append(current, head, recordBodies(fold(current, head), lying));
    current = done.log;
    head = done.event.id;
  }
  for (const rule of was.rules) {
    const done = append(current, head, ratifyRule(fold(current, head), rule));
    current = done.log;
    head = done.event.id;
  }

  return { log: current, refs: setHead(refs, active, head) };
}

/**
 * Down the stairs: the floor you escaped becomes the floor below.
 *
 * The chain continues — the new WORLD_INIT is appended to the current head, so
 * one run's history holds every floor it crossed, replayable end to end. The
 * player crosses inside the event: stats, ceiling, xp and level ride in the
 * payload, which is what lets a depth-2 log replay without needing depth 1
 * folded first. Rules re-ratify onto the new floor exactly as `beginAgain`
 * re-ratifies them onto a fresh start; the world changes, what it has agreed
 * to does not.
 *
 * The next floor's seed derives from this one's — deterministic, so the same
 * run descends into the same world every time it replays.
 */
export function descend(
  log: EventLog,
  refs: Refs,
  active: string,
  dims: { width: number; height: number },
  playerId = 'player',
): { log: EventLog; refs: Refs; depth: number } | null {
  const ref = getRef(refs, active);
  const state = fold(log, ref.head);
  if (outcome(state, playerId) !== 'escaped') return null;

  const you = findEntity(state.entities, playerId);
  if (you === undefined) return null;

  // Rest at the stairs: descend a *cleared* floor and you descend healed.
  // The full-clear fighter earns the breath; the runner leaves bleeding, past
  // things still alive. This is the sawtooth's ease tooth for floors, as the
  // level-up heal is for levels — and it is the differential that makes
  // clearing pay beyond XP.
  const cleared = !state.entities.some((e) => e.id !== playerId && isAlive(e));
  const hp = cleared ? you.maxHp : you.stats.hp;

  const nextDepth = state.depth + 1;
  const nextSeed = u32(state.seed, 1_000_003 + state.depth);
  const born = append(log, ref.head, createWorld(
    nextSeed, dims.width, dims.height, playerId, nextDepth,
    {
      stats: { ...you.stats, hp }, maxHp: you.maxHp, xp: state.xp, level: state.level,
      ...(you.gear === undefined ? {} : { gear: { ...you.gear } as Record<string, { kind: string; grants: typeof you.stats }> }),
      ...(you.satchel === undefined ? {} : { satchel: { kind: you.satchel.kind } }),
    },
  ));

  let current: Position = { log: born.log, head: born.event.id };
  // The world's identity crosses the stairs before its law does — the rules
  // pattern exactly: the floor changes, what the world is does not.
  if (state.bible !== null) {
    const done = append(current.log, current.head, foundWorld(fold(current.log, current.head), state.bible));
    current = { log: done.log, head: done.event.id };
  }
  // The dead of the floor below: an earlier run that made it this deep and
  // fell leaves a body the descending run can stand on.
  const lying = fallenBodies(current.log, refs, active, nextDepth);
  if (lying.length > 0) {
    const done = append(current.log, current.head, recordBodies(fold(current.log, current.head), lying));
    current = { log: done.log, head: done.event.id };
  }
  for (const rule of state.rules) {
    const done = append(current.log, current.head, ratifyRule(fold(current.log, current.head), rule));
    current = { log: done.log, head: done.event.id };
  }

  return { log: current.log, refs: setHead(refs, active, current.head), depth: nextDepth };
}

export function buryIfDead(
  log: EventLog,
  refs: Refs,
  active: string,
  playerId = 'player',
): Burial {
  const ref = getRef(refs, active);
  if (outcome(fold(log, ref.head), playerId) !== 'dead') return { log, refs, grave: null };

  // Already buried at exactly this point. Without this the world would dig a
  // fresh grave on every render, because the ref now stays on the dead state
  // rather than moving off it.
  const existing = listRefs(refs).find((r) => isGrave(r.name) && r.head === ref.head);
  if (existing !== undefined) return { log, refs, grave: existing.name };

  const past = listRefs(refs).filter((r) => r.name.startsWith(`${active}${GRAVE_MARK}`)).length;
  const grave = `${active}${GRAVE_MARK}${past + 1}`;

  // The dead timeline is kept, and the world *stays on it*.
  //
  // It used to rewind immediately, which meant the most significant thing that
  // can happen to you was the one thing you could never look at: a line of text
  // went by and the map was already a fresh run. Your body stays where it fell
  // until you decide to begin again.
  return { log, refs: fork(log, refs, active, grave, ref.head, 'died here'), grave };
}
