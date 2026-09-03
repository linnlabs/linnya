import { describe, expect, it } from 'vitest';

import type { AiMessage, RuntimeResourceRef } from '../../../contracts';
import { createFenceRegistry } from '../fences';
import { createMessageFormatter, formatAgentLlmMessages } from '../MessageFormatter';
import { ToolCallIdSchema } from '../../../contracts';

const contextInjection: AiMessage = {
  id: 'ctx-1',
  role: 'user',
  type: 'context_injection',
  content: 'Memory payload',
  timestamp: 1,
  metadata: {
    fenceKind: 'memory-context',
    fenceAttrs: { source: 'memory' },
  },
};

describe('MessageFormatter fences', () => {
  it('formats context_injection messages through an injected registry', () => {
    const registry = createFenceRegistry([
      {
        kind: 'memory-context',
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'turn-only',
        formatter: (content, attrs) =>
          `<memory-context source="${String(attrs.source)}">\n${content}\n</memory-context>`,
      },
    ]);
    const formatter = createMessageFormatter({ fenceRegistry: registry });

    expect(formatter.format([contextInjection], { nativeTools: true })).toEqual([
      {
        role: 'user',
        content: '<memory-context source="memory">\nMemory payload\n</memory-context>',
      },
    ]);
  });

  it('supports registry injection through formatAgentLlmMessages', () => {
    const registry = createFenceRegistry([
      {
        kind: 'memory-context',
        llmRole: 'system',
        placement: 'after-system',
        lifetime: 'persisted',
        formatter: content => `<memory-context>\n${content}\n</memory-context>`,
      },
    ]);

    expect(formatAgentLlmMessages([contextInjection], { fenceRegistry: registry })).toEqual([
      {
        role: 'system',
        content: '<memory-context>\nMemory payload\n</memory-context>',
      },
    ]);
  });

  it('passes task request content through without host-specific task type text', () => {
    const formatter = createMessageFormatter();

    expect(
      formatter.format([
        {
          id: 'task-1',
          role: 'user',
          type: 'task_request',
          content: 'write this',
          timestamp: 1,
          metadata: { taskType: 'editor' },
        },
      ])
    ).toEqual([{ role: 'user', content: 'write this' }]);
  });

  it('does not merge adjacent text messages in the formatter', () => {
    const result = formatAgentLlmMessages([
      {
        id: 'system-1',
        role: 'system',
        type: 'system_prompt',
        content: 'System prompt',
        timestamp: 1,
      },
      {
        id: 'system-2',
        role: 'system',
        type: 'history_summary',
        content: 'Summary',
        timestamp: 2,
      },
      {
        id: 'user-1',
        role: 'user',
        type: 'user_input',
        content: 'First user turn',
        timestamp: 3,
      },
      {
        id: 'user-2',
        role: 'user',
        type: 'user_input',
        content: 'Second user turn',
        timestamp: 4,
      },
    ]);

    expect(result).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'system', content: 'Summary' },
      { role: 'user', content: 'First user turn' },
      { role: 'user', content: 'Second user turn' },
    ]);
  });

  it('never formats UI thought projections as model messages', () => {
    const formatter = createMessageFormatter();
    const messages: AiMessage[] = [
      {
        id: 'thought-1',
        role: 'assistant',
        type: 'thought',
        content: 'UI reasoning projection',
        timestamp: 1,
      },
      {
        id: 'answer-1',
        role: 'assistant',
        type: 'final_answer',
        content: 'Answer',
        timestamp: 2,
      },
    ];

    expect(formatter.format(messages)).toEqual([{ role: 'assistant', content: 'Answer' }]);
    expect(formatAgentLlmMessages(messages)).toEqual([{ role: 'assistant', content: 'Answer' }]);
  });

  it('keeps ordered user/tool resource refs in native LLM messages', () => {
    const attachments: RuntimeResourceRef[] = [
      {
        id: 'attachment-1',
        kind: 'image',
        resourceId: 'resource-1',
        mediaType: 'image/png',
        byteLength: 1024,
        width: 640,
        height: 480,
        sha256: 'a'.repeat(64),
      },
      {
        id: 'attachment-2',
        kind: 'image',
        resourceId: 'resource-2',
        mediaType: 'image/jpeg',
        byteLength: 2048,
        width: 800,
        height: 600,
        sha256: 'b'.repeat(64),
      },
    ];

    expect(
      formatAgentLlmMessages([
        {
          id: 'user-1',
          role: 'user',
          type: 'user_input',
          content: '',
          timestamp: 1,
          attachments,
        },
        {
          id: 'tool-1',
          role: 'tool',
          type: 'tool_output',
          content: 'rendered',
          timestamp: 2,
          metadata: { tool_call_id: ToolCallIdSchema.parse('call-1') },
          attachments,
        },
      ])
    ).toEqual([
      { role: 'user', content: '', attachments },
      { role: 'tool', tool_call_id: 'call-1', content: 'rendered', attachments },
    ]);
  });
});
