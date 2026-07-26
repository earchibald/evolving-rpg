import { writeFileSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Mirrors a played session to disk.
 *
 * The point is the collaboration loop, not the backup: "play a round, then look
 * at what happened together" only works if what happened is somewhere both of
 * us can read. A browser cannot write to the repository, so the dev server does
 * it — one endpoint, no database, no ceremony.
 *
 * `runs/latest.json` is the whole session, overwritten each save.
 * `runs/history.jsonl` gets one line per save — counts only, a trail rather
 * than a record.
 * `runs/archive/` holds the full session as it stood *before* anything shrank
 * it, which is the only reason a wiped run is still readable afterwards.
 *
 * Development only. It is a Vite dev middleware and does not exist in a build.
 */
export function chroniclePlugin(): Plugin {
  return {
    name: 'evolving-rpg:chronicle',
    configureServer(server) {
      // Notes: one line per thing said, appended, never rewritten. Kept beside
      // the chronicle rather than inside it — they are about the game and
      // around it, not events within it.
      server.middlewares.use('/__notes', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => { body += String(chunk); });
        req.on('end', () => {
          try {
            const note = JSON.parse(body) as Record<string, unknown>;
            const out = resolve(process.cwd(), 'runs/notes.jsonl');
            mkdirSync(dirname(out), { recursive: true });
            appendFileSync(out, `${JSON.stringify(note)}\n`, 'utf8');
            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      });

      server.middlewares.use('/__chronicle', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }

        let body = '';
        req.on('data', (chunk) => { body += String(chunk); });
        req.on('end', () => {
          try {
            const full = resolve(process.cwd(), 'runs/latest.json');
            mkdirSync(dirname(full), { recursive: true });

            /*
             * Archive before overwriting, when the new session is smaller.
             *
             * The chronicle exists so a round played here can be read back
             * afterwards — and it could not survive the one action designed to
             * destroy things. A wipe posted a one-event session straight over
             * the top of a six-hundred-event run, and history.jsonl keeps only
             * counts, so the run was simply gone. That is exactly how an agent
             * verifying the wipe fix destroyed the play it was meant to be
             * studying.
             *
             * Shrinking is the signal: any save with fewer events than the one
             * on disk is either a wipe or a fresh start, and both are worth
             * stepping around rather than through.
             */
            const shrinking = ((): number => {
              try {
                const was = JSON.parse(readFileSync(full, 'utf8')) as { events?: unknown[] };
                return was.events?.length ?? 0;
              } catch {
                return 0;
              }
            })();

            const incoming = ((): number => {
              try {
                return (JSON.parse(body) as { events?: unknown[] }).events?.length ?? 0;
              } catch {
                return 0;
              }
            })();

            if (shrinking > incoming && shrinking > 1) {
              const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
              const kept = resolve(process.cwd(), `runs/archive/${stamp}-${String(shrinking)}-events.json`);
              mkdirSync(dirname(kept), { recursive: true });
              writeFileSync(kept, readFileSync(full, 'utf8'), 'utf8');
            }

            writeFileSync(full, body, 'utf8');

            // A one-line trail. Parsed here rather than trusted, so a malformed
            // body fails loudly instead of writing nonsense into the history.
            const parsed = JSON.parse(body) as {
              savedAt?: string;
              active?: string;
              events?: unknown[];
              refs?: unknown[];
            };
            appendFileSync(
              resolve(process.cwd(), 'runs/history.jsonl'),
              `${JSON.stringify({
                savedAt: parsed.savedAt,
                active: parsed.active,
                events: parsed.events?.length ?? 0,
                worlds: parsed.refs?.length ?? 0,
              })}\n`,
              'utf8',
            );

            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      });
    },
  };
}
