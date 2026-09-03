export type FreeSearchProviderId = 'parallel_free' | 'duckduckgo';

export interface FreeSearchAttempt {
  provider: FreeSearchProviderId;
  caseId: string;
  requestSucceeded: boolean;
  nonEmpty: boolean;
  resultCount: number;
  validUrlCount: number;
  duplicateCount: number;
  tookMs: number;
  failureKind?: string;
}

export interface FreeSearchSummary {
  provider: FreeSearchProviderId;
  attempts: number;
  requestSuccessRate: number;
  nonEmptyRate: number;
  validUrlRate: number;
  duplicateRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  qualifiedAsDefaultCandidate: boolean;
}

export function selectDefaultFreeSearchProvider(
  summaries: FreeSearchSummary[],
): FreeSearchProviderId | undefined {
  // Parallel 是正式免费 API；DuckDuckGo HTML 仅在 Parallel 未达门槛时作为实验性候选。
  return summaries.find((summary) =>
    summary.provider === 'parallel_free' && summary.qualifiedAsDefaultCandidate)?.provider
    ?? summaries.find((summary) =>
      summary.provider === 'duckduckgo' && summary.qualifiedAsDefaultCandidate)?.provider;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? 0;
}

export function summarizeFreeSearchAttempts(
  provider: FreeSearchProviderId,
  allAttempts: FreeSearchAttempt[],
): FreeSearchSummary {
  const attempts = allAttempts.filter((attempt) => attempt.provider === provider);
  const requestSuccesses = attempts.filter((attempt) => attempt.requestSucceeded);
  const nonEmpty = attempts.filter((attempt) => attempt.nonEmpty).length;
  const resultCount = requestSuccesses.reduce((sum, attempt) => sum + attempt.resultCount, 0);
  const validUrlCount = requestSuccesses.reduce((sum, attempt) => sum + attempt.validUrlCount, 0);
  const duplicateCount = requestSuccesses.reduce((sum, attempt) => sum + attempt.duplicateCount, 0);
  const requestSuccessRate = attempts.length > 0 ? requestSuccesses.length / attempts.length : 0;
  const nonEmptyRate = attempts.length > 0 ? nonEmpty / attempts.length : 0;
  const validUrlRate = resultCount > 0 ? validUrlCount / resultCount : 0;
  const duplicateRate = resultCount > 0 ? duplicateCount / resultCount : 0;

  return {
    provider,
    attempts: attempts.length,
    requestSuccessRate,
    nonEmptyRate,
    validUrlRate,
    duplicateRate,
    latencyP50Ms: percentile(requestSuccesses.map((attempt) => attempt.tookMs), 0.5),
    latencyP95Ms: percentile(requestSuccesses.map((attempt) => attempt.tookMs), 0.95),
    qualifiedAsDefaultCandidate:
      attempts.length >= 30
      && requestSuccessRate >= 0.95
      && nonEmptyRate >= 0.95
      && validUrlRate >= 0.99
      && duplicateRate <= 0.05,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function renderFreeSearchReport(args: {
  generatedAt: string;
  attempts: FreeSearchAttempt[];
  summaries: FreeSearchSummary[];
}): string {
  const recommendedDefault = selectDefaultFreeSearchProvider(args.summaries);
  const lines = [
    '# 免费 Web Search 短基准报告',
    '',
    `> 生成时间：${args.generatedAt}`,
    '> 口径：40 条中英文真实查询 smoke；不宣称统计 SLO，不测试百度 API 稳定性。',
    '',
    '## 汇总',
    '',
    '| Provider | 请求成功率 | 非空率 | URL 合法率 | 重复率 | p50 | p95 | 默认候选 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const summary of args.summaries) {
    lines.push(
      `| ${summary.provider} | ${percent(summary.requestSuccessRate)} | ${percent(summary.nonEmptyRate)} | `
      + `${percent(summary.validUrlRate)} | ${percent(summary.duplicateRate)} | ${summary.latencyP50Ms}ms | `
      + `${summary.latencyP95Ms}ms | ${summary.qualifiedAsDefaultCandidate ? '是' : '否'} |`,
    );
  }

  lines.push(
    '',
    '默认候选门槛：至少 30 条查询，请求成功率和非空率均不低于 95%，URL 合法率不低于 99%，结果重复率不高于 5%。延迟只做观测，不在本次小样本中设置发布门槛。',
    '',
    '## 默认决策',
    '',
    recommendedDefault === 'parallel_free'
      ? '- 选择 `parallel_free` 作为 S2 的零配置产品默认：它达到门槛，且使用正式 MCP API；`duckduckgo` 即使达到门槛也只保留为实验性选项。'
      : recommendedDefault === 'duckduckgo'
        ? '- `parallel_free` 未达到门槛；暂以 `duckduckgo` 作为实验性零配置默认候选。'
        : '- 两个免费 Provider 均未达到门槛；生产默认继续保持现状。',
    '',
    '## 失败明细',
    '',
  );
  const failures = args.attempts.filter((attempt) => !attempt.requestSucceeded || !attempt.nonEmpty);
  if (failures.length === 0) {
    lines.push('- 无。');
  } else {
    for (const attempt of failures) {
      lines.push(
        `- ${attempt.provider} / ${attempt.caseId}: ${attempt.failureKind ?? (attempt.nonEmpty ? 'unknown' : 'empty_results')} (${attempt.tookMs}ms)`,
      );
    }
  }
  lines.push(
    '',
    '## 决策边界',
    '',
    '- 本报告只回答零 Key Provider 在当前网络环境下是否适合作为首次使用默认候选。',
    '- DuckDuckGo 是非官方 HTML 集成；即使本次通过，也必须在设置页标记实验性。',
    '- Parallel Free 依赖第三方匿名免费服务；通过不代表免费政策、共享限流或长期可用性承诺。',
    '- 默认路由切换由 S2 的显式配置合同落地；S1 不修改当前百度默认。',
  );
  return lines.join('\n');
}
