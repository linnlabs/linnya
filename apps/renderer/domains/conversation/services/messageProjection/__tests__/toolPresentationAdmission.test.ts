import { afterEach, describe, expect, it } from 'vitest';
import { ConversationUiMessageSchema } from '@app/schemas';
import {
  createSSEToolCallDecisionEvent,
  createSSEToolOutputEvent,
} from '@linnlabs/linnkit/contracts';
import type { Conversation } from '../../../types';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import {
  registerToolPresentationProjectionPort,
  type ToolPresentationProjectionPort,
} from '../../../ports/toolPresentationProjectionPort';
import { createInitialProjectionState, reduceEvent } from '../index';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

let unregisterPort: (() => void) | undefined;

afterEach(() => {
  unregisterPort?.();
  unregisterPort = undefined;
});

function installPort(port: ToolPresentationProjectionPort): void {
  unregisterPort?.();
  unregisterPort = registerToolPresentationProjectionPort(port);
}

function createConversation(): Conversation {
  return {
    id: 'conv-tool-presentation',
    title: 'Tool presentation admission',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function projectionPort(): ToolPresentationProjectionPort {
  return {
    project(request) {
      return {
        uiKey: request.sourceToolName,
        status: request.status,
        phase: request.phase,
        data: {
          args: request.args,
          result: request.result,
        },
        title: {
          text: {
            key: 'conversation.tool.test.title',
            fallback: 'Test tool',
          },
        },
      };
    },
  };
}

describe('tool presentation admission', () => {
  it('live 与 reload 都保留工具业务错误码', () => {
    installPort(projectionPort());
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-error-decision',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'generate_image',
      'call-error-tool',
      'start',
      'loading',
      { ...PROJECTION_TEST_SCOPE, args: {}, payload: { args: {} } },
    );
    const output = createSSEToolOutputEvent(
      'evt-error-output',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'generate_image',
      'call-error-tool',
      {
        status: 'error',
        observation: '尚未配置图片生成模型，请提醒用户配置。',
        error: '尚未配置图片生成模型，请提醒用户配置。',
        error_code: 'image_generation.model_not_configured',
      },
      PROJECTION_TEST_SCOPE,
    );

    expect(reduceEvent(state, decision).success).toBe(true);
    expect(reduceEvent(state, output).success).toBe(true);
    const live = state.conversation.messages[0];
    expect(live?.type).toBe('tool_calls');
    if (!live || live.type !== 'tool_calls') throw new Error('Expected live tool message');
    expect(live.metadata.error_code).toBe('image_generation.model_not_configured');

    const reloaded = mapUiMessageDtoToConversationMessage(ConversationUiMessageSchema.parse({
      message_id: live.id,
      conversation_id: 'conv-tool-presentation',
      turn_id: 'turn-tool-presentation',
      run_id: PROJECTION_TEST_SCOPE.run_id,
      role: 'assistant',
      message_type: 'tool_calls',
      sort_seq: 1,
      timestamp: output.timestamp,
      content: live.content,
      payload: {
        tool_call_id: live.metadata.tool_call_id,
        tool_name: live.metadata.tool_name,
        status: 'error',
        phase: 'error',
        args: {},
        error: live.metadata.error,
        error_code: live.metadata.error_code,
        started_at: live.metadata.started_at,
        completed_at: live.metadata.completed_at,
      },
      merge_key: null,
      presentation: null,
    }));
    expect(reloaded.type).toBe('tool_calls');
    if (reloaded.type !== 'tool_calls') throw new Error('Expected reloaded tool message');
    expect(reloaded.metadata.error_code).toBe('image_generation.model_not_configured');
  });

  it('live 与 reload 在写入各自状态前生成同一份 Renderer-only presentation', () => {
    installPort(projectionPort());
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-tool-decision',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-test-tool',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: { input: 'value' },
        payload: { args: { input: 'value' } },
      },
    );
    const resultPayload = { data: { output: 'done' }, observation: 'done' };
    const runtimeAttachment = {
      id: 'attachment-tool-output-image',
      kind: 'image' as const,
      resourceId: 'asset-tool-output-image',
      mediaType: 'image/png' as const,
      byteLength: 1024,
      width: 320,
      height: 180,
      sha256: 'a'.repeat(64),
      fileName: 'slide-001.png',
    };
    const output = createSSEToolOutputEvent(
      'evt-tool-output',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-test-tool',
      { status: 'success', observation: resultPayload.observation, data: resultPayload.data },
      {
        ...PROJECTION_TEST_SCOPE,
        attachments: [runtimeAttachment],
      },
    );

    expect(reduceEvent(state, decision).success).toBe(true);
    expect(reduceEvent(state, output).success).toBe(true);
    const live = state.conversation.messages[0];
    expect(live?.type).toBe('tool_calls');
    if (!live || live.type !== 'tool_calls') throw new Error('Expected live tool message');

    const dto = ConversationUiMessageSchema.parse({
      message_id: live.id,
      conversation_id: 'conv-tool-presentation',
      turn_id: 'turn-tool-presentation',
      run_id: PROJECTION_TEST_SCOPE.run_id,
      role: 'assistant',
      message_type: 'tool_calls',
      sort_seq: 1,
      timestamp: output.timestamp,
      content: live.content,
      attachments: [
        {
          id: runtimeAttachment.id,
          kind: runtimeAttachment.kind,
          assetId: runtimeAttachment.resourceId,
          mediaType: runtimeAttachment.mediaType,
          byteLength: runtimeAttachment.byteLength,
          width: runtimeAttachment.width,
          height: runtimeAttachment.height,
          sha256: runtimeAttachment.sha256,
          fileName: runtimeAttachment.fileName,
        },
      ],
      payload: {
        tool_call_id: live.metadata.tool_call_id,
        tool_name: live.metadata.tool_name,
        status: live.metadata.status,
        phase: live.metadata.phase,
        args: live.metadata.args,
        data: live.metadata.data,
        error: live.metadata.error,
        presentation: live.metadata.presentation,
        started_at: live.metadata.started_at,
        completed_at: live.metadata.completed_at,
      },
      merge_key: null,
      presentation: null,
    });
    const reloaded = mapUiMessageDtoToConversationMessage(dto);
    expect(reloaded.type).toBe('tool_calls');
    if (reloaded.type !== 'tool_calls') throw new Error('Expected reloaded tool message');

    expect(live.toolPresentation).toEqual(reloaded.toolPresentation);
    expect(live.attachments).toEqual(reloaded.attachments);
    expect(reloaded.attachments?.[0]).toMatchObject({
      assetId: 'asset-tool-output-image',
      fileName: 'slide-001.png',
    });
    expect(reloaded.toolPresentation).toMatchObject({
      uiKey: 'test_tool',
      status: 'success',
      phase: 'complete',
      data: {
        args: { input: 'value' },
        result: resultPayload,
      },
    });
  });

  it('projector 失败时不创建新的 tool message 或 toolState', () => {
    installPort({
      project() {
        throw new Error('invalid tool presentation');
      },
    });
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-invalid-tool-decision',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-invalid-tool',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: { input: 'invalid' },
        payload: { args: { input: 'invalid' } },
      },
    );

    const result = reduceEvent(state, decision);
    expect(result).toMatchObject({ success: false, reason: 'invalid tool presentation' });
    expect(state.conversation.messages).toEqual([]);
    expect(state.runStates.get(PROJECTION_TEST_SCOPE.run_id)?.toolState.size).toBe(0);
    expect(state.processedEvents.has(decision.id)).toBe(false);
  });

  it('batched decision 中任一 projector 失败时整批不提交', () => {
    installPort({
      project(request) {
        if (request.sourceToolName === 'invalid_tool') {
          throw new Error('invalid secondary tool presentation');
        }
        return {
          uiKey: request.sourceToolName,
          status: request.status,
          phase: request.phase,
          data: { args: request.args },
        };
      },
    });
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-batched-invalid-tool-decision',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-valid-primary',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: { input: 'primary' },
        payload: {
          args: { input: 'primary' },
          tool_calls: [
            {
              id: 'call-valid-primary',
              type: 'function',
              function: {
                name: 'test_tool',
                arguments: JSON.stringify({ input: 'primary' }),
              },
            },
            {
              id: 'call-invalid-secondary',
              type: 'function',
              function: {
                name: 'invalid_tool',
                arguments: JSON.stringify({ input: 'secondary' }),
              },
            },
          ],
        },
      },
    );

    expect(reduceEvent(state, decision)).toMatchObject({
      success: false,
      reason: 'invalid secondary tool presentation',
    });
    expect(state.conversation.messages).toEqual([]);
    const runState = state.runStates.get(PROJECTION_TEST_SCOPE.run_id);
    expect(runState?.toolState.size).toBe(0);
    expect(runState?.executionStates.get(PROJECTION_TEST_SCOPE.execution_id)?.turnState.size).toBe(0);
    expect(state.processedEvents.has(decision.id)).toBe(false);
  });

  it('projector 失败时保留既有 tool message 的完整快照', () => {
    installPort(projectionPort());
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-existing-tool-decision',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-existing-tool',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: { input: 'original' },
        payload: { args: { input: 'original' } },
      },
    );
    expect(reduceEvent(state, decision).success).toBe(true);
    const before = state.conversation.messages[0];

    installPort({
      project() {
        throw new Error('invalid success payload');
      },
    });
    const output = createSSEToolOutputEvent(
      'evt-invalid-existing-tool-output',
      'conv-tool-presentation',
      'turn-tool-presentation',
      'test_tool',
      'call-existing-tool',
      { status: 'success', observation: 'invalid', data: { invalid: true } },
      {
        ...PROJECTION_TEST_SCOPE,
      },
    );

    expect(reduceEvent(state, output)).toMatchObject({
      success: false,
      reason: 'invalid success payload',
    });
    expect(state.conversation.messages[0]).toBe(before);
    expect(state.conversation.messages[0]).toMatchObject({
      content: '',
      metadata: {
        status: 'loading',
        phase: 'start',
        args: { input: 'original' },
      },
    });
    expect(state.processedEvents.has(output.id)).toBe(false);
  });

  it('citation admission 失败时不得提交 success patch', () => {
    installPort(projectionPort());
    const state = createInitialProjectionState(createConversation());
    const decision = createSSEToolCallDecisionEvent(
      'evt-web-search-decision',
      'conv-tool-presentation',
      'turn-web-search',
      'web_search',
      'call-web-search',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: { query: 'strict citation admission' },
        payload: { args: { query: 'strict citation admission' } },
      },
    );
    expect(reduceEvent(state, decision).success).toBe(true);
    const before = state.conversation.messages[0];

    const invalidResult = {
      data: {
        query: 'strict citation admission',
        citations: { query: 'strict citation admission', searchMode: 'web', citations: [] },
      },
      observation: 'Incomplete web search result.',
    };
    const output = createSSEToolOutputEvent(
      'evt-web-search-invalid-output',
      'conv-tool-presentation',
      'turn-web-search',
      'web_search',
      'call-web-search',
      {
        status: 'success',
        observation: invalidResult.observation,
        data: invalidResult.data,
      },
      {
        ...PROJECTION_TEST_SCOPE,
      },
    );

    const result = reduceEvent(state, output);
    expect(result.success).toBe(false);
    expect(result.reason).toContain(
      '[CitationAdmission] tool_name=web_search 的结果不符合正式合同',
    );
    expect(state.conversation.messages[0]).toBe(before);
    expect(state.conversation.messages[0]).toMatchObject({
      metadata: { status: 'loading', phase: 'start' },
    });
    expect(state.processedEvents.has(output.id)).toBe(false);
  });
});
