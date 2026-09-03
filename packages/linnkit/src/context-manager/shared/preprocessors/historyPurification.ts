import {
  BasePreprocessor,
  type PreprocessorContext,
  type PreprocessorResult,
} from './base';
import { PREPROCESSOR_PRIORITY } from './priority';
import type { AiMessage } from '../../../contracts';

export interface HistoryPurificationConfig {
  logPrefix?: string;
}

export class HistoryPurificationPreprocessor extends BasePreprocessor {
  readonly name = 'HistoryPurificationPreprocessor';
  readonly description = '基于摘要ID列表的历史净化处理器';
  readonly priority = PREPROCESSOR_PRIORITY.historyPurification;

  constructor(config: HistoryPurificationConfig = {}) {
    // logPrefix 是可观察性标签，不改变 preprocessor.name，避免影响注册表 key。
    super(config.logPrefix);
  }

  async process(messages: AiMessage[], context: PreprocessorContext): Promise<PreprocessorResult> {
    this.debug('🧹 开始历史净化处理', { 原始消息数: messages.length }, context);

    const cleanedMessages = this.cleanHistoryWithSummaryReplacement(messages, context);
    const removedCount = messages.length - cleanedMessages.length;
    const appliedStrategies = removedCount > 0 ? ['summary_replacement_cleanup'] : [];

    this.debug(
      '✅ 历史净化完成',
      {
        原始消息: messages.length,
        净化后消息: cleanedMessages.length,
        移除消息: removedCount,
      },
      context,
    );

    return this.createResult(messages, cleanedMessages, appliedStrategies, 0);
  }

  shouldSkip(messages: AiMessage[], context: PreprocessorContext): boolean {
    const hasSummaryMessages = messages.some((msg) => msg.type === 'history_summary');
    if (!hasSummaryMessages) {
      this.debug('⏭️ 无摘要消息，跳过历史净化', {}, context);
      return true;
    }
    return false;
  }

  private findLatestSummary(summaryMessages: AiMessage[]): AiMessage {
    return summaryMessages.reduce((latest, current) => {
      const latestSeq = latest.metadata?.summarySeq ?? -1;
      const currentSeq = current.metadata?.summarySeq ?? -1;
      return currentSeq > latestSeq ? current : latest;
    }, summaryMessages[0]);
  }

  private cleanHistoryWithSummaryReplacement(
    messages: AiMessage[],
    context: PreprocessorContext,
  ): AiMessage[] {
    const summaryMessages = messages.filter((m) => m.type === 'history_summary');

    this.debug(
      '🧹 开始历史净化',
      {
        总消息数: messages.length,
        摘要消息数: summaryMessages.length,
      },
      context,
    );

    if (summaryMessages.length === 0) {
      this.debug('⚠️ 未发现摘要消息', {}, context);
      return messages;
    }

    const latestSummary = this.findLatestSummary(summaryMessages);

    this.debug(
      '📋 最新摘要',
      {
        id: latestSummary.id,
        summarySeq: latestSummary.metadata?.summarySeq,
        hasReplacedIds: Array.isArray(latestSummary.metadata?.replacedMessageIds),
        replacedCount: latestSummary.metadata?.replacedMessageIds?.length || 0,
      },
      context,
    );

    if (!latestSummary?.metadata?.replacedMessageIds || latestSummary.metadata.replacedMessageIds.length === 0) {
      this.debug('⏭️ 最新摘要缺少 replacedMessageIds，跳过净化', { summaryId: latestSummary?.id }, context);
      return messages;
    }

    const idsToRemove = new Set(latestSummary.metadata.replacedMessageIds);

    const summariesInInput = messages.filter((m) => m.type === 'history_summary');

    const summaryIdsInRemoveList = summariesInInput.filter((s) => idsToRemove.has(s.id || ''));
    this.debug('⚠️ 摘要ID检查', {
      摘要是否在移除列表: summaryIdsInRemoveList.length > 0,
      被误标记的摘要: summaryIdsInRemoveList.map((s) => ({ id: s.id, seq: s.metadata?.summarySeq })),
    }, context);

    this.debug(
      '🎯 执行ID列表净化',
      {
        要移除的ID数量: idsToRemove.size,
        示例ID: Array.from(idsToRemove).slice(0, 3),
      },
      context,
    );

    const removedMessages: AiMessage[] = [];
    const finalMessages = messages.filter((msg) => {
      if (msg.id === latestSummary.id) {
        return true;
      }

      if (idsToRemove.has(msg.id)) {
        removedMessages.push(msg);
        return false;
      }

      const sourceIds = msg.metadata?.replacementSourceIds;
      if (Array.isArray(sourceIds)) {
        for (const sourceId of sourceIds) {
          if (typeof sourceId === 'string' && idsToRemove.has(sourceId)) {
            removedMessages.push(msg);
            return false;
          }
        }
      }

      return true;
    });

    const removedCount = messages.length - finalMessages.length;
    const coveredRemovedIds = new Set<string>();
    for (const removedMessage of removedMessages) {
      if (typeof removedMessage.id === 'string' && idsToRemove.has(removedMessage.id)) {
        coveredRemovedIds.add(removedMessage.id);
      }
      const sourceIds = removedMessage.metadata?.replacementSourceIds;
      if (Array.isArray(sourceIds)) {
        for (const sourceId of sourceIds) {
          if (typeof sourceId === 'string' && idsToRemove.has(sourceId)) {
            coveredRemovedIds.add(sourceId);
          }
        }
      }
    }

    if (coveredRemovedIds.size !== idsToRemove.size) {
      const missingIds = Array.from(idsToRemove).filter((id) => !coveredRemovedIds.has(id));
      this.debug('🔍 移除差异详情', {
        缺失ID数量: missingIds.length,
        缺失ID示例: missingIds.slice(0, 5),
      }, context);
    }

    this.debug(
      '✅ 净化完成',
      {
        原始消息: messages.length,
        净化后消息: finalMessages.length,
        实际移除: removedCount,
        预期移除: idsToRemove.size,
        覆盖sourceIds: coveredRemovedIds.size,
      },
      context,
    );

    if (coveredRemovedIds.size !== idsToRemove.size) {
      this.debug(
        '⚠️ 移除数量不匹配',
        {
          预期: idsToRemove.size,
          实际覆盖: coveredRemovedIds.size,
          差异: idsToRemove.size - coveredRemovedIds.size,
        },
        context,
      );
    }

    return finalMessages;
  }
}
