import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolCompactStepProjectionPort } from '@/app/plugins/orchestration/createToolCompactStepProjectionPort';
import { registerToolCompactStepProjectionPort } from '../../../ports/toolCompactStepProjectionPort';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { workspaceReadToolConfigs } from '../../../ui/tools/configs/workspace';
import { knowledgeBaseToolConfigs } from '../../../ui/tools/configs/knowledgeBase';
import { createAppendOnlySubrunStepProjector } from '../functions/createAppendOnlySubrunStepProjector';

let unregisterCompactProjection: (() => void) | undefined;

function event(
  id: string,
  kind: SSESubRunTraceEvent['kind'],
  fields: Partial<SSESubRunTraceEvent>,
): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id,
    timestamp: 1,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    parent_tool_call_id: ToolCallIdSchema.parse('parent-tool-1'),
    subrun_id: 'subrun-1',
    source_event_id: `source-${id}`,
    kind,
    ...fields,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearRendererPluginRegistryForTest();
  registerRendererPlugin({
    meta: {
      id: 'read-file-image-compact-test',
      name: 'read_file image compact test',
      version: '1.0.0',
      description: 'Production compact registry fixture',
      developer: 'Linnya',
      builtin: true,
      required: true,
    },
    toolCards: {
      ...commonToolConfigs,
      ...workspaceReadToolConfigs,
      ...knowledgeBaseToolConfigs,
    },
  });
  useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
  unregisterCompactProjection = registerToolCompactStepProjectionPort(
    createToolCompactStepProjectionPort(),
  );
});

afterEach(() => {
  unregisterCompactProjection?.();
  unregisterCompactProjection = undefined;
  clearRendererPluginRegistryForTest();
});

describe('read_file image compact step integration', () => {
  it('knowledge_search 空 doc_id 的 error lifecycle 仍原子接纳为失败步骤', () => {
    const projector = createAppendOnlySubrunStepProjector();
    const callId = ToolCallIdSchema.parse('call-knowledge-error');
    projector.admit([{
      index: 0,
      event: event('knowledge-decision', 'tool_call_decision', {
        tool_calls: [{
          tool_call_id: callId,
          tool_name: 'knowledge_search',
          args: { query: 'beta 功能', doc_id: '', deep_search: false },
        }],
      }),
    }, {
      index: 1,
      event: event('knowledge-output', 'tool_output', {
        tool_name: 'knowledge_search',
        tool_call_id: callId,
        status: 'error',
        output: { error: 'doc_id must not be empty' },
      }),
    }]);

    expect(projector.projection.steps).toEqual([{
      toolCallId: 'call-knowledge-error',
      toolName: 'knowledge_search',
      title: {
        key: 'conversation.tool.knowledgeSearch.error',
        fallback: '搜索知识库时发生错误',
      },
      status: 'error',
    }]);
  });

  it('同一步骤在成功图片结果到达后由“阅读文件”切换为“查看图片”', () => {
    const projector = createAppendOnlySubrunStepProjector();
    const callId = ToolCallIdSchema.parse('call-read-image');
    const args = { locator: 'conversation:/slides-renders/run-1/slide-007.png' };
    projector.admit([{ index: 0, event: event('process', 'tool_process', {
      tool_name: 'read_file',
      tool_call_id: callId,
      status: 'loading',
      phase: 'start',
      args,
    }) }]);

    expect(projector.projection.steps).toMatchObject([{
      toolCallId: 'call-read-image',
      status: 'loading',
      title: { key: 'conversation.tool.workspace.compact.read' },
    }]);

    projector.admit([{ index: 1, event: event('output', 'tool_output', {
      tool_name: 'read_file',
      tool_call_id: callId,
      status: 'success',
      output: {
        data: {
          source_kind: 'conversation_file',
          locator: 'conversation:/slides-renders/run-1/slide-007.png',
          file_name: 'slide-007.png',
          content_type: 'image/png',
          byte_length: 1024,
          width: 1600,
          height: 900,
        },
        observation: '图片已读取。',
      },
    }) }]);

    expect(projector.projection.steps).toHaveLength(1);
    expect(projector.projection.steps[0]).toMatchObject({
      toolCallId: 'call-read-image',
      status: 'success',
      title: { key: 'conversation.tool.imageRead.title' },
    });
  });
});
