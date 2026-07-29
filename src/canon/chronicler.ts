import { assayLine } from '../assay/register.js';
import type { Oracle } from '../oracle/oracle.js';
import type { GameEvent } from '../core/events.js';
import type { GameState } from '../core/state.js';

/**
 * The Chronicler: the world setting a run down in words.
 *
 * This is the model doing the one thing code cannot — reading a finished
 * chain as a STORY. The namesmith took naming away from the model because
 * composition is arithmetic; this gives the model the job that is the
 * opposite of arithmetic: what a run meant, told back in the world's own
 * voice, with the world's own names in it.
 *
 * The doctrine it obeys is the one every model call here has converged on:
 * OFF the turn path (you are dead or you have won — latency is free),
 * RARE (once per ended run), DURABLE (an event on the ended run's chain,
 * the WORLD_BIBLE precedent), and VALIDATED (the register guard and hard
 * caps before it may touch the log). A refusal costs a mute grave, which
 * is what graves were until today.
 */

/** What the Chronicler is given: facts, not the log. Built in code so the
 *  two lines that matter are not buried under four hundred that do not. */
export interface RunStory {
  world: string;
  occasion: 'fallen' | 'won';
  /** Which life of this world this was — the first, the fourth. */
  life: number;
  /** One fact per sentence, in the order they happened. */
  facts: string[];
  /** What fell to this life, by the world's names, in order. */
  slain: string[];
  /** The world's name for what struck the killing blow, and its bare kind. */
  killer: string | null;
  killerKind: string | null;
  /** How deep, how long. */
  depth: number;
  turns: number;
  /** The world's identity, when it has one — anchor and register. */
  anchor: string | null;
  register: string[];
}

/** How the run actually went, told as compact facts with the world's own
 *  names in them. `called` resolves kinds to what this world calls them —
 *  split by family because the canon keys creatures and items apart. */
export function storyOf(
  events: readonly GameEvent[],
  state: GameState,
  world: string,
  occasion: 'fallen' | 'won',
  life: number,
  called: { creature: (kind: string) => string; item: (kind: string) => string },
): RunStory {
  const facts: string[] = [];

  facts.push(`the run lasted ${state.turn} turns and reached floor ${state.depth} of 9`);

  // Kills, by the world's names, in order — and what finally answered back.
  const slain: string[] = [];
  let lastHurt: string | null = null;
  let lastHurtKind: string | null = null;
  let worstBlow = 0;
  for (const e of events) {
    if (e.type !== 'STRIKE' || !e.payload.hit) continue;
    if (e.payload.attackerId === 'player') {
      const victim = e.payload.targetId;
      const kind = victimKind(events, victim);
      if (kind !== null && wasKilledBy(events, e, victim)) slain.push(called.creature(kind));
    } else if (e.payload.targetId === 'player') {
      const kind = victimKind(events, e.payload.attackerId);
      if (kind !== null) {
        lastHurt = called.creature(kind);
        lastHurtKind = kind;
        if (e.payload.damage > worstBlow) worstBlow = e.payload.damage;
      }
    }
  }
  if (slain.length > 0) {
    facts.push(`slain, in order: ${slain.join(', ')}`);
  } else {
    facts.push('nothing was slain');
  }
  if (worstBlow > 0) facts.push(`the worst single blow taken dealt ${worstBlow}`);

  if (occasion === 'fallen' && lastHurt !== null) {
    facts.push(`the killing blow came from ${lastHurt}`);
  }
  if (occasion === 'won') {
    facts.push('the heart was carried back up the stair — the world is won');
  }

  // What was worn and carried at the end, under the world's names.
  const you = state.entities.find((e) => e.kind === 'you');
  const worn = Object.values(you?.gear ?? {})
    .filter((g): g is { kind: string; grants: { hp: number; might: number; wits: number; speed: number } } => g !== undefined)
    .map((g) => called.item(g.kind));
  if (worn.length > 0) facts.push(`worn at the end: ${worn.join(', ')}`);
  if (you?.satchel !== undefined && you.satchel.length > 0) facts.push(`carried at the end: ${you.satchel.map((c) => called.item(c.kind)).join(', ')}`);

  for (const e of events) {
    if (e.type === 'ITEM_USED') facts.push(`${called.item(e.payload.kind)} was spent`);
    if (e.type === 'CALLED') facts.push('a caller cried out and the floor answered');
    if (e.type === 'WORLD_STIRRED') facts.push('the seized world stirred against the carrier');
  }

  const fired = events.filter((e) => e.type === 'RULE_FIRED').length;
  if (fired > 0) facts.push(`the world's laws fired ${fired} time(s)`);

  facts.push(`level ${state.level} was reached`);
  facts.unshift(`this was the ${ordinal(life)} life of this world`);

  return {
    world,
    occasion,
    life,
    facts,
    slain,
    killer: occasion === 'fallen' ? lastHurt : null,
    killerKind: occasion === 'fallen' ? lastHurtKind : null,
    depth: state.depth,
    turns: state.turn,
    anchor: state.bible?.anchor ?? null,
    register: state.bible === null ? [] : [...state.bible.register],
  };
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${String(n)}th`;
}

/**
 * The deterministic epitaph — the floor no grave falls below.
 *
 * The namesmith lesson, applied honestly: code composition is the floor and
 * the model only raises the ceiling. Every ended run gets THIS instantly,
 * synchronously, for nothing; the DCSS morgue tradition says a laconic fact
 * line is already a story. Slab voice: third person, past tense, no moral.
 */
export function epitaphOf(story: RunStory): string {
  if (story.occasion === 'won') {
    return `the ${ordinal(story.life)} life of this world carried the heart out on turn ${story.turns}. the world is won, and keeps the name.`;
  }
  const by = story.killer === null ? '' : ` under the ${story.killer}'s blow`;
  return `the ${ordinal(story.life)} life of this world ended on floor ${story.depth}, turn ${story.turns}${by}.`;
}

/**
 * Whether this ending has earned the Chronicler's fuller telling.
 *
 * The research's sharpest correction: every death getting model prose
 * converges into repetition by death ten (the Hades authoring lesson, the
 * Character.AI memory complaints). So the model is reserved for the ends
 * with something in them: the first life, a new deepest floor, a warden's
 * kill, the deep floors, and every win. The rest keep the epitaph — which
 * is the DCSS YASD one-liner culture, encoded.
 */
export function notable(story: RunStory, deepestPriorGrave: number): boolean {
  if (story.occasion === 'won') return true;
  if (story.life === 1) return true;
  if (story.depth > deepestPriorGrave) return true;
  if (story.depth >= 7) return true;
  if (story.killerKind !== null && story.killerKind.startsWith('warden')) return true;
  return false;
}

function victimKind(events: readonly GameEvent[], id: string): string | null {
  for (const e of events) {
    if (e.type === 'WORLD_INIT') {
      const found = e.payload.opponents.find((o) => o.id === id);
      if (found !== undefined) return found.kind;
    }
    if ((e.type === 'WORLD_STIRRED' || e.type === 'CALLED')) {
      const found = e.payload.opponents.find((o) => o.id === id);
      if (found !== undefined) return found.kind;
    }
  }
  return null;
}

/** Whether this exact strike was the one that ended the victim. */
function wasKilledBy(events: readonly GameEvent[], strike: GameEvent, victim: string): boolean {
  if (strike.type !== 'STRIKE') return false;
  // The last landed blow on a victim is the killing one iff no later blow
  // lands on it — cheap and true enough for a story.
  for (const e of events) {
    if (e.seq <= strike.seq) continue;
    if (e.type === 'STRIKE' && e.payload.hit && e.payload.targetId === victim) return false;
  }
  return true;
}

/** Words that mark generated grief-prose from a thousand other games. The
 *  research's blocklist, minus the words this game itself speaks (an echo
 *  is a creature here). Grown from real failures only, like MOOD_WORDS. */
export const SLOP: readonly string[] = Object.freeze([
  'tapestry', 'testament', 'legacy', 'brave soul', 'little did', 'valiant',
  'epic', 'saga of', 'forever remembered', 'rest in',
]);

/**
 * The gate: everything the register demands, the caps that keep a
 * remembrance a remembrance, and the three mechanical truths the research
 * demands — it names the run's own facts, it opens unlike its neighbours,
 * and it never speaks slop.
 */
export function validateRemembrance(
  raw: unknown,
  opts: { mustMention: readonly string[]; priorOpenings: readonly string[] } = { mustMention: [], priorOpenings: [] },
): { text: string } | { refused: string } {
  if (typeof raw !== 'string') return { refused: 'not text' };
  const text = raw.trim();
  if (text.length < 20) return { refused: 'too little said' };
  if (text.length > 480) return { refused: 'a remembrance, not a chapter' };
  const read = assayLine(text);
  if (!read.sound) return { refused: read.findings.join('; ') };

  const lower = text.toLowerCase();
  for (const s of SLOP) {
    if (lower.includes(s)) return { refused: `slop: "${s}"` };
  }

  // It must hold the run's own facts — the Qud rule: proper nouns carry
  // truth, and a remembrance naming none of them is generic by definition.
  if (opts.mustMention.length > 0) {
    const held = opts.mustMention.filter((m) => m !== '' && lower.includes(m.toLowerCase())).length;
    const enough = Math.min(2, opts.mustMention.length);
    if (held < enough) return { refused: 'names none of the run\'s own facts' };
  }

  // Twenty deaths must not open twenty identical stones.
  const opening = lower.split(/\s+/u).slice(0, 4).join(' ');
  for (const prior of opts.priorOpenings) {
    if (prior !== '' && opening === prior.toLowerCase().split(/\s+/u).slice(0, 4).join(' ')) {
      return { refused: 'opens like an earlier remembrance' };
    }
  }
  return { text };
}

/** The exact tokens a remembrance must carry, drawn from the story. */
export function mentionables(story: RunStory): string[] {
  return [
    ...(story.killer === null ? [] : [story.killer]),
    `floor ${String(story.depth)}`,
    ...story.slain.slice(0, 3),
  ];
}

/**
 * Asks the world to set the run down. Resolves to the validated text, or a
 * refusal that costs nothing — the deterministic epitaph is already on the
 * chain, so the floor holds. The oracle's queue shows the call either way.
 */
export async function remember(
  oracle: Oracle,
  story: RunStory,
  priorOpenings: readonly string[] = [],
): Promise<{ text: string } | { refused: string }> {
  try {
    const said = await oracle.consult({
      intent: 'chronicle',
      subject: `${story.occasion}:${story.world}`,
      context: {
        occasion: story.occasion,
        facts: story.facts,
        avoidOpenings: [...priorOpenings],
        ...(story.anchor === null ? {} : { anchor: story.anchor }),
        ...(story.register.length === 0 ? {} : { register: story.register }),
      },
    });
    return validateRemembrance(said.line === '' ? said.name : said.line, {
      mustMention: mentionables(story),
      priorOpenings,
    });
  } catch (error) {
    return { refused: String(error).slice(0, 120) };
  }
}

/** The remembrance already on a chain, newest if several. Walked from the
 *  head, so the common case (last event) answers immediately. */
export function rememberedOn(events: readonly GameEvent[]): { text: string; occasion: 'fallen' | 'won' } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.type === 'WORLD_REMEMBERED') return { text: e.payload.text, occasion: e.payload.occasion };
  }
  return null;
}
