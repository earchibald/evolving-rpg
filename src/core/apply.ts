import { makeGrid } from './grid.js';
import { applyResolved } from '../canon/interpret.js';
import { threatOf, levelForXp, growthAt, slotOf, SLAM_DAMAGE, verbOf, VENOM_TURNS, VENOM_HARM, wearsTrait, sizeStretch } from './tables.js';
import { NO_BODIES } from './state.js';
import type { GameEvent } from './events.js';
import type { GameState } from './state.js';
import type { Entity } from './entity.js';

/**
 * Experience, paid at the moment of the kill.
 *
 * Derived rather than evented: XP is a function of which creatures the player
 * finished, so the log and the level can never disagree and there is nothing
 * to upcast. `before` is the world as the blow found it — a creature counts
 * exactly once, on the event that took it from alive to not.
 *
 * Crossing a threshold applies the growth table and heals to full: the
 * sawtooth's ease tooth, one breath before the next floor bites.
 */
function creditKills(before: GameState, after: GameState, killerId: string, playerId = 'player'): GameState {
  if (killerId !== playerId) return after;

  let gained = 0;
  for (const was of before.entities) {
    if (was.id === playerId || was.stats.hp <= 0) continue;
    const now = after.entities.find((e) => e.id === was.id);
    if (now !== undefined && now.stats.hp <= 0) gained += threatOf(was.stats, was.kind);
  }
  if (gained === 0) return after;

  const xp = after.xp + gained;
  let level = after.level;
  let entities = after.entities;
  // The ladder stretches with the board it stands on (sizeStretch): a
  // stretched floor pays stretched XP, and reading the factor off the
  // grid's own dims keeps the level derived — never evented, never able
  // to disagree with the log.
  const target = levelForXp(xp, sizeStretch(after.grid.width, after.grid.height));

  while (level < target) {
    level += 1;
    const g = growthAt(level);
    entities = entities.map((e) => {
      if (e.id !== playerId) return e;
      const maxHp = e.maxHp + g.hp;
      return {
        ...e,
        maxHp,
        stats: {
          // Full heal at the moment of leveling — the breath between teeth.
          hp: maxHp,
          might: e.stats.might + g.might,
          wits: e.stats.wits + g.wits,
          speed: e.stats.speed + g.speed,
        },
      };
    });
  }

  return { ...after, xp, level, entities };
}

/** A stance ends the moment its holder acts — both stances, one law. Every
 *  event with an actor runs its actor through here; BRACED and DRAWN are the
 *  tags' only writers. WAIT is the draw's deliberate exception (its own arm
 *  below): an archer may stand at full draw as long as they dare stand
 *  still, while a brace is strictly one round. */
function unstanced(entities: readonly Entity[], actorId: string): readonly Entity[] {
  const held = entities.find((e) => e.id === actorId);
  if (held === undefined || (!held.tags.includes('braced') && !held.tags.includes('drawn'))) return entities;
  return entities.map((e) =>
    e.id === actorId ? { ...e, tags: e.tags.filter((t) => t !== 'braced' && t !== 'drawn') } : e,
  );
}

/** Reeling, at most once — a second stagger on a staggered thing is spent.
 *  The reel shakes any drawn shot loose (covenant M8's flinch). */
function staggered(tags: string[]): string[] {
  const shaken = tags.filter((t) => t !== 'drawn');
  return shaken.includes('staggered') ? shaken : [...shaken, 'staggered'];
}

/**
 * The shape change for one event, with the RNG counter deliberately left
 * alone — `apply` below is the single authority on that, so no branch here
 * can forget it or advance it twice.
 */
function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'WORLD_INIT': {
      const p = event.payload;
      // Copied out of the payload rather than referenced into state: the event
      // is frozen and shared by every fork, so aliasing it would let one world
      // rewrite another's history.
      const seeded = [p.player, ...p.opponents].map((s) => ({
        id: s.id,
        kind: s.kind,
        pos: { x: s.pos.x, y: s.pos.y },
        stats: { ...s.stats },
        tags: [...s.tags],
        // Where it was born — the warden's vigil is anchored here. A
        // universal fact, not a warden field: every creature has a post,
        // and only the vigil happens to read it.
        post: { x: s.pos.x, y: s.pos.y },
        // The temper (v10): guards own their posts, wanderers carry their
        // recorded round, leg 0 — the reducer advances it as steps land.
        // Absent fields read the old stillness, exactly as they always did.
        ...(s.disposition === undefined ? {} : { disposition: s.disposition }),
        ...(s.route === undefined ? {} : { route: s.route.map((w) => ({ x: w.x, y: w.y })), leg: 0 }),
        ...(s.guise === undefined ? {} : { guise: s.guise }),
        // A creature's ceiling is its birth hp; the player's crossed a floor
        // and may arrive wounded, so the ceiling rides in the payload.
        maxHp: s.id === p.player.id ? (p.playerMaxHp ?? s.stats.hp) : s.stats.hp,
        ...(s.id === p.player.id && p.playerGear !== undefined ? { gear: p.playerGear } : {}),
        ...(s.id === p.player.id && p.playerSatchel !== undefined ? { satchel: p.playerSatchel.kinds.map((k) => ({ kind: k })) } : {}),
      }));
      return {
        grid: makeGrid(p.width, p.height, p.tiles),
        entities: seeded,
        items: p.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          pos: { x: i.pos.x, y: i.pos.y },
          grants: { ...i.grants },
        })),
        turn: 1,
        activeEntityId: p.player.id,
        seed: p.seed,
        rngCounter: 0,
        // A new world plays under no rules, whatever stood before it on the
        // log. WORLD_INIT replaces state wholesale, and rules are state.
        rules: [],
        // Depth-crossing worlds may carry the player's earned progress in the
        // payload; a bare world starts at nothing. Read defensively — older
        // events never wrote these.
        xp: p.xp ?? 0,
        level: p.level ?? 1,
        depth: p.depth ?? 1,
        story: p.story ?? '',
        motif: p.motif ?? null,
        // The floor is born empty; the graveyard speaks separately, via
        // WORLD_BODIES in the rebirth and descent ceremonies.
        bodies: NO_BODIES,
        // Identity resets with the floor; descend re-appends WORLD_BIBLE
        // right after, the way it re-ratifies rules. Null, never undefined:
        // the carry guards test `!== null`, and an undefined slipping through
        // appended a bible-of-nothing to the chain.
        bible: null,
        // New floor, clear air.
        smoke: null,
      };
    }

    case 'RULE_FIRED': {
      // Replays the recorded effects. It does not look at `state.rules`, does
      // not re-read the rule, and does not re-evaluate a single condition —
      // that is what keeps folded history stable as rules accumulate. A kill
      // the rule made belongs to whoever the rule fired for.
      return creditKills(state, applyResolved(state, event.payload.outcomes), event.payload.actorId);
    }

    case 'RULE_RATIFIED': {
      // A fresh list. The old one is shared with every fold that has already
      // observed this state, so pushing in place would rewrite history that
      // something else is already holding.
      return { ...state, rules: [...state.rules, event.payload.rule] };
    }

    case 'WORLD_BIBLE': {
      // The world's identity, replacing whatever stood (WORLD_INIT resets it
      // to null, and descend re-appends it — the rules pattern exactly: the
      // world changes, what it has agreed to does not).
      return { ...state, bible: event.payload.bible };
    }

    case 'WORLD_BODIES': {
      // Copied out of the payload, like WORLD_INIT's seeds: the event is
      // frozen and shared by every fork that descends from it.
      return { ...state, bodies: event.payload.bodies.map((b) => ({ x: b.x, y: b.y })) };
    }

    case 'MOVE': {
      const p = event.payload;
      return {
        ...state,
        entities: unstanced(state.entities, p.entityId).map((e) => {
          if (e.id !== p.entityId) return e;
          const landed = { ...e, pos: { x: p.to.x, y: p.to.y } };
          // The wanderer's round advances when a step lands on ANY of its
          // waypoints — the next leg is the one after the waypoint struck,
          // so a skipped or coincidental stop can never turn the round
          // backwards. Derived, silent, replay-exact (the venom precedent).
          if (e.route !== undefined && e.route.length > 0) {
            const struck = e.route.findIndex((w) => w.x === p.to.x && w.y === p.to.y);
            if (struck >= 0) return { ...landed, leg: (struck + 1) % e.route.length };
          }
          return landed;
        }),
      };
    }

    case 'MOVE_BLOCKED':
      return state;

    // Waiting changes almost nothing by itself. It exists so that passing
    // time is a choice a player can make rather than something only walls
    // impose on them — and so the chronicle can tell "held position" apart
    // from "had no move". What it does spend: a stagger reels itself out on
    // the skipped action, and a stance is an action's worth of standing.
    case 'WAIT': {
      const p = event.payload;
      const me = state.entities.find((e) => e.id === p.entityId);
      if (me === undefined || (!me.tags.includes('staggered') && !me.tags.includes('braced'))) {
        return state;
      }
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId
            ? { ...e, tags: e.tags.filter((t) => t !== 'staggered' && t !== 'braced') }
            : e,
        ),
      };
    }

    case 'ITEM_TAKEN': {
      const p = event.payload;
      const item = state.items.find((i) => i.id === p.itemId);

      // The satchel's take: carried, not worn. The swap is recorded in the
      // payload (v3) because it MINTS a floor item — what was carried lies
      // where the new thing lay — and replay must mint the same one forever.
      // v4 records WHICH slot the take filled; absence reads the first (an
      // old chain carried one thing, and it lived there).
      if (p.satchel !== undefined) {
        const slot = p.satchel.slot ?? 0;
        const droppedKind = p.satchel.swappedOut;
        return {
          ...state,
          entities: state.entities.map((e) => {
            if (e.id !== p.entityId) return e;
            const held = [...(e.satchel ?? [])];
            held[slot] = { kind: item?.kind ?? 'carried' };
            return { ...e, satchel: held };
          }),
          items: [
            ...state.items.filter((i) => i.id !== p.itemId),
            ...(droppedKind === null || item === undefined ? [] : [{
              id: `drop-${p.itemId}`,
              kind: droppedKind,
              pos: { x: item.pos.x, y: item.pos.y },
              grants: { hp: 0, might: 0, wits: 0, speed: 0 },
            }]),
          ],
        };
      }

      // Equipment, not accumulation. The item goes into its slot; whatever
      // was worn there comes off, its grants subtracted, before the new
      // grants apply — and (v4) the shed relic LANDS where the new one lay,
      // kind and grants recorded so replay mints it identically forever.
      // Old events carried neither field: the slot re-derives from grants
      // and nothing is minted, exactly as their present always was.
      const slot = p.gearSlot ?? slotOf(p.grants);
      const taken = state.items.find((i) => i.id === p.itemId);

      return {
        ...state,
        entities: state.entities.map((e) => {
          if (e.id !== p.entityId) return e;
          const worn = e.gear?.[slot];
          const off = worn?.grants ?? { hp: 0, might: 0, wits: 0, speed: 0 };
          const maxHp = e.maxHp - off.hp + p.grants.hp;
          return {
            ...e,
            stats: {
              // hp never exceeds the (possibly lowered) ceiling.
              hp: Math.min(e.stats.hp, maxHp),
              might: e.stats.might - off.might + p.grants.might,
              wits: e.stats.wits - off.wits + p.grants.wits,
              speed: e.stats.speed - off.speed + p.grants.speed,
            },
            maxHp,
            gear: { ...e.gear, [slot]: { kind: item?.kind ?? 'worn', grants: { ...p.grants } } },
          };
        }),
        items: [
          ...state.items.filter((i) => i.id !== p.itemId),
          ...(p.shed === undefined || p.shed === null || taken === undefined ? [] : [{
            id: `drop-${p.itemId}`,
            kind: p.shed.kind,
            pos: { x: taken.pos.x, y: taken.pos.y },
            grants: { ...p.shed.grants },
          }]),
        ],
      };
    }

    case 'STRIKE': {
      const p = event.payload;
      // Whether the blow found a set guard — read before anything moves,
      // because it is the state the blow was thrown into.
      const guarded = state.entities.find((e) => e.id === p.targetId)?.tags.includes('braced') === true;
      // The attacker's own stance (a player striking out of a brace) ends
      // with the action.
      const acted = unstanced(state.entities, p.attackerId);
      // The verbs' movement applies whether or not the blow landed: a lunge
      // that whiffs still crossed the ground (attackerTo rides on misses for
      // lunges; trample fields are only ever written on landed, surviving
      // blows — the command decides, replay applies).
      const moved = p.attackerTo === undefined && p.targetTo === undefined
        ? acted
        : acted.map((e) => {
          if (e.id === p.attackerId && p.attackerTo !== undefined) {
            return { ...e, pos: { x: p.attackerTo.x, y: p.attackerTo.y } };
          }
          if (e.id === p.targetId && p.targetTo !== undefined) {
            return { ...e, pos: { x: p.targetTo.x, y: p.targetTo.y } };
          }
          return e;
        });
      if (!p.hit) {
        // Missing a set guard is overcommitment: the attacker reels. This is
        // the brace's tooth — derived from the tag the blow was thrown at,
        // so replay reads it the same forever. Melee only: overcommitment
        // is a fact about bodies, and the far shooter never lent theirs
        // (absent mode reads melee — v3 chains fold unchanged).
        const after = guarded && (p.mode ?? 'melee') === 'melee'
          ? moved.map((e) => (e.id === p.attackerId ? { ...e, tags: staggered(e.tags) } : e))
          : moved;
        return after === state.entities ? state : { ...state, entities: after };
      }
      // Whether this landed blow leaves venom behind — derived from the
      // attacker's kind, which replay reads identically forever. And whether
      // it lands hard enough to stagger: the sure edge's one rule, a crit
      // that sends the survivor reeling.
      const attacker = state.entities.find((e) => e.id === p.attackerId);
      const venomous = attacker !== undefined && verbOf(attacker.kind) === 'venom';
      const surely = p.crit && attacker !== undefined && wearsTrait(attacker.gear, 'stagger-crit');
      return creditKills(state, {
        ...state,
        entities: moved.map((e) => {
          if (e.id === p.targetId) {
            // The ward drank this blow whole (resolved at command time,
            // damage recorded 0): no wound, no venom, no reeling, the draw
            // unbroken — and the warding is spent by exactly this blow.
            if (p.warded === true) {
              return { ...e, tags: e.tags.filter((t) => t !== 'warded') };
            }
            // Clamped at zero: a corpse is dead, not increasingly dead, and
            // letting hp run negative would make "how badly did it lose" a
            // number nothing reads and every display has to special-case.
            const hp = Math.max(0, e.stats.hp - p.damage);
            // A landed, hurting blow shakes any drawn shot loose — the
            // flinch, covenant M8's half that melee enforces on archers.
            const flinched = p.damage > 0 ? e.tags.filter((t) => t !== 'drawn') : e.tags;
            // A surviving, bitten body burns: fresh venom replaces stale —
            // the wound re-opened, never stacked.
            let tags = venomous && hp > 0
              ? [...flinched.filter((t) => !t.startsWith('venom-')), `venom-${String(VENOM_TURNS)}`]
              : flinched;
            if (surely && hp > 0) tags = staggered(tags);
            return { ...e, stats: { ...e.stats, hp }, tags };
          }
          if (e.id === p.attackerId && p.ambush === true) {
            // The spring is spent the moment it lands. One coiled blow per
            // birth — the tag leaves, and the stalker fights plain after.
            return { ...e, tags: e.tags.filter((t) => t !== 'ambush') };
          }
          return e;
        }),
      }, p.attackerId);
    }

    case 'SHOVE': {
      const p = event.payload;
      const after = unstanced(state.entities, p.shoverId).map((e) => {
        if (e.id === p.targetId) {
          const reels = p.slammed || p.struckId !== null;
          return {
            ...e,
            pos: p.to === null ? e.pos : { x: p.to.x, y: p.to.y },
            stats: { ...e.stats, hp: p.slammed ? Math.max(0, e.stats.hp - SLAM_DAMAGE) : e.stats.hp },
            tags: reels ? staggered(e.tags) : e.tags,
          };
        }
        if (p.struckId !== null && e.id === p.struckId) return { ...e, tags: staggered(e.tags) };
        return e;
      });
      // A slam can finish a wounded thing; the kill pays like any other.
      return creditKills(state, { ...state, entities: after }, p.shoverId);
    }

    case 'BRACED': {
      // One stance per body: setting the guard lowers any drawn shot.
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId
            ? { ...e, tags: [...e.tags.filter((t) => t !== 'braced' && t !== 'drawn'), 'braced'] }
            : e,
        ),
      };
    }

    case 'DRAWN': {
      // The warning covenant M8 requires, written where replay reads it.
      // One stance per body: drawing drops any set guard.
      const p = event.payload;
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === p.entityId
            ? { ...e, tags: [...e.tags.filter((t) => t !== 'braced' && t !== 'drawn'), 'drawn'] }
            : e,
        ),
      };
    }

    case 'ITEM_USED': {
      // The satchel spent. Effects were resolved when the command ran and
      // are applied verbatim — replay never re-decides how much a draught
      // mended or who the smoke fooled.
      const p = event.payload;
      const emptied = unstanced(state.entities, p.entityId).map((e) => {
        if (e.id !== p.entityId) return e;
        // The recorded slot empties; what remains compacts forward (the
        // second thing becomes the first — q always spends the first).
        const left = (e.satchel ?? []).filter((_c, i) => i !== (p.slot ?? 0));
        const { satchel: _spent, ...rest } = e;
        const carried = left.length === 0 ? rest : { ...rest, satchel: left };
        if (p.effect.kind === 'draught') {
          return {
            ...carried,
            maxHp: p.effect.ceilingTo,
            stats: { ...e.stats, hp: p.effect.healedTo },
          };
        }
        return carried;
      });
      if (p.effect.kind === 'smoke') {
        return {
          ...state,
          entities: emptied,
          smoke: {
            until: p.effect.until,
            at: { x: p.effect.at.x, y: p.effect.at.y },
            unfooled: [...p.effect.unfooled],
          },
        };
      }
      // The ward is worn: a tag, spent later by the one blow it drinks
      // (the STRIKE that pays it says so and this reducer strips it there).
      if (p.effect.kind === 'ward') {
        return {
          ...state,
          entities: emptied.map((e) => (
            e.id === p.entityId && !e.tags.includes('warded')
              ? { ...e, tags: [...e.tags, 'warded'] }
              : e)),
        };
      }
      // The burr: the recorded list reels — same staggered tag the shove
      // writes, same recorded WAIT spends it. Replay staggers the same
      // bodies forever; nobody is re-decided here.
      if (p.effect.kind === 'burr') {
        const reeling = new Set(p.effect.staggered);
        return {
          ...state,
          entities: emptied.map((e) => (reeling.has(e.id) ? { ...e, tags: staggered(e.tags) } : e)),
        };
      }
      // The bell is knowledge alone — the fog reads it off the chain; the
      // world's state does not move.
      return { ...state, entities: emptied };
    }

    case 'WORLD_STIRRED': {
      // The risen join the world exactly as WORLD_INIT seats its seeds:
      // copied, posted where they stand, ceilinged at their birth hp.
      const rising = event.payload.opponents.map((s) => ({
        id: s.id,
        kind: s.kind,
        pos: { x: s.pos.x, y: s.pos.y },
        stats: { ...s.stats },
        tags: [...s.tags],
        post: { x: s.pos.x, y: s.pos.y },
        maxHp: s.stats.hp,
      }));
      return { ...state, entities: [...state.entities, ...rising] };
    }

    case 'VIGIL_KEPT': {
      // The warden, home and unwatched, knits shut. Heal to the ceiling in
      // one event: the point is the reset, not a drip — poking a boss and
      // running must buy nothing at all, or the mandatory fight erodes.
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === event.payload.entityId
            ? { ...e, stats: { ...e.stats, hp: e.maxHp } }
            : e,
        ),
      };
    }

    // The remembrance changes nothing: it exists to be read, and it arrives
    // after the last turn a run will ever take. State passes through whole.
    case 'WORLD_REMEMBERED':
      return state;

    case 'UNMASKED': {
      // The guise drops and the spring loads: `hidden` off, `ambush` on —
      // the stalker's machinery, so the mimic's first landed blow rolls
      // one band harder and the reducer already knows how to spend it.
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === event.payload.mimicId
            ? { ...e, tags: [...e.tags.filter((t) => t !== 'hidden'), 'ambush'] }
            : e,
        ),
      };
    }

    case 'TURN_ADVANCED': {
      const advanced = { ...state, turn: event.payload.turn, activeEntityId: event.payload.activeEntityId };
      // Venom burns on the round, not on the activation — once each time the
      // turn wraps. Deterministic arithmetic on tags already on the chain
      // (the creditKills precedent: derived, silent, replay-exact).
      if (event.payload.turn === state.turn) return advanced;
      if (!state.entities.some((e) => e.tags.some((t) => t.startsWith('venom-')))) return advanced;
      return {
        ...advanced,
        entities: advanced.entities.map((e) => {
          const burning = e.tags.find((t) => t.startsWith('venom-'));
          if (burning === undefined || e.stats.hp <= 0) return e;
          const left = Number(burning.slice('venom-'.length)) - 1;
          return {
            ...e,
            stats: { ...e.stats, hp: Math.max(0, e.stats.hp - VENOM_HARM) },
            tags: left <= 0
              ? e.tags.filter((t) => !t.startsWith('venom-'))
              : e.tags.map((t) => (t.startsWith('venom-') ? `venom-${String(left)}` : t)),
          };
        }),
      };
    }

    case 'CALLED': {
      const p = event.payload;
      // The floor answers; the voice is spent. Risers arrive exactly as
      // recorded — kinds, stats and tiles were all drawn at command time.
      return {
        ...state,
        entities: [
          ...state.entities.map((e) =>
            e.id === p.callerId ? { ...e, tags: e.tags.filter((t) => t !== 'call') } : e,
          ),
          ...p.opponents.map((o) => ({
            id: o.id,
            kind: o.kind,
            pos: { x: o.pos.x, y: o.pos.y },
            stats: { ...o.stats },
            tags: [...o.tags],
            post: { x: o.pos.x, y: o.pos.y },
            maxHp: o.stats.hp,
          })),
        ],
      };
    }

    default: {
      // Exhaustive at compile time — the never assignment is what proves it —
      // and loud at runtime. Without this arm the switch falls off the end and
      // returns undefined while still typed GameState, so a log carrying an
      // event type this engine does not know folds to nothing and every later
      // read dereferences it. A log from a newer engine is an expected input,
      // not an exotic one, which is exactly why this must throw rather than
      // quietly return the state unchanged.
      const unhandled: never = event;
      throw new Error(`apply: unknown event type ${String((unhandled as { type: unknown }).type)}`);
    }
  }
}

/**
 * The only way state changes. Pure: no RNG, no clock, no network. Everything
 * random was resolved when the command ran and is recorded in the event, which
 * is what makes a replay faithful rather than merely similar.
 *
 * The counter advances by `rngCounter + rngDraws` for every event type without
 * exception. Before v2 only WORLD_INIT moved it, reading a `counterAfter` field
 * out of its payload — a special case that could not survive a second consumer
 * of randomness. Handling it in one place here means a new event type cannot
 * forget to account for its own draws.
 *
 * An event that changes nothing returns the very same state object, so a
 * blocked move stays free of allocation as well as free of consequence.
 *
 * Total over *validated* events. A WORLD_INIT payload that is internally
 * inconsistent with the grid it describes — a tile count disagreeing with the
 * declared size, or a non-positive width or height — throws out of makeGrid.
 * That is deliberate rather than a gap: it happens only to a corrupted log,
 * where failing loudly beats folding nonsense. Verify an untrusted log with
 * verifyChain before folding it.
 */
export function apply(state: GameState, event: GameEvent): GameState {
  const next = reduce(state, event);
  const rngCounter = event.rngCounter + event.rngDraws;
  return next.rngCounter === rngCounter ? next : { ...next, rngCounter };
}
