import { describe, expect, it } from 'vitest';
import { assessVirtualizerSpikeStability } from './assessVirtualizerSpikeStability';

describe('assessVirtualizerSpikeStability', () => {
  it('passes only when every sampled frame keeps the anchor below the strict threshold', () => {
    const result = assessVirtualizerSpikeStability({
      baseline: 120,
      thresholdPx: 1,
      samples: [
        { frame: 0, value: 120.2 },
        { frame: 1, value: 119.4 },
        { frame: 2, value: 120.8 },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.maxDriftPx).toBeCloseTo(0.8);
    expect(result.missingFrames).toBe(0);
  });

  it('fails on a missing anchor or a one-pixel drift', () => {
    const missing = assessVirtualizerSpikeStability({
      baseline: 80,
      thresholdPx: 1,
      samples: [{ frame: 0, value: null }],
    });
    const boundary = assessVirtualizerSpikeStability({
      baseline: 80,
      thresholdPx: 1,
      samples: [{ frame: 0, value: 81 }],
    });

    expect(missing.passed).toBe(false);
    expect(missing.missingFrames).toBe(1);
    expect(boundary.passed).toBe(false);
  });
});
