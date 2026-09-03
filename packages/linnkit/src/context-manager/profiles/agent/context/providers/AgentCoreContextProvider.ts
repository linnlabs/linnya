/**
 * @file src/agent/context/providers/AgentCoreContextProvider.ts
 * @description Agent专用核心上下文保留层Provider - 第一阶段上下文构建
 * 
 * 🎯 职责: 识别并保留必须保留的核心消息（Agent专用逻辑）
 * 📖 规则: 系统提示词、工具描述、最新用户输入、注入的上下文始终无条件保留
 * ✨ Agent特性: 支持宿主通过 MustKeepPolicy 声明必保留 fence，确保工具调用上下文的完整性
 * 🔧 工具优先: 优先保留工具调用相关的核心消息
 * 
 * 🏗️ 架构优化: 工具描述现在由 AgentContextManager 统一管理，而不是在 MessageFormatter 中特殊处理
 * 这确保了架构的一致性和调试的透明性
 */

import { BaseContextProvider, MessageProcessingState, ProviderContext, ProviderResult } from './base';
import type { AiMessage } from '../../../../../contracts';
import {
  DEFAULT_MUST_KEEP_POLICY,
  findMatchingTruncationRule,
  type MustKeepPolicy,
} from '../../../../shared/policies';

export interface AgentCoreContextProviderOptions {
  mustKeepPolicy?: MustKeepPolicy;
}

/**
 * Agent专用核心上下文保留层Provider
 * 
 * 实现Agent README中描述的第一阶段：核心上下文保留层 (Must-Keep)
 * 内容包括：系统提示词、用户当前请求、宿主显式声明的必保留 fence。
 */
export class AgentCoreContextProvider extends BaseContextProvider {
  readonly name = 'AgentCoreContextProvider';
  readonly description = 'Agent核心上下文保留层 - 识别并保留系统提示词、最新用户输入和注入的上下文';
  readonly priority = 1; // 最高优先级

  private readonly mustKeepPolicy: MustKeepPolicy;

  constructor(options: AgentCoreContextProviderOptions = {}) {
    super();
    this.mustKeepPolicy = options.mustKeepPolicy ?? DEFAULT_MUST_KEEP_POLICY;
  }

  async provide(
    states: MessageProcessingState[], 
    availableBudget: number, 
    context: ProviderContext
  ): Promise<ProviderResult> {
    this.debug('🚀 开始核心上下文保留层处理', {
      totalMessages: states.length,
      availableBudget,
    }, context);

    let coreTokens = 0;
    let processedCount = 0;
    const strategiesApplied: string[] = [];
    
    // 获取所有原始消息，用于判断最新用户输入
    const allMessages = states.map(s => s.message);
    const latestHistorySummaryIndex = findLatestHistorySummaryIndex(allMessages);
    const latestUserInputIndex = findLatestUserInputIndex(allMessages);
    
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      const msg = state.message;
      
      // 检查是否为核心消息
      if (this.isCoreMessage(
        msg,
        i,
        latestHistorySummaryIndex,
        latestUserInputIndex,
      )) {
        if (msg.type === 'history_summary') {
          strategiesApplied.push('history_summary');
        }
        let processedContent = msg.content;
        let contentType: MessageProcessingState['contentType'] = 'full';
        const truncationRule = findMatchingTruncationRule(msg, this.mustKeepPolicy);
        
        if (truncationRule) {
          const originalTokens = context.estimateTokens(msg);
          const maxAllowedTokens = Math.floor(context.totalBudget * truncationRule.maxBudgetFraction);
          
          if (originalTokens > maxAllowedTokens) {
            processedContent = this.truncateContent(msg.content, maxAllowedTokens, context.config.AVG_CHARS_PER_TOKEN);
            strategiesApplied.push(truncationRule.strategyName);
            
            this.debug('📄 核心注入消息被截断', {
              id: msg.id,
              originalTokens,
              maxAllowedTokens,
              truncatedTokens: context.estimateTokens({ ...msg, content: processedContent })
            }, context);
          }
        }
        
        // 标记为核心消息
        state.action = 'keep_core';
        state.overrideContent = processedContent;
        state.contentType = contentType;
        state.phase = 'CORE_CONTEXT';
        
        // 重新计算Token数量（基于可能被截断的内容）
        const tokenEstimate = context.estimateTokensWithTrace?.({ ...msg, content: processedContent });
        state.tokens = tokenEstimate?.tokens ?? context.estimateTokens({ ...msg, content: processedContent });
        if (tokenEstimate?.tokenCalibration) {
          state.tokenCalibration = tokenEstimate.tokenCalibration;
        }
        coreTokens += state.tokens;
        processedCount++;
        
        this.debug(`✅ 标记为核心消息`, {
          index: i,
          id: msg.id,
          type: msg.type,
          tokens: state.tokens,
          totalCoreTokens: coreTokens
        }, context);
      } else {
        this.debug(`⏭️ 跳过非核心消息`, { 
          index: i, 
          id: msg.id, 
          type: msg.type 
        }, context);
      }
    }
    
    this.debug('📊 核心上下文保留层处理完成', {
      coreMessages: processedCount,
      coreTokens,
      remainingBudget: availableBudget - coreTokens
    }, context);

    return this.createResult(
      states,
      coreTokens,
      strategiesApplied,
      {
        processedCount,
        skippedCount: states.length - processedCount,
        addedCount: 0
      }
    );
  }

  /**
   * 判断是否为核心消息 - Agent专用逻辑
   * 
   * 🎯 Agent核心上下文保留规则：
   * 1. 保留 system_prompt（系统级消息）
   * 2. 保留最新的 user 消息 (current_user_request)
   * 3. 保留 MustKeepPolicy 指定的 fence
   * 4. 对命中的 MustKeepPolicy.truncationRules 做 Token 截断
   */
  private isCoreMessage(
    msg: AiMessage,
    index: number,
    latestHistorySummaryIndex: number,
    latestUserInputIndex: number,
  ): boolean {
    // 最新 durable summary 是此前已压缩事实的唯一载体。即使当前工具组吃满工作记忆预算，
    // 也不能静默丢掉它；旧 summary 仍保持可替换，不会在 core 层累积。
    if (msg.type === 'history_summary') {
      return index === latestHistorySummaryIndex;
    }

    // 规则1: 系统提示词始终无条件保留
    if (this.mustKeepPolicy.alwaysKeepTypes.includes(msg.type) && msg.type !== 'user_input') {
      return true;
    }
    
    // 规则2: 保留最新的用户输入消息 (current_user_request)
    if (msg.type === 'user_input') {
      return index === latestUserInputIndex;
    }
    
    const fenceKind = msg.metadata?.fenceKind;
    if (fenceKind && this.mustKeepPolicy.alwaysKeepFenceKinds.includes(fenceKind)) {
      return true;
    }
    
    return false;
  }

  /**
   * 内容截断 - 保持完整词汇
   * 复用ContextManager中的逻辑
   */
  private truncateContent(content: string, maxTokens: number, avgCharsPerToken: number): string {
    const maxChars = maxTokens * avgCharsPerToken;
    if (content.length <= maxChars) {
      return content;
    }

    // 找到最接近的词汇边界
    const truncated = content.substring(0, maxChars);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    const result = lastSpaceIndex > maxChars * 0.8 
      ? truncated.substring(0, lastSpaceIndex)
      : truncated;
      
    return result + '...';
  }
}

function findLatestHistorySummaryIndex(messages: readonly AiMessage[]): number {
  let latestIndex = -1;
  let latestSequence = -1;
  messages.forEach((message, index) => {
    if (message.type !== 'history_summary') return;
    const sequence = message.metadata?.summarySeq ?? -1;
    if (latestIndex === -1 || sequence > latestSequence) {
      latestIndex = index;
      latestSequence = sequence;
    }
  });
  return latestIndex;
}

function findLatestUserInputIndex(messages: readonly AiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user_input') return index;
  }
  return -1;
}
