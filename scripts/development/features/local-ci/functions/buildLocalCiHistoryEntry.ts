import {
  LOCAL_CI_HISTORY_VERSION,
  type LocalCiHistoryEntry,
  type LocalCiHistoryStepFacts,
  type LocalCiLoadSummary,
} from '../definitions/localCiHistory';

export function summarizeLocalCiLoad(cores: number, samples: readonly number[]): LocalCiLoadSummary {
  const round = (value: number) => Math.round(value * 100) / 100;
  const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  return { cores, samples: samples.length, mean: round(mean), max: round(samples.length ? Math.max(...samples) : 0) };
}

/** 一轮运行的历史行：只留统计趋势要用的事实，失败细节仍在运行目录的回执里。 */
export function buildLocalCiHistoryEntry(input: Omit<LocalCiHistoryEntry, 'v' | 'failedSteps'> & {
  readonly results: readonly LocalCiHistoryStepFacts[];
}): LocalCiHistoryEntry {
  const { results, ...facts } = input;
  return {
    v: LOCAL_CI_HISTORY_VERSION,
    ...facts,
    // 复用别的步骤结果的失败只算一次：算在真正执行的那一步上，与终端汇总一致。
    failedSteps: results
      .filter(result => result.outcome === 'failure' && !result.reusedFrom)
      .map(result => ({
        step: `${result.jobLabel} › ${result.name}`,
        kind: result.kind,
        networkFailure: result.failureDigest?.networkFailure ?? false,
        ...(result.failureDigest?.isolatedRerun ? { isolatedRerun: result.failureDigest.isolatedRerun.outcome } : {}),
      })),
  };
}
