/**
 * @file review-options.extender.ts
 * @description Review（审阅）请求字段透传：从 ConversationNextRequest.options 提取 Review 扩展字段
 *
 * 为什么需要：
 * - ReviewRequestEnricher 会在 promptKey='review' 时强制校验 agent_id/chunk_index/total_chunks 等字段
 * - 如果 HistoryBuilder 不透传这些字段，Enricher 会直接失败，内置角色提示词也无法注入
 */

import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { PromptKeys } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type {
  HistoryBuilderOptionsExtender,
  HistoryBuilderOptionsExtenderContext,
} from '../history-builder-options-extender.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function getOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

export class ReviewOptionsExtender implements HistoryBuilderOptionsExtender {
  readonly name = 'ReviewOptionsExtender';

  isApplicable(ctx: HistoryBuilderOptionsExtenderContext): boolean {
    return ctx.resolvedPromptKey === PromptKeys.REVIEW;
  }

  extend(ctx: HistoryBuilderOptionsExtenderContext): Partial<AgentInvokeRequest> {
    const options = ctx.options;
    if (!options || !isRecord(options)) {
      return {};
    }

    return {
      review_run_id: getOptionalString(options, 'review_run_id'),
      agent_id: getOptionalString(options, 'agent_id'),
      chunk_index: getOptionalNumber(options, 'chunk_index'),
      total_chunks: getOptionalNumber(options, 'total_chunks'),
      review_background: getOptionalString(options, 'review_background'),
      review_goal: getOptionalString(options, 'review_goal'),
    };
  }
}
