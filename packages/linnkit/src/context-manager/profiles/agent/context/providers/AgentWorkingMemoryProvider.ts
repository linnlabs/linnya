/**
 * @file src/agent/context/providers/AgentWorkingMemoryProvider.ts
 * @description Agent专用工作记忆填充层Provider - 第二阶段上下文构建
 *
 * 🎯 职责: 实现Agent的P1-P3优先级填充策略
 * 📖 策略: P1(工具交互) > P2(纯文本对话) > P3(历史工具交互)
 * ✨ Agent特性: 工具调用优先级、配对保留策略
 * 🔧 核心逻辑: 保留工具调用时，必须确保其对应的另一半也被保留
 */

import { BaseContextProvider, MessageProcessingState, ProviderContext, ProviderResult } from './base';
import {
  createAgentContextBuilderConfig,
  type AgentContextBuilderConfig,
} from '../config';
import {
  ToolPairMatcher,
  ReplacementSourceTagger,
  processHistoricalToolInteractions,
  processTextConversations,
  processToolInteractions,
  promoteMostRecentToolPair,
  resolveProtectedToolRunWindow,
} from './working-memory';
import type { DebugFn } from './working-memory';
import {
  buildToolInteractionGroupsFromStates,
  findLastUserInputOriginalIndex,
} from '../../../../shared/toolInteractionGroup';

/**
 * Agent专用工作记忆填充层Provider
 *
 * 实现Agent README中描述的第二阶段：工作记忆填充层 (Working Memory)
 * 工具调用为最高优先级，确保工具交互的完整性
 */
export class AgentWorkingMemoryProvider extends BaseContextProvider {
  readonly name = 'AgentWorkingMemoryProvider';
  readonly description = 'Agent工作记忆填充层 - 工具优先的反向填充策略，支持配对保留';
  readonly priority = 2; // 仅次于核心上下文

  private readonly matcher: ToolPairMatcher;
  private readonly tagger: ReplacementSourceTagger;
  private readonly config: AgentContextBuilderConfig;

  constructor(customConfig?: Partial<AgentContextBuilderConfig>) {
    super();
    this.config = createAgentContextBuilderConfig(customConfig ?? {});
    this.matcher = new ToolPairMatcher();
    this.tagger = new ReplacementSourceTagger();
  }

  /**
   * 类型守卫：用于安全读取 ProviderContext 上的"扩展字段"
   * 注意：ProviderContext 本身是稳定契约，扩展字段来自编排层（不应污染接口定义）。
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * 读取当前上下文阶段（如果编排层提供了 currentPhase）
   * - 禁止 any 类型断言：这里用 Record 逐层收窄。
   */
  private readCurrentPhase(context: ProviderContext): string | undefined {
    const ctx = context as unknown;
    if (!this.isRecord(ctx)) return undefined;
    const currentPhase = ctx['currentPhase'];
    if (!this.isRecord(currentPhase)) return undefined;
    const phase = currentPhase['phase'];
    return typeof phase === 'string' ? phase : undefined;
  }

  /**
   * 创建调试函数
   */
  private createDebugFn(context: ProviderContext): DebugFn {
    return (message: string, data?: Record<string, unknown>) => {
      this.debug(message, data, context);
    };
  }

  async provide(
    states: MessageProcessingState[],
    availableBudget: number,
    context: ProviderContext
  ): Promise<ProviderResult> {
    // 使用统一配置
    const config = this.config;

    this.debug('🧠 开始Agent工作记忆填充层处理', {
      totalMessages: states.length,
      availableBudget,
      config: {
        budgetPercentage: config.WORKING_MEMORY_BUDGET_PERCENTAGE
      }
    }, context);

    // 计算当前已使用的Token (核心上下文)
    const coreTokens = this.calculateUsedTokens(states);
    let workingMemoryTokens = coreTokens;
    let processedCount = 0;
    const strategiesApplied: string[] = [];

    // 中文备注：工作记忆比例以本次“输入总预算”为基准。availableBudget 已经被 pipeline
    // 扣过核心层 token；如果再用它乘比例，会把核心消息重复扣一次，导致上下文过早收缩。
    const workingMemoryBudget = Math.floor(context.totalBudget * config.WORKING_MEMORY_BUDGET_PERCENTAGE);

    // 🔥 阶段感知：POST_TOOL_CALL 优先保留"最近一对"工具交互（tool_calls ↔ tool_output）
    const processedIds = new Set<string>();
    const inPostToolCall = this.readCurrentPhase(context) === 'post_tool_call';
    if (inPostToolCall) {
      const pri = promoteMostRecentToolPair({
        allStates: states,
        processedIds,
        currentTokens: workingMemoryTokens,
        budgetLimit: workingMemoryBudget,
        matcher: this.matcher,
        tagger: this.tagger,
        debug: this.createDebugFn(context),
      });
      workingMemoryTokens += pri.tokensUsed;
      processedCount += pri.processedCount;
      strategiesApplied.push(...pri.strategiesApplied);
    }

    // 获取所有跳过的消息状态，用于填充
    const skippedStates = states.filter(s => s.action === 'skip');
    const toolGroups = buildToolInteractionGroupsFromStates(states, {
      maxPairingDistance: config.TOOL_PAIRING_SEARCH_RANGE,
    });

    // === Agent专用逻辑：工具优先填充策略 ===
    const maxToolGroupsTotal = config.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP;
    let historicalToolGroupsKept = 0;

    // 计算"当前轮次起点（最后一条 user_input）"的 originalIndex
    const lastUserOriginalIndex = findLastUserInputOriginalIndex(states);
    const protectedToolRunWindow = resolveProtectedToolRunWindow({
      toolGroups,
      lastUserOriginalIndex,
      maxRecentToolRunsToKeep: config.MAX_RECENT_TOOL_RUNS_TO_KEEP,
    });

    // P1 优先级：工具交互（tool_calls 和 tool 消息）- 配对保留
    this.debug('🔧 P1优先级：开始处理工具交互（turn保护窗口配对保留）', {
      remainingBudget: workingMemoryBudget - workingMemoryTokens,
      protectedToolRunWindow,
    });
    const p1Result = processToolInteractions({
      allStates: states,
      toolGroups,
      processedIds,
      currentTokens: workingMemoryTokens,
      budgetLimit: workingMemoryBudget,
      protectedToolRunWindow,
      lastUserOriginalIndex,
      matcher: this.matcher,
      tagger: this.tagger,
      debug: this.createDebugFn(context),
    });

    workingMemoryTokens += p1Result.tokensUsed;
    processedCount += p1Result.processedCount;
    strategiesApplied.push(...p1Result.strategiesApplied);
    historicalToolGroupsKept += p1Result.historicalToolGroupsKept;

    // P2 优先级：纯文本对话（user 和 assistant 纯文本消息）
    if (workingMemoryTokens < workingMemoryBudget) {
      this.debug('💬 P2优先级：开始处理纯文本对话', {
        remainingBudget: workingMemoryBudget - workingMemoryTokens
      });
      const p2Result = processTextConversations({
        skippedStates,
        processedIds,
        currentTokens: workingMemoryTokens,
        budgetLimit: workingMemoryBudget,
        config,
        matcher: this.matcher,
        debug: this.createDebugFn(context),
      });

      workingMemoryTokens += p2Result.tokensUsed;
      processedCount += p2Result.processedCount;
      strategiesApplied.push(...p2Result.strategiesApplied);
    }

    // P3 优先级：历史工具交互（compressed 摘要 + 保护窗口内未处理的 raw 组）
    if (workingMemoryTokens < workingMemoryBudget && lastUserOriginalIndex !== null) {
      this.debug('📚 P3优先级：开始处理历史工具交互', {
        remainingBudget: workingMemoryBudget - workingMemoryTokens
      });
      const remainingToolGroups = Math.max(0, maxToolGroupsTotal - historicalToolGroupsKept);
      const p3Result = processHistoricalToolInteractions({
        allStates: states,
        toolGroups,
        processedIds,
        currentTokens: workingMemoryTokens,
        budgetLimit: workingMemoryBudget,
        maxToolGroupsToKeep: remainingToolGroups,
        minToolGroupsToKeep: config.MIN_TOOL_INTERACTIONS_TO_KEEP,
        alreadyKeptToolGroups: historicalToolGroupsKept,
        lastUserOriginalIndex,
        minRawToolRunOrdinal: protectedToolRunWindow.minRunOrdinal,
        matcher: this.matcher,
        tagger: this.tagger,
        debug: this.createDebugFn(context),
      });

      workingMemoryTokens += p3Result.tokensUsed;
      processedCount += p3Result.processedCount;
      strategiesApplied.push(...p3Result.strategiesApplied);
    }

    const finalTokensUsed = workingMemoryTokens - coreTokens;

    this.debug('📊 Agent工作记忆填充层处理完成', {
      workingMemoryMessages: processedCount,
      workingMemoryTokens: finalTokensUsed,
      totalTokensUsed: workingMemoryTokens,
      remainingBudget: availableBudget - workingMemoryTokens
    }, context);

    return this.createResult(
      states,
      finalTokensUsed,
      strategiesApplied,
      {
        processedCount,
        skippedCount: skippedStates.length - processedCount,
        addedCount: 0
      }
    );
  }

  /**
   * 计算当前已使用的Token数
   */
  private calculateUsedTokens(states: MessageProcessingState[]): number {
    return states
      .filter(s => s.action.startsWith('keep_'))
      .reduce((total, state) => total + state.tokens, 0);
  }

}
