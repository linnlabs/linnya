import { describe, expect, it } from 'vitest';
import { evaluateReliabilityGate, wilsonLowerBound, type ReliabilityAttempt } from './statistics';

function attempts(successes: number, total: number, excluded = 0): ReliabilityAttempt[] {
  return [
    ...Array.from({ length: successes }, () => ({ eligible: true, success: true })),
    ...Array.from({ length: total - successes }, () => ({ eligible: true, success: false })),
    ...Array.from({ length: excluded }, () => ({ eligible: false, success: false })),
  ];
}

describe('Web 可靠性 Wilson 门禁', () => {
  it('197/200 达标，196/200 不达标', () => {
    expect(evaluateReliabilityGate(attempts(197, 200)).passed).toBe(true);
    expect(evaluateReliabilityGate(attempts(196, 200)).passed).toBe(false);
    expect(wilsonLowerBound(196, 200, 0.95)).toBeLessThan(0.95);
  });

  it('样本不足时即使全成功也不能宣称达标', () => {
    const result = evaluateReliabilityGate(attempts(199, 199));
    expect(result.hasEnoughSamples).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('excluded attempt 不进入分母', () => {
    const result = evaluateReliabilityGate(attempts(197, 200, 12));
    expect(result.eligibleAttempts).toBe(200);
    expect(result.excludedAttempts).toBe(12);
    expect(result.passed).toBe(true);
  });
});
