import { describe, expect, it } from 'vitest';
import { concatChunks, encodeWav } from '../../src/witness/wav.js';

/** Byte-level proofs: a WAV header that is wrong anywhere is a file the
 *  transcriber refuses, so every field is pinned exactly — change a header
 *  constant in the encoder and one of these fails. */
describe('encodeWav', () => {
  const ascii = (bytes: Uint8Array, at: number, n: number): string =>
    String.fromCharCode(...bytes.slice(at, at + n));
  const u32 = (bytes: Uint8Array, at: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
  const u16 = (bytes: Uint8Array, at: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);
  const i16 = (bytes: Uint8Array, at: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset).getInt16(at, true);

  it('writes an exact RIFF/WAVE header for 16-bit mono PCM', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000);

    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(u32(wav, 4)).toBe(36 + 6); // 3 samples × 2 bytes
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(u32(wav, 16)).toBe(16); // PCM chunk size
    expect(u16(wav, 20)).toBe(1); // PCM
    expect(u16(wav, 22)).toBe(1); // mono
    expect(u32(wav, 24)).toBe(16000); // sample rate
    expect(u32(wav, 28)).toBe(32000); // byte rate = rate × 2
    expect(u16(wav, 32)).toBe(2); // block align
    expect(u16(wav, 34)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(u32(wav, 40)).toBe(6);
    expect(wav.length).toBe(44 + 6);
  });

  it('carries whatever rate is true — the header never lies about 16k', () => {
    const wav = encodeWav(new Float32Array(8), 48000);
    expect(u32(wav, 24)).toBe(48000);
    expect(u32(wav, 28)).toBe(96000);
  });

  it('scales samples to 16-bit and clamps instead of wrapping', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000);
    expect(i16(wav, 44)).toBe(0);
    expect(i16(wav, 46)).toBe(0x7fff);
    expect(i16(wav, 48)).toBe(-0x7fff);
    // A hot mic clips; it must never alias into the opposite sign.
    expect(i16(wav, 50)).toBe(0x7fff);
    expect(i16(wav, 52)).toBe(-0x7fff);
  });
});

describe('concatChunks', () => {
  it('joins worklet chunks in order, sample for sample', () => {
    const joined = concatChunks([
      new Float32Array([1, 2]),
      new Float32Array([]),
      new Float32Array([3]),
    ]);
    expect([...joined]).toEqual([1, 2, 3]);
  });
});
