/**
 * AestheticLint 可复算指标。
 *
 * 指标只描述规则命中和相邻页相似度，不把不同维度压成一个主观总分。
 */
import type { LayoutLintReport } from '../LayoutLint.js';
import { r3 } from './elementUtils.js';
import { computeLongestRun } from './repetition.js';
import type { AestheticLintIssue, AestheticLintMetrics, SlideRepetitionPair } from './types.js';

export function computeMetrics(
  layout: LayoutLintReport,
  aesthetic: AestheticLintIssue[],
  repetitionPairs: SlideRepetitionPair[],
): AestheticLintMetrics {
  const adjacentSimilarities = repetitionPairs.map((pair) => pair.similarity);
  return {
    layoutWarnings: layout.issueCount,
    aestheticWarnings: aesthetic.filter((issue) => issue.severity === 'warning').length,
    aestheticInfos: aesthetic.filter((issue) => issue.severity === 'info').length,
    averageAdjacentSimilarity: adjacentSimilarities.length > 0
      ? r3(adjacentSimilarities.reduce((sum, similarity) => sum + similarity, 0) / adjacentSimilarities.length)
      : 0,
    maxAdjacentSimilarity: adjacentSimilarities.length > 0 ? Math.max(...adjacentSimilarities) : 0,
    repeatedAdjacentPairs: repetitionPairs.length,
    longestRepetitionRun: computeLongestRun(repetitionPairs),
  };
}
