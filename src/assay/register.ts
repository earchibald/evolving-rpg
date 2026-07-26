/**
 * The thematic register, structural half.
 *
 * The world is cold, quiet and attentive, and these are the checks a machine
 * can make without an opinion: nothing shouts, nothing exclaims, names point
 * at things. The other half — whether a line actually *sounds* like this world
 * — is a judged pass, kept separate so opinion never silently gates mechanics.
 *
 * The banned head words are a regression list, not an ontology: each one is a
 * word the world has actually tried to name something with, where the name was
 * a mood rather than a thing. "small iron want" is the founding member.
 */

export interface TextVerdict {
  readonly sound: boolean;
  readonly findings: readonly string[];
}

const OK: TextVerdict = Object.freeze({ sound: true, findings: Object.freeze([]) });

const refuse = (...findings: string[]): TextVerdict => Object.freeze({ sound: false, findings: Object.freeze(findings) });

/** Words that name feelings, not things. Grown from real failures only. */
export const MOOD_WORDS: readonly string[] = Object.freeze([
  'want', 'need', 'quiet', 'below', 'above', 'breath', 'hush', 'silence',
  'sorrow', 'ache', 'longing', 'stillness',
]);

/** A spoken line in the world's voice. */
export function assayLine(text: string): TextVerdict {
  const findings: string[] = [];
  if (text.includes('!')) findings.push('the world does not exclaim (T2)');
  if (/[A-Z]{3,}/.test(text)) findings.push('the world does not shout (T2)');
  if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(text)) findings.push('no emoji in this world (T2)');
  if (text.trim() === '') findings.push('an empty line says nothing (T2)');
  return findings.length === 0 ? OK : refuse(...findings);
}

/** A name the world gives a thing. Structure only — whether the head word is
 *  genuinely concrete is the judged pass's problem. */
export function assayName(name: string, alreadyNamed: readonly string[] = []): TextVerdict {
  const findings: string[] = [];
  const words = name.trim().split(/\s+/u);

  if (name.trim() === '') findings.push('a thing must be called something (T1)');
  if (words.length > 3) findings.push(`${words.length} words — a name is at most three (T1)`);
  if (name !== name.toLowerCase()) findings.push('names are lowercase (T1)');
  if (/^(a|an|the)\s/iu.test(name.trim())) findings.push('no articles — "the" is the player\'s to add (T1)');
  if (name.includes('!')) findings.push('the world does not exclaim (T2)');

  const head = words[words.length - 1] ?? '';
  if (MOOD_WORDS.includes(head)) {
    findings.push(`"${head}" names a mood, not a thing a player can point at (T1)`);
  }

  const taken = alreadyNamed.filter((n) => n !== '').map((n) => n.toLowerCase());
  if (taken.includes(name.trim().toLowerCase())) {
    findings.push('two kinds cannot share one name (T3)');
  }

  return findings.length === 0 ? OK : refuse(...findings);
}
