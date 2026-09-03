import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { BaseMessage } from '../../types';
import { useConversationState } from '../conversationState';
import { useProjectionStore } from './projectionStore';
import { useInteractiveRunStore } from '../../features/interactive-run';
import { useMessageWindowStore } from '../../message-window';
import { useConversationSelectors } from '../selectors';
import { ConversationUiMessageSchema } from '@app/schemas';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../testing/functions/createConversationTestMessage';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { projectMessageCitationDependencies } from '../../features/citation-presentation';

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentProjectId: null,
  }),
}));

type LocalStorageMock = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

function createExecutionScope(runId: string, executionId: string) {
  return {
    run_id: runId,
    execution_id: executionId,
    lane: 'foreground' as const,
    visibility: 'conversation' as const,
  };
}

function buildBaseHistory(): BaseMessage[] {
  return [
    createTestUserMessage({ id: 'msg_user_1', content: '第一问', timestamp: 1 }),
    createTestAnswerMessage({ id: 'msg_answer_1', content: '第一答', timestamp: 2 }),
  ];
}

function createMessage(message: {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly type: 'user_input' | 'final_answer';
  readonly content: string;
  readonly timestamp: number;
}): BaseMessage {
  return message.type === 'user_input'
    ? createTestUserMessage({
        id: message.id,
        content: message.content,
        timestamp: message.timestamp,
      })
    : createTestAnswerMessage({
        id: message.id,
        content: message.content,
        timestamp: message.timestamp,
      });
}

async function enqueueBufferedAnswer(
  projectionStore: ReturnType<typeof useProjectionStore>,
  input: {
    readonly conversationId: string;
    readonly turnId: string;
    readonly answerId: string;
    readonly messageId: string;
    readonly content: string;
    readonly timestamp: number;
  }
): Promise<void> {
  const executionScope = createExecutionScope(
    `run_${input.answerId}`,
    `execution_${input.answerId}`
  );
  await projectionStore.handleSseEvent(input.conversationId, {
    type: 'final_answer_chunk',
    id: `${input.messageId}_chunk_0`,
    conversation_id: input.conversationId,
    turn_id: input.turnId,
    timestamp: input.timestamp,
    answer_id: input.answerId,
    seq: 0,
    chunk: input.content,
    is_last: true,
    ...executionScope,
  });
  await projectionStore.handleSseEvent(input.conversationId, {
    type: 'final_answer',
    id: input.answerId,
    conversation_id: input.conversationId,
    turn_id: input.turnId,
    timestamp: input.timestamp + 1,
    answer_id: input.answerId,
    content: input.content,
    completion_reason: 'terminal',
    ...executionScope,
  });
}

describe('projectionStore interrupted follow-up regression', () => {
  let localStorageMock: LocalStorageMock;

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());

    localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop 后立刻继续发送消息时，不应被旧的延迟 commit 回写覆盖历史', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_interrupted_followup',
      title: '中断后续发',
      autoActivate: true,
    });
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error('conversation should exist');
    }
    conversation.messages = buildBaseHistory();

    const projectionStore = useProjectionStore();

    await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer_chunk',
      id: 'evt_partial_1',
      conversation_id: conversationId,
      turn_id: 'turn_interrupted_1',
      timestamp: 3,
      answer_id: 'answer_interrupted_1',
      seq: 0,
      chunk: '已有输出',
      ...createExecutionScope('run_interrupted_1', 'execution_interrupted_1'),
    });

    expect(vi.getTimerCount()).toBe(1);
    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
    ]);

    projectionStore.commitUserInput({
      type: 'user_input_committed',
      id: 'message_followup',
      timestamp: 4,
      conversation_id: conversationId,
      turn_id: 'turn_followup',
      operation: 'append',
      content: '继续追问',
      raw_content: '继续追问',
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
      '已有输出',
      '继续追问',
    ]);

    await vi.advanceTimersByTimeAsync(60);

    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
      '已有输出',
      '继续追问',
    ]);
  });

  it('截断目标在 live 中间时，应只保留到目标消息', () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_truncate_live_middle',
      title: 'live truncate',
      autoActivate: true,
    });
    const projectionStore = useProjectionStore();

    projectionStore.appendMessage(
      createMessage({
        id: 'live-user-1',
        role: 'user',
        type: 'user_input',
        content: '第一轮',
        timestamp: 1,
      }),
      conversationId
    );
    projectionStore.appendMessage(
      createMessage({
        id: 'live-answer-1',
        role: 'assistant',
        type: 'final_answer',
        content: '第一轮回答',
        timestamp: 2,
      }),
      conversationId
    );
    projectionStore.appendMessage(
      createMessage({
        id: 'live-answer-2',
        role: 'assistant',
        type: 'final_answer',
        content: '应被截断',
        timestamp: 3,
      }),
      conversationId
    );

    projectionStore.truncateProjectionStateAfterMessage(conversationId, 'live-answer-1');

    expect(conversationState.conversations[0]?.messages.map(message => message.id)).toEqual([
      'live-user-1',
      'live-answer-1',
    ]);
  });

  it('rejects conflicting live identity once, rolls back projection runtime, and keeps navigation usable', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_identity_conflict',
      title: 'identity conflict',
      autoActivate: true,
    });
    const windowStore = useMessageWindowStore();
    const messageId = 'shared-message-id';
    const durableUserMessage = createTestUserMessage({
      id: messageId,
      content: 'durable user input',
      timestamp: 10,
    });
    windowStore.replaceWithSnapshot({
      conversationId,
      rows: [
        {
          conversationId,
          messageId,
          sortSeq: 1,
          revision: 1,
          dto: ConversationUiMessageSchema.parse({
            conversation_id: conversationId,
            message_id: messageId,
            turn_id: durableUserMessage.metadata?.turn_id ?? 'turn-durable-user',
            role: 'user',
            message_type: 'user_input',
            sort_seq: 1,
            timestamp: durableUserMessage.timestamp,
            content: durableUserMessage.content,
            payload: null,
            merge_key: null,
            presentation: null,
            run_id: durableUserMessage.metadata?.run_id ?? 'run-durable-user',
          }),
          message: durableUserMessage,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      revision: 1,
    });

    const projectionStore = useProjectionStore();
    const result = await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer_chunk',
      id: 'event-conflicting-answer-chunk',
      conversation_id: conversationId,
      turn_id: 'turn-conflict',
      timestamp: 11,
      answer_id: messageId,
      seq: 0,
      chunk: 'conflicting live answer',
      ...createExecutionScope('run-conflict', 'execution-conflict'),
    });

    expect(result).toMatchObject({
      success: false,
      reason: `Conversation message ${messageId} changed type across window/live sources: user_input -> final_answer`,
    });
    expect(conversationState.conversations[0]?.messages).toEqual([]);
    expect(
      projectionStore.messageProjectionStates.get(conversationId)?.conversation.messages
    ).toEqual([]);

    const selectors = useConversationSelectors(conversationState);
    expect(() => selectors.activeMessages.value).not.toThrow();
    expect(selectors.activeMessages.value.map(message => message.id)).toEqual([messageId]);

    const newConversationId = conversationState.createConversation({
      id: 'conv_after_identity_conflict',
      title: 'new conversation',
      autoActivate: true,
    });
    expect(conversationState.activeConversationId).toBe(newConversationId);
    expect(selectors.activeMessages.value).toEqual([]);
  });

  it('rejects a conflicting live answer seal and rolls back the whole uncommitted attempt', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_answer_seal_conflict',
      title: 'answer seal conflict',
      autoActivate: true,
    });
    const windowStore = useMessageWindowStore();
    const answerId = 'answer_reused_across_attempts';
    const durablePartial = createTestAnswerMessage({
      id: answerId,
      type: 'partial_answer',
      content: 'interrupted answer',
      timestamp: 10,
    });
    windowStore.replaceWithSnapshot({
      conversationId,
      rows: [
        {
          conversationId,
          messageId: answerId,
          sortSeq: 1,
          revision: 1,
          dto: ConversationUiMessageSchema.parse({
            conversation_id: conversationId,
            message_id: answerId,
            turn_id: durablePartial.metadata.turn_id,
            role: 'assistant',
            message_type: 'partial_answer',
            sort_seq: 1,
            timestamp: durablePartial.timestamp,
            content: durablePartial.content,
            payload: {
              answer_id: answerId,
              is_complete: false,
              completion_reason: 'interrupted',
              first_token_at: durablePartial.metadata.first_token_at,
            },
            merge_key: null,
            presentation: null,
            run_id: durablePartial.metadata.run_id,
          }),
          message: durablePartial,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      revision: 1,
    });

    const projectionStore = useProjectionStore();
    const executionScope = createExecutionScope('run-new-attempt', 'execution-new-attempt');
    await expect(
      projectionStore.handleSseEvent(conversationId, {
        type: 'final_answer_chunk',
        id: 'event-new-attempt-chunk',
        conversation_id: conversationId,
        turn_id: 'turn-new-attempt',
        timestamp: 20,
        answer_id: answerId,
        seq: 0,
        chunk: 'terminal answer',
        is_last: true,
        ...executionScope,
      })
    ).resolves.toMatchObject({ success: true });

    const result = await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer',
      id: answerId,
      conversation_id: conversationId,
      turn_id: 'turn-new-attempt',
      timestamp: 21,
      answer_id: answerId,
      content: 'terminal answer',
      completion_reason: 'terminal',
      ...executionScope,
    });

    expect(result).toMatchObject({
      success: false,
      reason: `Conversation answer ${answerId} has conflicting sealed facts across window/live sources: completion_reason=interrupted -> terminal, content=different`,
    });
    expect(conversationState.conversations[0]?.messages).toEqual([]);
    expect(
      projectionStore.messageProjectionStates.get(conversationId)?.conversation.messages
    ).toEqual([]);

    const selectors = useConversationSelectors(conversationState);
    expect(() => selectors.activeMessages.value).not.toThrow();
    expect(selectors.activeMessages.value).toEqual([durablePartial]);
  });

  it('window/live 冲突回滚时保留尚未 flush 的 subrun citation fact', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_citation_workspace_rollback',
      title: 'citation workspace rollback',
      autoActivate: true,
    });
    const windowStore = useMessageWindowStore();
    const answerId = 'answer_citation_rollback_conflict';
    const durablePartial = createTestAnswerMessage({
      id: answerId,
      type: 'partial_answer',
      content: 'durable interrupted answer',
      timestamp: 10,
    });
    windowStore.replaceWithSnapshot({
      conversationId,
      rows: [{
        conversationId,
        messageId: answerId,
        sortSeq: 1,
        revision: 1,
        dto: ConversationUiMessageSchema.parse({
          conversation_id: conversationId,
          message_id: answerId,
          turn_id: durablePartial.metadata.turn_id,
          role: 'assistant',
          message_type: 'partial_answer',
          sort_seq: 1,
          timestamp: durablePartial.timestamp,
          content: durablePartial.content,
          payload: {
            answer_id: answerId,
            is_complete: false,
            completion_reason: 'interrupted',
            first_token_at: durablePartial.metadata.first_token_at,
          },
          merge_key: null,
          presentation: null,
          run_id: durablePartial.metadata.run_id,
        }),
        message: durablePartial,
      }],
      hasMoreBefore: false,
      hasMoreAfter: false,
      revision: 1,
    });

    const projectionStore = useProjectionStore();
    const runId = RunIdSchema.parse('run-citation-rollback');
    const parentToolCallId = ToolCallIdSchema.parse('call-citation-parent');
    const executionId = 'execution-citation-rollback';
    await projectionStore.handleSseEvent(conversationId, {
      type: 'tool_call_decision',
      id: 'evt-citation-parent-decision',
      timestamp: 20,
      conversation_id: conversationId,
      turn_id: 'turn-citation-parent',
      run_id: runId,
      execution_id: executionId,
      lane: 'foreground',
      visibility: 'conversation',
      tool_call_id: parentToolCallId,
      tool_name: 'web_search',
      phase: 'start',
      status: 'loading',
      args: { query: 'parent', top_k: 10 },
    });
    await projectionStore.handleSseEvent(conversationId, {
      type: 'subrun_trace',
      id: 'evt-citation-child-output',
      timestamp: 21,
      conversation_id: conversationId,
      turn_id: 'turn-citation-child',
      run_id: runId,
      execution_id: executionId,
      parent_tool_call_id: parentToolCallId,
      subrun_id: 'subrun-citation-rollback',
      source_event_id: 'source-citation-child-output',
      kind: 'tool_output',
      tool_name: 'web_search',
      tool_call_id: ToolCallIdSchema.parse('call-citation-child'),
      status: 'success',
      output: {
        data: {
          query: 'child',
          resultCount: 1,
          citations: {
            query: 'child',
            searchMode: 'web',
            citations: [{
              sourceType: 'web',
              ref: 'Gh4Jkm',
              index: 1,
              url: 'https://example.com/rollback-child',
              docTitle: 'rollback child source',
              snippet: 'rollback child snippet',
            }],
          },
          evidence_store: { bundle_id: 'bundle-rollback-child' },
          cacheStatus: 'miss',
        },
        observation: 'child search complete',
      },
    });

    const answerScope = createExecutionScope(runId, executionId);
    await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer_chunk',
      id: 'evt-citation-conflicting-chunk',
      conversation_id: conversationId,
      turn_id: 'turn-citation-answer',
      timestamp: 22,
      answer_id: answerId,
      seq: 0,
      chunk: 'conflicting answer [@Gh4Jkm]',
      is_last: true,
      ...answerScope,
    });
    const result = await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer',
      id: answerId,
      conversation_id: conversationId,
      turn_id: 'turn-citation-answer',
      timestamp: 23,
      answer_id: answerId,
      content: 'conflicting answer [@Gh4Jkm]',
      completion_reason: 'terminal',
      ...answerScope,
    });

    expect(result.success).toBe(false);
    const rebuiltRuntime = projectionStore.messageProjectionStates.get(conversationId);
    if (!rebuiltRuntime) throw new Error('projection runtime should be rebuilt after conflict');
    expect(projectMessageCitationDependencies(
      rebuiltRuntime.citationWorkspace,
      'turn-after-rollback',
      'later answer [@Gh4Jkm]',
    )).toEqual({
      citations: [expect.objectContaining({
        ref: 'Gh4Jkm',
        url: 'https://example.com/rollback-child',
      })],
      unresolved_refs: [],
    });
  });

  it('截断目标不在 live 但 live 非空时，应清空整个 live 投影', () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_truncate_window_target',
      title: 'window target truncate',
      autoActivate: true,
    });
    const projectionStore = useProjectionStore();

    projectionStore.appendMessage(
      createMessage({
        id: 'live-user-after-window',
        role: 'user',
        type: 'user_input',
        content: '窗口之后的新问题',
        timestamp: 10,
      }),
      conversationId
    );
    projectionStore.appendMessage(
      createMessage({
        id: 'live-answer-after-window',
        role: 'assistant',
        type: 'final_answer',
        content: '窗口之后的新回答',
        timestamp: 11,
      }),
      conversationId
    );

    projectionStore.truncateProjectionStateAfterMessage(conversationId, 'window-only-message');

    expect(conversationState.conversations[0]?.messages).toEqual([]);
  });

  it('截断会话没有 live 投影时，应保持 no-op', () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_truncate_no_projection',
      title: 'no live truncate',
      autoActivate: true,
    });
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error('conversation should exist');
    }
    conversation.messages = buildBaseHistory();

    const projectionStore = useProjectionStore();

    projectionStore.truncateProjectionStateAfterMessage(conversationId, 'window-only-message');

    expect(conversationState.conversations[0]?.messages.map(message => message.id)).toEqual([
      'msg_user_1',
      'msg_answer_1',
    ]);
  });

  it('收到 requires_user_interaction 时，应进入正式等待态且不再报未知事件', async () => {
    const conversationState = useConversationState();
    const interactiveRunStore = useInteractiveRunStore();
    const conversationId = conversationState.createConversation({
      id: 'conv_requires_user_interaction',
      title: '等待态测试',
      autoActivate: true,
    });
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error('conversation should exist');
    }
    conversation.messages = buildBaseHistory();

    const projectionStore = useProjectionStore();
    const controller = new AbortController();
    interactiveRunStore.beginStart(conversationId, controller);

    const decisionResult = await projectionStore.handleSseEvent(conversationId, {
      type: 'tool_call_decision',
      id: 'evt_wait_tool_1',
      conversation_id: conversationId,
      turn_id: 'turn_wait_1',
      timestamp: 9,
      run_id: RunIdSchema.parse('run_wait_1'),
      execution_id: 'execution_wait_1',
      lane: 'foreground',
      visibility: 'conversation',
      tool_name: 'ask',
      tool_call_id: ToolCallIdSchema.parse('toolu_wait_1'),
      phase: 'start',
      status: 'loading',
      args: { questions: [{ id: 'q_1', type: 'text', question: '请补充需求' }] },
    });
    expect(decisionResult.success).toBe(true);

    const result = await projectionStore.handleSseEvent(conversationId, {
      type: 'requires_user_interaction',
      id: 'evt_wait_1',
      conversation_id: conversationId,
      turn_id: 'turn_wait_1',
      timestamp: 10,
      run_id: RunIdSchema.parse('run_wait_1'),
      execution_id: 'execution_wait_1',
      lane: 'foreground',
      visibility: 'conversation',
      interaction_id: 'interaction_wait_1',
      tool_call_id: ToolCallIdSchema.parse('toolu_wait_1'),
      checkpoint_revision: 3,
      resume_token: 'resume_wait_1',
      interaction_status: 'pending',
      form: {
        data: {
          questionnaireId: 'questionnaire_wait_1',
          allowSkip: true,
          submitLabel: '提交',
          questions: [{ id: 'q_1', type: 'text', question: '请补充需求' }],
        },
        observation: '等待用户回答',
      },
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(interactiveRunStore.snapshotFor(conversationId)).toMatchObject({
      status: 'awaiting_user',
      runId: 'run_wait_1',
      pendingInteraction: {
        interactionId: 'interaction_wait_1',
        toolCallId: 'toolu_wait_1',
        checkpointRevision: 3,
      },
    });
    expect(controller.signal.aborted).toBe(false);
    const committedConversation = conversationState.conversations.find(
      item => item.id === conversationId
    );
    expect(
      committedConversation?.messages.find(message => message.type === 'tool_calls')?.metadata
    ).toMatchObject({
      data: { questionnaireId: 'questionnaire_wait_1' },
      interaction: {
        status: 'active',
        interactionId: 'interaction_wait_1',
      },
    });
  });

  it('此前处理过其它 turn 时，历史窗口事件仍应缓冲并按序回放', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_history_window_buffer',
      title: '窗口加载缓冲',
      autoActivate: true,
    });
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error('conversation should exist');
    }
    conversation.messages = buildBaseHistory();

    const projectionStore = useProjectionStore();
    const previousTurnResult = await projectionStore.handleSseEvent(conversationId, {
      type: 'transport_end',
      id: 'evt_previous_transport_end',
      conversation_id: conversationId,
      turn_id: 'turn_previous',
      timestamp: 9,
      execution_id: 'execution_previous',
      reason: 'complete',
    });
    expect(previousTurnResult.success).toBe(true);

    const requestToken = 1;
    projectionStore.beginHistoryLoadingSseBuffer(conversationId, requestToken);
    conversationState.setHistoryLoadingConversation(conversationId);
    await enqueueBufferedAnswer(projectionStore, {
      conversationId,
      turnId: 'turn_buffered',
      answerId: 'answer_buffered',
      messageId: 'evt_buffered_answer',
      content: '加载期间到达的回答',
      timestamp: 10,
    });

    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
    ]);

    await projectionStore.replayBufferedHistoryLoadingEvents(
      conversationId,
      requestToken,
      () => true
    );

    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
      '加载期间到达的回答',
    ]);
  });

  it('历史加载缓冲超过旧上限时仍应无损按序回放', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_history_buffer_fifo',
      title: '无损缓冲',
      autoActivate: true,
    });
    const projectionStore = useProjectionStore();
    const requestToken = 2;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    projectionStore.beginHistoryLoadingSseBuffer(conversationId, requestToken);

    for (let index = 0; index < 501; index += 1) {
      await enqueueBufferedAnswer(projectionStore, {
        conversationId,
        turnId: `turn_buffered_${index}`,
        answerId: `answer_buffered_${index}`,
        messageId: `evt_buffered_${index}`,
        content: `回答 ${index}`,
        timestamp: index * 2,
      });
    }

    await expect(
      projectionStore.replayBufferedHistoryLoadingEvents(conversationId, requestToken, () => true)
    ).resolves.toBe('replayed');

    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    expect(conversation?.messages).toHaveLength(501);
    expect(conversation?.messages[0]?.content).toBe('回答 0');
    expect(conversation?.messages[500]?.content).toBe('回答 500');
    expect(warning).toHaveBeenCalledWith(
      '[ProjectionStore] history loading SSE buffer count is high',
      expect.objectContaining({ eventCount: 500 })
    );
    warning.mockRestore();
  });

  it('回放 token 失效后不得继续写入剩余缓冲事件', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_history_buffer_stale',
      title: '过期回放',
      autoActivate: true,
    });
    const projectionStore = useProjectionStore();
    const requestToken = 3;
    projectionStore.beginHistoryLoadingSseBuffer(conversationId, requestToken);

    for (let index = 0; index < 2; index += 1) {
      await enqueueBufferedAnswer(projectionStore, {
        conversationId,
        turnId: `turn_stale_${index}`,
        answerId: `answer_stale_${index}`,
        messageId: `evt_stale_${index}`,
        content: `过期回答 ${index}`,
        timestamp: index * 2,
      });
    }

    let checks = 0;
    await expect(
      projectionStore.replayBufferedHistoryLoadingEvents(conversationId, requestToken, () => {
        checks += 1;
        // 一条答案由 live chunk 与 durable final 两个连续事实组成；
        // token 在下一条答案前失效时，已开始的答案仍应完整提交身份。
        return checks <= 2;
      })
    ).resolves.toBe('stale');

    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    expect(conversation?.messages.map(message => message.content)).toEqual(['过期回答 0']);
    projectionStore.discardHistoryLoadingSseBuffer(conversationId, requestToken, 'test-cleanup');
  });

  it('加载缓冲中的非法 seal 必须让回放失败，不能静默吞掉协议错误', async () => {
    const conversationState = useConversationState();
    const conversationId = conversationState.createConversation({
      id: 'conv_history_buffer_invalid_seal',
      title: '非法封口',
      autoActivate: true,
    });
    const projectionStore = useProjectionStore();
    const requestToken = 4;
    projectionStore.beginHistoryLoadingSseBuffer(conversationId, requestToken);

    await projectionStore.handleSseEvent(conversationId, {
      type: 'final_answer',
      id: 'answer_without_chunk',
      conversation_id: conversationId,
      turn_id: 'turn_without_chunk',
      timestamp: 1,
      answer_id: 'answer_without_chunk',
      content: '缺少实时前缀',
      completion_reason: 'terminal',
      ...createExecutionScope('run_without_chunk', 'execution_without_chunk'),
    });

    await expect(
      projectionStore.replayBufferedHistoryLoadingEvents(conversationId, requestToken, () => true)
    ).rejects.toThrow('arrived without a live chunk stream');
    projectionStore.discardHistoryLoadingSseBuffer(conversationId, requestToken, 'test-cleanup');
  });
});
