import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../contracts';
import type { MessageProcessingState } from '../providers/base';
import { buildContextTokenComponents } from '../context-token-components';
import { ToolCallIdSchema } from '../../../contracts';

function message(input: {
  id: string;
  role: AiMessage['role'];
  type: AiMessage['type'];
  content?: string;
  metadata?: AiMessage['metadata'];
}): AiMessage {
  return {
    id: input.id,
    role: input.role,
    type: input.type,
    content: input.content ?? input.id,
    timestamp: 1,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function state(input: {
  message: AiMessage;
  index: number;
  action: MessageProcessingState['action'];
  tokens: number;
}): MessageProcessingState {
  return {
    message: input.message,
    originalIndex: input.index,
    action: input.action,
    tokens: input.tokens,
  };
}

describe('buildContextTokenComponents', () => {
  it('按消息语义归类 kept 与 dropped 组件', () => {
    const components = buildContextTokenComponents([
      state({
        index: 0,
        action: 'keep_core',
        tokens: 10,
        message: message({ id: 'sys', role: 'system', type: 'system_prompt' }),
      }),
      state({
        index: 1,
        action: 'keep_core',
        tokens: 12,
        message: message({
          id: 'fence',
          role: 'user',
          type: 'context_injection',
          metadata: { fenceKind: 'document-context' },
        }),
      }),
      state({
        index: 2,
        action: 'keep_working_memory',
        tokens: 8,
        message: message({ id: 'summary', role: 'system', type: 'history_summary' }),
      }),
      state({
        index: 3,
        action: 'skip',
        tokens: 9,
        message: message({ id: 'old-answer', role: 'assistant', type: 'final_answer' }),
      }),
    ]);

    expect(components).toEqual([
      expect.objectContaining({ componentId: '0:sys', kind: 'system', tokens: 10, kept: true }),
      expect.objectContaining({ componentId: '1:fence', kind: 'fence', tokens: 12, kept: true }),
      expect.objectContaining({
        componentId: '2:summary',
        kind: 'history-summary',
        tokens: 8,
        kept: true,
      }),
      expect.objectContaining({
        componentId: '3:old-answer',
        kind: 'assistant',
        tokens: 9,
        kept: false,
      }),
    ]);
  });

  it('用执行期字符截断计量反推工具原始与丢弃 token 估算', () => {
    const [component] = buildContextTokenComponents([
      state({
        index: 0,
        action: 'keep_working_memory',
        tokens: 25,
        message: message({
          id: 'tool-output',
          role: 'tool',
          type: 'tool_output',
          metadata: {
            tool_name: 'search',
            tool_call_id: ToolCallIdSchema.parse('call-1'),
            observationTruncation: {
              originalChars: 1000,
              previewChars: 250,
            },
          },
        }),
      }),
    ]);

    expect(component).toMatchObject({
      kind: 'tool',
      tokens: 25,
      source: 'local-estimate',
      confidence: 'estimate',
      truncatedAtExecution: true,
      originalTokensEstimate: 100,
      droppedTokensEstimate: 75,
    });
  });
});
