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

import type { StorageSpaceGateway } from '../definitions/storageSpaceGateway';
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
    };

    const first = loadStorageSpaceOverview(gateway);
    const second = loadStorageSpaceOverview(gateway);
    expect(reads).toBe(1);
    read.resolve(overview());
    await Promise.all([first, second]);
    expect(reads).toBe(1);
  });

  it('坏响应或网络失败保留旧概览并显示读取失败', async () => {
    const stable = overview();
    const gateway: StorageSpaceGateway = {
      readOverview: async () => stable,
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
});
