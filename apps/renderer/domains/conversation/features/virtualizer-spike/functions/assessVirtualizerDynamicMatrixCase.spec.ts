import { describe, expect, it } from 'vitest';
import type { VirtualizerSpikeStabilityResult } from '../definitions/virtualizerSpike';
import {
  assessVirtualizerDynamicMatrixCase,
  readVirtualizerDynamicExpectation,
} from './assessVirtualizerDynamicMatrixCase';

function stability(maxDriftPx: number, passed: boolean): VirtualizerSpikeStabilityResult {
  return {
    baseline: 100,
    maxDriftPx,
    missingFrames: 0,
    passed,
    samples: [{ frame: 0, value: 100 + maxDriftPx }],
  };
}

describe('assessVirtualizerDynamicMatrixCase', () => {
  it('requires the instance predicate to be called and matched for stable visual rows', () => {
    const expectation = readVirtualizerDynamicExpectation({
      granularity: 'visual-row',
      policy: 'fully-above',
      scenario: 'chart-growth',
    });

    expect(expectation).toBe('stable');
    expect(assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: 'visual-row',
      policy: 'fully-above',
      predicateCalls: 1,
      predicateMatches: 1,
      backwardScrollObserved: true,
      scrollCorrectionPx: 180,
      outerHeightDeltaPx: 180,
      scenario: 'chart-growth',
      stability: stability(0.2, true),
    })).toBe(true);
    expect(assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: 'visual-row',
      policy: 'fully-above',
      predicateCalls: 0,
      predicateMatches: 0,
      backwardScrollObserved: true,
      scrollCorrectionPx: 0,
      outerHeightDeltaPx: 0,
      scenario: 'chart-growth',
      stability: stability(0.2, true),
    })).toBe(false);
  });

  it('treats reproducible drift as expected even when the library performs legal correction', () => {
    const expectation = readVirtualizerDynamicExpectation({
      granularity: 'turn',
      policy: 'fully-above',
      scenario: 'chart-growth',
    });

    expect(expectation).toBe('drift');
    expect(assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: 'turn',
      policy: 'fully-above',
      predicateCalls: 1,
      predicateMatches: 0,
      backwardScrollObserved: true,
      scrollCorrectionPx: 0,
      outerHeightDeltaPx: 120,
      scenario: 'chart-growth',
      stability: stability(120, false),
    })).toBe(true);
    expect(assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: 'turn',
      policy: 'fully-above',
      predicateCalls: 1,
      predicateMatches: 0,
      backwardScrollObserved: true,
      scrollCorrectionPx: 120,
      outerHeightDeltaPx: 120,
      scenario: 'chart-growth',
      stability: stability(120, false),
    })).toBe(true);
    expect(assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: 'turn',
      policy: 'fully-above',
      predicateCalls: 1,
      predicateMatches: 0,
      backwardScrollObserved: true,
      scrollCorrectionPx: 120,
      outerHeightDeltaPx: 120,
      scenario: 'chart-growth',
      stability: stability(12, false),
    })).toBe(false);
  });

  it('accepts bounded nested growth only when outer geometry stays fixed for either policy', () => {
    for (const policy of ['default', 'fully-above'] as const) {
      const expectation = readVirtualizerDynamicExpectation({
        granularity: 'turn',
        policy,
        scenario: 'bounded-nested-growth',
      });

      expect(expectation).toBe('stable');
      expect(assessVirtualizerDynamicMatrixCase({
        expectation,
        granularity: 'turn',
        policy,
        predicateCalls: 0,
        predicateMatches: 0,
        backwardScrollObserved: true,
        scrollCorrectionPx: 0,
        outerHeightDeltaPx: 0,
        scenario: 'bounded-nested-growth',
        stability: stability(0.2, true),
      })).toBe(true);
      expect(assessVirtualizerDynamicMatrixCase({
        expectation,
        granularity: 'turn',
        policy,
        predicateCalls: 0,
        predicateMatches: 0,
        backwardScrollObserved: true,
        scrollCorrectionPx: 0,
        outerHeightDeltaPx: 12,
        scenario: 'bounded-nested-growth',
        stability: stability(12, false),
      })).toBe(false);
    }
  });
});
