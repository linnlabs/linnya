import { expect, it, vi } from 'vitest';
import type { DocumentHistoryListResponse, DocumentHistoryRestoreResponse } from '@app/schemas';
import { createHistoryPanelState } from '../store/historyPanelState';
import { createHistoryPanelController } from './createHistoryPanelController';

const versions = [
  { versionId: 'v2', order: 2, createdAt: 2000, isCurrent: true },
  { versionId: 'v1', order: 1, createdAt: 1000, isCurrent: false },
];
it('恢复携带看到的 current；冲突后刷新列表，不自动覆盖新版本', async () => {
  const store = createHistoryPanelState();
  const list = vi.fn(
    async (): Promise<DocumentHistoryListResponse> => ({
      success: true,
      recent: versions,
      earlier: [],
    })
  );
  const restore = vi.fn(async () => ({ success: false, code: 'version_conflict' }) as const);
  const controller = createHistoryPanelController('doc', store, { list, restore });
  await controller.load();
  controller.select('v1');
  list.mockResolvedValueOnce({
    success: true,
    recent: [{ versionId: 'v3', order: 3, createdAt: 3000, isCurrent: true }],
    earlier: [],
  });
  await controller.restore();
  expect(restore).toHaveBeenCalledExactlyOnceWith({
    documentId: 'doc',
    versionId: 'v1',
    expectedCurrentVersionId: 'v2',
  });
  expect(store.state.value).toMatchObject({
    phase: 'ready',
    selectedId: 'v3',
    error: 'version_conflict',
  });
});

it('关闭面板后丢弃迟到列表，不重新打开预览', async () => {
  const store = createHistoryPanelState();
  let resolve!: (value: DocumentHistoryListResponse) => void;
  const pending = new Promise<DocumentHistoryListResponse>(done => {
    resolve = done;
  });
  const controller = createHistoryPanelController('doc', store, {
    list: () => pending,
    restore: async () => ({ success: false, code: 'restore_failed' }),
  });
  const loading = controller.load();
  controller.close();
  resolve({ success: true, recent: versions, earlier: [] });
  await loading;
  expect(store.state.value).toMatchObject({ phase: 'closed', recent: [], selectedId: null });
});

it('长时间浏览不轮询；目标失效时刷新并提示，不自动恢复其他版本', async () => {
  vi.useFakeTimers();
  try {
    const store = createHistoryPanelState();
    const list = vi.fn(
      async (): Promise<DocumentHistoryListResponse> => ({
        success: true,
        recent: versions,
        earlier: [],
      })
    );
    const restore = vi.fn(async () => ({ success: false, code: 'version_not_found' }) as const);
    const controller = createHistoryPanelController('doc', store, { list, restore });
    await controller.load();
    controller.select('v1');
    await vi.advanceTimersByTimeAsync(2 * 86400_000);
    expect(list).toHaveBeenCalledOnce();
    expect(store.state.value.selectedId).toBe('v1');
    await controller.restore();
    expect(list).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledOnce();
    expect(store.state.value).toMatchObject({
      error: 'version_not_found',
      selectedId: 'v2',
      restored: false,
    });
    controller.close();
  } finally {
    vi.useRealTimers();
  }
});

it('恢复期间不可换目标，关闭后不消费迟到的成功响应，也不重开面板', async () => {
  const store = createHistoryPanelState();
  let finish!: (response: DocumentHistoryRestoreResponse) => void;
  const pending = new Promise<DocumentHistoryRestoreResponse>(resolve => {
    finish = resolve;
  });
  const list = vi.fn(
    async (): Promise<DocumentHistoryListResponse> => ({
      success: true,
      recent: versions,
      earlier: [],
    })
  );
  const restore = vi.fn(() => pending);
  const controller = createHistoryPanelController('doc', store, { list, restore });
  await controller.load();
  controller.select('v1');
  const restoring = controller.restore();
  controller.select('v2');
  expect(store.state.value.selectedId).toBe('v1');
  controller.close();
  finish({
    success: true,
    current: { versionId: 'v3', order: 3, createdAt: 3000, isCurrent: true },
  });
  await restoring;
  expect(store.state.value.phase).toBe('closed');
  expect(list).toHaveBeenCalledOnce();
  expect(restore).toHaveBeenCalledOnce();
});
