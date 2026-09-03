import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), getApiBaseUrl: vi.fn() }));
vi.mock('../../../../../shared/services/aiService/common', () => mocks);

import { ConversationImagePreviewApiError } from '../definitions/conversationImagePreview';
import { conversationImagePreviewApi } from './conversationImagePreviewApi';

describe('conversation image preview api', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.getApiBaseUrl.mockReset();
    mocks.getApiBaseUrl.mockResolvedValue('http://workspace.local');
  });

  it('只按编码后的 asset ID 读取鉴权图片内容', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    mocks.apiFetch.mockResolvedValue(new Response(blob, { status: 200 }));
    const signal = new AbortController().signal;

    await expect(conversationImagePreviewApi.loadImage('asset/one', signal))
      .resolves.toEqual(expect.objectContaining({ type: 'image/png', size: 5 }));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      'http://workspace.local/api/v1/conversation/assets/images/asset%2Fone/content',
      { headers: { Accept: 'image/*' }, signal },
    );
  });

  it('保留 host 稳定错误码，并把未知响应收口为通用 preview 错误', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 'conversation.image.asset_integrity_failed',
    }), { status: 422 }));
    await expect(conversationImagePreviewApi.loadImage(
      'asset-corrupt',
      new AbortController().signal,
    )).rejects.toEqual(new ConversationImagePreviewApiError(
      'conversation.image.asset_integrity_failed',
    ));

    mocks.apiFetch.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    await expect(conversationImagePreviewApi.loadImage(
      'asset-failed',
      new AbortController().signal,
    )).rejects.toEqual(new ConversationImagePreviewApiError('conversation.image.preview_failed'));
  });
});
