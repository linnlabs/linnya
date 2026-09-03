import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogGateway } from '../definitions/modelCatalogGateway';
import { useModelCatalogStore } from '../store/modelCatalogStore';
import {
  deleteModelFromCatalog,
  loadModelCatalog,
  updateModelInCatalog,
} from './modelCatalogOperations';

function createGateway(): ModelCatalogGateway {
  return {
    load: vi.fn().mockResolvedValue({
      models: [{ id: 'custom-1', catalog_source: 'user', display_name: 'Before' }],
      purposeDefaults: { autocomplete: 'custom-1' },
      cloudModelsReady: true,
    }),
    update: vi.fn().mockResolvedValue({
      id: 'custom-1',
      catalog_source: 'user',
      display_name: 'After',
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('model catalog operations', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('按 load → update → delete 流程同步目录 read model', async () => {
    const gateway = createGateway();
    const store = useModelCatalogStore();

    await loadModelCatalog(gateway);
    expect(store.models).toEqual([{ id: 'custom-1', catalog_source: 'user', display_name: 'Before' }]);
    expect(store.purposeDefaults).toEqual({ autocomplete: 'custom-1' });
    expect(store.cloudModelsReady).toBe(true);

    await updateModelInCatalog('custom-1', { display_name: 'After' }, gateway);
    expect(store.models[0]?.display_name).toBe('After');

    await deleteModelFromCatalog('custom-1', gateway);
    expect(store.models).toEqual([]);
    expect(store.activeOperation).toBeNull();
  });

  it('网关失败时保留现有目录并记录有业务含义的 operation', async () => {
    const gateway = createGateway();
    const store = useModelCatalogStore();
    await loadModelCatalog(gateway);
    vi.mocked(gateway.update).mockRejectedValueOnce(new Error('上游拒绝更新'));

    await expect(updateModelInCatalog('custom-1', { display_name: 'After' }, gateway))
      .rejects.toThrow('上游拒绝更新');

    expect(store.models[0]?.display_name).toBe('Before');
    expect(store.error).toEqual({ operation: 'update', detail: '上游拒绝更新' });
    expect(store.activeOperation).toBeNull();
  });
});
