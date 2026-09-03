import type { MessageProcessingState } from '../base';
import {
  buildToolInteractionGroupsFromStates,
} from '../../../../../shared/toolInteractionGroup';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { ReplacementSourceTagger } from './ReplacementSourceTagger';
import { keepToolGroup } from './ToolGroupKeeper';
import type { DebugFn, WorkingMemoryRetentionResult } from './types';

/**
 * POST_TOOL_CALL 阶段的特殊保留策略。
 *
 * 中文备注：
 * - 工具刚执行完的下一 tick，最近工具组是模型续写最依赖的短期事实；
 * - 该策略先于常规 P1/P2/P3 执行，并通过 processedIds 防止后续重复计数。
 */
export function promoteMostRecentToolPair(params: {
  allStates: MessageProcessingState[];
  processedIds: Set<string>;
  currentTokens: number;
  budgetLimit: number;
  matcher: ToolPairMatcher;
  tagger: ReplacementSourceTagger;
  debug: DebugFn;
}): WorkingMemoryRetentionResult {
  const {
    allStates,
    processedIds,
    currentTokens,
    budgetLimit,
    matcher,
    tagger,
    debug,
  } = params;
  let tokensUsed = 0;
  let processedCount = 0;
  const strategiesApplied: string[] = [];
  const toolGroups = buildToolInteractionGroupsFromStates(allStates);
  const group = [...toolGroups].reverse().find((candidate) => candidate.isComplete);
  if (!group || processedIds.has(group.anchorId)) {
    return { tokensUsed, processedCount, strategiesApplied };
  }

  tagger.tagReplacementSources(group.messages, allStates);

  const kept = keepToolGroup({
    group,
    processedIds,
    currentTokens,
    budgetLimit,
    matcher,
    debug,
    directStrategy: 'post_tool_call_priority',
    directLog: '✅ POST_TOOL_CALL：优先保留最近工具交互对',
    overBudgetLog: '⚠️ POST_TOOL_CALL：最近工具交互对超出预算，仍原样保留',
    stopWhenOverBudget: true,
    forceKeepWhenOverBudget: true,
  });

  tokensUsed += kept.tokensUsed;
  processedCount += kept.processedCount;
  strategiesApplied.push(...kept.strategiesApplied);
  return { tokensUsed, processedCount, strategiesApplied };
}
