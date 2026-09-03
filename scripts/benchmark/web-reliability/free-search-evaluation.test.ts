import { describe, expect, it } from 'vitest';
import {
  renderFreeSearchReport,
  selectDefaultFreeSearchProvider,
  summarizeFreeSearchAttempts,
  type FreeSearchAttempt,
} from './free-search-evaluation';

function attempts(params: {
  count: number;
  failures?: number;
  empty?: number;
  invalidUrls?: number;
  duplicates?: number;
}): FreeSearchAttempt[] {
  return Array.from({ length: params.count }, (_value, index) => {
    const failed = index < (params.failures ?? 0);
    const empty = !failed && index < (params.failures ?? 0) + (params.empty ?? 0);
    return {
      provider: 'parallel_free',
      caseId: `case-${index}`,
      requestSucceeded: !failed,
      nonEmpty: !failed && !empty,
      resultCount: failed || empty ? 0 : 10,
      validUrlCount: failed || empty ? 0 : 10 - (index === params.count - 1 ? (params.invalidUrls ?? 0) : 0),
      duplicateCount: failed || empty ? 0 : index === params.count - 1 ? (params.duplicates ?? 0) : 0,
      tookMs: 100 + index,
      ...(failed ? { failureKind: 'rate_limited' } : {}),
    };
  });
}

describe('免费 Web Search 短基准汇总', () => {
  it('业务门槛全部满足时成为默认候选', () => {
    const summary = summarizeFreeSearchAttempts('parallel_free', attempts({ count: 40 }));
    expect(summary).toMatchObject({
      attempts: 40,
      requestSuccessRate: 1,
      nonEmptyRate: 1,
      validUrlRate: 1,
      duplicateRate: 0,
      qualifiedAsDefaultCandidate: true,
    });
    expect(summary.latencyP50Ms).toBe(119);
    expect(summary.latencyP95Ms).toBe(137);
  });

  it('请求成功率或非空率不足时不能成为默认候选', () => {
    expect(summarizeFreeSearchAttempts('parallel_free', attempts({ count: 40, failures: 3 })).qualifiedAsDefaultCandidate).toBe(false);
    expect(summarizeFreeSearchAttempts('parallel_free', attempts({ count: 40, empty: 3 })).qualifiedAsDefaultCandidate).toBe(false);
  });

  it('两者都达标时优先选择正式 API，而不是实验性 HTML 抓取', () => {
    const parallel = summarizeFreeSearchAttempts('parallel_free', attempts({ count: 40 }));
    const duckDuckGo = {
      ...parallel,
      provider: 'duckduckgo' as const,
      latencyP50Ms: 50,
      latencyP95Ms: 100,
    };
    expect(selectDefaultFreeSearchProvider([duckDuckGo, parallel])).toBe('parallel_free');
  });

  it('报告分别展示各项指标和失败根因', () => {
    const input = attempts({ count: 40, failures: 1 });
    const summary = summarizeFreeSearchAttempts('parallel_free', input);
    const report = renderFreeSearchReport({
      generatedAt: '2026-07-19T00:00:00.000Z',
      attempts: input,
      summaries: [summary],
    });
    expect(report).toContain('| parallel_free | 97.50% | 97.50% |');
    expect(report).toContain('parallel_free / case-0: rate_limited');
    expect(report).toContain('不宣称统计 SLO');
    expect(report).toContain('选择 `parallel_free` 作为 S2 的零配置产品默认');
  });
});
