import { describe, expect, it } from 'vitest';

import type { AiMessage, RuntimeEvent, RuntimeResourceRef } from '../../../contracts';
import {
  agentEventToRuntime,
  applyRuntimeEventToMemory,
  type ConversationMemoryPort,
} from '../eventMappers';
import { ObservationEventSchema } from '../agentEvents';
import { createToolOutputEvent, ToolCallIdSchema } from '../../../contracts';

class TestMemory implements ConversationMemoryPort {
  readonly messages: AiMessage[] = [];

  addUserMessage(content: string, id?: string, attachments?: RuntimeResourceRef[]): void {
    this.messages.push({
      id: id ?? 'user',
      role: 'user',
      type: 'user_input',
      content,
      timestamp: 1,
      ...(attachments ? { attachments } : {}),
    });
  }

  addAssistantMessage(
    content: string | null,
    type: AiMessage['type'] & ('thought' | 'final_answer' | 'tool_calls'),
    metadata?: AiMessage['metadata'],
    id?: string
  ): void {
    this.messages.push({
      id: id ?? 'assistant',
      role: 'assistant',
      type,
      content: content ?? '',
      timestamp: 1,
      metadata,
    });
  }

  addToolResponse(
    toolCallId: string,
    content: string,
    toolName?: string,
    id?: string,
    attachments?: RuntimeResourceRef[]
  ): void {
    this.messages.push({
      id: id ?? 'tool',
      role: 'tool',
      type: 'tool_output',
      content,
      timestamp: 1,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        tool_name: toolName,
      },
      ...(attachments ? { attachments } : {}),
    });
  }

  appendMessage(message: AiMessage): void {
    this.messages.push(message);
  }
}

describe('eventMappers.applyRuntimeEventToMemory', () => {
  it('observation 允许保留正文首尾空白，但拒绝全空白结果', () => {
    const event = {
      type: 'observation' as const,
      id: 'observation-whitespace',
      timestamp: 1,
      tool_name: 'read_file',
      tool_call_id: 'call-whitespace',
      observation: '\n文件正文\n',
      success: true,
      data: { path: '/功能测试.slides' },
    };

    expect(ObservationEventSchema.parse(event).observation).toBe('\n文件正文\n');
    expect(() => ObservationEventSchema.parse({ ...event, observation: '\n\t' })).toThrow(
      'value must not be blank',
    );
  });

  it('重建 terminal final_answer 时保留封口原因，避免内存消息丢失 segment 语义', () => {
    const memory = new TestMemory();
    const event: RuntimeEvent = {
      type: 'final_answer',
      id: 'answer-preamble',
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      timestamp: 1,
      version: 1,
      answer_id: 'answer-preamble',
      content: '我先读取资料。',
      is_complete: true,
      completion_reason: 'terminal',
    };

    applyRuntimeEventToMemory(event, memory);

    expect(memory.messages[0]).toMatchObject({
      type: 'final_answer',
      metadata: { completion_reason: 'terminal' },
    });
  });

  it('tool_call 封口正文与决策合并为一个有序 assistant turn', () => {
    const memory = new TestMemory();
    const assistantReplayParts = [
      { type: 'text' as const, text: '我先读取资料。' },
      { type: 'tool_call' as const, tool_call_id: 'call_1' },
    ];
    const events: RuntimeEvent[] = [
      {
        type: 'final_answer',
        id: 'answer-preamble',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        timestamp: 1,
        version: 1,
        answer_id: 'answer-preamble',
        content: '我先读取资料。',
        is_complete: true,
        completion_reason: 'tool_call',
        assistant_replay_parts: assistantReplayParts,
      },
      {
        type: 'tool_call_decision',
        id: 'tool-decision-1',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        timestamp: 2,
        version: 1,
        tool_name: 'workspace_read',
        tool_call_id: ToolCallIdSchema.parse('call_1'),
        phase: 'start',
        status: 'loading',
        payload: {
          assistant_replay_parts: assistantReplayParts,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'workspace_read', arguments: '{}' } },
          ],
        },
      },
    ];

    for (const event of events) applyRuntimeEventToMemory(event, memory);

    expect(memory.messages).toHaveLength(1);
    expect(memory.messages[0]).toMatchObject({
      role: 'assistant',
      type: 'tool_calls',
      content: '我先读取资料。',
      metadata: { assistant_replay_parts: assistantReplayParts },
    });
  });

  it('重建 user_input 与 tool_output 时保持附件身份和顺序', () => {
    const memory = new TestMemory();
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
    const events: RuntimeEvent[] = [
      {
        type: 'user_input',
        id: 'user-1',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        timestamp: 1,
        version: 1,
        source: 'user',
        content: '',
        attachments,
      },
      createToolOutputEvent(
        'tool-1',
        'conv-1',
        'turn-1',
        'render',
        'call-1',
        { status: 'success', observation: 'rendered', data: {} },
        { timestamp: 2, attachments }
      ),
    ];

    for (const event of events) applyRuntimeEventToMemory(event, memory);

    expect(
      memory.messages.map(message =>
        'attachments' in message ? message.attachments?.map(attachment => attachment.id) : undefined
      )
    ).toEqual([
      ['attachment-1', 'attachment-2'],
      ['attachment-1', 'attachment-2'],
    ]);
  });

  it('重建 tool_call_decision 时应保留 payload.provider_continuations', () => {
    const memory = new TestMemory();
    const providerContinuations = [{
      schema_version: 2 as const,
      producer: {
        model_id: 'deepseek-reasoner',
        endpoint_id: 'deepseek',
        api_surface: 'openai_chat_completions',
        capability_id: 'test:chat-codec',
        endpoint_model_id: 'deepseek-reasoner',
      },
      kind: 'reasoning_content',
      payload: { provider: 'deepseek', type: 'reasoning_content', reasoning_content: 'Need the tool.' },
    }];
    const event: RuntimeEvent = {
      type: 'tool_call_decision',
      id: 'tool_decision_1',
      conversation_id: 'conv_1',
      turn_id: 'turn_1',
      timestamp: 1,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse('call_1'),
      phase: 'start',
      status: 'loading',
      payload: {
        provider_continuations: providerContinuations,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'workspace_read', arguments: '{}' } },
        ],
      },
    };

    applyRuntimeEventToMemory(event, memory);

    expect(memory.messages).toHaveLength(1);
    expect(memory.messages[0].metadata?.provider_continuations).toEqual(providerContinuations);
  });
});

describe('eventMappers.agentEventToRuntime', () => {
  it('error 应保留稳定 code、retryable 与安全 details', () => {
    const event = agentEventToRuntime(
      {
        type: 'error',
        id: 'error-1',
        timestamp: 1,
        error: '当前模型不支持图片输入',
        error_code: 'llm.image_input.model_unsupported',
        retryable: false,
        details: {
          reason: '结构化错误: llm.image_input.model_unsupported',
          metadata: {
            compatible_model_ids: ['vision-model'],
          },
        },
      },
      {
        conversationId: 'conv-1',
        turnId: 'turn-1',
        metadata: { activity: { kind: 'model_error' } },
      }
    );

    expect(event).toMatchObject({
      type: 'error',
      error_code: 'llm.image_input.model_unsupported',
      retryable: false,
      details: {
        metadata: {
          compatible_model_ids: ['vision-model'],
        },
      },
      metadata: { activity: { kind: 'model_error' } },
    });
    expect(event).not.toHaveProperty('run_id');
    expect(event).not.toHaveProperty('lane');
    expect(event).not.toHaveProperty('visibility');
  });

  it('final_answer 只保留非路由 metadata，mapper 不拥有 run admission', () => {
    const event = agentEventToRuntime(
      {
        type: 'final_answer',
        id: 'answer-1',
        timestamp: 1,
        answer_id: 'answer-1',
        answer: '完成',
        completion_reason: 'terminal',
      },
      {
        conversationId: 'conv-1',
        turnId: 'turn-1',
        metadata: {
          runtime_trace: { traceId: 'trace-1' },
        },
      }
    );

    expect(event).toMatchObject({
      type: 'final_answer',
      answer_id: 'answer-1',
      metadata: {
        runtime_trace: { traceId: 'trace-1' },
      },
    });
    expect(event).not.toHaveProperty('run_id');
    expect(event).not.toHaveProperty('lane');
    expect(event).not.toHaveProperty('visibility');
  });

  it('拒绝缺少答案身份的外部事件，不在映射层猜测或补造', () => {
    const malformedFinalAnswer: Record<string, unknown> = {
      type: 'final_answer',
      id: 'answer-without-identity',
      timestamp: 1,
      answer: '完成',
    };

    expect(() =>
      agentEventToRuntime(malformedFinalAnswer, { conversationId: 'conv-1', turnId: 'turn-1' })
    ).toThrow(/answer_id/);
  });

  it.each([
    {
      type: 'tool_call_decision',
      tool_name: 'workspace_read',
      tool_args: {},
      status: 'loading',
    },
    {
      type: 'tool_process',
      tool_name: 'workspace_read',
      tool_args: {},
      status: 'loading',
    },
    {
      type: 'observation',
      tool_name: 'workspace_read',
      output: 'done',
      success: true,
    },
  ])('拒绝缺少 tool_call_id 的 $type，不在 admission 补造身份', malformedEvent => {
    expect(() =>
      agentEventToRuntime(
        {
          ...malformedEvent,
          id: 'event-without-tool-identity',
          timestamp: 1,
        },
        { conversationId: 'conv-1', turnId: 'turn-1' }
      )
    ).toThrow(/tool_call_id/);
  });
});
