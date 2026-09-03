import { describe, expect, it } from 'vitest';

import {
  createInitialProjectionState,
  reduceEvent,
} from '../index';
import type { Conversation } from '../../../types';
import { createUserInputEvent } from 'linnkit/contracts';

function createConversation(): Conversation {
  return {
    id: 'conv_user_input_projection',
    title: '',
    titleOrigin: 'explicit',
    messages: [],
    selectedAgentId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('user input projection', () => {
  it('历史回放展示 raw_content，而不是给模型看的完整 user content', () => {
    const state = createInitialProjectionState(createConversation());

    const result = reduceEvent(state, createUserInputEvent(
      'user_msg_1',
      'conv_user_input_projection',
      'turn-user-1',
      [
        '<local_time>2026-06-28 11:30:23</local_time>',
        '<user_request>',
        '调用一次工具试试',
        '</user_request>',
      ].join('\n'),
      {
      timestamp: 100,
      raw_content: '调用一次工具试试',
      },
    ));

    expect(result.success).toBe(true);
    expect(state.conversation.messages).toHaveLength(1);
    expect(state.conversation.messages[0]).toMatchObject({
      id: 'user_msg_1',
      role: 'user',
      type: 'user_input',
      content: '调用一次工具试试',
    });
  });

  it('图片-only 回放保留空文本与 durable 附件顺序', () => {
    const state = createInitialProjectionState(createConversation());
    const result = reduceEvent(state, createUserInputEvent(
      'user-image-only',
      'conv_user_input_projection',
      'turn-user-image',
      '',
      {
      timestamp: 200,
      raw_content: '',
      attachments: [
        {
          id: 'attachment-first',
          kind: 'image',
          resourceId: 'asset-first',
          mediaType: 'image/png',
          byteLength: 128,
          width: 16,
          height: 8,
          sha256: 'a'.repeat(64),
        },
        {
          id: 'attachment-second',
          kind: 'image',
          resourceId: 'asset-second',
          mediaType: 'image/webp',
          byteLength: 256,
          width: 32,
          height: 24,
          sha256: 'b'.repeat(64),
        },
      ],
      },
    ));

    expect(result.success).toBe(true);
    expect(state.conversation.messages[0]).toMatchObject({
      content: '',
      attachments: [
        { id: 'attachment-first', assetId: 'asset-first' },
        { id: 'attachment-second', assetId: 'asset-second' },
      ],
    });
  });
});
