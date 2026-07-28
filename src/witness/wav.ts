/**
 * Float32 samples → a WAV file (16-bit PCM, mono).
 *
 * The format is chosen for the far end, not this one: AVFoundation reads WAV
 * natively, so the transcriber never needs a decoder we would have to ship.
 * MediaRecorder's webm/opus would have been less code here and an ffmpeg
 * dependency there — the wrong trade for a thing that must stay local.
 */

const HEADER_BYTES = 44;

/** Encodes one mono channel. Samples outside [-1, 1] clamp rather than wrap —
 *  a hot microphone should clip audibly, not alias into garbage. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const data = new ArrayBuffer(HEADER_BYTES + samples.length * 2);
  const view = new DataView(data);

  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: rate × block align
  view.setUint16(32, 2, true); // block align: one 16-bit mono frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 0x7fff), true);
  }

  return new Uint8Array(data);
}

/** Joins worklet-sized chunks into the one buffer the encoder wants. */
export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}
