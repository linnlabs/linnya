import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteConfiguredModel } = vi.hoisted(() => ({
  deleteConfiguredModel: vi.fn(async () => undefined),
}));

vi.mock('./deleteConfiguredModel', () => ({ deleteConfiguredModel }));

import { removeConfiguredProvider } from './removeConfiguredProvider';

describe('removeConfiguredProvider', () => {
  beforeEach(() => {
    deleteConfiguredModel.mockClear();
  });

  it('按稳定顺序删除 Provider 的全部已激活模型', async () => {
    await removeConfiguredProvider(['model-a', 'model-b']);

    expect(deleteConfiguredModel).toHaveBeenNthCalledWith(1, 'model-a');
    expect(deleteConfiguredModel).toHaveBeenNthCalledWith(2, 'model-b');
  });
});
