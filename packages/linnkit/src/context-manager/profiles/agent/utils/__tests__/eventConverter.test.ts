import { describe, expect, it } from 'vitest';
import {
  convertAiMessageToEvent,
  convertEventToAiMessage,
  convertEventsToAiMessages,
} from '../eventConverter';
import {
  createAuditEnvelopeEvent,
  createErrorEvent,
  createFinalAnswerChunkEvent,
  createFinalAnswerEvent,
  createHistorySummaryEvent,
  createRequiresUserInteractionEvent,
  createRunExecutionMetricsEvent,
  createSubRunTraceEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  createUserInputEvent,
  validateRuntimeEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
  RunIdSchema,
  ToolCallIdSchema,
} from '../../../../../contracts';
import { formatAgentLlmMessages } from '../../../../shared';
import { events as runtimeEvents } from '../../../../../runtime-kernel';
import { RuntimeEvent as RuntimeEventSchema } from '../../../../../contracts';

describe('agent/utils/eventConverter.convertEventsToAiMessages', () => {
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
      mediaType: 'image/webp',
      byteLength: 2048,
      width: 800,
      height: 600,
      sha256: 'b'.repeat(64),
    },
  ];

  it('所有允许进入 agent context 的 RuntimeEvent 类型都能被 converter 处理', () => {
    const samples: RuntimeEvent[] = [
      createUserInputEvent('user', 'conv-1', 'turn-1', '问题'),
      createUserInputEvent('hidden-user', 'conv-1', 'turn-1', '隐藏输入', {
        metadata: { ui: { presentation: 'hidden' } },
      }),
      createFinalAnswerChunkEvent('chunk', 'conv-1', 'turn-1', 'answer-1', 0, 'partial'),
      createThoughtEvent('thought', 'conv-1', 'turn-1', '思考', { is_complete: true }),
      createThoughtEvent('empty-thought', 'conv-1', 'turn-1', ' ', { is_complete: true }),
      createToolCallDecisionEvent('decision', 'conv-1', 'turn-1', 'lookup', 'call-1'),
      createToolProcessEvent('process', 'conv-1', 'turn-1', 'lookup', 'call-1'),
      createToolOutputEvent('output', 'conv-1', 'turn-1', 'lookup', 'call-1', {
        status: 'success', observation: '结果', data: {},
      }),
      createSubRunTraceEvent(
        'subrun',
        'conv-1',
        'turn-1',
        'parent-call',
        'subrun-1',
        'thought_delta',
        {
          source_event_id: 'child-thought',
          delta: '处理中',
        }
      ),
      createRequiresUserInteractionEvent('wait-user', 'conv-1', 'turn-1', {
        prompt: '确认',
        interaction_id: 'interaction-1',
        run_id: RunIdSchema.parse('run-1'),
        tool_call_id: ToolCallIdSchema.parse('call-wait-1'),
        checkpoint_revision: 1,
        resume_token: 'resume-token-1',
        interaction_status: 'pending',
      }),
      createAuditEnvelopeEvent('audit', 'conv-1', 'turn-1', {
        envelopeId: 'audit-1',
        runId: RunIdSchema.parse('run-1'),
        ts: 1,
        actor: { kind: 'system' },
        action: 'run.spawn',
        scope: { runId: RunIdSchema.parse('run-1') },
      }),
      createFinalAnswerEvent('answer-1', 'conv-1', 'turn-1', '回答', {
        completion_reason: 'terminal',
      }),
      createFinalAnswerEvent('answer-2', 'conv-1', 'turn-1', '', { completion_reason: 'terminal' }),
      createHistorySummaryEvent('summary', 'conv-1', 'turn-1', '摘要', ['user'], 1, 1),
      createErrorEvent('error', 'conv-1', 'turn-1', '失败'),
      {
        type: 'control',
        id: 'control',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        timestamp: 1,
        version: 1,
        op: 'truncate_after',
      },
      createRunExecutionMetricsEvent('execution-metrics', 'conv-1', 'turn-1', {
        execution_id: 'execution-1',
        outcome: 'completed',
        duration_ms: 12,
      }),
    ];

    for (const event of samples) {
      if (runtimeEvents.shouldEnterAgentContext(event)) {
        expect(() => convertEventToAiMessage(event)).not.toThrow();
      }
    }
  });

  it('会过滤 tool_process，只保留 tool_call_decision 作为 tool_calls 锚点', () => {
    const events: RuntimeEvent[] = [
      RuntimeEventSchema.parse({
        type: 'tool_process',
        id: 'p_tool',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        tool_name: 'workspace_read',
        tool_call_id: 'call_x',
        phase: 'start',
        status: 'loading',
        payload: {
          tool_calls: [
            {
              id: 'call_x',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{}' },
            },
          ],
        },
      }),
      RuntimeEventSchema.parse({
        type: 'tool_call_decision',
        id: 'd_llm',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        tool_name: 'workspace_read',
        tool_call_id: 'call_x',
        phase: 'start',
        status: 'loading',
        payload: {
          tool_calls: [
            {
              id: 'call_x',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{}' },
            },
          ],
        },
        meta: {},
      }),
      RuntimeEventSchema.parse({
        type: 'tool_output',
        id: 'o1',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        tool_name: 'workspace_read',
        tool_call_id: 'call_x',
        status: 'success',
        observation: 'read complete',
        data: { ok: true },
      }),
    ];

    const messages = convertEventsToAiMessages(events);
    // 应仅保留一个 tool_calls（来自 LLM 的 tool_call_decision）+ tool_output
    const toolCalls = messages.filter(m => m.type === 'tool_calls');
    const toolOutputs = messages.filter(m => m.type === 'tool_output');

    expect(toolCalls).toHaveLength(1);
    expect(toolOutputs).toHaveLength(1);
    expect(toolCalls[0].id).toBe('d_llm');
  });

  it('会过滤全部 thought 与空 final_answer，避免形成重复或空白 assistant 消息', () => {
    const events: RuntimeEvent[] = [
      RuntimeEventSchema.parse({
        type: 'user_input',
        id: 'u1',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        content: '问题',
        source: 'user',
      }),
      RuntimeEventSchema.parse({
        type: 'thought',
        id: 'th_empty',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        content: '   ',
        is_complete: true,
      }),
      RuntimeEventSchema.parse({
        type: 'final_answer',
        id: 'fa_empty',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        answer_id: 'fa_empty',
        content: '',
        is_complete: false,
        completion_reason: 'interrupted',
      }),
      RuntimeEventSchema.parse({
        type: 'final_answer',
        id: 'fa_ok',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: Date.now(),
        version: 1,
        answer_id: 'fa_ok',
        content: '有效回答',
        is_complete: true,
        completion_reason: 'terminal',
      }),
    ];

    const messages = convertEventsToAiMessages(events);

    expect(messages.map(m => m.id)).toEqual(['u1', 'fa_ok']);
    expect(messages.map(m => m.content)).toEqual(['问题', '有效回答']);
  });

  it('会过滤 error 事件，避免错误历史变成空 assistant 消息', () => {
    const events: RuntimeEvent[] = [
      {
        type: 'user_input',
        id: 'u1',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 1,
        version: 1,
        content: '问题',
        source: 'user',
      },
      {
        type: 'error',
        id: 'err_1',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 2,
        version: 1,
        error: 'provider failed',
        error_code: 'llm.provider_down',
        retryable: true,
      },
      {
        type: 'final_answer',
        id: 'fa_ok',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 3,
        version: 1,
        answer_id: 'ans_ok',
        content: '有效回答',
        is_complete: true,
        completion_reason: 'terminal',
      },
    ];

    const messages = convertEventsToAiMessages(events);

    expect(messages.map(message => message.id)).toEqual(['u1', 'fa_ok']);
    expect(messages.some(message => message.content === '')).toBe(false);
  });

  it('交互工具提交后应保留合法的 tool_calls + tool_output 结构', () => {
    const events: RuntimeEvent[] = [
      RuntimeEventSchema.parse({
        type: 'tool_call_decision',
        id: 'd1',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 1,
        version: 1,
        tool_name: 'ppt_plan',
        tool_call_id: 'call_ppt_plan_1',
        phase: 'start',
        status: 'loading',
        payload: {
          tool_calls: [
            {
              id: 'call_ppt_plan_1',
              type: 'function',
              function: { name: 'ppt_plan', arguments: '{}' },
            },
          ],
        },
      }),
      RuntimeEventSchema.parse({
        type: 'tool_output',
        id: 'o_interaction',
        conversation_id: 'c1',
        turn_id: 't2',
        timestamp: 2,
        version: 1,
        tool_name: 'ppt_plan',
        tool_call_id: 'call_ppt_plan_1',
        status: 'success',
        observation: '{"action":"approve"}',
        data: { action: 'approve' },
        metadata: {
          interaction: {
            status: 'approved',
            response: { action: 'approve' },
          },
        },
      }),
    ];

    const messages = convertEventsToAiMessages(events);
    expect(messages.map(message => [message.id, message.role, message.type])).toEqual([
      ['d1', 'assistant', 'tool_calls'],
      ['o_interaction', 'tool', 'tool_output'],
    ]);
    expect(messages[1]?.content).toBe('{"action":"approve"}');
  });

  it('tool_output 回放时应保留执行期 observation 截断计量', () => {
    const event: RuntimeEvent = {
      type: 'tool_output',
      id: 'o_truncated',
      conversation_id: 'c1',
      turn_id: 't1',
      timestamp: 1,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse('call_1'),
      status: 'success',
      observation: 'preview',
      data: {},
      metadata: {
        observationTruncation: {
          blobId: 'blob_1',
          originalChars: 100,
          previewChars: 20,
          originalLines: 10,
          previewLines: 2,
        },
      },
    };

    const messages = convertEventsToAiMessages([event]);

    expect(messages[0]?.metadata?.observationTruncation).toEqual({
      blobId: 'blob_1',
      originalChars: 100,
      previewChars: 20,
      originalLines: 10,
      previewLines: 2,
    });
  });

  it('工具调用回放出关时应保留 provider replay sidecar', () => {
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
    const events: RuntimeEvent[] = [
      RuntimeEventSchema.parse({
        type: 'tool_call_decision',
        id: 'd_sidecar',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 1,
        version: 1,
        tool_name: 'workspace_read',
        tool_call_id: 'call_sidecar_1',
        phase: 'start',
        status: 'loading',
        payload: {
          provider_continuations: providerContinuations,
          assistant_replay_parts: [
            { type: 'text', text: '我先读文档。' },
            {
              type: 'tool_call',
              tool_call_id: 'call_sidecar_1',
              provider_continuations: providerContinuations,
            },
          ],
          tool_calls: [
            {
              id: 'call_sidecar_1',
              type: 'function',
              function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
            },
          ],
        },
      }),
    ];

    const aiMessages = convertEventsToAiMessages(events);
    const llmMessages = formatAgentLlmMessages(aiMessages);
    const assistant = llmMessages.find(message => message.role === 'assistant');

    expect(assistant).toBeDefined();
    if (!assistant || assistant.role !== 'assistant' || !('tool_calls' in assistant)) {
      throw new Error('expected assistant tool_calls message');
    }
    expect(assistant.provider_continuations).toEqual(providerContinuations);
    expect(assistant.content).toBe('我先读文档。');
    expect(assistant.assistant_replay_parts).toEqual([
      { type: 'text', text: '我先读文档。' },
      {
        type: 'tool_call',
        tool_call_id: 'call_sidecar_1',
        provider_continuations: providerContinuations,
      },
    ]);
    expect(assistant.tool_calls[0]).toEqual({
      id: 'call_sidecar_1',
      type: 'function',
      function: { name: 'workspace_read', arguments: '{"path":"README.md"}' },
    });
  });

  it('最终回答回放出关时应保留 provider replay sidecar', () => {
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
      payload: { provider: 'deepseek', type: 'reasoning_content', reasoning_content: 'Answer after tool.' },
    }];
    const events: RuntimeEvent[] = [
      RuntimeEventSchema.parse({
        type: 'final_answer',
        id: 'fa_sidecar',
        conversation_id: 'c1',
        turn_id: 't1',
        timestamp: 1,
        version: 1,
        answer_id: 'fa_sidecar',
        content: '最终回答。',
        is_complete: true,
        completion_reason: 'terminal',
        provider_continuations: providerContinuations,
        assistant_replay_parts: [{
          type: 'text',
          text: '最终回答。',
          provider_continuations: providerContinuations,
        }],
      }),
    ];

    const aiMessages = convertEventsToAiMessages(events);
    expect(aiMessages[0].metadata?.provider_continuations).toEqual(providerContinuations);

    const llmMessages = formatAgentLlmMessages(aiMessages);
    const assistant = llmMessages.find(message => message.role === 'assistant');

    expect(assistant).toBeDefined();
    if (!assistant || assistant.role !== 'assistant') {
      throw new Error('expected assistant final answer message');
    }
    expect(assistant.content).toBe('最终回答。');
    expect(assistant.provider_continuations).toEqual(providerContinuations);
    expect(assistant.assistant_replay_parts).toEqual([{
      type: 'text',
      text: '最终回答。',
      provider_continuations: providerContinuations,
    }]);
  });

  it('工具调用封口正文只通过 tool_call_decision 进入一次 Context', () => {
    const replayParts = [
      { type: 'reasoning' as const, text: '需要先读取文件。' },
      { type: 'text' as const, text: '我先读取。' },
      { type: 'tool_call' as const, tool_call_id: 'call_once' },
    ];
    const events: RuntimeEvent[] = [
      createThoughtEvent('thought_once', 'c1', 't1', '需要先读取文件。', {
        is_complete: true,
      }),
      createFinalAnswerEvent('answer_once', 'c1', 't1', '我先读取。', {
        completion_reason: 'tool_call',
        assistant_replay_parts: replayParts,
      }),
      createToolCallDecisionEvent('decision_once', 'c1', 't1', 'workspace_read', 'call_once', {
        payload: {
          assistant_replay_parts: replayParts,
          tool_calls: [{
            id: 'call_once',
            type: 'function',
            function: { name: 'workspace_read', arguments: '{}' },
          }],
        },
      }),
    ];

    const messages = convertEventsToAiMessages(events);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      type: 'tool_calls',
      content: '我先读取。',
      metadata: { assistant_replay_parts: replayParts },
    });
  });

  it('user/tool 附件经过 event、AiMessage 与 LLM wire 往返时保持身份和顺序', () => {
    const events: RuntimeEvent[] = [
      createUserInputEvent('user-with-images', 'conv-1', 'turn-1', '', { attachments }),
      createToolOutputEvent(
        'tool-with-images',
        'conv-1',
        'turn-1',
        'render',
        'call-1',
        { status: 'success', observation: 'rendered', data: { path: 'rendered.png' } },
        { attachments }
      ),
    ];

    const messages = convertEventsToAiMessages(events);
    expect(messages.map(message => message.role)).toEqual(['user', 'tool']);
    expect(
      messages.map(message =>
        'attachments' in message ? message.attachments?.map(attachment => attachment.id) : undefined
      )
    ).toEqual([
      ['attachment-1', 'attachment-2'],
      ['attachment-1', 'attachment-2'],
    ]);

    expect(formatAgentLlmMessages(messages)).toEqual([
      { role: 'user', content: '', attachments },
      { role: 'tool', tool_call_id: 'call-1', content: 'rendered', attachments },
    ]);

    const replayedEvents = messages.map(message =>
      convertAiMessageToEvent(message, {
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
      })
    );
    expect(replayedEvents.every(event => validateRuntimeEvent(event).success)).toBe(true);
    expect(
      replayedEvents.map(event =>
        'attachments' in event
          ? event.attachments?.map(attachment => attachment.resourceId)
          : undefined
      )
    ).toEqual([
      ['resource-1', 'resource-2'],
      ['resource-1', 'resource-2'],
    ]);
  });
});
