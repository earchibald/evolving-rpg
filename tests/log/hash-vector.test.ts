import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

describe('sha256 library wiring', () => {
  it('matches the published test vector for "abc"', () => {
    const digest = bytesToHex(sha256(new TextEncoder().encode('abc')));
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
