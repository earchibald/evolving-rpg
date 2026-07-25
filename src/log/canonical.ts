/**
 * Deterministic JSON: keys sorted, no whitespace, arrays left alone. Event
 * identity is a hash of these bytes, so if key order drifted between engine
 * versions every existing chain would fail to verify.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean' || t === 'string') return JSON.stringify(value);

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalJson: non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }

  if (t === 'undefined') throw new Error('canonicalJson: undefined is not serialisable');

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }

  if (t === 'object') {
    // Plain objects only. A Date, Map, Set or class instance has no own
    // enumerable keys, so it would serialise to `{}` — two different Dates
    // hashing identically to each other and to an empty object. In a
    // tamper-evident chain, refusing is far better than collapsing silently.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(
        `canonicalJson: only plain objects are serialisable, got ${Object.prototype.toString.call(value)}`,
      );
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',');
    return `{${body}}`;
  }

  throw new Error(`canonicalJson: unsupported type ${t}`);
}
