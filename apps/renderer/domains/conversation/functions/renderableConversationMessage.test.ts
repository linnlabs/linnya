import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../types';
import {
  createTestAnswerMessage,
  createTestHistorySummaryMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../testing/functions/createConversationTestMessage';
import {
  hasRenderableConversationMessages,
  isBlankFinalAnswerMessage,
  isHiddenConversationMessage,
  isRenderableConversationMessage,
  shouldRenderConversationMessage,
} from './renderableConversationMessage';

function message(overrides: {
  readonly id?: string;
  readonly role?: BaseMessage['role'];
  readonly type?: BaseMessage['type'];
  readonly content?: string;
  readonly timestamp?: number;
  readonly metadata?: { readonly ui?: { readonly presentation: 'message' | 'hidden' } };
}): BaseMessage {
  const common = {
    id: overrides.id ?? 'message-1',
    content: overrides.content ?? 'hello',
    timestamp: overrides.timestamp ?? 1,
  };
  const type = overrides.type ?? 'final_answer';
  switch (type) {
    case 'user_input':
      return createTestUserMessage({ ...common, metadata: overrides.metadata });
    case 'tool_calls':
      return createTestToolMessage(common);
    case 'history_summary':
      return createTestHistorySummaryMessage(common);
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return createTestAnswerMessage({ ...common, type, metadata: overrides.metadata });
    case 'thought':
    case 'summarization_progress':
      throw new Error('This test fixture does not use thought/progress messages');
  }
}

describe('renderableConversationMessage', () => {
  it('不把 hidden UI 消息算作可渲染内容', () => {
    const hidden = message({
      role: 'user',
      type: 'user_input',
      metadata: { ui: { presentation: 'hidden' } },
    });

    expect(isHiddenConversationMessage(hidden)).toBe(true);
    expect(isRenderableConversationMessage(hidden)).toBe(false);
    expect(hasRenderableConversationMessages([hidden])).toBe(false);
  });

  it('普通用户和助手消息算作可渲染内容', () => {
    expect(hasRenderableConversationMessages([
      message({ role: 'user', type: 'user_input', content: '开始' }),
    ])).toBe(true);

    expect(hasRenderableConversationMessages([
      message({ role: 'assistant', type: 'tool_calls', content: '' }),
    ])).toBe(true);
  });

  it('图片-only 用户消息属于可渲染内容', () => {
    const imageOnly = message({ role: 'user', type: 'user_input', content: '' });
    imageOnly.attachments = [{
      id: 'attachment-1',
      kind: 'image',
      assetId: 'asset-1',
      mediaType: 'image/png',
      byteLength: 4,
      width: 2,
      height: 2,
      sha256: 'a'.repeat(64),
    }];

    expect(isRenderableConversationMessage(imageOnly)).toBe(true);
    expect(shouldRenderConversationMessage(imageOnly)).toBe(true);
  });

  it('不把仅含不可见字符的 final_answer 算作可渲染内容', () => {
    const blankAnswer = message({
      role: 'assistant',
      type: 'final_answer',
      content: '\u200b',
    });

    expect(isBlankFinalAnswerMessage(blankAnswer)).toBe(true);
    expect(isRenderableConversationMessage(blankAnswer)).toBe(false);
    expect(shouldRenderConversationMessage(blankAnswer)).toBe(false);
    expect(hasRenderableConversationMessages([blankAnswer])).toBe(false);
  });

  it('history_summary 不在空态统计内，但仍应在 Message.vue 渲染', () => {
    const summary = message({
      role: 'system',
      type: 'history_summary',
      content: '',
    });

    expect(isRenderableConversationMessage(summary)).toBe(false);
    expect(shouldRenderConversationMessage(summary)).toBe(true);
  });
});
