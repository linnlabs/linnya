import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  toggleBlockHistoryForRootBlockId,
  type BlockHistoryToggleStore,
  type BlockHistoryVersionForToggle,
} from './toggleBlockHistoryForRootBlockId';

function createStore(options: {
  versions?: readonly BlockHistoryVersionForToggle[];
  known?: boolean;
  inHistoryMode?: boolean;
  loadRejects?: boolean;
} = {}): BlockHistoryToggleStore & {
  calls: string[];
} {
  const blockId = 'root-a';
  const calls: string[] = [];
  const versions = options.versions ?? [{ id: 'version-latest' }];
  const versionsByBlock = ref<Record<string, unknown>>(options.known ? { [blockId]: versions } : {});
  const loadedVersionsByBlock = new Map<string, readonly BlockHistoryVersionForToggle[]>();
  if (options.known) loadedVersionsByBlock.set(blockId, versions);

  return {
    calls,
    versionsByBlock,
    loadBlockHistory: vi.fn(async (_documentNodeId: string, targetBlockId: string) => {
      calls.push(`load:${targetBlockId}`);
      if (options.loadRejects) {
        throw new Error('load failed');
      }
      versionsByBlock.value[targetBlockId] = versions;
      loadedVersionsByBlock.set(targetBlockId, versions);
    }),
    getVersions: vi.fn((targetBlockId: string) => {
      return loadedVersionsByBlock.get(targetBlockId) ?? [];
    }),
    isInHistoryMode: vi.fn(() => options.inHistoryMode ?? false),
    exitHistoryMode: vi.fn((targetBlockId: string) => {
      calls.push(`exit:${targetBlockId}`);
    }),
    setViewMode: vi.fn((targetBlockId: string, mode: 'side-by-side') => {
      calls.push(`mode:${targetBlockId}:${mode}`);
    }),
    selectVersion: vi.fn((targetBlockId: string, versionId: string) => {
      calls.push(`select:${targetBlockId}:${versionId}`);
    }),
  };
}

describe('toggleBlockHistoryForRootBlockId', () => {
  it('块已处于历史模式时关闭历史模式', async () => {
    const store = createStore({ inHistoryMode: true });

    const result = await toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(result).toEqual({ ok: true, action: 'closed' });
    expect(store.calls).toEqual(['exit:root-a']);
  });

  it('加载历史版本并打开 side-by-side 最新版本', async () => {
    const store = createStore({
      versions: [{ id: 'version-2' }, { id: 'version-1' }],
    });

    const result = await toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(result).toEqual({
      ok: true,
      action: 'opened',
      selectedVersionId: 'version-2',
    });
    expect(store.calls).toEqual([
      'load:root-a',
      'mode:root-a:side-by-side',
      'select:root-a:version-2',
    ]);
  });

  it('已知版本状态时不重复加载', async () => {
    const store = createStore({ known: true });

    await toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(store.loadBlockHistory).not.toHaveBeenCalled();
    expect(store.calls).toEqual([
      'mode:root-a:side-by-side',
      'select:root-a:version-latest',
    ]);
  });

  it('没有历史版本时跳过打开', async () => {
    const store = createStore({ versions: [] });

    const result = await toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store,
    });

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'no-history-versions',
    });
    expect(store.calls).toEqual(['load:root-a']);
  });

  it('缺少必要 id 或加载失败时返回失败原因', async () => {
    await expect(toggleBlockHistoryForRootBlockId({
      documentNodeId: '',
      blockId: 'root-a',
      store: createStore(),
    })).resolves.toEqual({ ok: false, reason: 'missing-document-node-id' });

    await expect(toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: ' ',
      store: createStore(),
    })).resolves.toEqual({ ok: false, reason: 'missing-block-id' });

    const result = await toggleBlockHistoryForRootBlockId({
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      store: createStore({ loadRejects: true }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('load-failed');
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});
