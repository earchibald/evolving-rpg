import { readFileSync } from 'node:fs';
import { validateRule, isRejected, readRule } from '../src/canon/rule.js';
import { assayRule } from '../src/assay/ruleAssay.js';

/**
 * Puts one rule on trial, for anyone with a shell.
 *
 *   npm run trial -- path/to/rule.json
 *   echo '{"when":"WAIT",...}' | npm run trial
 *
 * Exit codes are the contract: 0 sound, 1 not even a rule, 2 refused by the
 * assay. An agent can gate on the code and read the JSON for the reasons.
 */

const path = process.argv[2];
const raw = path !== undefined && !path.startsWith('--')
  ? readFileSync(path, 'utf8')
  : readFileSync(0, 'utf8');

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.log(JSON.stringify({ verdict: 'invalid', findings: [`not JSON: ${String(error).slice(0, 80)}`] }));
  process.exit(1);
}

const candidate = {
  id: 'candidate',
  ratifiedAt: new Date().toISOString(),
  ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
};

const rule = validateRule(candidate);
if (isRejected(rule)) {
  console.log(JSON.stringify({ verdict: 'invalid', findings: [rule.rejected] }, null, 1));
  process.exit(1);
}

const assay = assayRule(rule);
console.log(JSON.stringify({
  verdict: assay.verdict,
  reads: readRule(rule),
  findings: assay.findings,
  neverFired: assay.neverFired,
}, null, 1));
process.exit(assay.verdict === 'sound' ? 0 : 2);
