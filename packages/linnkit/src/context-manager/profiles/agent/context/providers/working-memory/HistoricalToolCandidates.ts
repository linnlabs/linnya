import type { MessageProcessingState } from '../base';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { HistoricalToolCandidate } from './types';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';

/**
 * 构造 P3 历史工具候选。
 *
 * 中文备注：
 * - compressed 工具历史摘要与 raw tool group 共享同一条“历史工具交互”预算；
 * - 候选按 originalIndex/startIndex 倒序返回，确保越新的历史越先被塞回上下文。
 */
export function buildHistoricalToolCandidates(params: {
  allStates: MessageProcessingState[];
  toolGroups: ToolInteractionGroup<MessageProcessingState>[];
  lastUserOriginalIndex: number;
  minRawToolRunOrdinal: number | null;
  matcher: ToolPairMatcher;
}): HistoricalToolCandidate[] {
  const { allStates, toolGroups, lastUserOriginalIndex, minRawToolRunOrdinal, matcher } = params;
  const compressedCandidates = allStates
    .filter((state) => {
      if (!matcher.isCompressedToolHistoryMessage(state.message)) {
        return false;
      }
      return typeof state.originalIndex === 'number' && state.originalIndex <= lastUserOriginalIndex;
    })
    .map((state) => ({
      kind: 'compressed' as const,
      sortIndex: state.originalIndex,
      state,
    }));

  const groupCandidates = toolGroups
    .filter((group) => (
      group.startIndex <= lastUserOriginalIndex &&
      minRawToolRunOrdinal !== null &&
      group.runOrdinal >= minRawToolRunOrdinal
    ))
    .map((group) => ({
      kind: 'group' as const,
      sortIndex: group.startIndex,
      group,
    }));

  return [...compressedCandidates, ...groupCandidates].sort((left, right) => right.sortIndex - left.sortIndex);
}
