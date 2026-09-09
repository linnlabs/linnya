import { describe, expect, it } from 'vitest';
import type { ConversationImageDraftItem } from '../definitions/conversationImageAttachmentDraft';
import {
  resolveConversationImageSubmitPreflight,
  validateConversationImageDraftAddition,
} from './conversationImageDraftRules';

const readyItem: ConversationImageDraftItem = {
  clientId: 'client-1',
  fileName: 'diagram.png',
  byteLength: 4,
  previewUrl: 'blob:preview-1',
  status: 'ready',
  staged: {
    draft: { draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' },
    mediaType: 'image/png',
    byteLength: 4,
    width: 2,
    height: 2,
    sha256: 'a'.repeat(64),
  },
};

function createSizedFile(name: string, size: number): File {
  const file = new File([], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('validateConversationImageDraftAddition', () => {
  it('允许 100 MiB 聚合图片，但拒绝再增加会超出上限的文件', () => {
    const currentItems: ConversationImageDraftItem[] = [
      { ...readyItem, byteLength: 60 * 1024 * 1024 },
    ];
    expect(validateConversationImageDraftAddition(
      currentItems,
      [createSizedFile('within-limit.png', 40 * 1024 * 1024)],
    )).toBeNull();
    expect(validateConversationImageDraftAddition(
      currentItems,
      [createSizedFile('over-limit.png', 40 * 1024 * 1024 + 1)],
    )).toBe('conversation.image.total_bytes_exceeded');
  });
});

describe('resolveConversationImageSubmitPreflight', () => {
  it('允许图片-only，但必须全部 ready 且当前模型显式支持 image_input', () => {
    expect(resolveConversationImageSubmitPreflight({
      text: '',
      items: [readyItem],
      activeModelAcceptsUserImages: true,
      extensionAcceptsAttachments: true,
    })).toEqual({ ok: true });
    expect(resolveConversationImageSubmitPreflight({
      text: '',
      items: [readyItem],
      activeModelAcceptsUserImages: false,
      extensionAcceptsAttachments: true,
    })).toEqual({ ok: false, reason: 'model_unsupported' });
  });

  it.each([
    ['uploading', 'draft_pending'],
    ['failed', 'draft_failed'],
  ] as const)('%s 草稿阻止整批发送', (status, reason) => {
    const item: ConversationImageDraftItem = status === 'uploading'
      ? { ...readyItem, status: 'uploading' }
      : { ...readyItem, status: 'failed', errorCode: 'conversation.image.staging_failed' };
    expect(resolveConversationImageSubmitPreflight({
      text: 'question',
      items: [item],
      activeModelAcceptsUserImages: true,
      extensionAcceptsAttachments: true,
    })).toEqual({ ok: false, reason });
  });

  it('扩展不接受附件时阻止发送，且不会静默降成纯文本', () => {
    expect(resolveConversationImageSubmitPreflight({
      text: 'question',
      items: [readyItem],
      activeModelAcceptsUserImages: true,
      extensionAcceptsAttachments: false,
    })).toEqual({ ok: false, reason: 'extension_unsupported' });
  });
});
