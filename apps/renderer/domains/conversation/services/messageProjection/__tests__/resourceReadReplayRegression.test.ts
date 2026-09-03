import { describe, expect, it } from 'vitest';
import type { BaseMessage, Conversation, ToolCallMessage } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '../index';
import { resourceToolConfigs } from '../../../ui/tools/configs/resource';
import { isRecord } from '../../../utils/typeGuards';
import type { SSEToolCallDecisionEvent, SSEToolOutputEvent } from 'linnkit/contracts';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';
import { ToolCallIdSchema } from 'linnkit/contracts';

function createConversation(): Conversation {
  return {
    id: 'conv_test_resource_replay',
    title: 'test',
    titleOrigin: 'explicit',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    selectedAgentId: null,
  };
}

function readMessageByToolCallId(
  messages: BaseMessage[],
  toolCallId: string
): ToolCallMessage | undefined {
  return messages.find(
    (message): message is ToolCallMessage =>
      message.type === 'tool_calls' && message.metadata.tool_call_id === toolCallId
  );
}

describe('resource_read replay regression', () => {
  it('batched secondary resource_read 在旧结果缺失 data.uri 时，replay 后仍应按 args.uri 渲染知识库阅读卡片', () => {
    const conversation = createConversation();
    const turnId = 'turn_resource_replay';

    const decision: SSEToolCallDecisionEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'tool_call_decision',
      id: 'evt_resource_batch_decision',
      conversation_id: conversation.id,
      turn_id: turnId,
      timestamp: 1,
      tool_name: 'subagent',
      tool_call_id: ToolCallIdSchema.parse('call_subagent_primary'),
      phase: 'start',
      status: 'loading',
      args: {
        description: '主任务',
        prompt: '执行主任务',
      },
      payload: {
        args: {
          description: '主任务',
          prompt: '执行主任务',
        },
        tool_calls: [
          {
            id: 'call_subagent_primary',
            type: 'function',
            function: {
              name: 'subagent',
              arguments: JSON.stringify({
                description: '主任务',
                prompt: '执行主任务',
              }),
            },
          },
          {
            id: 'call_resource_secondary',
            type: 'function',
            function: {
              name: 'resource_read',
              arguments: JSON.stringify({
                uri: 'kb://documents/doc_legacy',
                offset: 0,
                limit: 6,
                view: 'overview',
              }),
            },
          },
        ],
      },
      meta: {
        tool_call_ids: ['call_subagent_primary', 'call_resource_secondary'],
        tool_batch_size: 2,
      },
    };

    const legacyResult = {
      data: {
        chunks: [
          { index: 1, text: '<div style="text-align: center;' },
          { index: 2, text: 'China Technology Roadmap...' },
        ],
        filename: 'All-Solid-State-Batteries-China-Roadmap-v1.pdf',
        total_chunks: 22,
        mode: 'glance',
        has_more: true,
      },
      observation:
        'Cursor: To continue, set offset to 6.\n[Chunk 1/22] <div style="text-align: center;\n[Chunk 2/22] China Technology Roadmap...',
    };

    const output: SSEToolOutputEvent = {
      ...PROJECTION_TEST_SCOPE,
      type: 'tool_output',
      id: 'evt_resource_secondary_output',
      conversation_id: conversation.id,
      turn_id: turnId,
      timestamp: 2,
      tool_name: 'resource_read',
      tool_call_id: ToolCallIdSchema.parse('call_resource_secondary'),
      status: 'success',
      observation: legacyResult.observation,
      data: legacyResult.data,
    };

    const state = createInitialProjectionState(conversation);
    const r1 = reduceEvent(state, decision);
    expect(r1.success).toBe(true);

    const r2 = reduceEvent(state, output);
    expect(r2.success).toBe(true);

    const resourceMessage = readMessageByToolCallId(
      state.conversation.messages,
      'call_resource_secondary'
    );
    expect(resourceMessage).toBeDefined();

    const args = resourceMessage?.metadata.args;
    const result = resourceMessage
      ? { data: resourceMessage.metadata.data, observation: resourceMessage.content }
      : undefined;

    expect(args?.['uri']).toBe('kb://documents/doc_legacy');
    expect(
      isRecord(result) && isRecord(result['data']) ? result['data']?.['uri'] : undefined
    ).toBeUndefined();

    const uiKey = resourceToolConfigs['resource_read']?.resolveUiKey(args, result);
    expect(uiKey).toBe('knowledge_read');
  });
});
