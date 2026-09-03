import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getApiBaseUrl: vi.fn(),
}));

vi.mock('../../../../../shared/services/aiService/common', () => mocks);

import { ConversationImageAttachmentApiError } from '../definitions/conversationImageAttachmentDraft';
import { conversationImageAttachmentApi } from './conversationImageAttachmentApi';

describe('conversation image attachment api', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.getApiBaseUrl.mockReset();
    mocks.getApiBaseUrl.mockResolvedValue('http://workspace.local');
  });

  it('以单文件 FormData staging 并严格解析 host response', async () => {
    const responseBody = {
      draft: { draftId: 'draft-1', kind: 'image', fileName: 'photo.png' },
      mediaType: 'image/png',
      byteLength: 4,
      width: 2,
      height: 2,
      sha256: 'a'.repeat(64),
    };
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    const controller = new AbortController();

    await expect(conversationImageAttachmentApi.stageFile(file, controller.signal))
      .resolves.toEqual(responseBody);
    const request = mocks.apiFetch.mock.calls[0];
    expect(request[0]).toBe('http://workspace.local/api/v1/conversation/attachments/images');
    expect(request[1]).toMatchObject({ method: 'POST', signal: controller.signal });
    const body = request[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body instanceof FormData ? body.get('file') : null).toBeInstanceOf(File);
  });

  it('拒绝 malformed 成功响应，保留稳定安全错误 code', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ draftId: 'draft-1' }), {
      status: 200,
    }));

    await expect(conversationImageAttachmentApi.stageFile(
      new File(['data'], 'photo.png'),
      new AbortController().signal,
    )).rejects.toEqual(new ConversationImageAttachmentApiError('conversation.image.staging_failed'));
  });

  it('release 对 draft ID 做 URL 编码并使用 DELETE', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await conversationImageAttachmentApi.releaseDraft('draft/one');
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      'http://workspace.local/api/v1/conversation/attachments/images/draft%2Fone',
      { method: 'DELETE' },
    );
  });
});
