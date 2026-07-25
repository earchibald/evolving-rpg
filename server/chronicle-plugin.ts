import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
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
 * `runs/history.jsonl` gets one line per save, so a trail survives even though
 * the full state does not.
 *
 * Development only. It is a Vite dev middleware and does not exist in a build.
 */
export function chroniclePlugin(): Plugin {
  return {
    name: 'evolving-rpg:chronicle',
    configureServer(server) {
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
