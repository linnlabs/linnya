import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureBlockHistoryLoadedForRootBlockId,
  type BlockHistoryLoadStore,
} from './ensureBlockHistoryLoadedForRootBlockId';

function createStore(options: {
  known?: boolean;
  rejects?: boolean;
} = {}): BlockHistoryLoadStore {
  const versionsByBlock = ref<Record<string, unknown>>(
    options.known ? { 'root-a': [] } : {}
  );

  return {
    versionsByBlock,
    loadBlockHistory: vi.fn(async (_documentNodeId: string, blockId: string) => {
      if (options.rejects) throw new Error('load failed');
      versionsByBlock.value[blockId] = [];
    }),
  };
}

describe('ensureBlockHistoryLoadedForRootBlockId', () => {
  it('已知版本状态时不重复加载', async () => {
    const store = createStore({ known: true });

    const result = await ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(result).toEqual({ ok: true, action: 'already-known' });
    expect(store.loadBlockHistory).not.toHaveBeenCalled();
  });

  it('未知版本状态时加载并返回 loaded', async () => {
    const store = createStore();

    const result = await ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(result).toEqual({ ok: true, action: 'loaded' });
    expect(store.loadBlockHistory).toHaveBeenCalledWith('doc-a', 'root-a');
  });

  it('缺少必要 id 或加载失败时返回失败原因', async () => {
    await expect(ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId: '',
      blockId: 'root-a',
      store: createStore(),
    })).resolves.toEqual({ ok: false, reason: 'missing-document-node-id' });

    await expect(ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: '',
      store: createStore(),
    })).resolves.toEqual({ ok: false, reason: 'missing-block-id' });

    const result = await ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store: createStore({ rejects: true }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('load-failed');
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});
