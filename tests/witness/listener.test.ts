import { describe, expect, it } from 'vitest';
import { listenerPrompt } from '../../src/witness/listener.js';
import type { ListenerPacket } from '../../src/witness/listener.js';

const PACKET: ListenerPacket = {
  world: 'main',
  reason: 'begin-again',
  ended: 'dead',
  turns: 118,
  depth: 3,
  level: 4,
  happened: ['The run lasted 118 turns and ended: dead.'],
  said: ['Out of world, about the game, they said: "the warden is a wall"'],
  measured: ['Lens #61, Interest: flat early floors (measured)'],
  inForce: ['when a turn goes by … you lose 1 hit point'],
  woven: '00:41 · you say: “why would I ever shove”',
  spoke: true,
};

describe('the listener’s prompt', () => {
  it('carries every register of evidence, verbatim', () => {
    const prompt = listenerPrompt(PACKET);
    expect(prompt).toContain('The run lasted 118 turns');
    expect(prompt).toContain('the warden is a wall');
    expect(prompt).toContain('Lens #61');
    expect(prompt).toContain('you lose 1 hit point');
    expect(prompt).toContain('why would I ever shove');
    expect(prompt).toContain('ended: dead at turn 118');
    expect(prompt).toContain('the player chose to begin this world again');
  });

  it('demands the header-then-divider shape the plugin will parse', () => {
    const prompt = listenerPrompt(PACKET);
    expect(prompt).toContain('one line of JSON');
    expect(prompt).toContain('\n---\n');
    expect(prompt).toContain('"line":');
    // The report must ride OUTSIDE the JSON — a report packed inside a JSON
    // array died to one unescaped quote, live, the first time it was tried.
    expect(prompt).not.toContain('"report":');
  });

  it('is honest about a silent run instead of weaving nothing', () => {
    const prompt = listenerPrompt({ ...PACKET, spoke: false });
    expect(prompt).toContain('(the player said nothing aloud this run)');
    expect(prompt).not.toContain('why would I ever shove');
  });

  it('names the submit action — leaving for another world reads differently', () => {
    expect(listenerPrompt({ ...PACKET, reason: 'wipe' })).toContain('wiped everything');
    expect(listenerPrompt({ ...PACKET, reason: 'another-world' })).toContain('left for another world');
  });
});
