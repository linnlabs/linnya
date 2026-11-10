import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import {
  clearConversationReferenceKindsForTest,
  readConversationReferenceIcon,
  registerConversationReferenceKind,
  resolveConversationReferenceChipPresentation,
} from './conversationReferenceKindRegistry';

const reference: ConversationReferenceChipInput = {
  id: 'reference-1',
  pluginId: 'platform',
  kind: 'text-selection',
  label: '引用内容',
  previewText: '一段引用',
  text: '一段引用',
};

describe('conversationReferenceKindRegistry', () => {
  beforeEach(() => {
    clearConversationReferenceKindsForTest();
  });

  it('由注册贡献解析标准 pill 展示', () => {
    registerConversationReferenceKind({
      pluginId: 'platform',
      kind: 'text-selection',
      chip: {
        label: (input) => input.label,
        preview: (input) => `预览：${input.previewText}`,
      },
    });

    expect(resolveConversationReferenceChipPresentation(reference)).toEqual({
      label: '引用内容',
      preview: '预览：一段引用',
    });
  });

  it('只有声明对象图标且可用的引用类型才在历史中按标签显示', () => {
    const icon = { name: 'DocIcon' };
    expect(readConversationReferenceIcon(reference)).toBeNull();
    registerConversationReferenceKind({
      pluginId: 'platform',
      kind: 'text-selection',
      chip: { label: (input) => input.label, preview: (input) => input.previewText },
    });
    expect(readConversationReferenceIcon(reference)).toBeNull();
    let available = true;
    registerConversationReferenceKind({
      pluginId: 'platform',
      kind: 'workspace-document',
      chip: { label: (input) => input.label, preview: (input) => input.label, icon: () => icon },
      isAvailable: () => available,
    });
    const documentReference = { ...reference, kind: 'workspace-document' };
    expect(readConversationReferenceIcon(documentReference)).toBe(icon);
    expect(resolveConversationReferenceChipPresentation(documentReference).icon).toBe(icon);
    available = false;
    expect(readConversationReferenceIcon(documentReference)).toBeNull();
  });

  it('把未注册、重复注册与失效引用视为契约错误', () => {
    expect(() => resolveConversationReferenceChipPresentation(reference))
      .toThrow('引用类型未注册: platform:text-selection');

    const contribution = {
      pluginId: 'platform',
      kind: 'text-selection',
      chip: {
        label: (input: ConversationReferenceChipInput) => input.label,
        preview: (input: ConversationReferenceChipInput) => input.previewText,
      },
      isValid: () => false,
    };
    registerConversationReferenceKind(contribution);

    expect(() => registerConversationReferenceKind(contribution))
      .toThrow('引用类型重复注册: platform:text-selection');
    expect(() => resolveConversationReferenceChipPresentation(reference))
      .toThrow('引用已失效: platform:text-selection#reference-1');
  });
});
