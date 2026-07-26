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

const TIMEOUT_MS = 45_000;

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

  const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: unknown; line?: unknown; rule?: unknown };
  if (typeof parsed.name !== 'string') throw new Error('reply had no name');
  return {
    name: parsed.name,
    line: typeof parsed.line === 'string' ? parsed.line : '',
    // Handed on unvalidated, deliberately: this is a dev server, and the one
    // place that decides whether a rule is a rule is the validator in canon/.
    data: parsed.rule,
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
              '-p',
              intent === 'gamemaster' ? gamemasterPrompt(context)
                : intent === 'propose' ? proposePrompt(context)
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
