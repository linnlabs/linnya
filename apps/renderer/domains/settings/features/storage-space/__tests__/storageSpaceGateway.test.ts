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


  it('非成功响应只接受共享错误合同', async () => {
    const known = createStorageSpaceGateway({
      getBaseUrl: async () => 'http://127.0.0.1:3000',
      fetch: async () => new Response(JSON.stringify({
        code: 'storage_space.overview_failed',
      }), { status: 500 }),
    });
    await expect(known.readOverview()).rejects.toEqual(
      new StorageSpaceGatewayError('storage_space.overview_failed'),
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
