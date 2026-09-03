import { describe, expect, it } from 'vitest';
import {
  buildConversationReferencePreview,
  buildUserQuotePayloadFromConversationReferences,
  createConversationReference,
} from './conversationReferences';
import type { ConversationReference } from '../types';

function reference(overrides: Partial<ConversationReference>): ConversationReference {
  return {
    id: overrides.id ?? 'reference-11111111111111111111111111111111',
    pluginId: overrides.pluginId ?? 'platform',
    kind: overrides.kind ?? 'text-selection',
    label: overrides.label ?? '引用内容',
    previewText: overrides.previewText ?? overrides.text ?? '引用内容',
    text: overrides.text ?? '引用内容',
    source: overrides.source ?? {},
    ...(overrides.uri ? { uri: overrides.uri } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

describe('conversationReferences', () => {
  it('缺失 owner/kind 时拒绝构造引用，不套用平台默认身份', () => {
    const referenceId = 'reference-11111111111111111111111111111111';
    expect(() => createConversationReference({ text: 'hello' }, referenceId)).toThrow('pluginId');
    expect(() =>
      createConversationReference({ text: 'hello', pluginId: 'platform' }, referenceId),
    ).toThrow('kind');
  });

  it('显式声明身份时构造引用，并允许补充稳定定位信息', () => {
    expect(
      createConversationReference(
        { text: 'hello', pluginId: 'platform', kind: 'text-selection' },
        'reference-11111111111111111111111111111111',
      ),
    ).toEqual({
      id: 'reference-11111111111111111111111111111111',
      pluginId: 'platform',
      kind: 'text-selection',
      label: 'hello',
      text: 'hello',
      previewText: 'hello',
      source: {},
    });

    expect(createConversationReference({
      text: '第 1 页元素',
      pluginId: 'slides',
      kind: 'slides-element',
      uri: 'linnya://slides/deck-1#element/a',
      label: '第 1 页元素',
      metadata: { slideId: 's1' },
    }, 'reference-22222222222222222222222222222222')).toMatchObject({
      id: 'reference-22222222222222222222222222222222',
      pluginId: 'slides',
      kind: 'slides-element',
      uri: 'linnya://slides/deck-1#element/a',
      label: '第 1 页元素',
      metadata: { slideId: 's1' },
    });
  });

  it('引用预览优先使用 previewText，并保持短文本完整展示', () => {
    expect(buildConversationReferencePreview(reference({
      text: 'abcdefghijklmnopqrstuvwxyz',
      previewText: 'abcdefg1234567',
    }))).toBe('abcd...4567');

    expect(buildConversationReferencePreview(reference({
      text: '短文本',
      previewText: '',
    }))).toBe('短文本');
  });

  it('发送前保留每条引用的身份、定位与业务元数据', () => {
    expect(buildUserQuotePayloadFromConversationReferences([])).toBeUndefined();

    expect(buildUserQuotePayloadFromConversationReferences([
      reference({
        text: 'first',
        source: { type: 'text-selection' },
      }),
      reference({
        id: 'reference-22222222222222222222222222222222',
        pluginId: 'slides',
        kind: 'slides-element',
        uri: 'linnya://slides/deck-1#element/a',
        text: 'second',
        label: '第 1 页元素',
        source: { type: 'slides-element' },
        metadata: { slideId: 's1' },
      }),
    ])).toEqual({
      items: [
        {
          id: 'reference-11111111111111111111111111111111',
          pluginId: 'platform',
          kind: 'text-selection',
          text: 'first',
          label: '引用内容',
          source: { type: 'text-selection' },
        },
        {
          id: 'reference-22222222222222222222222222222222',
          pluginId: 'slides',
          kind: 'slides-element',
          uri: 'linnya://slides/deck-1#element/a',
          text: 'second',
          label: '第 1 页元素',
          source: { type: 'slides-element' },
          metadata: { slideId: 's1' },
        },
      ],
    });

    expect(buildUserQuotePayloadFromConversationReferences([
      reference({ text: 'only one', label: '第 1 页元素' }),
    ])).toEqual({
      items: [{
        id: 'reference-11111111111111111111111111111111',
        pluginId: 'platform',
        kind: 'text-selection',
        text: 'only one',
        label: '第 1 页元素',
        source: {},
      }],
    });
  });
});
