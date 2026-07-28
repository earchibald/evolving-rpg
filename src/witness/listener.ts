/**
 * The Listener: the persona that reads a submitted run for fun.
 *
 * The Rulesmith reads a run to propose one rule; the Critic reads it to
 * score lenses. The Listener reads it for the thing neither can see — how
 * it FELT — and its primary evidence is the player's own voice, spoken
 * while playing and woven back between the moments it was spoken in.
 * Its output is a report for the designer, never a mechanical change:
 * recommendations may sketch a Forge-ready rule, but ratification stays
 * a human button.
 */

export interface ListenerPacket {
  world: string;
  reason: 'begin-again' | 'another-world' | 'wipe';
  ended: string;
  turns: number;
  depth: number;
  level: number;
  /** Plain sentences from summariseRun — what the chain says happened. */
  happened: readonly string[];
  /** What the player typed, both channels, with the world's replies. */
  said: readonly string[];
  /** The Critic's verdicts, one sentence each. */
  measured: readonly string[];
  /** Rules in force, in English. */
  inForce: readonly string[];
  /** The woven timeline: play and speech interleaved, silences annotated. */
  woven: string;
  /** Whether any words were actually spoken — the prompt says so honestly. */
  spoke: boolean;
}

const REASONS: Record<ListenerPacket['reason'], string> = {
  'begin-again': 'the player chose to begin this world again',
  'another-world': 'the player left for another world',
  wipe: 'the player wiped everything',
};

const list = (items: readonly string[], empty: string): string =>
  (items.length === 0 ? empty : items.map((i) => `- ${i}`).join('\n'));

export function listenerPrompt(packet: ListenerPacket): string {
  return [
    'You are the Listener for a small evolving grid RPG. A human just played a',
    'run and spoke their thoughts aloud while playing; a microphone kept their',
    'words, stamped to the moment. Your one question: where is the fun, and',
    'where does it break?',
    '',
    `THE RUN — world "${packet.world}", ended: ${packet.ended} at turn ${String(packet.turns)},`,
    `depth ${String(packet.depth)}, level ${String(packet.level)}. It was submitted because ${REASONS[packet.reason]}.`,
    '',
    'WHAT THE CHAIN SAYS HAPPENED',
    list(packet.happened, '(nothing recorded)'),
    '',
    'WHAT THE PLAYER TYPED, DURING PLAY',
    list(packet.said, '(they typed nothing)'),
    '',
    'WHAT THE LENSES MEASURED',
    list(packet.measured, '(no readings)'),
    '',
    'RULES IN FORCE',
    list(packet.inForce, '(none — the world plays as it was born)'),
    '',
    'THE TIMELINE — play and the spoken words, interleaved by the clock.',
    'Bracketed lines are raw actions; bare lines are the journal; “you say”',
    'lines are the player’s actual voice. Elisions and pauses are marked.',
    packet.spoke ? packet.woven : '(the player said nothing aloud this run)',
    '',
    'HOW TO READ IT',
    '- The spoken words outrank every other signal. They are the feeling at',
    '  the moment of feeling it — quote them VERBATIM, with the nearest turn.',
    '- Silence is evidence too: a long pause before a word, a complaint said',
    '  flatly, a run abandoned mid-floor. Say what the gaps say.',
    '- Tie every finding to a moment in the timeline or a fact above. A',
    '  finding that floats free of the run is an opinion, not a finding.',
    '- "Not fun yet" is the expected diagnosis; be precise about WHY: no',
    '  decision to make, no consequence to feel, no legible cause, too slow,',
    '  too safe, too samey. Name the mechanism.',
    '',
    'WRITE THE REPORT as markdown lines:',
    '1. `## findings` — 3 to 6, each anchored to a quote or a turn number,',
    '   each naming the mechanism that made the moment land or fail.',
    '2. `## recommendations` — 2 to 5, smallest change first. If one fits the',
    '   rule vocabulary (triggers/conditions/effects), sketch it as a Forge',
    '   candidate; if it is a tuning number, name the table; if it is',
    '   fiction, name the prompt. Never more than one big swing.',
    '3. `## the shape of it` — one short paragraph: is this getting more fun,',
    '   and what single absence matters most next.',
    '',
    'Reply in EXACTLY this shape — one line of JSON, a divider, then the',
    'report as plain markdown. No code fences anywhere, nothing after the',
    'report. (The report rides outside the JSON so no escaping can mangle it.)',
    '{"name": "<four words or fewer, a headline for this reading>", "line": "<one sentence verdict a journal can print>"}',
    '---',
    '## findings',
    '…',
  ].join('\n');
}
