import { describe, expect, it } from 'vitest';
import {
  renderReliabilityReport,
  summarizeLiveSmoke,
  type LiveReliabilityAttemptReport,
} from './report';

function attempt(success: boolean): LiveReliabilityAttemptReport {
  return {
    provider: 'baidu_qianfan',
    caseId: success ? 'success' : 'failure',
    round: 1,
    startedAt: '2026-07-19T00:00:00.000Z',
    eligible: true,
    success,
    ...(success ? {} : { failureKind: 'quality_or_evidence' }),
    resultCount: success ? 10 : 0,
    tookMs: 100,
  };
}

describe('Web Search live smoke 报告', () => {
  it('按观测成功率判定 smoke，并明确不宣称统计 SLO', () => {
    const attempts = [attempt(true), attempt(true), attempt(true), attempt(false)];
    const summary = summarizeLiveSmoke(attempts, 0.75);
    expect(summary.passed).toBe(true);
    expect(summary.observedRate).toBe(0.75);

    const report = renderReliabilityReport(attempts, summary);
    expect(report).toContain('smoke threshold: 75.00% (PASS)');
    expect(report).toContain('statistical SLO: not claimed');
    expect(report).not.toContain('enough samples (>=200)');
  });
});
