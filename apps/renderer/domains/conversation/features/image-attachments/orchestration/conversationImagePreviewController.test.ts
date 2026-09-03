import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationAttachmentRef } from '@app/schemas';
import {
  ConversationImagePreviewApiError,
  type ConversationImagePreviewItem,
} from '../definitions/conversationImagePreview';
import { createConversationImagePreviewController } from './conversationImagePreviewController';

function attachment(id: string, assetId: string): ConversationAttachmentRef {
  return {
    id,
    kind: 'image',
    assetId,
    mediaType: 'image/png',
    byteLength: 4,
    width: 2,
    height: 2,
    sha256: 'a'.repeat(64),
    fileName: `${id}.png`,
  };
}

describe('conversation image preview controller', () => {
  const loadImage = vi.fn<(
    assetId: string,
    signal: AbortSignal,
  ) => Promise<Blob>>();
  const replace = vi.fn<(items: readonly ConversationImagePreviewItem[]) => void>();
  const create = vi.fn((blob: Blob) => `blob:${blob.size}`);
  const revoke = vi.fn();

  beforeEach(() => {
    loadImage.mockReset();
    replace.mockReset();
    create.mockClear();
    revoke.mockClear();
  });

  it('保持附件顺序，并在附件移除与 dispose 时中止请求、回收 URL', async () => {
    const pending = new Map<string, (blob: Blob) => void>();
    loadImage.mockImplementation((assetId: string) => new Promise<Blob>(resolve => {
      pending.set(assetId, resolve);
    }));
    const controller = createConversationImagePreviewController({
      api: { loadImage },
      state: { replace },
      objectUrls: { create, revoke },
    });
    const first = attachment('attachment-1', 'asset-1');
    const second = attachment('attachment-2', 'asset-2');

    controller.setAttachments([first, second]);
    pending.get('asset-2')?.(new Blob(['two']));
    pending.get('asset-1')?.(new Blob(['one']));
    await Promise.resolve();
    await Promise.resolve();

    const readyItems = replace.mock.calls[replace.mock.calls.length - 1]?.[0];
    expect(readyItems?.map(item => item.attachment.id))
      .toEqual(['attachment-1', 'attachment-2']);
    controller.setAttachments([second]);
    expect(revoke).toHaveBeenCalledWith('blob:3');

    controller.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('错误只影响对应图片，retry 复用同一 durable attachment', async () => {
    loadImage
      .mockRejectedValueOnce(new ConversationImagePreviewApiError('conversation.image.asset_not_found'))
      .mockResolvedValueOnce(new Blob(['retry']));
    const controller = createConversationImagePreviewController({
      api: { loadImage },
      state: { replace },
      objectUrls: { create, revoke },
    });
    controller.setAttachments([attachment('attachment-1', 'asset-1')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(replace.mock.calls[replace.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({
      status: 'error',
      errorCode: 'conversation.image.asset_not_found',
    });
    controller.retry('attachment-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenLastCalledWith('asset-1', expect.any(AbortSignal));
    expect(replace.mock.calls[replace.mock.calls.length - 1]?.[0]?.[0]).toMatchObject({ status: 'ready' });
  });

  it('附件移除后忽略晚到响应，不创建新的 object URL', async () => {
    let resolvePending: ((blob: Blob) => void) | undefined;
    loadImage.mockImplementation(() => new Promise<Blob>(resolve => {
      resolvePending = resolve;
    }));
    const controller = createConversationImagePreviewController({
      api: { loadImage },
      state: { replace },
      objectUrls: { create, revoke },
    });

    controller.setAttachments([attachment('attachment-1', 'asset-1')]);
    controller.setAttachments([]);
    resolvePending?.(new Blob(['late']));
    await Promise.resolve();
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
    expect(replace.mock.calls[replace.mock.calls.length - 1]?.[0]).toEqual([]);
  });
});
