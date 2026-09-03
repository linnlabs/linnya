import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  ConversationInteractionResponseRequest,
  ConversationNextRequest,
} from '@app/schemas';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import type { ConversationTransportOutcome } from '../definitions/conversationTransport';

type ConversationStreamRequest = ConversationNextRequest | ConversationInteractionResponseRequest;
const fixtureAgentId = ConversationSelectedAgentIdSchema.parse('assistant-service-fixture-agent');

const { streamConversationMock } = vi.hoisted(() => ({
  streamConversationMock: vi.fn<
    (
      req: ConversationStreamRequest,
      callbacks: Record<string, unknown>,
      signal?: AbortSignal,
      endpoint?: string,
    ) => Promise<ConversationTransportOutcome>
  >(async (req, callbacks) => {
    const conversationId = req.conversation_id;
    if (!conversationId) throw new Error('Expected a conversation-scoped request');
    const onTransportEnd = callbacks['onTransportEnd'];
    if (typeof onTransportEnd === 'function') {
      await onTransportEnd({
        type: 'transport_end',
        id: 'evt_transport_end',
        conversation_id: conversationId,
        turn_id: 'turn_1',
        timestamp: Date.now(),
        reason: 'complete',
      });
    }
    return {
      kind: 'ended',
      event: {
        type: 'transport_end',
        id: 'evt_transport_end',
        conversation_id: conversationId,
        turn_id: 'turn_1',
        execution_id: 'execution_1',
        timestamp: Date.now(),
        reason: 'complete',
      },
    };
  }),
}));

vi.mock('./conversationService', () => ({
  streamConversation: streamConversationMock,
}));

vi.mock('../../../shared/services/aiService/common', () => ({
  determineModelId: () => 'test-model',
}));

import {
  continueWithToolOutput,
  invokeAssistant,
} from './assistantService';
import type { ConversationEventDispatcher } from '../features/realtime-event-routing';

function createTransportEndOutcome(
  reason: 'complete' | 'error' = 'complete',
): ConversationTransportOutcome {
  return {
    kind: 'ended',
    event: {
      type: 'transport_end',
      id: `transport-end-${reason}`,
      conversation_id: 'conversation-test',
      turn_id: 'turn-test',
      execution_id: 'execution-test',
      timestamp: 1,
      reason,
    },
  };
}

function readFirstUserInputEvent(req: ConversationNextRequest | undefined) {
  const event = req?.new_events?.[0];
  if (event?.type !== 'user_input') {
    throw new Error('Expected first event to be user_input');
  }
  return event;
}

function createPendingInteraction(toolCallId: string) {
  return {
    interactionId: `interaction-${toolCallId}`,
    runId: `run-${toolCallId}`,
    toolCallId,
    checkpointRevision: 3,
    resumeToken: `resume-${toolCallId}`,
    turnId: `turn-${toolCallId}`,
  };
}

function readInteractionResponseRequest(
  req: ConversationStreamRequest | undefined,
): ConversationInteractionResponseRequest {
  if (!req || !('run_id' in req)) {
    throw new Error('Expected an interaction response request');
  }
  return req;
}

function readConversationNextRequest(
  req: ConversationStreamRequest | undefined,
): ConversationNextRequest {
  if (!req || 'run_id' in req) {
    throw new Error('Expected a conversation next request');
  }
  return req;
}

describe('continueWithToolOutput', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    streamConversationMock.mockClear();
  });

  it('把 renderer 历史隔离策略映射为 wire history_mode，且不改变持久化配置', async () => {
    await invokeAssistant(
      {
        userMessage: { text: '独立处理当前内容' },
        options: {
          conversationId: 'conv-isolated',
          historyIsolation: 'isolated',
          persist: true,
        },
      },
      {},
      new AbortController().signal,
    );

    const request = readConversationNextRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(request.options).toMatchObject({
      history_mode: 'isolated',
      persist: true,
    });
    expect(request.options?.conversationHistory).toBeUndefined();
  });

  it('会话级 Agent 只上行产品身份，不在 Renderer 转换为 promptKey', async () => {
    await invokeAssistant(
      {
        userMessage: { text: '创建一份演示文稿' },
        options: {
          conversationId: 'conv-selected-agent',
          selectedAgentId: fixtureAgentId,
        },
      },
      {},
      new AbortController().signal,
    );

    const request = readConversationNextRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(request.options?.selected_agent_id).toBe(fixtureAgentId);
    expect(request.options?.promptKey).toBeUndefined();
  });

  it('把插件扩展写入唯一 namespace 槽，运行归属由 Host ingress 负责', async () => {
    await invokeAssistant(
      {
        userMessage: { text: '处理节点' },
        userInputExtension: {
          namespace: 'fixture.run',
          data: { action: 'expand', node_id: 'node-1' },
        },
        options: {
          conversationId: 'conv-metadata',
          messageId: 'message-metadata',
          activity: { runId: 'run-1', feature: 'fixture_expand' },
        },
      },
      {},
      new AbortController().signal,
    );

    const event = readFirstUserInputEvent(streamConversationMock.mock.calls[0]?.[0]);
    expect(event.metadata).toEqual({
      extension: {
        namespace: 'fixture.run',
        data: { action: 'expand', node_id: 'node-1' },
      },
    });
  });

  it('把独立 draft snapshot 写入上行 user event，并允许图片-only 文本', async () => {
    await invokeAssistant(
      {
        userMessage: { text: '' },
        draftAttachments: [
          { draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' },
          { draftId: 'draft-2', kind: 'image', fileName: 'photo.jpg' },
        ],
        options: {
          conversationId: 'conv-image-only',
          messageId: 'message-image-only',
        },
      },
      {},
      new AbortController().signal,
    );

    const event = readFirstUserInputEvent(streamConversationMock.mock.calls[0]?.[0]);
    expect(event.id).toBe('message-image-only');
    expect(event.content).toBe('');
    expect(event.attachments).toEqual([
      { draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' },
      { draftId: 'draft-2', kind: 'image', fileName: 'photo.jpg' },
    ]);
  });

  it('把 edit/regenerate 附件选择写入独立 wire 字段', async () => {
    await invokeAssistant(
      {
        userMessage: { text: 'edited' },
        attachmentSelection: {
          mode: 'replace',
          items: [
            { source: 'existing', attachmentId: 'attachment-1' },
            { source: 'draft', draft: { draftId: 'draft-2', kind: 'image' } },
          ],
        },
        options: {
          conversationId: 'conv-edit-selection',
          messageId: 'message-edit-selection',
          truncateFromMessageId: 'message-edit-selection',
          truncateReason: 'edit',
        },
      },
      {},
      new AbortController().signal,
    );

    const event = readFirstUserInputEvent(streamConversationMock.mock.calls[0]?.[0]);
    expect(event.attachments).toBeUndefined();
    expect(event.attachment_selection).toEqual({
      mode: 'replace',
      items: [
        { source: 'existing', attachmentId: 'attachment-1' },
        { source: 'draft', draft: { draftId: 'draft-2', kind: 'image' } },
      ],
    });
  });

  it('ppt_plan 应直接上行 canonical observation 与 data', async () => {
    const payload = {
      action: 'modify',
      plan: {
        title: 'Deck Plan',
        pageCount: 2,
        pages: [
          { slideNumber: 1, title: 'Intro', elements: ['标题'] },
        ],
      },
      notes: '第 2 页改成时间线',
    };

    await continueWithToolOutput(
      'conv_1',
      'call_1',
      'ppt_plan',
      JSON.stringify(payload),
      payload,
      {
        projectId: 'project_1',
        projectMetadata: { id: 'project_1' },
      },
      {},
      new AbortController().signal,
      undefined,
      { status: 'modified', response: payload },
      createPendingInteraction('call_1'),
    );

    expect(streamConversationMock).toHaveBeenCalledTimes(1);
    const req = readInteractionResponseRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(req).toMatchObject({
      run_id: 'run-call_1',
      interaction_id: 'interaction-call_1',
      tool_call_id: 'call_1',
      tool_name: 'ppt_plan',
      checkpoint_revision: 3,
      resume_token: 'resume-call_1',
      observation: JSON.stringify(payload),
      data: payload,
      interaction_status: 'modified',
    });
    expect(streamConversationMock.mock.calls[0]?.[3]).toBe(
      '/api/v1/conversation/runs/run-call_1/interactions/interaction-call_1/respond',
    );
  });

  it('交互工具恢复提交应把交互状态交给 Host 构造 committed fact，前端不得补造事件', async () => {
    const payload = {
      action: 'approve',
    };

    const projectedEvents: Array<Record<string, unknown>> = [];
    const eventDispatcher: ConversationEventDispatcher = async (_conversationId, event) => {
      projectedEvents.push(event);
      return { success: true };
    };

    await continueWithToolOutput(
      'conv_1',
      'call_1',
      'ppt_plan',
      JSON.stringify(payload),
      payload,
      {
        projectId: 'project_1',
        projectMetadata: { id: 'project_1' },
      },
      {},
      new AbortController().signal,
      eventDispatcher,
      {
        status: 'approved',
        submittedAt: 123,
        response: payload,
      },
      createPendingInteraction('call_1'),
    );

    const req = readInteractionResponseRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(req).toMatchObject({
      interaction_status: 'approved',
      interaction_submitted_at: 123,
      interaction_response: payload,
    });
    expect(projectedEvents.map(event => event.type)).toEqual(['transport_end']);
  });

  it('恢复命令失败时不得把未被服务端接受的 tool_output 乐观写入正文', async () => {
    streamConversationMock.mockImplementationOnce(async (_request, callbacks) => {
      const onError = callbacks['onError'];
      if (typeof onError === 'function') {
        await onError({
          type: 'error',
          id: 'interaction-conflict',
          timestamp: 1,
          conversation_id: 'conv_1',
          turn_id: 'turn-call_1',
          error: 'interaction already submitted',
        });
      }
      const onTransportEnd = callbacks['onTransportEnd'];
      if (typeof onTransportEnd === 'function') {
        await onTransportEnd({
          type: 'transport_end',
          id: 'interaction-conflict-end',
          timestamp: 2,
          conversation_id: 'conv_1',
          turn_id: 'turn-call_1',
          reason: 'error',
        });
      }
      return createTransportEndOutcome('error');
    });
    const projectedTypes: string[] = [];
    const eventDispatcher: ConversationEventDispatcher = async (_conversationId, event) => {
      projectedTypes.push(event.type);
      return { success: true };
    };

    await continueWithToolOutput(
      'conv_1',
      'call_1',
      'ask',
      '用户回答',
      { answers: { goal: '演示' } },
      undefined,
      {},
      new AbortController().signal,
      eventDispatcher,
      { status: 'submitted', response: { goal: '演示' } },
      createPendingInteraction('call_1'),
    );

    expect(projectedTypes).toEqual(['error', 'transport_end']);
  });

  it('ask 响应应保留给 Agent 的 observation 与结构化答案', async () => {
    const payload = {
      answers: { topic: '增长汇报' },
    };

    await continueWithToolOutput(
      'conv_1',
      'call_ask_1',
      'ask',
      '问卷回答摘要',
      payload,
      undefined,
      {},
      new AbortController().signal,
      undefined,
      { status: 'submitted', response: payload },
      createPendingInteraction('call_ask_1'),
    );

    const req = readInteractionResponseRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(req.observation).toBe('问卷回答摘要');
    expect(req.data).toEqual(payload);
  });

  it('点选编辑上下文应写入 ConversationNextRequest 的 user_input metadata', async () => {
    const selectedSlidesElement = [
      'source_file_inode: deck-1',
      '',
      '<slides_element_source_context>',
      '<<<deck.js exact source',
      'coverImg.rounding = true;',
      '>>>',
      '</slides_element_source_context>',
    ].join('\n');

    await invokeAssistant(
      {
        userMessage: {
          text: '修改第 1 页选中的 1 个元素：这个能不能搞成矩形',
          userQuote: {
            items: [{
              id: 'reference-11111111111111111111111111111111',
              pluginId: 'slides',
              kind: 'slides-source-selection',
              text: '1. image s1-freeform-0 lines 3-9',
              label: '第 1 页 · 1 个元素',
              source: {
                type: 'slides_source_selection',
                presentation_id: 'deck-1',
                source_file_inode: 'deck-1',
              },
            }],
          },
        },
        projectId: 'project-1',
        options: {
          promptKey: 'plugin_agent_fixture',
          conversationId: 'conv_1',
          messageId: 'msg_1',
          enableTools: true,
          fences: [{
            kind: 'selected-slides-element',
            content: selectedSlidesElement,
          }],
        },
      },
      {},
      new AbortController().signal,
    );

    const req = readConversationNextRequest(streamConversationMock.mock.calls[0]?.[0]);

    expect(req?.new_events?.[0]).toMatchObject({
      type: 'user_input',
      id: 'msg_1',
      metadata: {
        user_quote: {
          items: [{
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'slides',
            kind: 'slides-source-selection',
            label: '第 1 页 · 1 个元素',
            source: {
              type: 'slides_source_selection',
              presentation_id: 'deck-1',
              source_file_inode: 'deck-1',
            },
          }],
        },
      },
    });
    expect(req?.options?.fences).toEqual([
      {
        kind: 'selected-slides-element',
        content: selectedSlidesElement,
      },
    ]);
  });

  it('系统编排指定的 host tool call 应原样透传到 conversation 请求', async () => {
    await invokeAssistant(
      {
        userMessage: { text: '批量填充两行' },
        options: {
          promptKey: 'default',
          conversationId: 'conv_host_tool',
          hostToolCall: {
            tool_name: 'subrun_batch',
            args: {
              worker_prompt_key: 'table_ai_fill',
              subruns: [
                { unit_id: 'row-1', prompt: '处理第一行' },
                { unit_id: 'row-2', prompt: '处理第二行' },
              ],
            },
          },
        },
      },
      {},
      new AbortController().signal,
    );

    const req = readConversationNextRequest(streamConversationMock.mock.calls[0]?.[0]);
    expect(req.options?.host_tool_call).toEqual({
      tool_name: 'subrun_batch',
      args: {
        worker_prompt_key: 'table_ai_fill',
        subruns: [
          { unit_id: 'row-1', prompt: '处理第一行' },
          { unit_id: 'row-2', prompt: '处理第二行' },
        ],
      },
    });
  });

  it('旧流取消后迟到的 transport_end 不得进入投影或触发调用方收尾', async () => {
    const eventDispatcher = vi.fn<ConversationEventDispatcher>(async (
      _conversationId: string,
      _event,
    ) => ({ success: true }));

    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelledTransportEnd = vi.fn();

    await invokeAssistant(
      {
        userMessage: { text: '旧请求' },
        options: { conversationId: 'conv_old' },
        eventDispatcher,
      },
      { onTransportEnd: cancelledTransportEnd },
      cancelledController.signal,
    );

    const activeTransportEnd = vi.fn();
    await invokeAssistant(
      {
        userMessage: { text: '新请求' },
        options: { conversationId: 'conv_new' },
        eventDispatcher,
      },
      { onTransportEnd: activeTransportEnd },
      new AbortController().signal,
    );

    expect(cancelledTransportEnd).not.toHaveBeenCalled();
    expect(activeTransportEnd).toHaveBeenCalledTimes(1);
    expect(eventDispatcher).toHaveBeenCalledTimes(1);
    expect(eventDispatcher.mock.calls[0]?.[0]).toBe('conv_new');
  });

  it('事件 ID 只在单个请求流内去重，不得跨流互相吞事件', async () => {
    streamConversationMock.mockImplementation(async (req, callbacks) => {
      const onThought = callbacks['onThought'];
      if (typeof onThought === 'function') {
        const event = {
          type: 'thought',
          id: 'shared-event-id',
          conversation_id: req.conversation_id ?? 'unknown-conversation',
          turn_id: 'shared-turn-id',
          timestamp: Date.now(),
          version: 1,
          is_complete: false,
          delta: 'thinking',
        };
        await onThought(event);
        await onThought(event);
      }
      return createTransportEndOutcome();
    });

    const dispatcherA = vi.fn<ConversationEventDispatcher>(async (
      _conversationId: string,
      _event,
    ) => ({ success: true }));
    const dispatcherB = vi.fn<ConversationEventDispatcher>(async (
      _conversationId: string,
      _event,
    ) => ({ success: true }));

    await Promise.all([
      invokeAssistant(
        {
          userMessage: { text: '并发请求 A' },
          options: { conversationId: 'conv_a' },
          eventDispatcher: dispatcherA,
        },
        {},
        new AbortController().signal,
      ),
      invokeAssistant(
        {
          userMessage: { text: '并发请求 B' },
          options: { conversationId: 'conv_b' },
          eventDispatcher: dispatcherB,
        },
        {},
        new AbortController().signal,
      ),
    ]);

    expect(dispatcherA).toHaveBeenCalledTimes(1);
    expect(dispatcherA.mock.calls[0]?.[0]).toBe('conv_a');
    expect(dispatcherB).toHaveBeenCalledTimes(1);
    expect(dispatcherB.mock.calls[0]?.[0]).toBe('conv_b');
  });

  it('统一投影回调失败时必须进入调用方错误链，不能在 router 内静默吞掉', async () => {
    streamConversationMock.mockImplementation(async (_req, callbacks) => {
      const onThought = callbacks['onThought'];
      if (typeof onThought === 'function') {
        await onThought({
          type: 'thought',
          id: 'projection-failure-event',
          conversation_id: 'conv_projection_failure',
          turn_id: 'turn_projection_failure',
          timestamp: Date.now(),
          version: 1,
          is_complete: false,
          delta: 'thinking',
        });
      }
      return createTransportEndOutcome();
    });

    const eventDispatcher: ConversationEventDispatcher = async () => {
      throw new Error('projection failed');
    };
    const onError = vi.fn();

    await invokeAssistant(
      {
        userMessage: { text: '触发投影失败' },
        options: { conversationId: 'conv_projection_failure' },
        eventDispatcher,
      },
      { onError },
      new AbortController().signal,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'projection failed' });
  });

  it('统一投影返回 success=false 时必须进入调用方错误链', async () => {
    streamConversationMock.mockImplementation(async (_req, callbacks) => {
      const onThought = callbacks['onThought'];
      if (typeof onThought === 'function') {
        await onThought({
          type: 'thought',
          id: 'projection-rejected-event',
          conversation_id: 'conv_projection_rejected',
          turn_id: 'turn_projection_rejected',
          timestamp: Date.now(),
          version: 1,
          is_complete: false,
          delta: 'thinking',
        });
      }
      return createTransportEndOutcome();
    });

    const eventDispatcher: ConversationEventDispatcher = async () => ({
      success: false,
      reason: 'missing parent anchor',
    });
    const onError = vi.fn();

    await invokeAssistant(
      {
        userMessage: { text: '触发投影拒绝' },
        options: { conversationId: 'conv_projection_rejected' },
        eventDispatcher,
      },
      { onError },
      new AbortController().signal,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('missing parent anchor'),
    });
  });

  it('必须等待异步工具副作用完成后再分发 final_answer', async () => {
    streamConversationMock.mockImplementationOnce(async (_req, callbacks) => {
      const onToolOutput = callbacks['onToolOutput'];
      const onFinalAnswer = callbacks['onFinalAnswer'];

      if (typeof onToolOutput === 'function') {
        await onToolOutput({
          type: 'tool_output',
          id: 'tool-output-ordering',
          conversation_id: 'conv_ordering',
          turn_id: 'turn_ordering',
          timestamp: Date.now(),
          tool_name: 'write_to_table',
          tool_call_id: 'call_ordering',
          status: 'success',
          observation: 'write complete',
          data: { content: 'done' },
        });
      }

      if (typeof onFinalAnswer === 'function') {
        await onFinalAnswer({
          type: 'final_answer',
          id: 'final-answer-ordering',
          conversation_id: 'conv_ordering',
          turn_id: 'turn_ordering',
          timestamp: Date.now(),
          answer_id: 'answer_ordering',
          content: '批量处理完成。',
        });
      }
      return createTransportEndOutcome();
    });

    const order: string[] = [];
    const toolSideEffectGateController: { release: () => void } = {
      release: () => {
        throw new Error('异步工具副作用闸门未初始化');
      },
    };
    const toolSideEffectGate = new Promise<void>((resolve) => {
      toolSideEffectGateController.release = () => resolve();
    });

    const invocation = invokeAssistant(
      {
        userMessage: { text: '验证异步副作用顺序' },
        options: { conversationId: 'conv_ordering' },
      },
      {
        onToolOutput: async () => {
          order.push('tool:start');
          await toolSideEffectGate;
          order.push('tool:end');
        },
        onFinalAnswer: () => {
          order.push('final');
        },
      },
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(order).toEqual(['tool:start']);
    });

    toolSideEffectGateController.release();
    await invocation;

    expect(order).toEqual(['tool:start', 'tool:end', 'final']);
  });

  it('统一路由下必须等待 subrun trace 副作用完成后再分发父工具结果和 final_answer', async () => {
    streamConversationMock.mockImplementationOnce(async (_req, callbacks) => {
      const onSubRunTrace = callbacks['onSubRunTrace'];
      const onToolOutput = callbacks['onToolOutput'];
      const onFinalAnswer = callbacks['onFinalAnswer'];

      if (typeof onSubRunTrace === 'function') {
        await onSubRunTrace({
          type: 'subrun_trace',
          id: 'subrun-trace-ordering',
          conversation_id: 'conv_subrun_ordering',
          turn_id: 'turn_subrun_ordering',
          timestamp: Date.now(),
          parent_tool_call_id: 'parent_call_ordering',
          subrun_id: 'subrun_ordering',
          source_event_id: 'child_call_ordering_output',
          kind: 'tool_output',
          tool_name: 'write_to_table',
          tool_call_id: 'child_call_ordering',
          status: 'success',
          output: { content: 'row done' },
        });
      }
      if (typeof onToolOutput === 'function') {
        await onToolOutput({
          type: 'tool_output',
          id: 'parent-tool-output-ordering',
          conversation_id: 'conv_subrun_ordering',
          turn_id: 'turn_subrun_ordering',
          timestamp: Date.now(),
          tool_name: 'subrun_batch',
          tool_call_id: 'parent_call_ordering',
          status: 'success',
          observation: 'batch complete',
          data: {},
        });
      }
      if (typeof onFinalAnswer === 'function') {
        await onFinalAnswer({
          type: 'final_answer',
          id: 'final-answer-subrun-ordering',
          conversation_id: 'conv_subrun_ordering',
          turn_id: 'turn_subrun_ordering',
          timestamp: Date.now(),
          answer_id: 'answer_subrun_ordering',
          content: '批量处理完成。',
        });
      }
      return createTransportEndOutcome();
    });

    const order: string[] = [];
    let releaseTraceSideEffect = (): void => {
      throw new Error('subrun trace 副作用闸门未初始化');
    };
    const traceSideEffectGate = new Promise<void>((resolve) => {
      releaseTraceSideEffect = resolve;
    });
    const eventDispatcher: ConversationEventDispatcher = async (_conversationId, event) => {
      order.push(`route:${event.type}`);
      return { success: true };
    };

    const invocation = invokeAssistant(
      {
        userMessage: { text: '验证 subrun trace 副作用顺序' },
        options: { conversationId: 'conv_subrun_ordering' },
        eventDispatcher,
      },
      {
        onSubRunTrace: async () => {
          order.push('trace:start');
          await traceSideEffectGate;
          order.push('trace:end');
        },
        onToolOutput: () => {
          order.push('parent-tool-output');
        },
        onFinalAnswer: () => {
          order.push('final');
        },
      },
      new AbortController().signal,
    );

    await vi.waitFor(() => {
      expect(order).toEqual(['route:subrun_trace', 'trace:start']);
    });

    releaseTraceSideEffect();
    await invocation;

    expect(order).toEqual([
      'route:subrun_trace',
      'trace:start',
      'trace:end',
      'route:tool_output',
      'parent-tool-output',
      'route:final_answer',
      'final',
    ]);
  });

  it('进入用户交互等待后只接收控制事件，不得继续投影同一请求的普通增量', async () => {
    streamConversationMock.mockImplementation(async (_req, callbacks) => {
      const onRequiresUserInteraction = callbacks['onRequiresUserInteraction'];
      const onFinalAnswerChunk = callbacks['onFinalAnswerChunk'];
      const onTransportEnd = callbacks['onTransportEnd'];

      if (typeof onRequiresUserInteraction === 'function') {
        await onRequiresUserInteraction({
          type: 'requires_user_interaction',
          id: 'wait-event',
          conversation_id: 'conv_wait',
          turn_id: 'turn_wait',
          timestamp: Date.now(),
          form: { toolCallId: 'tool_wait', toolName: 'ask' },
        });
      }
      if (typeof onFinalAnswerChunk === 'function') {
        await onFinalAnswerChunk({
          type: 'final_answer_chunk',
          id: 'late-answer-chunk',
          conversation_id: 'conv_wait',
          turn_id: 'turn_wait',
          timestamp: Date.now(),
          answer_id: 'answer_wait',
          seq: 0,
          chunk: 'late answer',
        });
      }
      if (typeof onTransportEnd === 'function') {
        await onTransportEnd({
          type: 'transport_end',
          id: 'wait-stream-end',
          conversation_id: 'conv_wait',
          turn_id: 'turn_wait',
          timestamp: Date.now(),
          version: 1,
          reason: 'complete',
        });
      }
      return createTransportEndOutcome();
    });

    const routedTypes: string[] = [];
    const eventDispatcher: ConversationEventDispatcher = async (_conversationId, event) => {
      routedTypes.push(event.type);
      return { success: true };
    };
    const onFinalAnswerChunk = vi.fn();

    await invokeAssistant(
      {
        userMessage: { text: '等待用户回答' },
        options: { conversationId: 'conv_wait' },
        eventDispatcher,
      },
      { onFinalAnswerChunk },
      new AbortController().signal,
    );

    expect(routedTypes).toEqual(['requires_user_interaction', 'transport_end']);
    expect(onFinalAnswerChunk).not.toHaveBeenCalled();
  });

  it('首次发送与工具续跑应共享统一路由和调用方副作用契约', async () => {
    streamConversationMock.mockImplementation(async (req, callbacks) => {
      const turnId = 'options' in req
        ? req.options?.turn_id ?? 'turn-shared'
        : 'turn-call-input';
      const events = [
        ['onToolOutput', {
          type: 'tool_output',
          id: `tool-output-${req.conversation_id}`,
          conversation_id: req.conversation_id,
          turn_id: turnId,
          timestamp: Date.now(),
          tool_name: 'write_to_table',
          tool_call_id: 'tool-shared',
          observation: 'write complete',
          data: {},
          status: 'success',
        }],
        ['onFinalAnswerChunk', {
          type: 'final_answer_chunk',
          id: `answer-chunk-${req.conversation_id}`,
          conversation_id: req.conversation_id,
          turn_id: turnId,
          timestamp: Date.now(),
          answer_id: 'answer-shared',
          seq: 0,
          chunk: 'done',
        }],
        ['onSummarizationStart', {
          type: 'summarization_start',
          id: `summary-start-${req.conversation_id}`,
          summarization_id: `summary-start-${req.conversation_id}`,
          conversation_id: req.conversation_id,
          turn_id: turnId,
          run_id: `run-${req.conversation_id}`,
          execution_id: `execution-${req.conversation_id}`,
          timestamp: Date.now(),
        }],
        ['onTransportEnd', {
          type: 'transport_end',
          id: `stream-end-${req.conversation_id}`,
          conversation_id: req.conversation_id,
          turn_id: turnId,
          timestamp: Date.now(),
          reason: 'complete',
        }],
      ] as const;

      for (const [callbackName, event] of events) {
        const callback = callbacks[callbackName];
        if (typeof callback === 'function') await callback(event);
      }
      return createTransportEndOutcome();
    });

    const routedTypes: string[] = [];
    const eventDispatcher: ConversationEventDispatcher = async (_conversationId, event) => {
      routedTypes.push(event.type);
      return { success: true };
    };

    const invokeToolOutput = vi.fn();
    const invokeAnswerChunk = vi.fn();
    const invokeTransportEnd = vi.fn();
    await invokeAssistant(
      {
        userMessage: { text: '首次发送' },
        options: { conversationId: 'conv-invoke' },
        eventDispatcher,
      },
      {
        onToolOutput: invokeToolOutput,
        onFinalAnswerChunk: invokeAnswerChunk,
        onTransportEnd: invokeTransportEnd,
      },
      new AbortController().signal,
    );

    const continueToolOutput = vi.fn();
    const continueAnswerChunk = vi.fn();
    const continueTransportEnd = vi.fn();
    await continueWithToolOutput(
      'conv-continue',
      'call-input',
      'ask',
      '继续',
      {},
      undefined,
      {
        onToolOutput: continueToolOutput,
        onFinalAnswerChunk: continueAnswerChunk,
        onTransportEnd: continueTransportEnd,
      },
      new AbortController().signal,
      eventDispatcher,
      { status: 'submitted', response: { accepted: true } },
      createPendingInteraction('call-input'),
    );

    expect(invokeToolOutput).toHaveBeenCalledTimes(1);
    expect(continueToolOutput).toHaveBeenCalledTimes(1);
    expect(invokeAnswerChunk).toHaveBeenCalledTimes(1);
    expect(continueAnswerChunk).toHaveBeenCalledTimes(1);
    expect(invokeTransportEnd).toHaveBeenCalledTimes(1);
    expect(continueTransportEnd).toHaveBeenCalledTimes(1);
    expect(routedTypes.filter(type => type === 'summarization_start')).toHaveLength(2);
  });
});
