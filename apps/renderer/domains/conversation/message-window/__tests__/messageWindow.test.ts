import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { MessageWindowApiPort } from '../definitions/messageWindowApi';
import { WINDOW_MAX_ROWS } from '../definitions/messageWindow';
import type { UiMessageDto, UiMessagesWindowDto, UiMessagesWindowReadyDto } from '../definitions/uiMessagesDto';
import { mapUiMessageDtoToConversationMessage, mapUiMessagesWindowDtoToRows } from '../functions/mapUiMessageDto';
import { readUiMessagesWindowDto } from '../functions/uiMessagesDtoGuards';
import { mergeWindowAndLiveMessages } from '../functions/mergeWindowAndLiveMessages';
import { createMessageWindowSnapshot } from '../functions/windowSnapshot';
import { loadAfter, loadAround, loadBefore, loadTail } from '../orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../store/messageWindowStore';
import type { BaseMessage, ToolCallMessage } from '../../types';
import {
  ConversationUiMessageSchema,
  conversationMessageIdFromToolIdentity,
} from '@app/schemas';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
  createTestUserMessage,
} from '../../testing/functions/createConversationTestMessage';

const readNoLiveMessages = (): readonly BaseMessage[] => [];

function createMessageDto(overrides: Partial<UiMessageDto> = {}): UiMessageDto {
  const messageId = overrides.message_id ?? 'msg-1';
  const messageType = overrides.message_type ?? 'final_answer';
  const defaultPayload = messageType === 'user_input'
    ? null
    : {
        answer_id: messageId,
        is_complete: true,
        completion_reason: 'terminal',
        first_token_at: 100,
      };
  return ConversationUiMessageSchema.parse({
    message_id: messageId,
    conversation_id: 'conv-window',
    turn_id: 'turn-1',
    role: 'assistant',
    message_type: 'final_answer',
    sort_seq: 1,
    timestamp: 100,
    content: 'hello',
    payload: defaultPayload,
    merge_key: null,
    presentation: null,
    run_id: 'run-1',
    ...overrides,
  });
}

function createSealedAnswerDto(
  messageId: string,
  completionReason: 'terminal' | 'tool_call' | 'interrupted',
): UiMessageDto {
  const common = {
    message_id: messageId,
    content: 'durable sealed answer',
  } as const;
  switch (completionReason) {
    case 'terminal':
      return createMessageDto({
        ...common,
        message_type: 'final_answer',
        payload: {
          answer_id: messageId,
          is_complete: true,
          completion_reason: 'terminal',
          first_token_at: 100,
        },
      });
    case 'tool_call':
      return createMessageDto({
        ...common,
        message_type: 'tool_preamble',
        payload: {
          answer_id: messageId,
          is_complete: true,
          completion_reason: 'tool_call',
          first_token_at: 100,
        },
      });
    case 'interrupted':
      return createMessageDto({
        ...common,
        message_type: 'partial_answer',
        payload: {
          answer_id: messageId,
          is_complete: false,
          completion_reason: 'interrupted',
          first_token_at: 100,
        },
      });
  }
}

function createWindowDto(messages: readonly UiMessageDto[], overrides: Partial<UiMessagesWindowReadyDto> = {}): UiMessagesWindowReadyDto {
  return {
    success: true,
    conversation_id: 'conv-window',
    messages,
    has_more_before: false,
    has_more_after: false,
    revision: 7,
    ...overrides,
    citation_dependencies: overrides.citation_dependencies ?? {},
  };
}

function createApi(responses: {
  tail?: UiMessagesWindowDto | Promise<UiMessagesWindowDto>;
  before?: UiMessagesWindowDto | Promise<UiMessagesWindowDto>;
  after?: UiMessagesWindowDto | Promise<UiMessagesWindowDto>;
  around?: UiMessagesWindowDto | Promise<UiMessagesWindowDto>;
}): MessageWindowApiPort {
  return {
    async readTail() {
      if (!responses.tail) throw new Error('tail response not configured');
      return await responses.tail;
    },
    async readBefore() {
      if (!responses.before) throw new Error('before response not configured');
      return await responses.before;
    },
    async readAfter() {
      if (!responses.after) throw new Error('after response not configured');
      return await responses.after;
    },
    async readAround() {
      if (!responses.around) throw new Error('around response not configured');
      return await responses.around;
    },
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createConversationWindowDto(
  conversationId: string,
  messageId: string,
  content: string,
): UiMessagesWindowReadyDto {
  return createWindowDto([
    createMessageDto({
      message_id: messageId,
      conversation_id: conversationId,
      content,
    }),
  ], {
    conversation_id: conversationId,
  });
}

describe('message-window DTO adapter', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('maps a UI message DTO to ConversationMessage without inventing live-only subrunTrace', () => {
    const dto = createMessageDto({
      message_id: 'tool-event-1',
      message_type: 'tool_calls',
      content: 'search complete',
      payload: {
        tool_call_id: 'call-1',
        tool_name: 'search_knowledge_base',
        status: 'success',
        phase: 'complete',
        started_at: 90,
        completed_at: 100,
        data: {},
        subrun_summary: {
          subrun_ids: ['subrun-1'],
          event_counts: { 'subrun-1': 3 },
        },
      },
      presentation: null,
    });

    const message = mapUiMessageDtoToConversationMessage(dto);

    expect(message).toMatchObject({
      id: 'tool-event-1',
      role: 'assistant',
      type: 'tool_calls',
      content: 'search complete',
      timestamp: 100,
    });
    expect(message.type).toBe('tool_calls');
    if (message.type !== 'tool_calls') throw new Error('Expected mapped tool message');
    expect(message.metadata.tool_call_id).toBe('call-1');
    expect(message.metadata.subrun_summary).toEqual({
      subrun_ids: ['subrun-1'],
      event_counts: { 'subrun-1': 3 },
    });
    expect(message.metadata.subrunTrace).toBeUndefined();
  });

  it('maps a durable history summary through the canonical summary payload', () => {
    const dto = createMessageDto({
      message_id: 'summary-1',
      role: 'system',
      message_type: 'history_summary',
      content: 'durable summary',
      payload: {
        summary: {
          info: {
            originalMessageCount: 8,
            compressedMessageCount: 1,
            compressionRatio: 0.5,
          },
          replacedMessageIds: ['message-1'],
        },
      },
    });

    expect(mapUiMessageDtoToConversationMessage(dto)).toMatchObject({
      id: 'summary-1',
      type: 'history_summary',
      metadata: {
        turn_id: 'turn-1',
        run_id: 'run-1',
        summary: {
          replacedMessageIds: ['message-1'],
          info: { compressionRatio: 0.5 },
        },
      },
    });
  });

  it('把窗口 sidecar 绑定到对应消息，而不是注册到会话级全局状态', () => {
    const dto = createMessageDto({
      message_id: 'answer-with-citation',
      content: 'answer [@Ab3Def]',
    });
    const rows = mapUiMessagesWindowDtoToRows(createWindowDto([dto], {
      citation_dependencies: {
        'answer-with-citation': {
          citations: [{
            sourceType: 'web',
            ref: 'Ab3Def',
            index: 1,
            url: 'https://example.com/source',
            docTitle: 'source',
            snippet: 'snippet',
          }],
          unresolved_refs: [],
        },
      },
    }));

    expect(rows[0]?.message.citationDependencies).toEqual({
      citations: [expect.objectContaining({ ref: 'Ab3Def' })],
      unresolved_refs: [],
    });
  });

  it('在窗口 admission 边界拒绝缺失、残缺或不属于可见消息的引用依赖', () => {
    const message = createMessageDto({
      message_id: 'answer-with-two-citations',
      content: 'answer [@Ab3Def] and [@Gh4Jkm]',
    });
    const citation = {
      sourceType: 'web' as const,
      ref: 'Ab3Def',
      index: 1,
      url: 'https://example.com/source',
      docTitle: 'source',
      snippet: 'snippet',
    };
    const secondCitation = {
      ...citation,
      ref: 'Gh4Jkm',
      index: 2,
      url: 'https://example.com/second',
    };

    expect(() => readUiMessagesWindowDto(createWindowDto([message]))).toThrow(/window DTO contract/);
    expect(() => readUiMessagesWindowDto(createWindowDto([message], {
      citation_dependencies: {
        'answer-with-two-citations': {
          citations: [citation],
          unresolved_refs: [],
        },
      },
    }))).toThrow(/window DTO contract/);
    expect(() => readUiMessagesWindowDto(createWindowDto([createMessageDto()], {
      citation_dependencies: {
        'message-outside-window': {
          citations: [citation],
          unresolved_refs: [],
        },
      },
    }))).toThrow(/window DTO contract/);
    expect(() => readUiMessagesWindowDto(createWindowDto([message], {
      citation_dependencies: {
        'answer-with-two-citations': {
          citations: [secondCitation, citation],
          unresolved_refs: [],
        },
      },
    }))).toThrow(/window DTO contract/);

    expect(readUiMessagesWindowDto(createWindowDto([message], {
      citation_dependencies: {
        'answer-with-two-citations': {
          citations: [citation],
          unresolved_refs: ['Gh4Jkm'],
        },
      },
    }))).toMatchObject({ success: true });
  });

  it('accepts valid durable attachments and rejects draft refs at the window boundary', () => {
    const valid = createWindowDto([createMessageDto({
      role: 'user',
      message_type: 'user_input',
      attachments: [{
        id: 'attachment-guard',
        kind: 'image',
        assetId: 'asset-guard',
        mediaType: 'image/png',
        byteLength: 128,
        width: 16,
        height: 8,
        sha256: 'a'.repeat(64),
      }],
    })]);
    expect(readUiMessagesWindowDto(valid)).toBe(valid);

    const invalid: unknown = {
      ...valid,
      messages: [{
        ...valid.messages[0],
        attachments: [{ draftId: 'draft-must-not-leak', kind: 'image' }],
      }],
    };
    expect(() => readUiMessagesWindowDto(invalid)).toThrow(/window DTO contract/);
  });

  it('拒绝非法 role/type 组合及不属于 timeline 的本地 presentation 类型', () => {
    const ready = createWindowDto([createMessageDto()]);
    const invalidRolePair: unknown = {
      ...ready,
      messages: [{
        ...ready.messages[0],
        role: 'user',
        message_type: 'tool_calls',
      }],
    };
    const localCardEntity: unknown = {
      ...ready,
      messages: [{
        ...ready.messages[0],
        role: 'system',
        message_type: 'ui_card',
      }],
    };
    const standaloneToolOutput: unknown = {
      ...ready,
      messages: [{
        ...ready.messages[0],
        role: 'tool',
        message_type: 'tool_output',
      }],
    };

    expect(() => readUiMessagesWindowDto(invalidRolePair)).toThrow(/window DTO contract/);
    expect(() => readUiMessagesWindowDto(localCardEntity)).toThrow(/window DTO contract/);
    expect(() => readUiMessagesWindowDto(standaloneToolOutput)).toThrow(/window DTO contract/);
  });

  it('maps user payload directly to one metadata layer', () => {
    const dto = createMessageDto({
      message_id: 'user-event-1',
      role: 'user',
      message_type: 'user_input',
      content: 'question',
      attachments: [{
        id: 'attachment-window',
        kind: 'image',
        assetId: 'asset-window',
        mediaType: 'image/webp',
        byteLength: 256,
        width: 32,
        height: 24,
        sha256: 'b'.repeat(64),
        label: '窗口图片',
      }],
      payload: {
        user_quote: {
          items: [{
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'platform',
            kind: 'text-selection',
            text: 'quoted text',
          }],
        },
        activity: { runId: 'activity-1', feature: 'message-window' },
        context_usage: {
          budget_model_id: 'primary-model',
          used_tokens: 900,
          components: {
            system_prompt_tokens: 200,
            conversation_tokens: 600,
            tool_definition_tokens: 100,
          },
          input_budget_tokens: 1_000,
          remaining_tokens: 100,
          output_limit_tokens: 200,
          source: 'provider-preflight-count',
          confidence: 'provider-estimate',
        },
      },
    });

    const message = mapUiMessageDtoToConversationMessage(dto);
    expect(message.type).toBe('user_input');
    if (message.type !== 'user_input') throw new Error('Expected mapped user message');

    expect(message.metadata?.user_quote).toEqual({
      items: [{
        quote_id: 'reference-11111111111111111111111111111111',
        plugin_id: 'platform',
        kind: 'text-selection',
        text: 'quoted text',
      }],
    });
    expect(message.metadata?.activity).toEqual({
      runId: 'activity-1',
      feature: 'message-window',
    });
    expect(message.metadata?.context_usage).toEqual({
      budget_model_id: 'primary-model',
      used_tokens: 900,
      components: {
        system_prompt_tokens: 200,
        conversation_tokens: 600,
        tool_definition_tokens: 100,
      },
      input_budget_tokens: 1_000,
      remaining_tokens: 100,
      output_limit_tokens: 200,
      source: 'provider-preflight-count',
      confidence: 'provider-estimate',
    });
    expect(message.metadata).not.toHaveProperty('metadata');
    expect(message.attachments).toEqual(dto.attachments);
  });

  it('merges window and live revisions by their shared canonical message id', () => {
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({
        message_id: 'event-tool-1',
        message_type: 'tool_calls',
        sort_seq: 10,
        payload: {
          tool_call_id: 'call-1',
          tool_name: 'workspace_read',
          status: 'loading',
          phase: 'start',
          started_at: 100,
        },
      }),
    ]));
    const liveMessage: ToolCallMessage = {
      id: 'event-tool-1',
      role: 'assistant',
      type: 'tool_calls',
      content: 'live content',
      timestamp: 200,
      metadata: {
        tool_call_id: 'call-1',
        tool_name: 'workspace_read',
        status: 'success',
        phase: 'complete',
        started_at: 100,
        completed_at: 200,
        turn_id: 'turn-1',
        run_id: 'run-1',
      },
    };

    const merged = mergeWindowAndLiveMessages(windowRows, [liveMessage]);

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]?.id).toBe('event-tool-1');
    expect(merged.messages[0]?.content).toBe('live content');
    expect(merged.messages[0]?.type).toBe('tool_calls');
    if (merged.messages[0]?.type !== 'tool_calls') throw new Error('Expected merged tool message');
    expect(merged.messages[0].metadata.status).toBe('success');
  });

  it('preserves questionnaire args and response when a live tool_output patches a window message', () => {
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({
        message_id: 'event-questionnaire',
        message_type: 'tool_calls',
        sort_seq: 10,
        payload: {
          tool_call_id: 'call-questionnaire',
          tool_name: 'ask',
          status: 'loading',
          phase: 'start',
          started_at: 100,
          args: {
            questions: [{ id: 'audience', prompt: 'Who is the audience?' }],
          },
          interaction: {
            status: 'active',
            interactionId: 'interaction-questionnaire',
            runId: 'run-1',
            checkpointRevision: 1,
            resumeToken: 'resume-questionnaire',
          },
        },
      }),
    ]));
    const liveMessage: ToolCallMessage = {
      id: 'event-questionnaire',
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 200,
      metadata: {
        tool_call_id: 'call-questionnaire',
        tool_name: 'ask',
        status: 'success',
        phase: 'complete',
        started_at: 100,
        completed_at: 200,
        turn_id: 'turn-1',
        run_id: 'run-1',
        data: {
          answers: [{ questionId: 'audience', value: 'Engineering leaders' }],
        },
        interaction: {
          status: 'submitted',
          response: {
            answers: [{ questionId: 'audience', value: 'Engineering leaders' }],
          },
        },
      },
    };

    const merged = mergeWindowAndLiveMessages(windowRows, [liveMessage]);
    const questionnaire = merged.messages[0];

    expect(questionnaire?.id).toBe('event-questionnaire');
    expect(questionnaire?.type).toBe('tool_calls');
    if (questionnaire?.type !== 'tool_calls') throw new Error('Expected merged questionnaire tool');
    expect(questionnaire.metadata.args).toEqual({
      questions: [{ id: 'audience', prompt: 'Who is the audience?' }],
    });
    expect(questionnaire.metadata.interaction).toEqual(liveMessage.metadata.interaction);
    expect(questionnaire.metadata.data).toEqual(liveMessage.metadata.data);
    expect(questionnaire.metadata.status).toBe('success');
  });

  it('keeps durable terminal tool lifecycle over stale live loading while preserving live subrun trace', () => {
    const messageId = conversationMessageIdFromToolIdentity('run-1', 'call-subagent');
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({
        message_id: messageId,
        message_type: 'tool_calls',
        sort_seq: 10,
        timestamp: 300,
        content: 'subagent completed',
        merge_key: messageId,
        payload: {
          tool_call_id: 'call-subagent',
          tool_name: 'subagent',
          status: 'success',
          phase: 'complete',
          started_at: 100,
          completed_at: 300,
          data: { subrun_ids: ['subrun-1'] },
        },
      }),
    ]));
    const liveMessage: ToolCallMessage = {
      id: messageId,
      role: 'assistant',
      type: 'tool_calls',
      content: 'subagent running',
      timestamp: 200,
      metadata: {
        tool_call_id: 'call-subagent',
        tool_name: 'subagent',
        status: 'loading',
        phase: 'update',
        started_at: 100,
        turn_id: 'turn-1',
        run_id: 'run-1',
        subrunTrace: {
          'subrun-1': [{ kind: 'thought_delta', delta: 'working' }],
        },
        subrunTraceVersion: 4,
      },
    };

    const merged = mergeWindowAndLiveMessages(windowRows, [liveMessage]);

    expect(merged.messages).toHaveLength(1);
    const tool = merged.messages[0];
    if (tool?.type !== 'tool_calls') throw new Error('Expected merged tool message');
    expect(tool).toMatchObject({
      id: messageId,
      content: 'subagent completed',
      timestamp: 300,
      metadata: {
        status: 'success',
        phase: 'complete',
        completed_at: 300,
        data: { subrun_ids: ['subrun-1'] },
        subrunTraceVersion: 4,
      },
    });
    expect(tool.metadata.subrunTrace).toEqual(liveMessage.metadata.subrunTrace);
  });

  it('does not append live-only tail messages when the window tail is not the conversation tail', () => {
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1, content: 'window' }),
    ]));
    const liveMessage = createTestAnswerMessage({
      id: 'live-only',
      content: 'live tail',
      timestamp: 200,
    });

    const merged = mergeWindowAndLiveMessages(windowRows, [liveMessage], { hasMoreAfter: true });

    expect(merged.messages.map(message => message.id)).toEqual(['m1']);
  });

  it('keeps selector merge total while reporting a window/live identity conflict', () => {
    const messageId = 'conflicting-message';
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({ message_id: messageId, content: 'durable answer' }),
    ]));
    const liveMessage = createTestUserMessage({
      id: messageId,
      content: 'invalid live user message',
    });

    const merged = mergeWindowAndLiveMessages(windowRows, [liveMessage]);

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      id: messageId,
      type: 'final_answer',
      content: 'durable answer',
    });
    expect(merged.conflicts).toEqual([{
      kind: 'message_type',
      messageId,
      windowType: 'final_answer',
      liveType: 'user_input',
    }]);
  });

  it.each([
    {
      label: 'terminal answer',
      messageType: 'final_answer' as const,
      isComplete: true,
      completionReason: 'terminal' as const,
    },
    {
      label: 'tool preamble',
      messageType: 'tool_preamble' as const,
      isComplete: true,
      completionReason: 'tool_call' as const,
    },
    {
      label: 'interrupted partial answer',
      messageType: 'partial_answer' as const,
      isComplete: false,
      completionReason: 'interrupted' as const,
    },
  ])('keeps durable sealed $label over a stale unsealed live answer', ({
    messageType,
    isComplete,
    completionReason,
  }) => {
    const messageId = `sealed-${completionReason}`;
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createSealedAnswerDto(messageId, completionReason),
    ]));
    const staleLiveAnswer = createTestAnswerMessage({
      id: messageId,
      type: 'final_answer',
      content: 'stale live prefix',
      timestamp: 200,
      metadata: { is_complete: false },
    });

    const merged = mergeWindowAndLiveMessages(windowRows, [staleLiveAnswer]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.messages[0]).toMatchObject({
      id: messageId,
      type: messageType,
      content: 'durable sealed answer',
      metadata: {
        is_complete: isComplete,
        completion_reason: completionReason,
      },
    });
  });

  it('allows identical sealed answer facts from window and live sources', () => {
    const messageId = 'identical-sealed-answer';
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({ message_id: messageId, content: 'same terminal answer' }),
    ]));
    const liveAnswer = createTestAnswerMessage({
      id: messageId,
      content: 'same terminal answer',
      timestamp: 200,
    });

    const merged = mergeWindowAndLiveMessages(windowRows, [liveAnswer]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.messages[0]).toMatchObject({
      id: messageId,
      type: 'final_answer',
      content: 'same terminal answer',
      timestamp: 200,
    });
  });

  it('同一 sealed answer 合并时保留 Host materialize 的权威引用闭包', () => {
    const messageId = 'identical-sealed-answer-with-citation';
    const content = 'same terminal answer [@Ab3Def]';
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({ message_id: messageId, content }),
    ], {
      citation_dependencies: {
        [messageId]: {
          citations: [{
            sourceType: 'web',
            ref: 'Ab3Def',
            index: 1,
            url: 'https://example.com/durable-source',
            docTitle: 'durable source',
            snippet: 'durable snippet',
          }],
          unresolved_refs: [],
        },
      },
    }));
    const liveAnswer = {
      ...createTestAnswerMessage({ id: messageId, content, timestamp: 200 }),
      citationDependencies: {
        citations: [],
        unresolved_refs: ['Ab3Def'],
      },
    };

    const merged = mergeWindowAndLiveMessages(windowRows, [liveAnswer]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.messages[0]?.citationDependencies).toEqual({
      citations: [expect.objectContaining({
        ref: 'Ab3Def',
        url: 'https://example.com/durable-source',
      })],
      unresolved_refs: [],
    });
  });

  it('completed thought 的 durable 正文与引用闭包作为同一 snapshot 合并', () => {
    const messageId = 'completed-thought-with-citation';
    const durableContent = 'durable thought [@Ab3Def]';
    const windowRows = mapUiMessagesWindowDtoToRows(createWindowDto([
      createMessageDto({
        message_id: messageId,
        message_type: 'thought',
        content: durableContent,
        payload: {
          is_complete: true,
          thought_started_at: 90,
          thought_completed_at: 100,
        },
      }),
    ], {
      citation_dependencies: {
        [messageId]: {
          citations: [{
            sourceType: 'web',
            ref: 'Ab3Def',
            index: 1,
            url: 'https://example.com/durable-thought-source',
            docTitle: 'durable thought source',
            snippet: 'durable thought snippet',
          }],
          unresolved_refs: [],
        },
      },
    }));
    const liveThought = {
      ...createTestThoughtMessage({
        id: messageId,
        content: 'different completed live thought [@Gh4Jkm]',
        timestamp: 200,
      }),
      citationDependencies: {
        citations: [],
        unresolved_refs: ['Gh4Jkm'],
      },
    };

    const merged = mergeWindowAndLiveMessages(windowRows, [liveThought]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.messages[0]).toMatchObject({
      content: durableContent,
      citationDependencies: {
        citations: [expect.objectContaining({ ref: 'Ab3Def' })],
        unresolved_refs: [],
      },
    });
  });

  it('rejects different content for one sealed answer identity while keeping selector merge total', async () => {
    const messageId = 'divergent-sealed-answer';
    const dto = createWindowDto([
      createMessageDto({ message_id: messageId, content: 'durable terminal answer' }),
    ]);
    const windowRows = mapUiMessagesWindowDtoToRows(dto);
    const liveAnswer = createTestAnswerMessage({
      id: messageId,
      content: 'different live terminal answer',
      timestamp: 200,
    });

    const merged = mergeWindowAndLiveMessages(windowRows, [liveAnswer]);

    expect(merged.messages[0]).toMatchObject({
      id: messageId,
      content: 'durable terminal answer',
    });
    expect(merged.conflicts).toEqual([{
      kind: 'answer_seal',
      messageId,
      windowType: 'final_answer',
      liveType: 'final_answer',
      windowCompletionReason: 'terminal',
      liveCompletionReason: 'terminal',
      contentMismatch: true,
    }]);

    const store = useMessageWindowStore();
    await expect(loadTail('conv-window', {}, {
      store,
      api: createApi({ tail: dto }),
      readLiveMessages: () => [liveAnswer],
    })).rejects.toThrow(
      `Conversation answer ${messageId} has conflicting sealed facts across window/live sources: completion_reason=terminal -> terminal, content=different`,
    );
    expect(store.status).toBe('error');
    expect(store.rows).toEqual([]);
  });

  it('rejects one answer identity sealed as interrupted and terminal before the window enters the store', async () => {
    const store = useMessageWindowStore();
    const messageId = 'conflicting-answer-seal';
    const dto = createWindowDto([
      createMessageDto({
        message_id: messageId,
        message_type: 'partial_answer',
        content: 'interrupted answer',
        payload: {
          answer_id: messageId,
          is_complete: false,
          completion_reason: 'interrupted',
          first_token_at: 100,
        },
      }),
    ]);

    await expect(loadTail('conv-window', {}, {
      store,
      api: createApi({ tail: dto }),
      readLiveMessages: () => [createTestAnswerMessage({
        id: messageId,
        content: 'terminal answer',
      })],
    })).rejects.toThrow(
      `Conversation answer ${messageId} has conflicting sealed facts across window/live sources: completion_reason=interrupted -> terminal, content=different`,
    );

    expect(store.status).toBe('error');
    expect(store.rows).toEqual([]);
  });

  it('rejects a conflicting durable window before it enters the store', async () => {
    const store = useMessageWindowStore();
    const messageId = 'conflicting-window-message';
    const dto = createWindowDto([
      createMessageDto({ message_id: messageId, content: 'durable answer' }),
    ]);

    await expect(loadTail('conv-window', {}, {
      store,
      api: createApi({ tail: dto }),
      readLiveMessages: () => [createTestUserMessage({ id: messageId })],
    })).rejects.toThrow(
      `Conversation message ${messageId} changed type across window/live sources: final_answer -> user_input`,
    );

    expect(store.status).toBe('error');
    expect(store.rows).toEqual([]);
  });

  it('prepends loadBefore rows in sort_seq order without writing to conversation.messages', async () => {
    const store = useMessageWindowStore();
    const tailDto = createWindowDto([
      createMessageDto({ message_id: 'm3', sort_seq: 3, content: 'third' }),
      createMessageDto({ message_id: 'm4', sort_seq: 4, content: 'fourth' }),
    ], {
      has_more_before: true,
      prev_cursor: 3,
      next_cursor: 4,
    });
    const beforeDto = createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1, content: 'first' }),
      createMessageDto({ message_id: 'm2', sort_seq: 2, content: 'second' }),
    ], {
      has_more_before: false,
      has_more_after: true,
      prev_cursor: 1,
      next_cursor: 2,
      revision: 7,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(tailDto, mapUiMessagesWindowDtoToRows(tailDto)));

    await loadBefore('conv-window', 3, { limit: 2 }, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ before: beforeDto }),
    });

    expect(store.status).toBe('ready');
    expect(store.rows.map(row => row.messageId)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(store.prevCursor).toBe(1);
    expect(store.nextCursor).toBe(4);
    expect(store.revision).toBe(7);
  });

  it('reports whether loadAround replaced the window or found a preparing read model', async () => {
    const store = useMessageWindowStore();
    const aroundDto = createWindowDto([
      createMessageDto({ message_id: 'target', sort_seq: 42, content: 'target' }),
    ]);

    await expect(loadAround('conv-window', 'target', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ around: aroundDto }),
    })).resolves.toBe('replaced');
    expect(store.rows.map(row => row.messageId)).toEqual(['target']);

    await expect(loadAround('conv-window', 'target', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        around: {
          success: false,
          status: 'preparing',
          conversation_id: 'conv-window',
        },
      }),
    })).resolves.toBe('preparing');
    expect(store.status).toBe('preparing');
  });

  it('reloads tail instead of prepending when the before window revision is stale', async () => {
    const store = useMessageWindowStore();
    const tailDto = createWindowDto([
      createMessageDto({ message_id: 'm3', sort_seq: 3, content: 'third' }),
      createMessageDto({ message_id: 'm4', sort_seq: 4, content: 'fourth' }),
    ], {
      has_more_before: true,
      prev_cursor: 3,
      next_cursor: 4,
      revision: 7,
    });
    const staleBeforeDto = createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1, content: 'first' }),
      createMessageDto({ message_id: 'm2', sort_seq: 2, content: 'second' }),
    ], {
      has_more_before: false,
      prev_cursor: 1,
      revision: 8,
    });
    const refreshedTailDto = createWindowDto([
      createMessageDto({ message_id: 'm5', sort_seq: 5, content: 'refreshed tail' }),
    ], {
      has_more_before: true,
      prev_cursor: 5,
      next_cursor: 5,
      revision: 8,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(tailDto, mapUiMessagesWindowDtoToRows(tailDto)));

    const result = await loadBefore('conv-window', 3, { limit: 2 }, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        before: staleBeforeDto,
        tail: refreshedTailDto,
      }),
    });

    expect(result).toBe('replaced');
    expect(store.rows.map(row => row.messageId)).toEqual(['m5']);
    expect(store.prevCursor).toBe(5);
    expect(store.revision).toBe(8);
  });

  it('caps prepended windows and exposes the retained tail as the next cursor', async () => {
    const store = useMessageWindowStore();
    const tailStart = 101;
    const tailDto = createWindowDto(
      Array.from({ length: WINDOW_MAX_ROWS }, (_, index) => (
        createMessageDto({
          message_id: `m${tailStart + index}`,
          sort_seq: tailStart + index,
          content: `message ${tailStart + index}`,
        })
      )),
      {
        has_more_before: true,
        prev_cursor: tailStart,
        next_cursor: tailStart + WINDOW_MAX_ROWS - 1,
      },
    );
    const beforeDto = createWindowDto([
      createMessageDto({ message_id: 'm100', sort_seq: 100, content: 'message 100' }),
    ], {
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 100,
      next_cursor: 100,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(tailDto, mapUiMessagesWindowDtoToRows(tailDto)));

    await loadBefore('conv-window', tailStart, { limit: 1 }, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ before: beforeDto }),
    });

    expect(store.rows).toHaveLength(WINDOW_MAX_ROWS);
    expect(store.rows[0]?.messageId).toBe('m100');
    expect(store.rows[WINDOW_MAX_ROWS - 1]?.messageId).toBe(`m${tailStart + WINDOW_MAX_ROWS - 2}`);
    expect(store.hasMoreAfter).toBe(true);
    expect(store.nextCursor).toBe(tailStart + WINDOW_MAX_ROWS - 2);
  });

  it('appends loadAfter rows and trims the head while keeping the window capped', async () => {
    const store = useMessageWindowStore();
    const tailDto = createWindowDto(
      Array.from({ length: WINDOW_MAX_ROWS }, (_, index) => (
        createMessageDto({
          message_id: `m${index + 1}`,
          sort_seq: index + 1,
          content: `message ${index + 1}`,
        })
      )),
      {
        has_more_before: false,
        has_more_after: true,
        prev_cursor: 1,
        next_cursor: WINDOW_MAX_ROWS,
      },
    );
    const afterDto = createWindowDto([
      createMessageDto({ message_id: `m${WINDOW_MAX_ROWS + 1}`, sort_seq: WINDOW_MAX_ROWS + 1 }),
    ], {
      has_more_before: true,
      has_more_after: true,
      prev_cursor: WINDOW_MAX_ROWS + 1,
      next_cursor: WINDOW_MAX_ROWS + 1,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(tailDto, mapUiMessagesWindowDtoToRows(tailDto)));

    const result = await loadAfter('conv-window', WINDOW_MAX_ROWS, { limit: 1 }, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ after: afterDto }),
    });

    expect(result).toBe('appended');
    expect(store.rows).toHaveLength(WINDOW_MAX_ROWS);
    expect(store.rows[0]?.messageId).toBe('m2');
    expect(store.rows[WINDOW_MAX_ROWS - 1]?.messageId).toBe(`m${WINDOW_MAX_ROWS + 1}`);
    expect(store.hasMoreBefore).toBe(true);
    expect(store.prevCursor).toBe(2);
    expect(store.nextCursor).toBe(WINDOW_MAX_ROWS + 1);
  });

  it('keeps the edited middle row, updates its content, and marks it as conversation tail', () => {
    const store = useMessageWindowStore();
    const dto = createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1 }),
      createMessageDto({ message_id: 'm2', sort_seq: 2, content: 'old prompt' }),
      createMessageDto({ message_id: 'm3', sort_seq: 3 }),
    ], {
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 1,
      next_cursor: 3,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(dto, mapUiMessagesWindowDtoToRows(dto)));

    store.truncateAfterMessage('m2', { content: 'new prompt' });

    expect(store.rows.map(row => row.messageId)).toEqual(['m1', 'm2']);
    expect(store.rows[1]?.message.content).toBe('new prompt');
    expect(store.rows[1]?.dto.content).toBe('new prompt');
    expect(store.hasMoreBefore).toBe(true);
    expect(store.prevCursor).toBe(1);
    expect(store.hasMoreAfter).toBe(false);
    expect(store.nextCursor).toBeUndefined();
  });

  it('replace ack 同步替换窗口消息的 durable 附件', () => {
    const store = useMessageWindowStore();
    const dto = createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1 }),
      createMessageDto({ message_id: 'm2', sort_seq: 2, content: 'old prompt' }),
      createMessageDto({ message_id: 'm3', sort_seq: 3 }),
    ]);
    store.replaceWithSnapshot(createMessageWindowSnapshot(dto, mapUiMessagesWindowDtoToRows(dto)));
    const replacement: BaseMessage = {
      id: 'm2',
      role: 'user',
      type: 'user_input',
      content: '',
      timestamp: 20,
      attachments: [{
        id: 'attachment-replaced',
        kind: 'image',
        assetId: 'asset-replaced',
        mediaType: 'image/png',
        byteLength: 4,
        width: 2,
        height: 2,
        sha256: 'a'.repeat(64),
      }],
    };

    store.truncateAfterMessage('m2', { replacement });

    expect(store.rows.map(row => row.messageId)).toEqual(['m1', 'm2']);
    expect(store.rows[1]?.message).toEqual(replacement);
    expect(store.rows[1]?.dto).toMatchObject({
      content: '',
      timestamp: 20,
      attachments: replacement.attachments,
    });
  });

  it('keeps the first edited row while preserving the before cursor when older history exists', () => {
    const store = useMessageWindowStore();
    const dto = createWindowDto([
      createMessageDto({ message_id: 'm2', sort_seq: 2, content: 'old prompt' }),
      createMessageDto({ message_id: 'm3', sort_seq: 3 }),
    ], {
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 2,
      next_cursor: 3,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(dto, mapUiMessagesWindowDtoToRows(dto)));

    store.truncateAfterMessage('m2', { content: 'new prompt' });

    expect(store.rows.map(row => row.messageId)).toEqual(['m2']);
    expect(store.rows[0]?.message.content).toBe('new prompt');
    expect(store.hasMoreBefore).toBe(true);
    expect(store.prevCursor).toBe(2);
    expect(store.hasMoreAfter).toBe(false);
    expect(store.nextCursor).toBeUndefined();
  });

  it('ignores truncate requests for messages outside the current window', () => {
    const store = useMessageWindowStore();
    const dto = createWindowDto([
      createMessageDto({ message_id: 'm1', sort_seq: 1 }),
      createMessageDto({ message_id: 'm2', sort_seq: 2 }),
    ], {
      has_more_before: false,
      has_more_after: true,
      next_cursor: 2,
    });
    store.replaceWithSnapshot(createMessageWindowSnapshot(dto, mapUiMessagesWindowDtoToRows(dto)));

    store.truncateAfterMessage('missing');

    expect(store.rows.map(row => row.messageId)).toEqual(['m1', 'm2']);
    expect(store.hasMoreAfter).toBe(true);
    expect(store.nextCursor).toBe(2);
  });

  it('maps 409 preparing to a distinct store state', async () => {
    const store = useMessageWindowStore();

    await loadTail('conv-window', { limit: 80 }, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        tail: {
          success: false,
          status: 'preparing',
          conversation_id: 'conv-window',
        },
      }),
    });

    expect(store.status).toBe('preparing');
    expect(store.conversationId).toBe('conv-window');
    expect(store.rows).toEqual([]);
  });

  it('keeps the latest conversation window when an older tail response arrives late', async () => {
    const store = useMessageWindowStore();
    const firstResponse = createDeferred<UiMessagesWindowDto>();
    const firstLoad = loadTail('conversation-a', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ tail: firstResponse.promise }),
    });

    await loadTail('conversation-b', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        tail: createConversationWindowDto('conversation-b', 'message-b', 'new conversation'),
      }),
    });
    firstResponse.resolve(createConversationWindowDto('conversation-a', 'message-a', 'stale conversation'));
    await firstLoad;

    expect(store.conversationId).toBe('conversation-b');
    expect(store.status).toBe('ready');
    expect(store.rows.map(row => row.messageId)).toEqual(['message-b']);
  });

  it('does not let an older request error replace the latest ready window', async () => {
    const store = useMessageWindowStore();
    const firstResponse = createDeferred<UiMessagesWindowDto>();
    const firstLoad = loadTail('conversation-a', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ tail: firstResponse.promise }),
    });

    await loadTail('conversation-b', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        tail: createConversationWindowDto('conversation-b', 'message-b', 'new conversation'),
      }),
    });
    firstResponse.reject(new Error('stale request failed'));
    await expect(firstLoad).rejects.toThrow('stale request failed');

    expect(store.conversationId).toBe('conversation-b');
    expect(store.status).toBe('ready');
    expect(store.error).toBeNull();
    expect(store.rows.map(row => row.messageId)).toEqual(['message-b']);
  });

  it('supersedes an older around request without replacing the newer target', async () => {
    const store = useMessageWindowStore();
    const firstResponse = createDeferred<UiMessagesWindowDto>();
    const firstLoad = loadAround('conv-window', 'target-old', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({ around: firstResponse.promise }),
    });

    await expect(loadAround('conv-window', 'target-new', {}, {
      store,
      readLiveMessages: readNoLiveMessages,
      api: createApi({
        around: createConversationWindowDto('conv-window', 'target-new', 'new target'),
      }),
    })).resolves.toBe('replaced');
    firstResponse.resolve(createConversationWindowDto('conv-window', 'target-old', 'old target'));

    await expect(firstLoad).resolves.toBe('superseded');
    expect(store.rows.map(row => row.messageId)).toEqual(['target-new']);
  });

  it('clears rows when loading another conversation and rejects cross-conversation snapshots', () => {
    const store = useMessageWindowStore();
    const firstDto = createConversationWindowDto('conversation-a', 'message-a', 'first');
    store.replaceWithSnapshot(createMessageWindowSnapshot(
      firstDto,
      mapUiMessagesWindowDtoToRows(firstDto),
    ));

    const foreignDto = createConversationWindowDto('conversation-b', 'message-b', 'foreign');
    const foreignSnapshot = createMessageWindowSnapshot(
      foreignDto,
      mapUiMessagesWindowDtoToRows(foreignDto),
    );
    expect(() => store.replaceWithSnapshot(foreignSnapshot)).toThrow('rejected snapshot');
    expect(store.conversationId).toBe('conversation-a');
    expect(store.rows.map(row => row.messageId)).toEqual(['message-a']);

    store.startLoading('conversation-b', 'tail');
    expect(store.conversationId).toBe('conversation-b');
    expect(store.status).toBe('loading');
    expect(store.rows).toEqual([]);
    expect(store.revision).toBeNull();
  });
});
