import type { MessageProcessingState } from '../base';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { ReplacementSourceTagger } from './ReplacementSourceTagger';
import { buildHistoricalToolCandidates } from './HistoricalToolCandidates';
import { keepToolGroup, markWorkingMemory } from './ToolGroupKeeper';
import type { DebugFn, HistoricalToolRetentionResult } from './types';

/**
 * P3：历史工具交互保留。
 *
 * 中文备注：
 * - compressed 工具摘要仍共享 maxToolGroupsToKeep；
 * - raw 工具组只允许来自 turn 保护窗口，超窗口旧 input 维持整组 drop。
 */
export function processHistoricalToolInteractions(params: {
  allStates: MessageProcessingState[];
  toolGroups: ToolInteractionGroup<MessageProcessingState>[];
  processedIds: Set<string>;
  currentTokens: number;
  budgetLimit: number;
  maxToolGroupsToKeep: number;
  minToolGroupsToKeep: number;
  alreadyKeptToolGroups: number;
  lastUserOriginalIndex: number;
  minRawToolRunOrdinal: number | null;
  matcher: ToolPairMatcher;
  tagger: ReplacementSourceTagger;
  debug: DebugFn;
}): HistoricalToolRetentionResult {
  const {
    allStates,
    toolGroups,
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
  let toolGroupsKept = 0;
  const maxToolGroupsToKeep = Math.max(0, Math.floor(params.maxToolGroupsToKeep));
  const minToolGroupsToKeep = Math.min(
    params.alreadyKeptToolGroups + maxToolGroupsToKeep,
    Math.max(0, Math.floor(params.minToolGroupsToKeep)),
  );

  const candidates = buildHistoricalToolCandidates({
    allStates,
    toolGroups,
    lastUserOriginalIndex: params.lastUserOriginalIndex,
    minRawToolRunOrdinal: params.minRawToolRunOrdinal,
    matcher,
  });
  for (const candidate of candidates) {
    if (toolGroupsKept >= maxToolGroupsToKeep) {
      break;
    }

    const shouldForceKeepForMinimum = params.alreadyKeptToolGroups + toolGroupsKept < minToolGroupsToKeep;
    if (!shouldForceKeepForMinimum && currentTokens + tokensUsed >= budgetLimit) {
      debug('💰 达到预算限制，停止历史工具交互填充', {
        currentTokens: currentTokens + tokensUsed,
        budgetLimit,
      });
      break;
    }

    if (candidate.kind === 'compressed') {
      const state = candidate.state;
      if (processedIds.has(state.message.id) || state.action !== 'skip') {
        continue;
      }
      if (!shouldForceKeepForMinimum && currentTokens + tokensUsed + state.tokens > budgetLimit) {
        continue;
      }
      markWorkingMemory(state);
      tokensUsed += state.tokens;
      processedCount++;
      processedIds.add(state.message.id);
      toolGroupsKept++;
      strategiesApplied.push('compressed_tool_history');
      continue;
    }

    const group = candidate.group;
    if (processedIds.has(group.anchorId) || !group.isComplete) {
      continue;
    }

    tagger.tagReplacementSources(group.messages, allStates);
    const kept = keepToolGroup({
      group,
      processedIds,
      currentTokens: currentTokens + tokensUsed,
      budgetLimit,
      matcher,
      debug,
      directStrategy: 'historical_tool_interaction',
      directLog: '✅ P3保留历史工具交互',
      overBudgetLog: '⚠️ P3保护窗口内历史工具交互超出预算，仍原样保留',
      stopWhenOverBudget: false,
      forceKeepWhenOverBudget: true,
    });

    tokensUsed += kept.tokensUsed;
    processedCount += kept.processedCount;
    strategiesApplied.push(...kept.strategiesApplied);
    if (kept.kept) {
      toolGroupsKept++;
    }
  }

  return { tokensUsed, processedCount, strategiesApplied, toolGroupsKept };
}
