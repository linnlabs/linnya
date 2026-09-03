import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/services/aiService/common', () => ({
  apiFetch: vi.fn(),
  getApiBaseUrl: vi.fn(),
}));

import { StorageSpaceGatewayError } from '../definitions/storageSpaceGateway';
import { createStorageSpaceGateway } from '../infrastructure/storageSpaceGateway';

const VALID_OVERVIEW = {
  measured_at_ms: 1,
  total_byte_size: 0,
  categories: [
    { kind: 'conversation_work_files', byte_size: 0 },
    { kind: 'workspace', byte_size: 0 },
    { kind: 'attachments', byte_size: 0 },
    { kind: 'temporary_outputs', byte_size: 0 },
    { kind: 'diagnostic_logs', byte_size: 0 },
    { kind: 'application_data', byte_size: 0 },
  ],
  conversations: [],
};

describe('storage-space HTTP gateway', () => {
  it('严格解析 overview，拒绝后端增加的未知字段', async () => {
    const gateway = createStorageSpaceGateway({
      getBaseUrl: async () => 'http://127.0.0.1:3000',
      fetch: async () => new Response(JSON.stringify({
        ...VALID_OVERVIEW,
        internal_path: '/private/path',
      }), { status: 200 }),
    });
    await expect(gateway.readOverview()).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('编码对话身份，并且 204 不读取空响应正文', async () => {
    let requestedUrl = '';
    const gateway = createStorageSpaceGateway({
      getBaseUrl: async () => 'http://127.0.0.1:3000',
      fetch: async (input) => {
        requestedUrl = String(input);
        return new Response(null, { status: 204 });
      },
    });
    await gateway.clearConversationWorkDirectory('conversation/a b');
    expect(requestedUrl.endsWith(
      '/conversations/conversation%2Fa%20b/work-directory',
    )).toBe(true);
  });

  it('非成功响应只接受共享错误合同', async () => {
    const known = createStorageSpaceGateway({
      getBaseUrl: async () => 'http://127.0.0.1:3000',
      fetch: async () => new Response(JSON.stringify({
        code: 'storage_space.conversation_not_found',
      }), { status: 404 }),
    });
    await expect(known.clearConversationWorkDirectory('conversation-a')).rejects.toEqual(
      new StorageSpaceGatewayError('storage_space.conversation_not_found'),
    );

    const malformed = createStorageSpaceGateway({
      getBaseUrl: async () => 'http://127.0.0.1:3000',
      fetch: async () => new Response(JSON.stringify({ message: 'internal path leaked' }), {
        status: 500,
      }),
    });
    await expect(malformed.readOverview()).rejects.toMatchObject({ name: 'ZodError' });
  });
});
