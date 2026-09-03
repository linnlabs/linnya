import { createServer, type Server } from 'node:http';

import {
  StorageSpaceErrorResponseSchema,
  StorageSpaceOverviewResponseSchema,
} from '@app/schemas';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  StorageSpaceUseCasePort,
} from '../../app-hosts/linnya/application/storage-space';
import { createStorageSpaceRouter } from './storageSpace.router';

const EMPTY_OVERVIEW = {
  measuredAtMs: 1_786_104_002_000,
  total: { byteSize: 0, fileCount: 0 },
  categories: [
    { kind: 'conversation_work_files', byteSize: 0, fileCount: 0 },
    { kind: 'workspace', byteSize: 0, fileCount: 0 },
    { kind: 'attachments', byteSize: 0, fileCount: 0 },
    { kind: 'temporary_outputs', byteSize: 0, fileCount: 0 },
    { kind: 'diagnostic_logs', byteSize: 0, fileCount: 0 },
    { kind: 'application_data', byteSize: 0, fileCount: 0 },
  ],
  conversations: [],
} as const;

async function start(useCase: StorageSpaceUseCasePort): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> {
  const app = express();
  app.use('/api/v1/storage-space', createStorageSpaceRouter(useCase));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('storage-space test server did not expose a TCP address');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function createUseCase(): StorageSpaceUseCasePort {
  return {
    async readOverview() {
      return EMPTY_OVERVIEW;
    },
    async clearConversationWorkDirectory() {
      return 'cleared';
    },
  };
}

describe('storage-space HTTP router', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(closeServer));
  });

  async function listen(useCase: StorageSpaceUseCasePort): Promise<string> {
    const running = await start(useCase);
    servers.push(running.server);
    return running.baseUrl;
  }

  it('返回由共享 schema 验证的六类概览，并禁止缓存非事务快照', async () => {
    const baseUrl = await listen(createUseCase());
    const response = await fetch(`${baseUrl}/api/v1/storage-space/overview`);
    const body = StorageSpaceOverviewResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      measured_at_ms: EMPTY_OVERVIEW.measuredAtMs,
      total_byte_size: 0,
      categories: EMPTY_OVERVIEW.categories.map(category => ({
        kind: category.kind,
        byte_size: category.byteSize,
      })),
      conversations: [],
    });
  });

  it('把带斜杠和反斜杠的合法身份原样交给 use case，并将 cleared 映射为 204', async () => {
    const useCase = createUseCase();
    const clear = vi.spyOn(useCase, 'clearConversationWorkDirectory');
    const baseUrl = await listen(useCase);
    const identities = ['conversation/with/slash', 'conversation\\with\\backslash'];

    for (const identity of identities) {
      const response = await fetch(
        `${baseUrl}/api/v1/storage-space/conversations/${encodeURIComponent(identity)}/work-directory`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(204);
    }
    expect(clear.mock.calls).toEqual(identities.map(identity => [identity]));
  });

  it.each([
    ['not_found', 404, 'storage_space.conversation_not_found'],
    ['deletion_in_progress', 409, 'storage_space.conversation_deletion_in_progress'],
  ] as const)('把 %s 映射为稳定错误合同', async (result, status, code) => {
    const useCase = createUseCase();
    vi.spyOn(useCase, 'clearConversationWorkDirectory').mockResolvedValue(result);
    const baseUrl = await listen(useCase);
    const response = await fetch(
      `${baseUrl}/api/v1/storage-space/conversations/conversation-a/work-directory`,
      { method: 'DELETE' },
    );

    expect(response.status).toBe(status);
    expect(StorageSpaceErrorResponseSchema.parse(await response.json())).toEqual({ code });
  });

  it('拒绝空白身份且不调用清理流程', async () => {
    const useCase = createUseCase();
    const clear = vi.spyOn(useCase, 'clearConversationWorkDirectory');
    const baseUrl = await listen(useCase);
    const response = await fetch(
      `${baseUrl}/api/v1/storage-space/conversations/%20/work-directory`,
      { method: 'DELETE' },
    );

    expect(response.status).toBe(400);
    expect(StorageSpaceErrorResponseSchema.parse(await response.json())).toEqual({
      code: 'storage_space.invalid_conversation_id',
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it.each([
    ['overview', 'GET', 'storage_space.overview_failed'],
    ['conversations/conversation-a/work-directory', 'DELETE', 'storage_space.work_directory_clear_failed'],
  ] as const)('内部失败只返回 code，不泄漏路径或异常详情', async (path, method, code) => {
    const useCase = createUseCase();
    if (method === 'GET') {
      vi.spyOn(useCase, 'readOverview')
        .mockRejectedValue(new Error('EACCES /Users/private/secret'));
    } else {
      vi.spyOn(useCase, 'clearConversationWorkDirectory')
        .mockRejectedValue(new Error('EACCES /Users/private/secret'));
    }
    const baseUrl = await listen(useCase);
    const response = await fetch(`${baseUrl}/api/v1/storage-space/${path}`, { method });
    const rawBody: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(StorageSpaceErrorResponseSchema.parse(rawBody)).toEqual({ code });
    expect(JSON.stringify(rawBody)).not.toContain('/Users/private');
    expect(JSON.stringify(rawBody)).not.toContain('EACCES');
  });
});
