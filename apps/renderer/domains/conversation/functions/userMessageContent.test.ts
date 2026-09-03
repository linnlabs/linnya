import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../types';
import { readUserMessageContent } from './userMessageContent';

describe('readUserMessageContent', () => {
  it('从消息投影恢复文本和完整结构化引用', () => {
    const message: BaseMessage = {
      id: 'message-1',
      role: 'user',
      type: 'user_input',
      content: '修改这张幻灯片',
      attachments: [{
        id: 'attachment-1',
        kind: 'image',
        assetId: 'asset-1',
        mediaType: 'image/png',
        byteLength: 128,
        width: 16,
        height: 8,
        sha256: 'a'.repeat(64),
        fileName: 'slide.png',
      }],
      timestamp: 1,
      metadata: {
        user_quote: {
          items: [{
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'slides',
            kind: 'slides-source-selection',
            uri: 'slides://deck-1/slide-1',
            text: 'shape source',
            label: '第 1 页',
            source: { presentation_id: 'deck-1' },
            metadata: { elementIds: ['shape-1'] },
          }],
        },
      },
    };

    expect(readUserMessageContent(message)).toEqual({
      text: '修改这张幻灯片',
      userQuote: {
        items: [{
          id: 'reference-11111111111111111111111111111111',
          pluginId: 'slides',
          kind: 'slides-source-selection',
          uri: 'slides://deck-1/slide-1',
          text: 'shape source',
          label: '第 1 页',
          source: { presentation_id: 'deck-1' },
          metadata: { elementIds: ['shape-1'] },
        }],
      },
      attachments: [{
        id: 'attachment-1',
        kind: 'image',
        assetId: 'asset-1',
        mediaType: 'image/png',
        byteLength: 128,
        width: 16,
        height: 8,
        sha256: 'a'.repeat(64),
        fileName: 'slide.png',
      }],
    });
  });

  it('没有引用时只返回文本', () => {
    const message: BaseMessage = {
      id: 'message-2',
      role: 'user',
      type: 'user_input',
      content: '继续',
      timestamp: 2,
    };

    expect(readUserMessageContent(message)).toEqual({ text: '继续' });
  });
});
