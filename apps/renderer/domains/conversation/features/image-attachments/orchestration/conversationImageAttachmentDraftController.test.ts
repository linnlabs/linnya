import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  type ConversationImageDraftStageResponse,
} from '@app/schemas';
import { createConversationImageDraftSubmissionSnapshot } from '../functions/conversationImageDraftRules';
import { useConversationImageAttachmentDraftStore } from '../store/conversationImageAttachmentDraftStore';
import type { ConversationImageAttachmentApiPort } from './conversationImageAttachmentApi';
import { createConversationImageAttachmentDraftController } from './conversationImageAttachmentDraftController';
import { bindConversationImageDraftsToWorkspaceScope } from './bindConversationImageDraftsToWorkspaceScope';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let fulfill: ((value: T) => void) | null = null;
  let rejectPromise: ((reason: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    fulfill = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (!fulfill) throw new Error('deferred 尚未初始化');
      fulfill(value);
    },
    reject(reason) {
      if (!rejectPromise) throw new Error('deferred 尚未初始化');
      rejectPromise(reason);
    },
  };
}

function createFile(name: string, byteLength = 4): File {
  return new File([new Uint8Array(byteLength)], name, { type: 'image/png' });
}

function createStageResponse(file: File, draftId: string): ConversationImageDraftStageResponse {
  return {
    draft: { draftId, kind: 'image', fileName: file.name },
    mediaType: 'image/png',
    byteLength: file.size,
    width: 2,
    height: 2,
    sha256: 'a'.repeat(64),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness() {
  const store = useConversationImageAttachmentDraftStore();
  const stages: Array<{
    file: File;
    signal: AbortSignal;
    deferred: Deferred<ConversationImageDraftStageResponse>;
  }> = [];
  const releasedDraftIds: string[] = [];
  const revokedUrls: string[] = [];
  const releaseErrorCodes: string[] = [];
  let nextClientId = 0;
  let nextUrlId = 0;

  const api: ConversationImageAttachmentApiPort = {
    stageFile(file, signal) {
      const deferred = createDeferred<ConversationImageDraftStageResponse>();
      stages.push({ file, signal, deferred });
      return deferred.promise;
    },
    async releaseDraft(draftId) {
      releasedDraftIds.push(draftId);
    },
  };
  const controller = createConversationImageAttachmentDraftController({
    store,
    api,
    objectUrls: {
      create: () => `blob:preview-${++nextUrlId}`,
      revoke: url => revokedUrls.push(url),
    },
    log: {
      releaseFailed: code => releaseErrorCodes.push(code),
    },
    createClientId: () => `client-${++nextClientId}`,
  });
  return {
    store,
    stages,
    releasedDraftIds,
    revokedUrls,
    releaseErrorCodes,
    controller,
  };
}

describe('conversation image attachment draft controller', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('并发上传逆序完成时仍保持用户添加顺序和提交顺序', async () => {
    const harness = createHarness();
    const first = createFile('first.png');
    const second = createFile('second.png');

    expect(harness.controller.stageFiles([first, second])).toEqual({
      kind: 'accepted',
      clientIds: ['client-1', 'client-2'],
    });
    harness.stages[1].deferred.resolve(createStageResponse(second, 'draft-second'));
    await flushPromises();
    harness.stages[0].deferred.resolve(createStageResponse(first, 'draft-first'));
    await flushPromises();

    expect(harness.store.items.map(item => [item.clientId, item.status])).toEqual([
      ['client-1', 'ready'],
      ['client-2', 'ready'],
    ]);
    expect(createConversationImageDraftSubmissionSnapshot(harness.store.items).attachments)
      .toEqual([
        { draftId: 'draft-first', kind: 'image', fileName: 'first.png' },
        { draftId: 'draft-second', kind: 'image', fileName: 'second.png' },
      ]);
  });

  it('单项失败不影响 ready 项，retry 保持 clientId、位置和 preview URL', async () => {
    const harness = createHarness();
    const first = createFile('first.png');
    const second = createFile('second.png');
    harness.controller.stageFiles([first, second]);

    harness.stages[0].deferred.resolve(createStageResponse(first, 'draft-first'));
    harness.stages[1].deferred.reject(new Error('network unavailable'));
    await flushPromises();
    const failedBeforeRetry = harness.store.items[1];
    expect(harness.store.items.map(item => item.status)).toEqual(['ready', 'failed']);

    expect(harness.controller.retry('client-2')).toBe(true);
    expect(harness.store.items[1]).toMatchObject({
      clientId: failedBeforeRetry.clientId,
      previewUrl: failedBeforeRetry.previewUrl,
      status: 'uploading',
    });
    harness.stages[2].deferred.resolve(createStageResponse(second, 'draft-second'));
    await flushPromises();
    expect(harness.store.items.map(item => [item.clientId, item.status])).toEqual([
      ['client-1', 'ready'],
      ['client-2', 'ready'],
    ]);
  });

  it('移除上传中 item 后立即 abort/revoke，晚到 draft 响应会被 release', async () => {
    const harness = createHarness();
    const file = createFile('pending.png');
    harness.controller.stageFiles([file]);

    harness.controller.remove('client-1');
    expect(harness.store.items).toEqual([]);
    expect(harness.stages[0].signal.aborted).toBe(true);
    expect(harness.revokedUrls).toEqual(['blob:preview-1']);

    harness.stages[0].deferred.resolve(createStageResponse(file, 'late-draft'));
    await flushPromises();
    expect(harness.releasedDraftIds).toEqual(['late-draft']);
    expect(harness.store.items).toEqual([]);
  });

  it('clear 立即清本地并回收 ready 与晚到 draft；commit ack 不重复 release', async () => {
    const harness = createHarness();
    const readyFile = createFile('ready.png');
    const pendingFile = createFile('pending.png');
    harness.controller.stageFiles([readyFile, pendingFile]);
    harness.stages[0].deferred.resolve(createStageResponse(readyFile, 'ready-draft'));
    await flushPromises();

    harness.controller.clear();
    expect(harness.store.items).toEqual([]);
    expect(harness.revokedUrls).toEqual(['blob:preview-1', 'blob:preview-2']);
    expect(harness.releasedDraftIds).toEqual(['ready-draft']);
    harness.stages[1].deferred.resolve(createStageResponse(pendingFile, 'late-draft'));
    await flushPromises();
    expect(harness.releasedDraftIds).toEqual(['ready-draft', 'late-draft']);

    const committedFile = createFile('committed.png');
    harness.controller.stageFiles([committedFile]);
    harness.stages[2].deferred.resolve(createStageResponse(committedFile, 'committed-draft'));
    await flushPromises();
    harness.controller.acceptCommitted();
    expect(harness.releasedDraftIds).toEqual(['ready-draft', 'late-draft']);
  });

  it('批次数量或总字节超限时整批拒绝，不创建部分 runtime 或请求', () => {
    const harness = createHarness();
    const tooMany = Array.from(
      { length: CONVERSATION_IMAGE_MAX_ATTACHMENTS + 1 },
      (_, index) => createFile(`${index}.png`),
    );
    expect(harness.controller.stageFiles(tooMany)).toEqual({
      kind: 'rejected',
      code: 'conversation.image.too_many_attachments',
    });
    expect(harness.stages).toHaveLength(0);
    expect(harness.store.items).toHaveLength(0);
    expect(harness.revokedUrls).toHaveLength(0);
  });

  it('workspace scopeWillChange 会立即清理 feature 草稿并回收晚到响应，解绑后不再响应', async () => {
    const harness = createHarness();
    const handlers = new Set<() => void>();
    const unbind = bindConversationImageDraftsToWorkspaceScope(harness.controller, {
      onScopeWillChange(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    });
    harness.controller.stageFiles([createFile('scoped.png')]);
    for (const handler of handlers) handler();
    expect(harness.store.items).toEqual([]);
    expect(harness.stages[0].signal.aborted).toBe(true);
    expect(harness.revokedUrls).toEqual(['blob:preview-1']);
    harness.stages[0].deferred.resolve(createStageResponse(
      harness.stages[0].file,
      'late-scoped-draft',
    ));
    await flushPromises();
    expect(harness.releasedDraftIds).toEqual(['late-scoped-draft']);
    unbind();
    expect(handlers.size).toBe(0);
  });
});
