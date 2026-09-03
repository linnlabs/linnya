import type { AiMessage } from '../../../../contracts';
import {
  BasePreprocessor,
  PreprocessorContext,
  PreprocessorResult,
  type ToolReplayProtocolPolicy,
} from './base';
import { buildToolInteractionGroupsFromMessages } from '../../../shared/toolInteractionGroup';
import { PREPROCESSOR_PRIORITY } from '../../../shared/preprocessors/priority';
import {
  ContextProviderError,
  TOOL_REPLAY_PROTOCOL_ERROR_CODE,
} from '../../../shared/providers/base';

export interface ToolReplayProtocolGuardOptions {
  policy?: ToolReplayProtocolPolicy;
  priority?: number;
}

export function resolveToolReplayProtocolPolicy(
  context: PreprocessorContext,
  explicitPolicy?: ToolReplayProtocolPolicy,
): ToolReplayProtocolPolicy {
  return explicitPolicy ?? context.toolReplayProtocolPolicy ?? {};
}

function hasOrderedToolContinuations(message: AiMessage, toolCallIds: readonly string[]): boolean {
  const parts = message.metadata?.assistant_replay_parts;
  if (!parts) return false;
  const replayedToolCallIds = new Set(
    parts
      .filter(part => part.type === 'tool_call' && Boolean(part.provider_continuations?.length))
      .map(part => part.type === 'tool_call' ? part.tool_call_id : '')
  );
  return toolCallIds.every(toolCallId => replayedToolCallIds.has(toolCallId));
}

/**
 * Agent 工具回放协议守卫。
 *
 * 要求 continuation 的路由只能回放带完整 producer identity 的结构化工具组。
 * 缺失时立即失败，避免把损坏的历史伪装成普通文本或伪造 provider 空字段。
 */
export class ToolReplayProtocolGuardPreprocessor extends BasePreprocessor {
  readonly name = 'ToolReplayProtocolGuardPreprocessor';
  readonly description = '工具回放协议守卫 - 拒绝缺少有序 provider continuation 的结构化工具历史';
  readonly priority: number;

  private readonly explicitPolicy?: ToolReplayProtocolPolicy;

  constructor(options: ToolReplayProtocolGuardOptions = {}) {
    super();
    this.priority = options.priority ?? PREPROCESSOR_PRIORITY.toolReplayProtocolGuard;
    this.explicitPolicy = options.policy;
  }

  shouldSkip(messages: AiMessage[], context: PreprocessorContext): boolean {
    if (!messages.some((message) => message.role === 'assistant' && message.type === 'tool_calls')) {
      return true;
    }
    const policy = resolveToolReplayProtocolPolicy(context, this.explicitPolicy);
    return policy.requiresProviderContinuationForToolReplay !== true;
  }

  async process(messages: AiMessage[], context: PreprocessorContext): Promise<PreprocessorResult> {
    const policy = resolveToolReplayProtocolPolicy(context, this.explicitPolicy);
    if (policy.requiresProviderContinuationForToolReplay !== true) {
      return this.createResult(messages, messages, [], 0);
    }

    const invalidGroups = buildToolInteractionGroupsFromMessages(messages).filter((group) => {
      return group.isComplete && !hasOrderedToolContinuations(
        group.assistantMessage,
        group.toolCallIds
      );
    });
    if (invalidGroups.length === 0) {
      return this.createResult(messages, messages, [], 0);
    }

    const missingToolCallIds = invalidGroups.flatMap((group) => group.toolCallIds);
    throw new ContextProviderError({
      code: TOOL_REPLAY_PROTOCOL_ERROR_CODE,
      fatal: true,
      providerName: this.name,
      message: `Provider ${policy.provider ?? 'unknown'} 要求工具回放携带有序 provider continuation；缺失 tool_call_id: ${missingToolCallIds.join(', ')}。`,
    });
  }
}
