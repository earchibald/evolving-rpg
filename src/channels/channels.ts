import type { Oracle } from '../oracle/oracle.js';

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
}

const GM_PROMPT = [
  'You are the gamemaster of a cold, quiet, attentive world.',
  'The player is speaking to you in character, about the world around them.',
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
): Promise<Note> {
  let reply: string | null = null;
  let trouble: string | null = null;

  if (channel === 'gamemaster') {
    try {
      const answered = await oracle.consult({
        intent: 'gamemaster',
        subject: said.slice(0, 60),
        context: { instruction: GM_PROMPT, asked: said, scene: where.scene },
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
