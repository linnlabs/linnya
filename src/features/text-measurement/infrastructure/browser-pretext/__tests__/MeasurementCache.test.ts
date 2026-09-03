import { describe, expect, it } from 'vitest';
import { MeasurementCache, createMeasurementCacheKey } from '../MeasurementCache.js';
import { normalizeTextMeasureInput } from '../../../index.js';

function createInput(text: string, widthInches: number) {
  return normalizeTextMeasureInput({
    paragraphs: [{ text }],
    style: {
      fontFamily: 'Arial',
      fontSizePt: 12,
      lineHeightMultiplier: 1.2,
    },
    box: {
      widthInches,
      wrap: 'word',
    },
    sourceKind: 'generated',
  });
}

describe('MeasurementCache', () => {
  it('creates a stable key for equivalent normalized inputs', () => {
    const left = createMeasurementCacheKey(createInput('Revenue growth', 2.4));
    const right = createMeasurementCacheKey(createInput('Revenue growth', 2.4));

    expect(left).toBe(right);
  });

  it('evicts the least recently used entry when capacity is exceeded', () => {
    const cache = new MeasurementCache({ maxEntries: 2 });
    const alpha = createInput('Alpha', 2.2);
    const beta = createInput('Beta', 2.2);
    const gamma = createInput('Gamma', 2.2);

    cache.set(alpha, {
      lineCount: 1,
      contentHeightInches: 0.2,
      totalHeightInches: 0.2,
      maxLineWidthInches: 1,
      usedFallback: false,
      warnings: [],
    });
    cache.set(beta, {
      lineCount: 1,
      contentHeightInches: 0.2,
      totalHeightInches: 0.2,
      maxLineWidthInches: 1,
      usedFallback: false,
      warnings: [],
    });

    expect(cache.get(alpha)?.maxLineWidthInches).toBe(1);

    cache.set(gamma, {
      lineCount: 2,
      contentHeightInches: 0.4,
      totalHeightInches: 0.4,
      maxLineWidthInches: 1.4,
      usedFallback: false,
      warnings: [],
    });

    expect(cache.get(alpha)?.maxLineWidthInches).toBe(1);
    expect(cache.get(beta)).toBeUndefined();
    expect(cache.get(gamma)?.lineCount).toBe(2);
  });
});
