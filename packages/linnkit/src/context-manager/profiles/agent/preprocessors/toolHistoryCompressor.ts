import { generateAiMessageId } from '../../../../contracts';
import {
  BasePreprocessor,
  PreprocessorContext,
  PreprocessorResult,
} from './base';
import { createDefaultToolOutputSummarizer } from '../utils/toolOutputSummarizer';
import {
  buildToolInteractionGroupsFromMessages,
  findCurrentRunStartIndex,
  type ToolInteractionGroup,
} from '../../../shared/toolInteractionGroup';
import type { AiMessage } from '../../../../contracts';
import {
  ContextProviderError,
  TOOL_HISTORY_OVERFLOW_ERROR_CODE,
} from '../../../shared/providers/base';
import { PREPROCESSOR_PRIORITY } from '../../../shared/preprocessors/priority';

const DEFAULT_KEEP_LATEST_TOOL_PAIRS = 2;
const DEFAULT_KEEP_LATEST_RUNS = 1;
const DEFAULT_MAX_INTERACTION_GROUPS = 12;

export type ToolHistoryCompressionStrategy = 'per-pair' | 'per-run' | 'none';
export type ToolHistoryOverflowStrategy = 'keep-latest' | 'fail-fast';
export type ToolHistoryRetentionMode = 'drop' | 'compress';

export interface ToolHistoryCompressorOptions {
  strategy?: ToolHistoryCompressionStrategy;
  retentionMode?: ToolHistoryRetentionMode;
  keepLatestToolPairs?: number;
  keepLatestRuns?: number;
  maxInteractionGroups?: number;
  overflowStrategy?: ToolHistoryOverflowStrategy;
}

type NormalizedToolHistoryCompressorOptions = {
  strategy: ToolHistoryCompressionStrategy;
  retentionMode: ToolHistoryRetentionMode;
  keepLatestToolPairs: number;
  keepLatestRuns: number;
  maxInteractionGroups: number;
  overflowStrategy: ToolHistoryOverflowStrategy;
};

/**
 * 工具历史保留预处理器。
 *
 * 三种策略边界：
 * - per-pair：按全局最近 N 组完整工具交互保留，其余按 retentionMode 处理。
 * - per-run：按 user_input 划分 run，完整保留最近 K 个历史 run 内的工具组，避免腰斩同一轮工具链。
 * - none：不做常规压缩，仅在 maxInteractionGroups 显式触发时执行安全阀。
 *
 * retentionMode 边界：
 * - drop：默认行为。旧工具组超过保留窗口后直接移除，避免改写历史前缀和制造伪 final_answer。
 * - compress：兼容旧行为。把旧工具组替换为自然语言摘要，用于小上下文或审计友好的历史线索保留。
 *
 * 注意：本处理器只决定“工具组是原样保留、删除，还是压缩为摘要消息”。
 * 构建期不再二次截断 tool_call arguments 或 tool_output；output 的尺寸治理只发生在执行期 observationGovernance。
 */
export class ToolHistoryCompressorPreprocessor extends BasePreprocessor {
  readonly name = 'ToolHistoryCompressorPreprocessor';
  readonly description = '工具历史保留处理器 - 按策略保留、删除或压缩较早的历史工具调用对';
  readonly priority = PREPROCESSOR_PRIORITY.toolHistoryCompression;

  private summarizer = createDefaultToolOutputSummarizer();
  private readonly options: NormalizedToolHistoryCompressorOptions;

  constructor(options: ToolHistoryCompressorOptions = {}) {
    super();
    this.options = {
      strategy: options.strategy ?? 'per-run',
      retentionMode: options.retentionMode ?? 'drop',
      keepLatestToolPairs: normalizeNonNegativeInteger(
        options.keepLatestToolPairs,
        DEFAULT_KEEP_LATEST_TOOL_PAIRS,
      ),
      keepLatestRuns: normalizeNonNegativeInteger(
        options.keepLatestRuns,
        DEFAULT_KEEP_LATEST_RUNS,
      ),
      maxInteractionGroups: normalizeNonNegativeInteger(
        options.maxInteractionGroups,
        DEFAULT_MAX_INTERACTION_GROUPS,
      ),
      overflowStrategy: options.overflowStrategy ?? 'keep-latest',
    };
  }

  async process(
    messages: AiMessage[],
    context: PreprocessorContext,
  ): Promise<PreprocessorResult> {
    this.debug('🔧 开始工具历史保留处理', {
      原始消息数: messages.length,
    }, context);

    const currentRunStartIndex = findCurrentRunStartIndex(messages);
    const historyMessages = messages.slice(0, currentRunStartIndex);
    const currentRunMessages = messages.slice(currentRunStartIndex);

    this.debug('📊 消息分段分析', {
      历史消息数: historyMessages.length,
      当前轮次消息数: currentRunMessages.length,
      当前轮次起点索引: currentRunStartIndex,
      工具保留策略: this.options.strategy,
      历史工具保留模式: this.options.retentionMode,
    }, context);

    const processedHistory = this.processToolCallPairsInHistory(historyMessages, context);

    const finalMessages = [...processedHistory, ...currentRunMessages];
    const originalCount = messages.length;
    const processedCount = finalMessages.length;
    const removedCount = originalCount - processedCount;
    const appliedStrategies = removedCount > 0
      ? [this.options.retentionMode === 'compress' ? 'tool_history_compression' : 'tool_history_drop']
      : [];

    this.debug('✅ 工具历史保留处理完成', {
      原始消息: originalCount,
      处理后消息: processedCount,
      减少消息: removedCount,
      Token节省估计: `约${removedCount * 50}个Token`,
    }, context);

    return this.createResult(
      messages,
      finalMessages,
      appliedStrategies,
      0,
    );
  }

  shouldSkip(messages: AiMessage[], context: PreprocessorContext): boolean {
    const hasToolCalls = messages.some((msg) =>
      (msg.role === 'assistant' && msg.type === 'tool_calls') ||
      (msg.role === 'tool' && msg.type === 'tool_output'),
    );

    if (!hasToolCalls) {
      this.debug('⏭️ 无工具调用消息，跳过历史压缩', {}, context);
      return true;
    }

    return false;
  }

  private processToolCallPairsInHistory(
    historyMessages: AiMessage[],
    context: PreprocessorContext,
  ): AiMessage[] {
    if (historyMessages.length < 2) {
      return historyMessages;
    }

    const groups = buildToolInteractionGroupsFromMessages(historyMessages);
    if (groups.length === 0) {
      this.debug('🤔 在历史记录中未找到有效的工具交互组，跳过压缩', {}, context);
      return historyMessages;
    }

    const completeGroups = groups.filter((group) => group.isComplete);
    const keepGroups = this.enforceMaxInteractionGroups(
      this.selectGroupsToKeep(completeGroups),
      context,
    );
    const keepAnchorIds = new Set(keepGroups.map((group) => group.anchorId));

    const messagesToRemove = new Set<number>();
    const replacementMap = new Map<number, AiMessage>();

    for (const group of groups) {
      if (!group.isComplete || keepAnchorIds.has(group.anchorId)) {
        continue;
      }
      if (this.options.retentionMode === 'compress') {
        const compressedMessage = this.compressToolInteractionGroup(group, context);
        replacementMap.set(group.assistantIndex, compressedMessage);
      }
      for (const messageIndex of group.messageIndexes) {
        messagesToRemove.add(messageIndex);
      }
    }

    if (messagesToRemove.size === 0) {
      return historyMessages;
    }

    const finalResult: AiMessage[] = [];
    for (let i = 0; i < historyMessages.length; i++) {
      if (messagesToRemove.has(i)) {
        if (replacementMap.has(i)) {
          const replacement = replacementMap.get(i);
          if (replacement) {
            finalResult.push(replacement);
          }
        }
      } else {
        finalResult.push(historyMessages[i]);
      }
    }

    return finalResult;
  }

  private selectGroupsToKeep(
    completeGroups: Array<ToolInteractionGroup<AiMessage>>,
  ): Array<ToolInteractionGroup<AiMessage>> {
    const keepAnchorIds = new Set<string>();
    if (this.options.strategy === 'none') {
      for (const group of completeGroups) {
        keepAnchorIds.add(group.anchorId);
      }
    } else if (this.options.strategy === 'per-run') {
      const maxRunOrdinal = completeGroups.reduce(
        (maxOrdinal, group) => Math.max(maxOrdinal, group.runOrdinal),
        0,
      );
      const minRunOrdinal = Math.max(0, maxRunOrdinal - this.options.keepLatestRuns + 1);
      for (const group of completeGroups) {
        if (group.runOrdinal >= minRunOrdinal) {
          keepAnchorIds.add(group.anchorId);
        }
      }
    } else {
      if (this.options.keepLatestToolPairs > 0) {
        for (const group of completeGroups.slice(-this.options.keepLatestToolPairs)) {
          keepAnchorIds.add(group.anchorId);
        }
      }
    }

    return completeGroups.filter((group) => keepAnchorIds.has(group.anchorId));
  }

  private enforceMaxInteractionGroups(
    groupsToKeep: Array<ToolInteractionGroup<AiMessage>>,
    context: PreprocessorContext,
  ): Array<ToolInteractionGroup<AiMessage>> {
    if (groupsToKeep.length <= this.options.maxInteractionGroups) {
      return groupsToKeep;
    }

    if (this.options.overflowStrategy === 'fail-fast') {
      throw new ContextProviderError({
        code: TOOL_HISTORY_OVERFLOW_ERROR_CODE,
        fatal: true,
        providerName: this.name,
        message: `工具历史交互组数量 ${groupsToKeep.length} 超过上限 ${this.options.maxInteractionGroups}`,
      });
    }

    const selectedAnchorIds = new Set<string>();

    const sortedByLatestAction = [...groupsToKeep].sort((left, right) => right.endIndex - left.endIndex);
    for (const group of sortedByLatestAction) {
      if (selectedAnchorIds.size >= this.options.maxInteractionGroups) {
        break;
      }
      selectedAnchorIds.add(group.anchorId);
    }

    this.debug('⚠️ 工具历史交互组超过上限，按最近行动裁剪', {
      原始保留组数: groupsToKeep.length,
      裁剪后组数: selectedAnchorIds.size,
      上限: this.options.maxInteractionGroups,
    }, context);

    return groupsToKeep.filter((group) => selectedAnchorIds.has(group.anchorId));
  }

  private compressToolInteractionGroup(
    group: ToolInteractionGroup<AiMessage>,
    context: PreprocessorContext,
  ): AiMessage {
    const summaryParts: string[] = [];
    for (const item of group.items) {
      const formattedArgs = this.summarizer.formatToolArgs(item.toolArgs);
      const argsPart = formattedArgs ? `（参数：${formattedArgs}）` : '';
      const outputSummaries = item.rawOutputs.map((rawOutput) =>
        this.summarizer.getSummary(item.toolName, rawOutput, context.toolSummaryProvider),
      );
      const mergedSummary = outputSummaries.join('；');
      summaryParts.push(`我已经调用了工具「${item.toolName}」${argsPart}，并得到了结果：${mergedSummary}`);
    }

    const compressedContent = `${summaryParts.join('；')}，我需要思考下一步行动`;

    return {
      id: generateAiMessageId(),
      role: 'assistant',
      type: 'final_answer',
      content: compressedContent,
      timestamp: group.assistantMessage.timestamp,
      metadata: {
        isCompressedToolHistory: true,
        replacementSourceIds: group.sourceMessageIds,
        compressedToolCallIds: group.toolCallIds,
        compressedToolNames: group.toolNames,
        toolInteractionGroupSize: group.items.length,
      },
    };
  }
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}
