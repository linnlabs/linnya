import type { MessageProcessingState } from '../base';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { DebugFn } from './types';

/**
 * 工具组保留原语。
 *
 * 中文备注：
 * - P1、P3 都要保证 tool_call 与 tool_output 成对保留；
 * - 这里集中处理“预算内直接装入 / 保护窗口内超预算仍原样装入”的协议细节。
 */
export function keepToolGroup(params: {
  group: ToolInteractionGroup<MessageProcessingState>;
  processedIds: Set<string>;
  currentTokens: number;
  budgetLimit: number;
  matcher: ToolPairMatcher;
  debug: DebugFn;
  directStrategy: string;
  directLog: string;
  overBudgetLog: string;
  stopWhenOverBudget: boolean;
  forceKeepWhenOverBudget?: boolean;
}): {
  tokensUsed: number;
  processedCount: number;
  strategiesApplied: string[];
  kept: boolean;
  stop: boolean;
} {
  const {
    group,
    processedIds,
    currentTokens,
    budgetLimit,
    matcher,
    debug,
  } = params;
  let tokensUsed = 0;
  let processedCount = 0;
  const strategiesApplied: string[] = [];

  const fit = matcher.canFitToolPair(group, currentTokens, budgetLimit);
  if (fit.canFit) {
    const marked = markToolGroup(group, processedIds);
    tokensUsed += marked.tokensUsed;
    processedCount += marked.processedCount;
    strategiesApplied.push(params.directStrategy);
    debug(params.directLog, {
      anchorId: group.anchorId,
      pairSize: fit.pair.length,
      tokens: fit.totalTokens,
    });
    return { tokensUsed, processedCount, strategiesApplied, kept: true, stop: false };
  }

  if (params.forceKeepWhenOverBudget) {
    const marked = markToolGroup(group, processedIds);
    strategiesApplied.push(`${params.directStrategy}_forced`);
    debug(params.overBudgetLog, {
      anchorId: group.anchorId,
      pairSize: group.messages.length,
      pairTokens: fit.totalTokens,
      budgetLimit,
    });
    return {
      tokensUsed: marked.tokensUsed,
      processedCount: marked.processedCount,
      strategiesApplied,
      kept: true,
      stop: params.stopWhenOverBudget,
    };
  }

  if (params.stopWhenOverBudget) {
    debug('💰 工具组无法装入预算，停止继续保留更旧工具组（保持结构一致）', {
      pairTokens: fit.totalTokens,
      budgetLimit,
    });
  }
  return {
    tokensUsed,
    processedCount,
    strategiesApplied,
    kept: false,
    stop: params.stopWhenOverBudget,
  };
}

export function markWorkingMemory(state: MessageProcessingState): void {
  state.action = 'keep_working_memory';
  state.phase = 'WORKING_MEMORY';
}

function markToolGroup(
  group: ToolInteractionGroup<MessageProcessingState>,
  processedIds: Set<string>,
): {
  tokensUsed: number;
  processedCount: number;
} {
  let tokensUsed = 0;
  let processedCount = 0;

  for (const state of group.messages) {
    if (state.action === 'skip') {
      markWorkingMemory(state);
      tokensUsed += state.tokens;
      processedCount++;
    }
    processedIds.add(state.message.id);
  }

  return { tokensUsed, processedCount };
}
