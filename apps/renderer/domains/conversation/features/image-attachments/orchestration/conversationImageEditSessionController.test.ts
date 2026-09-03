import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConversationAttachmentRef, ConversationImageDraftStageResponse } from '@app/schemas';
import { useConversationImageEditSessionStore } from '../store/conversationImageEditSessionStore';
import { createConversationImageEditSessionController } from './conversationImageEditSessionController';

const existing: ConversationAttachmentRef = {
  id: 'attachment-existing',
  kind: 'image',
  assetId: 'asset-existing',
  mediaType: 'image/png',
  byteLength: 4,
  width: 2,
  height: 2,
  sha256: 'a'.repeat(64),
};
const staged: ConversationImageDraftStageResponse = {
  draft: { draftId: 'draft-new', kind: 'image', fileName: 'new.png' },
  mediaType: 'image/png',
  byteLength: 8,
  width: 4,
  height: 2,
  sha256: 'b'.repeat(64),
};

describe('conversation image edit session controller', () => {
  const stageFile = vi.fn(async () => staged);
  const releaseDraft = vi.fn(async () => undefined);
  const revoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    stageFile.mockClear();
    releaseDraft.mockClear();
    revoke.mockClear();
  });

  function createController() {
    const store = useConversationImageEditSessionStore();
    const controller = createConversationImageEditSessionController({
      store,
      api: { stageFile, releaseDraft },
      objectUrls: { create: () => 'blob:edit', revoke },
      createClientId: () => 'client-new',
    });
    return { store, controller };
  }

  it('冻结 existing + ready draft 的有序 selection，失败后保留会话供重试', async () => {
    const { store, controller } = createController();
    controller.start('message-1', [existing]);
    controller.stageFiles([new File(['image'], 'new.png', { type: 'image/png' })]);
    expect(controller.beginSubmission('message-1')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    controller.move({ source: 'draft', clientId: 'client-new' }, -1);
    expect(controller.beginSubmission('message-1')).toEqual({
      selection: {
        mode: 'replace',
        items: [
          { source: 'draft', draft: staged.draft },
          { source: 'existing', attachmentId: 'attachment-existing' },
        ],
      },
    });
    expect(controller.start('message-other', [])).toBe(false);
    expect(store.messageId).toBe('message-1');
    controller.failSubmission('message-1');
    expect(store.messageId).toBe('message-1');
    expect(store.isSubmitting).toBe(false);
    expect(releaseDraft).not.toHaveBeenCalled();
  });

  it('取消释放 host draft，commit ack 只回收本地 runtime', async () => {
    const first = createController();
    first.controller.start('message-cancel', []);
    first.controller.stageFiles([new File(['image'], 'cancel.png')]);
    await Promise.resolve();
    await Promise.resolve();
    first.controller.cancel('message-cancel');
    await Promise.resolve();
    expect(releaseDraft).toHaveBeenCalledWith('draft-new');
    expect(revoke).toHaveBeenCalledWith('blob:edit');

    releaseDraft.mockClear();
    revoke.mockClear();
    const second = createController();
    second.controller.start('message-commit', []);
    second.controller.stageFiles([new File(['image'], 'commit.png')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(second.controller.beginSubmission('message-commit')).not.toBeNull();
    second.controller.acceptCommitted('message-commit');
    expect(releaseDraft).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:edit');
    expect(second.store.messageId).toBeNull();
  });

  it('提交中的 scope 切换延迟到请求失败后再释放 draft', async () => {
    const { store, controller } = createController();
    controller.start('message-pending-switch', []);
    controller.stageFiles([new File(['image'], 'pending.png')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.beginSubmission('message-pending-switch')).not.toBeNull();

    controller.cancel();
    expect(store.messageId).toBe('message-pending-switch');
    expect(releaseDraft).not.toHaveBeenCalled();
    controller.failSubmission('message-pending-switch');
    await Promise.resolve();

    expect(releaseDraft).toHaveBeenCalledWith('draft-new');
    expect(store.messageId).toBeNull();
  });
});
