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

function prompt(subject: string, context: unknown): string {
  return [
    'You are naming one thing in a cold, quiet, attentive world.',
    'The world is under-specified on purpose: it has no established genre yet,',
    'and what you say becomes permanent canon that cannot later be contradicted.',
    '',
    `Subject: ${subject}`,
    `What is known: ${JSON.stringify(context)}`,
    '',
    'Reply with ONLY a JSON object, no prose around it, no code fence:',
    '{"name": "<two or three words, lowercase, no article>",',
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
function extract(text: string): { name: string; line: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no object in reply: ${text.slice(0, 120)}`);

  const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: unknown; line?: unknown };
  if (typeof parsed.name !== 'string') throw new Error('reply had no name');
  return {
    name: parsed.name,
    line: typeof parsed.line === 'string' ? parsed.line : '',
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
              intent === 'gamemaster' ? gamemasterPrompt(context) : prompt(subject, context),
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
