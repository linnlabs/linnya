import { describe, expect, it } from 'vitest';

import type { AiMessage, ProviderContinuation } from '../../../../../contracts';
import { ToolCallIdSchema } from '../../../../../contracts';
import { ToolReplayProtocolGuardPreprocessor } from '../toolReplayProtocolGuard';

const requiredPolicy = {
  provider: 'deepseek',
  requiresProviderContinuationForToolReplay: true,
};

const continuation: ProviderContinuation = {
  schema_version: 2,
  producer: {
    model_id: 'deepseek-reasoner',
    endpoint_id: 'deepseek',
    api_surface: 'openai_chat_completions',
    capability_id: 'test:chat-codec',
    endpoint_model_id: 'deepseek-reasoner',
  },
  kind: 'reasoning_content',
  payload: { type: 'reasoning_content', reasoning_content: 'Need README.' },
};

function userMessage(id: string, timestamp: number): AiMessage {
  return { id, role: 'user', type: 'user_input', content: id, timestamp };
}

function toolCallsMessage(opts: {
  id: string;
  timestamp: number;
  providerContinuations?: ProviderContinuation[];
}): AiMessage {
  return {
    id: opts.id,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: opts.timestamp,
    metadata: {
      ...(opts.providerContinuations
        ? {
            provider_continuations: opts.providerContinuations,
            assistant_replay_parts: [{
              type: 'tool_call' as const,
              tool_call_id: `${opts.id}_call`,
              provider_continuations: opts.providerContinuations,
            }],
          }
        : {}),
      tool_calls: [{
        id: ToolCallIdSchema.parse(`${opts.id}_call`),
        type: 'function',
        function: {
          name: 'workspace_read',
          arguments: JSON.stringify({ path: 'README.md' }),
        },
      }],
    },
  };
}

function toolOutputMessage(toolCallSourceId: string, timestamp: number): AiMessage {
  return {
    id: `${toolCallSourceId}_output`,
    role: 'tool',
    type: 'tool_output',
    content: '{"observation":"README 内容"}',
    timestamp,
    metadata: {
      tool_call_id: ToolCallIdSchema.parse(`${toolCallSourceId}_call`),
      tool_name: 'workspace_read',
      data: { content: 'README 内容' },
    },
  };
}

describe('ToolReplayProtocolGuardPreprocessor', () => {
  it('required route 拒绝缺少 provider continuation 的完整工具组', async () => {
    const preprocessor = new ToolReplayProtocolGuardPreprocessor({ policy: requiredPolicy });
    const processing = preprocessor.process([
      userMessage('user_old', 1000),
      toolCallsMessage({ id: 'assistant_missing_continuation', timestamp: 1100 }),
      toolOutputMessage('assistant_missing_continuation', 1200),
      userMessage('user_followup', 2000),
    ], { debugMode: false });

    await expect(processing).rejects.toThrow(
      /要求工具回放携带有序 provider continuation.*assistant_missing_continuation_call/,
    );
  });

  it('required route 保留带完整 producer identity 的工具组', async () => {
    const messages = [
      userMessage('user_old', 1000),
      toolCallsMessage({
        id: 'assistant_with_continuation',
        timestamp: 1100,
        providerContinuations: [continuation],
      }),
      toolOutputMessage('assistant_with_continuation', 1200),
      userMessage('user_followup', 2000),
    ];
    const preprocessor = new ToolReplayProtocolGuardPreprocessor({ policy: requiredPolicy });

    const result = await preprocessor.process(messages, { debugMode: false });

    expect(result.messages).toEqual(messages);
    expect(result.appliedStrategies).toEqual([]);
  });

  it('当前轮次也拒绝缺失 continuation，避免掩盖生产链路缺陷', async () => {
    const preprocessor = new ToolReplayProtocolGuardPreprocessor({ policy: requiredPolicy });
    const processing = preprocessor.process([
      userMessage('user_current', 1000),
      toolCallsMessage({ id: 'assistant_current_missing', timestamp: 1100 }),
      toolOutputMessage('assistant_current_missing', 1200),
    ], { debugMode: false });

    await expect(processing).rejects.toThrow(/assistant_current_missing_call/);
  });

  it('optional route 不执行 continuation 守卫', () => {
    const preprocessor = new ToolReplayProtocolGuardPreprocessor();
    expect(preprocessor.shouldSkip([
      toolCallsMessage({ id: 'assistant_optional', timestamp: 1000 }),
    ], { debugMode: false })).toBe(true);
  });
});
