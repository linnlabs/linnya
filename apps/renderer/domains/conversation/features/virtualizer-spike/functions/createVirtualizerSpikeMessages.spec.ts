import { describe, expect, it } from 'vitest';
import { createVirtualizerSpikeMessages } from './createVirtualizerSpikeMessages';

describe('createVirtualizerSpikeMessages', () => {
  it('creates stable ids and deterministic mixed-height content across negative prepend ranges', () => {
    const first = createVirtualizerSpikeMessages(-12, 20);
    const second = createVirtualizerSpikeMessages(-12, 20);

    expect(second).toEqual(first);
    expect(first[0]?.id).toBe('virtualizer-spike-message--12');
    expect(first[19]?.id).toBe('virtualizer-spike-message-7');
    expect(new Set(first.map(message => message.id)).size).toBe(20);
    expect(first.some(message => message.image !== null)).toBe(true);
    expect(new Set(first.map(message => message.paragraphs.length)).size).toBeGreaterThan(1);
  });
});
