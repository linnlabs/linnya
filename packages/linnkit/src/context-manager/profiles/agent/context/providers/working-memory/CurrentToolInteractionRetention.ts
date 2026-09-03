import type { MessageProcessingState } from '../base';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { ReplacementSourceTagger } from './ReplacementSourceTagger';
import { keepToolGroup } from './ToolGroupKeeper';
import {
  isGroupInProtectedToolRunWindow,
  type ProtectedToolRunWindow,
} from './ToolRunWindow';
import type { DebugFn, ToolInteractionRetentionResult } from './types';

/**
 * P1：当前轮工具交互保留。
 *
 * 中文备注：
 * - 当前工具 turn 与最近历史工具 turn 原样保留，不受“历史工具组数量”上限影响；
 * - 超出 turn 保护窗口的 raw 工具组不在这里回填，避免旧 input 重新进入上下文。
 */
export function processToolInteractions(params: {
  allStates: MessageProcessingState[];
  toolGroups: ToolInteractionGroup<MessageProcessingState>[];
  processedIds: Set<string>;
  currentTokens: number;
  budgetLimit: number;
  protectedToolRunWindow: ProtectedToolRunWindow;
  lastUserOriginalIndex: number | null;
  matcher: ToolPairMatcher;
  tagger: ReplacementSourceTagger;
  debug: DebugFn;
}): ToolInteractionRetentionResult {
  const {
    allStates,
    toolGroups,
    processedIds,
    currentTokens,
    budgetLimit,
    protectedToolRunWindow,
    matcher,
    tagger,
    debug,
  } = params;
  let tokensUsed = 0;
  let processedCount = 0;
  const strategiesApplied: string[] = [];
  let historicalToolGroupsKept = 0;
  const lastUserOriginalIndex = params.lastUserOriginalIndex;

  for (let index = toolGroups.length - 1; index >= 0; index -= 1) {
    const group = toolGroups[index];
    if (!isGroupInProtectedToolRunWindow(group, protectedToolRunWindow)) {
      continue;
    }

    const isInCurrentTurn =
      lastUserOriginalIndex === null
        ? true
        : group.startIndex > lastUserOriginalIndex;

    if (processedIds.has(group.anchorId)) {
      continue;
    }

    if (!group.isComplete) {
      debug('⚠️ 跳过不完整工具组，避免破坏协议顺序', {
        anchorId: group.anchorId,
        toolCallIds: group.toolCallIds,
      });
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
      directStrategy: 'tool_interaction_pairing',
      directLog: '✅ P1保留工具交互对',
      overBudgetLog: '⚠️ P1保护窗口内工具交互超出预算，仍原样保留',
      stopWhenOverBudget: false,
      forceKeepWhenOverBudget: true,
    });

    tokensUsed += kept.tokensUsed;
    processedCount += kept.processedCount;
    strategiesApplied.push(...kept.strategiesApplied);

    if (kept.stop) {
      break;
    }
    if (kept.kept && !isInCurrentTurn) {
      historicalToolGroupsKept++;
    }
  }

  return { tokensUsed, processedCount, strategiesApplied, historicalToolGroupsKept };
}
