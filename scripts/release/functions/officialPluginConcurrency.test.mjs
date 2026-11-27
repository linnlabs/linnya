import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OFFICIAL_PLUGIN_CONCURRENCY,
  resolveOfficialPluginConcurrency,
  runBoundedParallel,
} from './officialPluginConcurrency.mjs';

describe('officialPluginConcurrency', () => {
  it('defaults to 3 bounded by target count and supports explicit overrides', () => {
    expect(DEFAULT_OFFICIAL_PLUGIN_CONCURRENCY).toBe(3);
    expect(resolveOfficialPluginConcurrency(undefined, 5)).toBe(3);
    expect(resolveOfficialPluginConcurrency('', 2)).toBe(2);
    expect(resolveOfficialPluginConcurrency('  ', 0)).toBe(1);
    expect(resolveOfficialPluginConcurrency('2', 5)).toBe(2);
    expect(resolveOfficialPluginConcurrency('8', 3)).toBe(3);
  });

  it('rejects non-positive or non-integer concurrency values', () => {
    expect(() => resolveOfficialPluginConcurrency('0', 3)).toThrow('positive integer');
    expect(() => resolveOfficialPluginConcurrency('-1', 3)).toThrow('positive integer');
    expect(() => resolveOfficialPluginConcurrency('1.5', 3)).toThrow('positive integer');
    expect(() => resolveOfficialPluginConcurrency('fast', 3)).toThrow('positive integer');
  });

  it('runs workers within the concurrency bound and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const results = await runBoundedParallel([10, 20, 30, 40, 50], 2, async value => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(results).toEqual([20, 40, 60, 80, 100]);
  });

  it('stops dequeuing remaining targets after a worker throws', async () => {
    const started = [];
    await expect(
      runBoundedParallel(['a', 'b', 'c', 'd'], 2, async item => {
        started.push(item);
        if (item === 'a') {
          await new Promise(resolve => setTimeout(resolve, 5));
          throw new Error('boom');
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }),
    ).rejects.toThrow('boom');

    expect(started).not.toContain('d');
  });
});
