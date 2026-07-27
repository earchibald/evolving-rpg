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
      if (question.intent === 'describe-batch') {
        const things = Array.isArray(question.context['things'])
          ? question.context['things'] as Array<{ subject?: unknown }>
          : [];
        return Promise.resolve({
          name: `${String(things.length)} named`,
          line: '',
          model: 'stub',
          costUsd: 0,
          data: things.map((t) => {
            const subject = String(t.subject ?? '');
            const bare = subject.slice(subject.indexOf(':') + 1);
            return {
              subject,
              // "pale skirmisher", "grey keen edge" — distinct per subject, so
              // a batch of different things passes the duplicate check.
              name: `pale ${bare}`,
              line: `It is a ${bare}, and the stub has nothing further to say.`,
            };
          }),
        });
      }
      const bare = question.subject.slice(question.subject.indexOf(':') + 1);
      return Promise.resolve({
        // Article-free on purpose: the stub's names pass the same register
        // assay real ones do, or every offline test fails the Covenant.
        name: `pale ${bare}`,
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
      // The browser's own deadline, past the server's: if the dev server
      // never answers at all (a hung child, a dead middleware), the call
      // must still FAIL here — an ask that never settles never clears its
      // in-flight gates, and a founding stuck "asking" for 26 minutes
      // silently held a whole world's naming shut.
      const response = await fetch('/__oracle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(question),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) throw new Error(`oracle ${response.status}: ${await response.text()}`);

      const said = (await response.json()) as {
        name?: unknown;
        line?: unknown;
        model?: unknown;
        costUsd?: unknown;
        data?: unknown;
      };

      if (typeof said.name !== 'string' || said.name.trim() === '') {
        throw new Error('oracle returned no name');
      }

      return {
        name: said.name.trim(),
        line: typeof said.line === 'string' ? said.line.trim() : '',
        model: typeof said.model === 'string' ? said.model : null,
        costUsd: typeof said.costUsd === 'number' ? said.costUsd : 0,
        // Straight through, unexamined. Whether this is a rule is the
        // validator's judgement, made in one place, not this one's.
        data: said.data,
      };
    },
  };
}
