import type { Oracle } from '../oracle/oracle.js';
import type { GameState } from '../core/state.js';
import { HEART_KIND } from '../core/tables.js';

/**
 * Two ways to talk, and they are not the same conversation.
 *
 * **designer** — you, out here, about the game as an artifact. "The wall bump
 * feels bad." "More of this." Out of world, in your own voice. This is the
 * fitness signal the Critic will eventually read.
 *
 * **gamemaster** — your character, in there, about the world. "I search the
 * wall." "What does the ash smell like?" In world, in the fiction. This is the
 * player-initiated path into improvisation: the world invents things when the
 * engine decides to ask, and this is how *you* decide instead.
 *
 * Neither writes to the event log. They are about the game and around it, not
 * events within it — but both record the world and the exact head you were
 * standing on, so they can be lined up against what was happening later without
 * ever having polluted causal history.
 *
 * Gamemaster replies are advisory this increment: prose, recorded, no state
 * changed and no canon committed. Integrating them is the next increment's
 * work, and the recording is what makes that possible rather than speculative.
 */
export type Channel = 'designer' | 'gamemaster';

/**
 * Who typed it.
 *
 * Not bookkeeping. The Rulesmith reads these notes as "what the designer
 * thinks" — so anything an automated or test path wrote has to be separable,
 * or the game evolves towards whatever a fixture happened to say. This is not
 * hypothetical: `runs/notes.jsonl` already holds notes written by an agent
 * during testing that are indistinguishable from the player's.
 */
export type Author = 'player' | 'agent';

/**
 * How the player stood at the moment a note was written.
 *
 * This is the lining-up the module always promised: a note pinned only to a
 * head can be correlated with play *in principle*, but reading it back means
 * refolding history. The status carries the answer in the note itself — for
 * the reader scanning the conversation, for the gamemaster answering it, and
 * for the Rulesmith weighing "too hard" said at 2 health against "too hard"
 * said at full.
 */
export interface Status {
  /** Which floor of the nine. */
  floor: number;
  turn: number;
  level: number;
  hitPoints: number;
  fullHealth: number;
  /** What the satchel holds — a provision kind, the heart, or nothing. */
  carrying: string | null;
}

/** Reads the player's standing out of a state, or null when there is no
 *  player to read (a world before its first breath). */
export function statusOf(state: GameState): Status | null {
  const you = state.entities.find((e) => e.kind === 'you');
  if (you === undefined) return null;
  return {
    floor: state.depth,
    turn: state.turn,
    level: state.level,
    hitPoints: you.stats.hp,
    fullHealth: you.maxHp,
    carrying: you.satchel === undefined || you.satchel.length === 0 ? null : you.satchel.map((c) => c.kind).join(', '),
  };
}

/** One line of plain words for a status — the stamp under a note, and the
 *  same words a prompt sees, so what the model is told is what you can read. */
export function statusLine(status: Status): string {
  const parts = [
    `floor ${status.floor}`,
    `turn ${status.turn}`,
    `level ${status.level}`,
    status.hitPoints <= 0 ? 'fallen' : `${status.hitPoints}/${status.fullHealth} health`,
  ];
  if (status.carrying === HEART_KIND) parts.push('the heart in hand');
  else if (status.carrying !== null) parts.push(`carrying the ${status.carrying}`);
  return parts.join(' · ');
}

export interface Note {
  channel: Channel;
  said: string;
  reply: string | null;
  /** What failed, when a reply was wanted and could not be had. */
  trouble: string | null;
  world: string;
  head: string | null;
  turn: number;
  at: string;
  author: Author;
  /** How the player stood when this was said. Null on notes older than the
   *  field — views may still derive it from the head. */
  status: Status | null;
}

export const NOTES_KEY = 'evolving-rpg/notes/v1';

/**
 * Reads a stored note, filling in an author it may not have.
 *
 * Unmarked notes read as `agent`, deliberately. Every note written before the
 * field existed is unmarked and at least some were written by an agent while
 * testing. Guessing "player" would feed that back as the designer's intent;
 * guessing "agent" merely ignores a real note. The two mistakes are not
 * equally bad.
 */
export function readNote(raw: unknown): Note {
  const n = raw as Partial<Note>;
  const author: Author = n.author === 'player' || n.author === 'agent' ? n.author : 'agent';
  return {
    channel: n.channel === 'gamemaster' ? 'gamemaster' : 'designer',
    said: typeof n.said === 'string' ? n.said : '',
    reply: typeof n.reply === 'string' ? n.reply : null,
    trouble: typeof n.trouble === 'string' ? n.trouble : null,
    world: typeof n.world === 'string' ? n.world : '',
    head: typeof n.head === 'string' ? n.head : null,
    turn: typeof n.turn === 'number' ? n.turn : 0,
    at: typeof n.at === 'string' ? n.at : '',
    author,
    status: readStatus(n.status),
  };
}

/** A status is either whole or absent — a half-read one would stamp a note
 *  with numbers that were never true together. */
function readStatus(raw: unknown): Status | null {
  if (raw === null || typeof raw !== 'object') return null;
  const s = raw as Partial<Status>;
  if (typeof s.floor !== 'number' || typeof s.turn !== 'number' || typeof s.level !== 'number'
    || typeof s.hitPoints !== 'number' || typeof s.fullHealth !== 'number') return null;
  return {
    floor: s.floor,
    turn: s.turn,
    level: s.level,
    hitPoints: s.hitPoints,
    fullHealth: s.fullHealth,
    carrying: typeof s.carrying === 'string' ? s.carrying : null,
  };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Notes are a sidecar, not history — so unlike the event log, a corrupt store
 *  costs you the notes rather than refusing to start the game. */
export function loadNotes(): Note[] {
  const store = storage();
  if (store === null) return [];
  try {
    const raw = store.getItem(NOTES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(readNote) : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: readonly Note[]): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch { /* quota; the notes still exist for this session */ }
}

/** One world's notes, in the order they were written, optionally narrowed to
 *  one author — which is how the Rulesmith avoids reading its own homework. */
export function notesFor(notes: readonly Note[], world: string, author?: Author): Note[] {
  return notes.filter((n) => n.world === world && (author === undefined || n.author === author));
}

const GM_PROMPT = [
  'You are the gamemaster of a cold, quiet, attentive world.',
  'The player is speaking to you in character, about the world around them.',
  'You are told how they stand — the floor, their wounds, what they carry.',
  'Let the answer sit in that moment without reciting it back.',
  'Answer in second person, under forty words, concrete and unhurried.',
  'Invent freely, but nothing you say changes the rules or the state of play —',
  'you are describing, not adjudicating.',
].join(' ');

export interface Where {
  world: string;
  head: string | null;
  turn: number;
  /** Whatever the player can currently see, so the gamemaster is not blind. */
  scene: Record<string, unknown>;
  /** How the player stands right now. Explicit like `author`, and for the
   *  same reason: a default is how a stamp quietly becomes a guess. */
  status: Status | null;
  /** The world's founding, when it has one — the gamemaster speaks FOR a
   *  world, and this is which world. */
  bible?: unknown;
}

/**
 * Records a note, and answers it if the channel expects an answer.
 *
 * The recording is attempted regardless of whether the reply succeeded, and
 * that ordering is the point: a designer note is worth keeping even when
 * nothing is listening, because it is *your* signal rather than the model's
 * output. Losing it because a transport was down would be losing the one thing
 * here that cannot be regenerated.
 */
export async function send(
  oracle: Oracle,
  channel: Channel,
  said: string,
  where: Where,
  at: string,
  post: (note: Note) => Promise<void>,
  author: Author,
): Promise<Note> {
  let reply: string | null = null;
  let trouble: string | null = null;

  if (channel === 'gamemaster') {
    try {
      const answered = await oracle.consult({
        intent: 'gamemaster',
        subject: said.slice(0, 60),
        context: {
          instruction: GM_PROMPT,
          asked: said,
          scene: where.scene,
          // The same words the player reads under the note — what the model
          // is told and what you can check are one line.
          ...(where.status === null ? {} : { standing: statusLine(where.status) }),
          ...(where.bible === undefined ? {} : { bible: where.bible }),
        },
      });
      reply = answered.line === '' ? answered.name : answered.line;
    } catch (error) {
      trouble = String(error).slice(0, 160);
    }
  }

  const note: Note = {
    channel,
    said,
    reply,
    trouble,
    world: where.world,
    head: where.head,
    turn: where.turn,
    at,
    // Explicit, with no default. A default is exactly how the distinction
    // erodes: every call site that forgets it silently claims to be the player.
    author,
    status: where.status,
  };

  // Recorded even if the reply failed, and even if recording itself fails —
  // the note is handed back either way so a view can show it.
  try {
    await post(note);
  } catch {
    // The sidecar is a development convenience; the note still happened.
  }

  return note;
}
