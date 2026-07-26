import { readTheGame } from './critic.js';
import type { Report } from './critic.js';
import type { EventLog } from '../log/chain.js';

/**
 * The Critic, memoised by head.
 *
 * The render loop runs on every keypress and the Critic replays the whole
 * chain. For an append-only log the memo key is exact rather than heuristic:
 * the head names the entire history, so same head means same report, always.
 *
 * A small map rather than a single slot, because the view switches between
 * worlds — main, a grave, a fork — and a one-line cache would thrash between
 * two warm heads forever.
 */
const KEEP = 8;

export class CachedCritic {
  /** How many real computations have run. Public because the tests' whole job
   *  is to count them. */
  computes = 0;

  private byHead = new Map<string, Report>();

  read(log: EventLog, head: string | null): Report {
    const key = head ?? '(none)';
    const kept = this.byHead.get(key);
    if (kept !== undefined) return kept;

    const report = readTheGame(log, head);
    this.computes += 1;

    this.byHead.set(key, report);
    // Oldest out first. Map iteration is insertion-ordered, which makes this a
    // FIFO — fine for a working set of two or three worlds.
    if (this.byHead.size > KEEP) {
      const oldest = this.byHead.keys().next().value;
      if (oldest !== undefined) this.byHead.delete(oldest);
    }
    return report;
  }
}
