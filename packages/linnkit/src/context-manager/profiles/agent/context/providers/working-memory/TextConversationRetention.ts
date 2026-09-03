import type { AgentContextBuilderConfig } from '../../config';
import type { MessageProcessingState } from '../base';
import type { ToolPairMatcher } from './ToolPairMatcher';
import type { DebugFn, WorkingMemoryRetentionResult } from './types';

/**
 * P2：普通文本与历史摘要保留策略。
 *
 * 中文备注：
 * - 这里不处理原始工具组，它们属于 P1/P3；
 * - 压缩工具历史摘要也不按普通 assistant 文本处理，避免绕过工具历史总量限制。
 */
export function processTextConversations(params: {
  skippedStates: MessageProcessingState[];
  processedIds: Set<string>;
  currentTokens: number;
  budgetLimit: number;
  config: AgentContextBuilderConfig;
  matcher: ToolPairMatcher;
  debug: DebugFn;
}): WorkingMemoryRetentionResult {
  const {
    skippedStates,
    processedIds,
    currentTokens,
    budgetLimit,
    config,
    matcher,
    debug,
  } = params;
  let tokensUsed = 0;
  let processedCount = 0;
  const strategiesApplied: string[] = [];

  for (let i = skippedStates.length - 1; i >= 0; i -= 1) {
    const state = skippedStates[i];

    if (currentTokens + tokensUsed >= budgetLimit) {
      debug('💰 达到预算限制，停止纯文本对话填充', {
        currentTokens: currentTokens + tokensUsed,
        budgetLimit,
      });
      break;
    }

    if (state.action !== 'skip' || processedIds.has(state.message.id)) {
      continue;
    }

    // thought 只服务 UI / 审计；模型侧 canonical reasoning 随 Assistant replay
    // 一起保留并由正式压缩统一淘汰，不作为独立工作记忆消息。
    if (state.message.type === 'thought') {
      continue;
    }

    if (state.message.role === 'system' && state.message.type === 'history_summary') {
      if (currentTokens + tokensUsed + state.tokens <= budgetLimit) {
        markWorkingMemory(state);
        tokensUsed += state.tokens;
        processedCount++;
        processedIds.add(state.message.id);
        strategiesApplied.push('history_summary');
        debug('✅ P2保留历史摘要', {
          id: state.message.id,
          tokens: state.tokens,
          totalTokens: currentTokens + tokensUsed,
        });
      }
      continue;
    }

    if (
      state.message.role === 'user' &&
      !state.message.metadata?.tool_name &&
      state.message.metadata?.fragmentType !== 'document'
    ) {
      if (currentTokens + tokensUsed + state.tokens <= budgetLimit) {
        markWorkingMemory(state);
        tokensUsed += state.tokens;
        processedCount++;
        strategiesApplied.push('text_conversation');
        debug('✅ P2保留用户文本消息', {
          id: state.message.id,
          tokens: state.tokens,
          totalTokens: currentTokens + tokensUsed,
        });
      }
      continue;
    }

    if (
      state.message.role === 'assistant' &&
      !state.message.metadata?.tool_name &&
      !state.message.metadata?.tool_calls &&
      state.message.type !== 'tool_calls'
    ) {
      if (matcher.isCompressedToolHistoryMessage(state.message)) {
        continue;
      }

      if (currentTokens + tokensUsed + state.tokens <= budgetLimit) {
        markWorkingMemory(state);
        tokensUsed += state.tokens;
        processedCount++;
        strategiesApplied.push('text_conversation');
        debug('✅ P2保留助手文本消息', {
          id: state.message.id,
          tokens: state.tokens,
          totalTokens: currentTokens + tokensUsed,
        });
      }
    }
  }

  return { tokensUsed, processedCount, strategiesApplied };
}

function markWorkingMemory(state: MessageProcessingState): void {
  state.action = 'keep_working_memory';
  state.phase = 'WORKING_MEMORY';
}
