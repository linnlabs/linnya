import { describe, expect, it } from 'vitest';
import type { AgentProfileRequest } from '../contracts';
import { BaseAgentTask } from './BaseAgentTask';
import {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  ToolCallIdSchema,
} from '../../../../contracts';
import type { AiMessage, RuntimeResourceRef } from '../../../../contracts';

class TestAgentTask extends BaseAgentTask {
  readonly name = 'test-agent-task';

  protected getSystemPrompt(_request: AgentProfileRequest): string {
    return '你是测试 Agent。';
  }
}

describe('BaseAgentTask.buildMessages', () => {
  const task = new TestAgentTask();
  const attachment: RuntimeResourceRef = {
    id: 'attachment-1',
    kind: 'image',
    resourceId: 'asset-1',
    mediaType: 'image/png',
    byteLength: 1024,
    width: 640,
    height: 480,
    sha256: 'a'.repeat(64),
    fileName: 'diagram.png',
  };

  it('history 不含 user 时，应追加当前 query 作为 standalone user message', () => {
    const request: AgentProfileRequest = {
      query: '当前问题',
      promptKey: 'default',
    };

    const messages = task.buildMessages(request, []);

    expect(messages.map(message => message.role)).toEqual(['system', 'user']);
    expect(messages[0]?.content).toContain(
      '<context-checkpoint trust="untrusted-memory">',
    );
    expect(messages[1]).toMatchObject({
      role: 'user',
      type: 'user_input',
      content: '当前问题',
    });
  });

  it('按 immutable ID 定位 history 中的当前轮，并保持后续消息时序', () => {
    const currentUser = createUserMessage('user_input', '你是谁，你为什么叫demo-agent');
    const request: AgentProfileRequest = {
      query: '你是谁，你为什么叫demo-agent',
      currentUserEventId: currentUser.id,
      promptKey: 'default',
    };
    const history: AiMessage[] = [
      currentUser,
      createAssistantMessage('tool_calls', '我先调用工具。'),
      createToolMessage(
        '搜索结果：demo-agent',
        ToolCallIdSchema.parse('call_search_1'),
        'web_search'
      ),
    ];

    const messages = task.buildMessages(request, history);
    const matchedUsers = messages.filter(message => {
      return (
        message.role === 'user' &&
        message.type === 'user_input' &&
        message.content === '你是谁，你为什么叫demo-agent'
      );
    });

    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(matchedUsers).toHaveLength(1);
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      type: 'tool_output',
      content: '搜索结果：demo-agent',
    });
  });

  it('相同文本出现多次时，只绑定 currentUserEventId 指定的消息', () => {
    const history: AiMessage[] = [
      { id: 'old-user', role: 'user', type: 'user_input', content: '重复问题', timestamp: 1 },
      {
        id: 'old-answer',
        role: 'assistant',
        type: 'final_answer',
        content: '旧回答',
        timestamp: 2,
      },
      { id: 'current-user', role: 'user', type: 'user_input', content: '重复问题', timestamp: 3 },
    ];

    const messages = task.buildMessages(
      {
        query: '重复问题',
        currentUserEventId: 'current-user',
        promptKey: 'default',
      },
      history
    );

    expect(messages.map(message => message.id)).toEqual([
      expect.any(String),
      'old-user',
      'old-answer',
      'current-user',
    ]);
  });

  it('当前事件尚未进入 history 时，以同一 ID、文本和附件创建 user message', () => {
    const messages = task.buildMessages(
      {
        query: '请分析图片',
        currentUserEventId: 'current-user',
        currentUserAttachments: [attachment],
        promptKey: 'default',
      },
      []
    );

    expect(messages[1]).toEqual(
      expect.objectContaining({
        id: 'current-user',
        role: 'user',
        type: 'user_input',
        content: '请分析图片',
        attachments: [attachment],
      })
    );
  });

  it('图片-only 当前轮允许空文本，但必须保留事实事件 ID 和附件', () => {
    const messages = task.buildMessages(
      {
        query: '',
        currentUserEventId: 'image-only-user',
        currentUserAttachments: [attachment],
        promptKey: 'default',
      },
      []
    );

    expect(messages[1]).toEqual(
      expect.objectContaining({
        id: 'image-only-user',
        content: '',
        attachments: [attachment],
      })
    );
  });

  it('没有 ID 的旧调用不再按文本扫描 history，而是创建新的当前消息', () => {
    const history: AiMessage[] = [
      { id: 'old-user', role: 'user', type: 'user_input', content: '重复问题', timestamp: 1 },
    ];

    const messages = task.buildMessages(
      {
        query: '重复问题',
        promptKey: 'default',
      },
      history
    );

    expect(messages).toHaveLength(3);
    expect(messages[1].id).toBe('old-user');
    expect(messages[2]).toMatchObject({
      role: 'user',
      type: 'user_input',
      content: '重复问题',
    });
    expect(messages[2].id).not.toBe('old-user');
  });

  it('附件缺少事实事件 ID 时明确失败', () => {
    expect(() =>
      task.buildMessages(
        {
          query: '请分析图片',
          currentUserAttachments: [attachment],
          promptKey: 'default',
        },
        []
      )
    ).toThrow(/attachments require currentUserEventId/i);
  });

  it('currentUserEventId 指向非 user_input 消息时明确失败', () => {
    expect(() =>
      task.buildMessages(
        {
          query: '当前问题',
          currentUserEventId: 'assistant-message',
          promptKey: 'default',
        },
        [
          {
            id: 'assistant-message',
            role: 'assistant',
            type: 'final_answer',
            content: '回答',
            timestamp: 1,
          },
        ]
      )
    ).toThrow(/not a user_input event/i);
  });
});
