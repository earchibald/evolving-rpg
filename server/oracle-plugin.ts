import { execFile } from 'node:child_process';
import type { Plugin } from 'vite';

/**
 * The dev server's side of the Oracle.
 *
 * A browser cannot shell out, so the question crosses here and the `claude`
 * CLI answers it. No API key: the CLI bills whatever account is already signed
 * in, which is what makes this the development default rather than a thing you
 * have to configure before the game will speak.
 *
 * Two decisions worth recording.
 *
 * **The prompt asks for JSON and nothing else.** A model asked for prose and
 * then parsed for structure will eventually be parsed wrong; asked for a small
 * object, it either produces one or fails visibly.
 *
 * **The model that ran is passed back, not the model requested.** Fast mode and
 * tier gating can substitute a smaller one, and for us that is a determinism
 * problem rather than a billing one — a world half-named by a different model
 * is a world whose canon has two voices, with nothing recording which is which.
 */

// Long enough for a batched naming call. 45s was tuned for one name; a
// floor's worth runs longer, and killing a paid call at the deadline wastes
// the money AND the names — the browser's queue shows the failure either way.
const TIMEOUT_MS = 120_000;

function gamemasterPrompt(context: Record<string, unknown>): string {
  return [
    String(context.instruction ?? ''),
    '',
    `What is around you: ${JSON.stringify(context.scene ?? {})}`,
    `The player says: ${String(context.asked ?? '')}`,
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name": "<four words or fewer, a label for this exchange>",',
    ' "line": "<your answer, second person, under forty words>"}',
  ].join('\n');
}

/**
 * The Rulesmith's prompt.
 *
 * It states the vocabulary exhaustively rather than gesturing at it, because a
 * rule outside the vocabulary is rejected on arrival and the round trip is
 * wasted. And it asks for the *absence* the run revealed rather than a good
 * idea — a rule that answers nothing in particular is how a game accumulates
 * noise instead of shape.
 */
function proposePrompt(context: Record<string, unknown>): string {
  const run = (context.run ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string => (Array.isArray(v) ? v.map((x) => `- ${String(x)}`).join('\n') : '(none)');

  return [
    'You are the Rulesmith of a small grid RPG that evolves through play.',
    'A run just ended. Propose exactly ONE new rule, in the vocabulary below.',
    '',
    'WHAT HAPPENED',
    list(run.happened),
    '',
    'WHAT THE PLAYER SAID',
    list(run.said) || '(they said nothing)',
    '',
    'WHAT THE LENSES MEASURED — findings to answer',
    list(run.measured) || '(no readings yet)',
    '',
    'RULES ALREADY IN FORCE — do not propose these again',
    list(run.inForce) || '(none)',
    '',
    'EVENT IDS YOU MAY CITE',
    Array.isArray(run.citable) ? (run.citable as string[]).join(' ') : '(none)',
    'NOTE TIMESTAMPS YOU MAY CITE',
    Array.isArray(run.citableNotes) ? (run.citableNotes as string[]).join(' ') : '(none)',
    '',
    'THE VOCABULARY. Anything outside it is rejected unread.',
    'when: WAIT | MOVE | MOVE_BLOCKED | STRIKE | STRUCK | KILLED | ITEM_TAKEN | TURN_PASSED',
    '  STRIKE is you swinging. STRUCK is something swinging at you.',
    '  KILLED is your blow finishing something.',
    'require: up to 4 of',
    '  {"kind":"hpAtMost"|"hpAtLeast","n":1-99}',
    '  {"kind":"hpBelowPercent"|"hpAbovePercent","n":1-99}',
    '  {"kind":"creatureWithin"|"noCreatureWithin","n":1-40}',
    '  {"kind":"creaturesAtMost"|"creaturesAtLeast","n":0-20}',
    '  {"kind":"exitWithin"|"exitBeyond","n":1-40}',
    '  {"kind":"turnAtLeast","n":1-999}',
    '  {"kind":"statAtLeast","stat":"might"|"speed"|"wits"|"maxHp","n":1-20}',
    '  {"kind":"blowLanded"} or {"kind":"blowMissed"} — only with STRIKE or STRUCK',
    'then: up to 3 of',
    '  {"kind":"heal"|"harm","n":1-20}',
    '  {"kind":"harmOther","n":1-20} — only with STRIKE, STRUCK or KILLED',
    '  {"kind":"push","n":1-3} — only with STRIKE, STRUCK or KILLED',
    '  {"kind":"grant"|"drain","stat":"might"|"speed"|"wits"|"maxHp","n":1-5}',
    '  {"kind":"speak","text":"<under 120 characters>"}',
    '',
    'HOW TO CHOOSE.',
    'Answer something the run actually revealed — most usefully an ABSENCE.',
    'A thing the player did repeatedly for no result, a thing they reached for',
    'in the fiction that the game cannot do, a complaint they made out of world.',
    'Do not propose a rule that merely sounds good. Prefer a small rule that',
    'makes one existing action worth taking to a large one that adds a system.',
    'You must cite at least one event id or note timestamp from the lists above.',
    'If your rule answers a lens finding, cite it: "lenses":[2] in provenance.',
    'A lens reading zero is a thing the world may address — a game whose dice',
    'never surprise anyone, or whose runs end in dead air, is naming its lack.',
    'Cite nothing you were not given — invented ids are stripped and the rule',
    'is then rejected for citing nothing.',
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name":"<four words or fewer, a label for this rule>",',
    ' "line":"<one sentence to the player on why this rule, second person>",',
    ' "rule":{"when":"...","require":[...],"then":[...],',
    '   "provenance":{"events":["..."],"notes":["..."],"lenses":[...],',
    '     "because":"<one sentence on what in the run prompted this>"}}}',
  ].join('\n');
}

/**
 * The judged pass: does a line sound like this world, and does a rule's
 * fiction match its mechanics? Opinion, deliberately separated from the
 * structural checks in src/assay/register.ts — and run on a small model,
 * because taste at this granularity does not need the big one.
 */
function judgePrompt(context: Record<string, unknown>): string {
  return [
    'You judge the voice of a cold, quiet, attentive world. Second person,',
    'concrete nouns, nothing shouts, nothing exclaims, no patch-note tone.',
    '',
    `Candidate text: ${JSON.stringify(context.text ?? '')}`,
    `What it is attached to (mechanics, if any): ${JSON.stringify(context.mechanics ?? 'none')}`,
    '',
    'Judge two things. REGISTER: does the text belong in this world\'s voice?',
    'FIT: if mechanics are given, does the fiction describe what they do —',
    'text about rest attached to a damage effect fails however pretty it is.',
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name": "<verdict: sound | off-register | off-fit>",',
    ' "line": "<one sentence saying why, in plain words>"}',
  ].join('\n');
}

/**
 * One call, every unnamed thing on the floor. Naming ran one call per kind
 * and a fast player outpaced it — descending two floors quickly left whole
 * rooms of placeholders. The rules are the single-name prompt's rules; only
 * the shape is plural, and the world is told to name them as a SET so the
 * floor's names cohere instead of arriving from four separate moods.
 */
function batchPrompt(context: Record<string, unknown>): string {
  const things = Array.isArray(context.things) ? context.things : [];
  return [
    'You are naming several things in a cold, quiet, attentive world.',
    'The world has no established genre yet, and what you say becomes permanent.',
    'Name them as one set: things found on one floor of one dungeon, in one voice.',
    '',
    'EVERY NAME MUST NAME ITS THING.',
    'A player reads it in a list and must know what they are looking at.',
    'A creature\'s name must read as something alive that can hurt you.',
    'An item\'s name must read as a thing you could hold.',
    'Concrete noun as the head word, at most one modifier before it.',
    'Do NOT produce a mood in place of a thing. "small iron want", "the quiet',
    'below", "a held breath" all fail — a player cannot point at them.',
    'No abstract nouns as the head word. Lowercase, no article, two or three words.',
    'Every name in the set must be distinct.',
    '',
    'THE THINGS',
    ...things.map((t) => JSON.stringify(t)),
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name": "<how many you named, e.g. 3 named>",',
    ' "line": "",',
    ' "things": [{"subject": "<exactly as given>", "name": "<the name>",',
    '   "line": "<one sentence, second person, under twenty words>"}, ...]}',
  ].join('\n');
}

function prompt(subject: string, context: unknown): string {
  const [kind] = subject.split(':');
  return [
    'You are naming one thing in a cold, quiet, attentive world.',
    'The world has no established genre yet, and what you say becomes permanent.',
    '',
    'THE NAME MUST NAME THE THING.',
    'A player reads it in a list and must know what they are looking at.',
    kind === 'creature'
      ? 'It is a creature: the name must read as something alive that can hurt you.'
      : 'It is an object you can pick up and use: the name must read as a thing you could hold.',
    'Concrete noun as the head word, at most one modifier before it.',
    // Only counter-examples. Naming a good one gets it used verbatim: the first
    // version of this offered "salt hound" as an illustration and the world
    // promptly called its creature a salt hound.
    'Do NOT produce a mood in place of a thing. "small iron want", "the quiet',
    'below", "a held breath" all fail — a player cannot point at them.',
    'The head word must be something that exists, not something that is felt.',
    'No abstract nouns as the head word. Lowercase, no article, two or three words.',
    '',
    `Subject: ${subject}`,
    `What is known: ${JSON.stringify(context)}`,
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name": "<the name>",',
    ' "line": "<one sentence, second person, under twenty words>"}',
  ].join('\n');
}

interface CliResult {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  modelUsage?: Record<string, unknown>;
}

/** Pulls a JSON object out of a reply that may have wandered around it. */
function extract(text: string): { name: string; line: string; data?: unknown } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no object in reply: ${text.slice(0, 120)}`);

  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    name?: unknown; line?: unknown; rule?: unknown; provenance?: unknown; things?: unknown;
  };
  if (typeof parsed.name !== 'string') throw new Error('reply had no name');

  // Models sometimes lift provenance out of the rule to sit beside it — two
  // of three live proposals tonight failed exactly this way. Reattaching a
  // sibling provenance is transport tolerance, not trust: the validator in
  // canon/ still judges everything.
  let rule = parsed.rule;
  if (typeof rule === 'object' && rule !== null
      && (rule as { provenance?: unknown }).provenance === undefined
      && parsed.provenance !== undefined) {
    rule = { ...rule, provenance: parsed.provenance };
  }

  return {
    name: parsed.name,
    line: typeof parsed.line === 'string' ? parsed.line : '',
    // Otherwise unvalidated, deliberately: this is a dev server, and the one
    // place that decides whether a rule is a rule is the validator in canon/
    // — and whether a batched name is a name is the Oracle's register guard.
    data: rule ?? parsed.things,
  };
}

export function oraclePlugin(): Plugin {
  return {
    name: 'evolving-rpg:oracle',
    configureServer(server) {
      server.middlewares.use('/__oracle', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }

        let body = '';
        req.on('data', (chunk) => { body += String(chunk); });
        req.on('end', () => {
          let subject = '';
          let context: Record<string, unknown> = {};
          let intent = 'describe';
          try {
            const question = JSON.parse(body) as { subject?: unknown; context?: unknown; intent?: unknown };
            if (typeof question.subject !== 'string') throw new Error('no subject');
            subject = question.subject;
            context = (question.context ?? {}) as Record<string, unknown>;
            if (typeof question.intent === 'string') intent = question.intent;
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
            return;
          }

          execFile(
            'claude',
            [
              // Taste at this granularity does not need the big model, and the
              // judge runs often once agents use it. Haiku is ~100x cheaper.
              ...(intent === 'judge' ? ['--model', 'claude-haiku-4-5-20251001'] : []),
              '-p',
              intent === 'gamemaster' ? gamemasterPrompt(context)
                : intent === 'propose' ? proposePrompt(context)
                  : intent === 'judge' ? judgePrompt(context)
                    : intent === 'describe-batch' ? batchPrompt(context)
                      : prompt(subject, context),
              '--output-format',
              'json',
            ],
            { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout) => {
              res.setHeader('content-type', 'application/json');

              if (error !== null) {
                res.statusCode = 502;
                res.end(JSON.stringify({ error: String(error).slice(0, 200) }));
                return;
              }

              try {
                const envelope = JSON.parse(stdout) as CliResult;
                if (envelope.is_error === true) throw new Error('cli reported an error');

                const said = extract(envelope.result ?? '');
                const ran = Object.keys(envelope.modelUsage ?? {})[0] ?? null;

                res.statusCode = 200;
                res.end(JSON.stringify({
                  name: said.name,
                  line: said.line,
                  data: said.data,
                  model: ran,
                  costUsd: envelope.total_cost_usd ?? 0,
                }));
              } catch (parseError) {
                res.statusCode = 502;
                res.end(JSON.stringify({ error: String(parseError).slice(0, 200) }));
              }
            },
          );
        });
      });
    },
  };
}
