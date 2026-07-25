import type { Question, Transport } from './types.js';

/**
 * A transport that invents nothing.
 *
 * Used by every test, which is how "no test touches the network" stays true
 * while the Oracle is still exercised end to end. Its answers are derived from
 * the question, so they are stable across runs and machines.
 */
export function stubTransport(): Transport {
  return {
    name: 'stub',
    ask(question: Question) {
      const bare = question.subject.slice(question.subject.indexOf(':') + 1);
      return Promise.resolve({
        name: `the ${bare}`,
        line: `It is a ${bare}, and the stub has nothing further to say.`,
        model: 'stub',
        costUsd: 0,
      });
    },
  };
}

/** A transport that always fails, for proving the game survives one that does. */
export function brokenTransport(reason = 'no transport'): Transport {
  return {
    name: 'broken',
    ask() {
      return Promise.reject(new Error(reason));
    },
  };
}

/**
 * Asks the dev server, which asks the `claude` CLI.
 *
 * The browser cannot shell out, so the question crosses to the dev server and
 * the answer comes back. No API key is involved anywhere: the CLI bills against
 * whatever account is already signed in, which is the whole reason this is the
 * development default.
 */
export function cliTransport(): Transport {
  return {
    name: 'claude cli',
    async ask(question: Question) {
      const response = await fetch('/__oracle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(question),
      });

      if (!response.ok) throw new Error(`oracle ${response.status}: ${await response.text()}`);

      const said = (await response.json()) as {
        name?: unknown;
        line?: unknown;
        model?: unknown;
        costUsd?: unknown;
      };

      if (typeof said.name !== 'string' || said.name.trim() === '') {
        throw new Error('oracle returned no name');
      }

      return {
        name: said.name.trim(),
        line: typeof said.line === 'string' ? said.line.trim() : '',
        model: typeof said.model === 'string' ? said.model : null,
        costUsd: typeof said.costUsd === 'number' ? said.costUsd : 0,
      };
    },
  };
}
