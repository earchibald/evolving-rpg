import { canonicalJson } from '../../src/log/canonical.js';

describe('canonicalJson', () => {
  it('sorts object keys, so declaration order cannot change a hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('keeps array order, because order is meaningful there', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: [1, 2], b: { c: 3 } })).toBe('{"a":[1,2],"b":{"c":3}}');
  });

  it('handles the primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(-0.5)).toBe('-0.5');
    expect(canonicalJson('hi "there"')).toBe('"hi \\"there\\""');
  });

  it('skips undefined properties rather than emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses values that cannot round-trip', () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(() => 1)).toThrow(/unsupported/);
  });

  it('refuses objects that are not plain, rather than collapsing them to {}', () => {
    // None of these has own enumerable keys, so without the prototype guard
    // every one of them serialises to `{}` — two different Dates would hash
    // identically to each other and to an empty object.
    expect(() => canonicalJson(new Date(0))).toThrow(/only plain objects/);
    expect(() => canonicalJson(new Map([['a', 1]]))).toThrow(/only plain objects/);
    expect(() => canonicalJson(new Set([1]))).toThrow(/only plain objects/);
  });

  it('accepts a null-prototype object, which is still plain data', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.b = 1;
    bare.a = 2;
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
  });
});
