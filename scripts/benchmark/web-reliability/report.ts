export interface LiveReliabilityAttemptReport {
  provider: string;
  caseId: string;
  round: number;
  startedAt: string;
  eligible: boolean;
  success: boolean;
  failureKind?: string;
  httpStatus?: number;
  resultCount: number;
  tookMs: number;
}

export interface LiveSmokeSummary {
  eligibleAttempts: number;
  excludedAttempts: number;
  successes: number;
  observedRate: number;
  minSuccessRate: number;
  passed: boolean;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function summarizeLiveSmoke(
  attempts: LiveReliabilityAttemptReport[],
  minSuccessRate: number,
): LiveSmokeSummary {
  if (!(minSuccessRate > 0 && minSuccessRate <= 1)) {
    throw new Error('minSuccessRate 必须大于 0 且不超过 1。');
  }
  const eligible = attempts.filter((attempt) => attempt.eligible);
  const successes = eligible.filter((attempt) => attempt.success).length;
  const observedRate = eligible.length > 0 ? successes / eligible.length : 0;
  return {
    eligibleAttempts: eligible.length,
    excludedAttempts: attempts.length - eligible.length,
    successes,
    observedRate,
    minSuccessRate,
    passed: eligible.length > 0 && observedRate >= minSuccessRate,
  };
}

export function renderReliabilityReport(
  attempts: LiveReliabilityAttemptReport[],
  summary: LiveSmokeSummary,
): string {
  const eligibleLatencies = attempts.filter((attempt) => attempt.eligible).map((attempt) => attempt.tookMs);
  const failures = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.success || !attempt.eligible) continue;
    const kind = attempt.failureKind ?? 'unknown';
    failures.set(kind, (failures.get(kind) ?? 0) + 1);
  }

  const lines = [
    '# Web Search Live Smoke Report',
    '',
    `- provider: ${attempts[0]?.provider ?? 'unknown'}`,
    `- eligible attempts: ${summary.eligibleAttempts}`,
    `- excluded attempts: ${summary.excludedAttempts}`,
    `- successes: ${summary.successes}`,
    `- observed success rate: ${percent(summary.observedRate)}`,
    `- smoke threshold: ${percent(summary.minSuccessRate)} (${summary.passed ? 'PASS' : 'FAIL'})`,
    '- statistical SLO: not claimed; accumulate production samples separately',
    `- latency p50/p95/p99: ${percentile(eligibleLatencies, 50)}ms / ${percentile(eligibleLatencies, 95)}ms / ${percentile(eligibleLatencies, 99)}ms`,
    '',
    '## Failure Kinds',
    '',
  ];
  if (failures.size === 0) lines.push('- none');
  for (const [kind, count] of [...failures.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${kind}: ${count}`);
  }
  return lines.join('\n');
}
