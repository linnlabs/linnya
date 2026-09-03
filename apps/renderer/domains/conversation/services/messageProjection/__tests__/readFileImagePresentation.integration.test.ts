import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ConversationUiMessageSchema } from '@app/schemas';
import {
  createSSEToolCallDecisionEvent,
  createSSEToolOutputEvent,
} from '@linnlabs/linnkit/contracts';

import type { Conversation } from '../../../types';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import { registerToolPresentationProjectionPort } from '../../../ports/toolPresentationProjectionPort';
import { createToolPresentationProjectionPort } from '../../../../../app/plugins/orchestration/createToolPresentationProjectionPort';
import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '../../../../../app/plugins/registry';
import { useEnabledPluginsStore } from '../../../../../app/plugins/enabledPluginsStore';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { workspaceReadToolConfigs } from '../../../ui/tools/configs/workspace';
import { createInitialProjectionState, reduceEvent } from '../index';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

let unregisterProjection: (() => void) | undefined;

function createConversation(): Conversation {
  return {
    id: 'conversation-read-file-image',
    title: 'read_file image presentation',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function createImageResult() {
  return {
    data: {
      source_kind: 'conversation_file' as const,
      locator: 'conversation:/slides-renders/run-1/slide-007.png' as const,
      file_name: 'slide-007.png',
      content_type: 'image/png' as const,
      byte_length: 1024,
      width: 1600,
      height: 900,
    },
    observation: '图片已进入模型输入。',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearRendererPluginRegistryForTest();
  registerRendererPlugin({
    meta: {
      id: 'read-file-image-presentation-test',
      name: 'read_file image presentation test',
      version: '1.0.0',
      description: 'Production registry fixture',
      developer: 'Linnya',
      builtin: true,
      required: true,
    },
    toolCards: {
      ...commonToolConfigs,
      ...workspaceReadToolConfigs,
    },
  });
  useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
  unregisterProjection = registerToolPresentationProjectionPort(
    createToolPresentationProjectionPort(),
  );
});

afterEach(() => {
  unregisterProjection?.();
  unregisterProjection = undefined;
  clearRendererPluginRegistryForTest();
});

describe('read_file image presentation integration', () => {
  it('同一 tool_call_id 从 loading 文件卡切换为 success 图片卡，且 reload 复用同一语义与附件', () => {
    const state = createInitialProjectionState(createConversation());
    const args = { locator: 'conversation:/slides-renders/run-1/slide-007.png' };
    const decision = createSSEToolCallDecisionEvent(
      'read-image-decision',
      state.conversation.id,
      'turn-read-image',
      'read_file',
      'call-read-image',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args,
        payload: { args },
      },
    );

    expect(reduceEvent(state, decision).success).toBe(true);
    const loading = state.conversation.messages[0];
    if (!loading || loading.type !== 'tool_calls') throw new Error('Expected loading tool message');
    expect(loading.toolPresentation).toMatchObject({
      uiKey: 'workspace_read_file',
      status: 'loading',
    });

    const imageResult = createImageResult();
    const runtimeAttachment = {
      id: 'attachment-read-image',
      kind: 'image' as const,
      resourceId: 'asset-read-image',
      mediaType: 'image/png' as const,
      byteLength: 1024,
      width: 1600,
      height: 900,
      sha256: 'a'.repeat(64),
      fileName: 'slide-007.png',
    };
    const output = createSSEToolOutputEvent(
      'read-image-output',
      state.conversation.id,
      'turn-read-image',
      'read_file',
      'call-read-image',
      {
        status: 'success',
        observation: imageResult.observation,
        data: imageResult.data,
      },
      {
        ...PROJECTION_TEST_SCOPE,
        attachments: [runtimeAttachment],
      },
    );

    expect(reduceEvent(state, output).success).toBe(true);
    expect(state.conversation.messages).toHaveLength(1);
    const success = state.conversation.messages[0];
    if (!success || success.type !== 'tool_calls') throw new Error('Expected success tool message');
    expect(success.id).toBe(loading.id);
    expect(success.metadata.tool_call_id).toBe(loading.metadata.tool_call_id);
    expect(success.toolPresentation).toMatchObject({
      uiKey: 'image_read',
      status: 'success',
      data: {
        kind: 'image',
        source: 'conversation_file',
        fileName: 'slide-007.png',
      },
      title: { text: { key: 'conversation.tool.imageRead.title' } },
    });
    expect(success.attachments).toMatchObject([{
      assetId: 'asset-read-image',
      fileName: 'slide-007.png',
    }]);
    expect(state.runStates.get(PROJECTION_TEST_SCOPE.run_id)?.toolState.size).toBe(1);

    const dto = ConversationUiMessageSchema.parse({
      message_id: success.id,
      conversation_id: state.conversation.id,
      turn_id: 'turn-read-image',
      run_id: PROJECTION_TEST_SCOPE.run_id,
      role: 'assistant',
      message_type: 'tool_calls',
      sort_seq: 1,
      timestamp: output.timestamp,
      content: success.content,
      attachments: success.attachments,
      payload: {
        tool_call_id: success.metadata.tool_call_id,
        tool_name: success.metadata.tool_name,
        status: success.metadata.status,
        phase: success.metadata.phase,
        args: success.metadata.args,
        data: success.metadata.data,
        started_at: success.metadata.started_at,
        completed_at: success.metadata.completed_at,
      },
      merge_key: null,
      presentation: null,
    });
    const reloaded = mapUiMessageDtoToConversationMessage(dto);
    expect(reloaded.type).toBe('tool_calls');
    if (reloaded.type !== 'tool_calls') throw new Error('Expected reloaded tool message');
    expect(reloaded.toolPresentation).toEqual(success.toolPresentation);
    expect(reloaded.attachments).toEqual(success.attachments);
  });

  it('非法 success 结果在 alias 后由 Workspace projector 拒绝，并保留 loading 快照', () => {
    const state = createInitialProjectionState(createConversation());
    const args = { locator: 'conversation:/slides-renders/run-1/slide-007.png' };
    const decision = createSSEToolCallDecisionEvent(
      'invalid-read-image-decision',
      state.conversation.id,
      'turn-read-image',
      'read_file',
      'call-read-image',
      'start',
      'loading',
      { ...PROJECTION_TEST_SCOPE, args, payload: { args } },
    );
    expect(reduceEvent(state, decision).success).toBe(true);
    const before = state.conversation.messages[0];

    const output = createSSEToolOutputEvent(
      'invalid-read-image-output',
      state.conversation.id,
      'turn-read-image',
      'read_file',
      'call-read-image',
      {
        status: 'success',
        observation: '缺少正式图片事实。',
        data: {
          source_kind: 'conversation_file',
          locator: 'conversation:/slides-renders/run-1/slide-007.png',
          file_name: 'slide-007.png',
          content_type: 'image/png',
        },
      },
      PROJECTION_TEST_SCOPE,
    );

    const result = reduceEvent(state, output);
    expect(result.success).toBe(false);
    expect(state.conversation.messages).toHaveLength(1);
    expect(state.conversation.messages[0]).toBe(before);
    expect(state.conversation.messages[0]).toMatchObject({
      metadata: { status: 'loading', phase: 'start' },
      toolPresentation: { uiKey: 'workspace_read_file' },
    });
    expect(state.runStates.get(PROJECTION_TEST_SCOPE.run_id)?.toolState.size).toBe(1);
    expect(state.processedEvents.has(output.id)).toBe(false);
  });
});
