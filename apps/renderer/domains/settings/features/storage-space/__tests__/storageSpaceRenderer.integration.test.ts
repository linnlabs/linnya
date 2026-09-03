import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StorageSpaceOverviewResponseSchema,
  type StorageSpaceOverviewResponse,
} from '@app/schemas';

vi.mock('@shared/services/aiService/common', () => ({
  apiFetch: vi.fn(),
  getApiBaseUrl: vi.fn(),
}));

import {
  StorageSpaceGatewayError,
  type StorageSpaceGateway,
} from '../definitions/storageSpaceGateway';
import { clearConversationWorkDirectory } from '../orchestration/clearConversationWorkDirectory';
import { loadStorageSpaceOverview } from '../orchestration/loadStorageSpaceOverview';
import { useStorageSpaceStore } from '../store/storageSpaceStore';

const CATEGORY_KINDS = [
  'conversation_work_files',
  'workspace',
  'attachments',
  'temporary_outputs',
  'diagnostic_logs',
  'application_data',
] as const;

function overview(input: {
  readonly measuredAtMs?: number;
  readonly conversations?: StorageSpaceOverviewResponse['conversations'];
  readonly categoryBytes?: readonly number[];
} = {}): StorageSpaceOverviewResponse {
  const categoryBytes = input.categoryBytes ?? [9, 8, 7, 6, 5, 4];
  return StorageSpaceOverviewResponseSchema.parse({
    measured_at_ms: input.measuredAtMs ?? 1_786_104_003_000,
    total_byte_size: categoryBytes.reduce((total, value) => total + value, 0),
    categories: CATEGORY_KINDS.map((kind, index) => ({
      kind,
      byte_size: categoryBytes[index],
    })),
    conversations: input.conversations ?? [{
      conversation_id: 'conversation-a',
      title: '报告整理',
      project_id: null,
      work_files_state: 'available',
      byte_size: 9,
      file_count: 1,
    }],
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error('deferred promise was not initialized');
      resolvePromise(value);
    },
  };
}

describe('storage-space renderer orchestration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('首次加载与手动刷新使用后端事实替换概览', async () => {
    const responses = [overview(), overview({ measuredAtMs: 1_786_104_004_000 })];
    const gateway: StorageSpaceGateway = {
      readOverview: async () => {
        const next = responses.shift();
        if (!next) throw new Error('missing overview fixture');
        return next;
      },
      clearConversationWorkDirectory: async () => {},
    };

    await loadStorageSpaceOverview(gateway);
    expect(useStorageSpaceStore().overview?.measured_at_ms).toBe(1_786_104_003_000);
    await loadStorageSpaceOverview(gateway);
    expect(useStorageSpaceStore().overview?.measured_at_ms).toBe(1_786_104_004_000);
  });

  it('同一页面并发刷新只读取一次', async () => {
    const read = deferred<StorageSpaceOverviewResponse>();
    let reads = 0;
    const gateway: StorageSpaceGateway = {
      readOverview: () => {
        reads += 1;
        return read.promise;
      },
      clearConversationWorkDirectory: async () => {},
    };

    const first = loadStorageSpaceOverview(gateway);
    const second = loadStorageSpaceOverview(gateway);
    expect(reads).toBe(1);
    read.resolve(overview());
    await Promise.all([first, second]);
    expect(reads).toBe(1);
  });

  it('用户取消确认时不发送删除请求', async () => {
    let clears = 0;
    const gateway: StorageSpaceGateway = {
      readOverview: async () => overview(),
      clearConversationWorkDirectory: async () => {
        clears += 1;
      },
    };

    await clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => false,
      gateway,
    });
    expect(clears).toBe(0);
    expect(useStorageSpaceStore().pendingConversationIds).toEqual([]);
  });

  it('同一对话从确认阶段开始去重，204 后重新读取概览', async () => {
    const confirmation = deferred<boolean>();
    const calls: string[] = [];
    const afterClear = overview({
      conversations: [{
        conversation_id: 'conversation-a',
        title: '报告整理',
        project_id: null,
        work_files_state: 'previous_files_unavailable',
        byte_size: 0,
        file_count: 0,
      }],
      categoryBytes: [0, 8, 7, 6, 5, 4],
    });
    const gateway: StorageSpaceGateway = {
      readOverview: async () => {
        calls.push('read');
        return afterClear;
      },
      clearConversationWorkDirectory: async () => {
        calls.push('clear');
      },
    };

    const first = clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: () => confirmation.promise,
      gateway,
    });
    const second = clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => true,
      gateway,
    });
    confirmation.resolve(true);
    await Promise.all([first, second]);

    expect(calls).toEqual(['clear', 'read']);
    expect(useStorageSpaceStore().overview).toEqual(afterClear);
    expect(useStorageSpaceStore().pendingConversationIds).toEqual([]);
  });

  it.each([
    ['storage_space.conversation_not_found', 'not_found'],
    ['storage_space.conversation_deletion_in_progress', 'deletion_in_progress'],
    ['storage_space.work_directory_clear_failed', 'failed'],
  ] as const)('把 %s 映射为稳定行失败 %s', async (code, expected) => {
    const gateway: StorageSpaceGateway = {
      readOverview: async () => overview(),
      clearConversationWorkDirectory: async () => {
        throw new StorageSpaceGatewayError(code);
      },
    };
    await clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => true,
      gateway,
    });
    expect(useStorageSpaceStore().failureFor('conversation-a')).toBe(expected);
    expect(useStorageSpaceStore().pendingConversationIds).toEqual([]);
  });

  it('保留名称身份不会污染或误读其他行失败状态', async () => {
    const gateway: StorageSpaceGateway = {
      readOverview: async () => overview(),
      clearConversationWorkDirectory: async () => {
        throw new StorageSpaceGatewayError('storage_space.conversation_not_found');
      },
    };
    await clearConversationWorkDirectory({
      conversationId: '__proto__',
      confirmClear: async () => true,
      gateway,
    });
    expect(useStorageSpaceStore().failureFor('__proto__')).toBe('not_found');
    expect(useStorageSpaceStore().failureFor('constructor')).toBeUndefined();
  });

  it('不同对话可以同时清理，一个 pending 不锁住另一行', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const gateway: StorageSpaceGateway = {
      readOverview: async () => overview({ conversations: [] }),
      clearConversationWorkDirectory: id => id === 'conversation-a'
        ? first.promise
        : second.promise,
    };

    const clearA = clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => true,
      gateway,
    });
    const clearB = clearConversationWorkDirectory({
      conversationId: 'conversation-b',
      confirmClear: async () => true,
      gateway,
    });
    await Promise.resolve();
    expect(useStorageSpaceStore().pendingConversationIds).toEqual([
      'conversation-a',
      'conversation-b',
    ]);

    first.resolve();
    second.resolve();
    await Promise.all([clearA, clearB]);
  });

  it('不同对话删除同时完成时串行读取，较旧概览不会覆盖较新事实', async () => {
    const firstRead = deferred<StorageSpaceOverviewResponse>();
    const secondRead = deferred<StorageSpaceOverviewResponse>();
    const secondReadStarted = deferred<void>();
    let activeReads = 0;
    let maximumActiveReads = 0;
    let readCount = 0;
    const gateway: StorageSpaceGateway = {
      readOverview: async () => {
        readCount += 1;
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        if (readCount === 2) secondReadStarted.resolve();
        const snapshot = await (readCount === 1 ? firstRead.promise : secondRead.promise);
        activeReads -= 1;
        return snapshot;
      },
      clearConversationWorkDirectory: async () => {},
    };

    const clearA = clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => true,
      gateway,
    });
    const clearB = clearConversationWorkDirectory({
      conversationId: 'conversation-b',
      confirmClear: async () => true,
      gateway,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(readCount).toBe(1);
    firstRead.resolve(overview({ measuredAtMs: 1_786_104_004_000 }));
    await secondReadStarted.promise;
    expect(readCount).toBe(2);
    secondRead.resolve(overview({ measuredAtMs: 1_786_104_005_000 }));
    await Promise.all([clearA, clearB]);

    expect(maximumActiveReads).toBe(1);
    expect(useStorageSpaceStore().overview?.measured_at_ms).toBe(1_786_104_005_000);
  });

  it('坏响应或网络失败保留旧概览并显示读取失败', async () => {
    const stable = overview();
    const gateway: StorageSpaceGateway = {
      readOverview: async () => stable,
      clearConversationWorkDirectory: async () => {},
    };
    await loadStorageSpaceOverview(gateway);
    await loadStorageSpaceOverview({
      ...gateway,
      readOverview: async () => {
        throw new Error('invalid response');
      },
    });
    expect(useStorageSpaceStore().loadState).toBe('failed');
    expect(useStorageSpaceStore().overview).toEqual(stable);
  });

  it('DELETE 已成功但重新读取失败时保留旧概览并明确失败', async () => {
    const stable = overview();
    const gateway: StorageSpaceGateway = {
      readOverview: async () => {
        throw new Error('reload failed');
      },
      clearConversationWorkDirectory: async () => {},
    };
    useStorageSpaceStore().loadSucceeded(stable);

    await clearConversationWorkDirectory({
      conversationId: 'conversation-a',
      confirmClear: async () => true,
      gateway,
    });

    expect(useStorageSpaceStore().overview).toEqual(stable);
    expect(useStorageSpaceStore().loadState).toBe('failed');
    expect(useStorageSpaceStore().failureFor('conversation-a')).toBe('failed');
    expect(useStorageSpaceStore().pendingConversationIds).toEqual([]);
  });
});
