import { describe, expect, it, vi } from 'vitest';
import type { ConversationCleanupUseCasePort } from '../../conversation-lifecycle';
import type { ManagedStorageInventoryPort } from '../index';
import { createStorageSpaceUseCase } from '../orchestration/createStorageSpaceUseCase';

function createCleanup(): ConversationCleanupUseCasePort {
  return {
    async requestWorkDirectoryClear() {
      return 'cleared';
    },
    async requestDeletion() {
      return true;
    },
    async readPendingConversationIds() {
      return new Set<string>();
    },
    async retryPending() {
      return 'not_found';
    },
    async recoverPending() {
      return {
        listedCount: 0,
        completedCount: 0,
        supersededCount: 0,
        failures: [],
      };
    },
  };
}


describe('storage-space use case', () => {
  it('概览仅请求一次物理盘点，不触发清理，原样投影分类总量', async () => {
    const measured = {
      total: { byteSize: 100, fileCount: 10 },
      categories: [
        { kind: 'conversation_work_files', byteSize: 25, fileCount: 3 },
        { kind: 'workspace', byteSize: 30, fileCount: 2 },
        { kind: 'attachments', byteSize: 15, fileCount: 1 },
        { kind: 'temporary_outputs', byteSize: 10, fileCount: 2 },
        { kind: 'diagnostic_logs', byteSize: 5, fileCount: 1 },
        { kind: 'application_data', byteSize: 15, fileCount: 1 },
      ],
    } as const;
    const inventory: ManagedStorageInventoryPort = { measure: vi.fn(async () => measured) };
    const cleanup = createCleanup();
    const clear = vi.spyOn(cleanup, 'requestWorkDirectoryClear');
    const overview = await createStorageSpaceUseCase({ inventory, cleanup, now: () => 1_786_104_001_000 }).readOverview();
    expect(overview).toEqual({ measuredAtMs: 1_786_104_001_000, ...measured });
    expect(inventory.measure).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });

  it('精准清理只转交唯一 lifecycle use case，并原样保留稳定结果', async () => {
    const cleanup = createCleanup();
    const request = vi.spyOn(cleanup, 'requestWorkDirectoryClear').mockResolvedValue('deletion_in_progress');
    const useCase = createStorageSpaceUseCase({
      inventory: { async measure() { throw new Error('cleanup must not measure'); } },
      cleanup,
    });
    await expect(useCase.clearConversationWorkDirectory('conversation/encoded')).resolves.toBe('deletion_in_progress');
    expect(request).toHaveBeenCalledWith('conversation/encoded');
  });

  it('物理总盘点失败时拒绝 overview，不把未知总量伪装成部分结果', async () => {
    const useCase = createStorageSpaceUseCase({
      inventory: { async measure() { throw new Error('inventory failed'); } },
      cleanup: createCleanup(),
    });
    await expect(useCase.readOverview()).rejects.toThrow('inventory failed');
  });
});
