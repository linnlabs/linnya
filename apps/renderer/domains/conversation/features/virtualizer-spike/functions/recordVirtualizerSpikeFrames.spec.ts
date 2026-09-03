import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordVirtualizerSpikeFrames } from './recordVirtualizerSpikeFrames';

describe('recordVirtualizerSpikeFrames', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads after a complete painted frame instead of inside the first rAF callback', async () => {
    const callbacks: Array<(timestamp: number) => void> = [];
    const readValue = vi.fn(() => 12);
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    const resultPromise = recordVirtualizerSpikeFrames({ frameCount: 1, readValue });
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(0);
    expect(readValue).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(16);
    await expect(resultPromise).resolves.toEqual([{ frame: 0, value: 12 }]);
    expect(readValue).toHaveBeenCalledOnce();
  });
});
