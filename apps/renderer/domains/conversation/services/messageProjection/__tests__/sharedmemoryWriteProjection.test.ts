import { describe, expect, it } from 'vitest';
import { createInitialProjectionState, reduceEvent } from '../index';
import type { BaseMessage, Conversation, ToolCallMessage } from '../../../types';
import { createSSEToolCallDecisionEvent, createSSEToolOutputEvent } from 'linnkit/contracts';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

function createConversation(): Conversation {
  return {
    id: 'conv_test',
    title: 'test',
    titleOrigin: 'explicit',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    selectedAgentId: null,
  };
}

function readMessageByToolCallId(messages: BaseMessage[], toolCallId: string): ToolCallMessage | undefined {
  return messages.find((message): message is ToolCallMessage => (
    message.type === 'tool_calls' && message.metadata.tool_call_id === toolCallId
  ));
}

describe('sharedmemory_write message projection', () => {
  it('同一轮连续两次 sharedmemory_write 时，不应把 ASCII 文档名串成中文文档的 sanitize 结果', () => {
    const state = createInitialProjectionState(createConversation());
    const turnId = 'turn_test';

    const zhAction = createSSEToolCallDecisionEvent(
      'evt_decision_zh',
      'conv_test',
      turnId,
      'sharedmemory_write',
      'call_zh',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: {
          doc_name: '测试文档',
          action: 'write',
          content: '中文内容',
        },
        payload: {
          args: {
            doc_name: '测试文档',
            action: 'write',
            content: '中文内容',
          },
        },
      }
    );

    const zhResult = {
      data: {
        conversation_id: 'conv_test',
        instance_id: 'inst_test',
        doc_name: '测试文档',
        uri: 'shared_memory://docs/测试文档.md',
        file_path: '/tmp/conv_test/inst_test/sharedmemory/docs/测试文档.md',
        action: 'write',
        created: true,
        version: 1,
      },
      observation: 'Shared memory doc created: 测试文档 (v1).',
    };
    const zhOutput = createSSEToolOutputEvent(
      'evt_output_zh',
      'conv_test',
      turnId,
      'sharedmemory_write',
      'call_zh',
      { status: 'success', observation: zhResult.observation, data: zhResult.data },
      {
        ...PROJECTION_TEST_SCOPE,
      }
    );

    const asciiAction = createSSEToolCallDecisionEvent(
      'evt_decision_ascii',
      'conv_test',
      turnId,
      'sharedmemory_write',
      'call_ascii',
      'start',
      'loading',
      {
        ...PROJECTION_TEST_SCOPE,
        args: {
          doc_name: 'test_document',
          action: 'write',
          content: 'ASCII 内容',
        },
        payload: {
          args: {
            doc_name: 'test_document',
            action: 'write',
            content: 'ASCII 内容',
          },
        },
      }
    );

    const asciiResult = {
      data: {
        conversation_id: 'conv_test',
        instance_id: 'inst_test',
        doc_name: 'test_document',
        uri: 'shared_memory://docs/test_document.md',
        file_path: '/tmp/conv_test/inst_test/sharedmemory/docs/test_document.md',
        action: 'write',
        created: true,
        version: 1,
      },
      observation: 'Shared memory doc created: test_document (v1).',
    };
    const asciiOutput = createSSEToolOutputEvent(
      'evt_output_ascii',
      'conv_test',
      turnId,
      'sharedmemory_write',
      'call_ascii',
      { status: 'success', observation: asciiResult.observation, data: asciiResult.data },
      {
        ...PROJECTION_TEST_SCOPE,
      }
    );

    // 中文备注：
    // - 按真实链路依次投影 tool_call_decision/tool_output；
    // - 两次 tool_call 在同一 turn 内，但 tool_call_id 不同，前端必须分别归并，不能互相覆盖。
    expect(reduceEvent(state, zhAction).success).toBe(true);
    expect(reduceEvent(state, zhOutput).success).toBe(true);
    expect(reduceEvent(state, asciiAction).success).toBe(true);
    expect(reduceEvent(state, asciiOutput).success).toBe(true);

    const zhMessage = readMessageByToolCallId(state.conversation.messages, 'call_zh');
    const asciiMessage = readMessageByToolCallId(state.conversation.messages, 'call_ascii');

    expect(zhMessage).toBeDefined();
    expect(asciiMessage).toBeDefined();
    expect(state.conversation.messages).toHaveLength(2);

    expect(zhMessage?.metadata.args).toMatchObject({
      doc_name: '测试文档',
      action: 'write',
    });
    expect(asciiMessage?.metadata.args).toMatchObject({
      doc_name: 'test_document',
      action: 'write',
    });

    const zhResultData = readResultData({ data: zhMessage?.metadata.data });
    const asciiResultData = readResultData({ data: asciiMessage?.metadata.data });

    expect(zhResultData?.['uri']).toBe('shared_memory://docs/测试文档.md');
    expect(asciiResultData?.['uri']).toBe('shared_memory://docs/test_document.md');
    expect(asciiResultData?.['file_path']).toBe(
      '/tmp/conv_test/inst_test/sharedmemory/docs/test_document.md'
    );
  });
});

function readResultData(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined;
  const data = Object.prototype.hasOwnProperty.call(result, 'data')
    ? Reflect.get(result, 'data')
    : undefined;
  return isRecord(data) ? data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
