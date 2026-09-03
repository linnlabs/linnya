import { describe, expect, it, vi } from 'vitest';
import type {
  BeginProviderModelRemovalInput,
  PendingProviderModelRemoval,
} from 'src/domains/provider-configuration';

import { createConfiguredModelRemovalUseCase } from './createConfiguredModelRemovalUseCase';

function dependencies() {
  const beginModelRemoval = vi.fn<
    (input: BeginProviderModelRemovalInput) => Promise<PendingProviderModelRemoval | null>
  >(async () => ({ id: 'removal-1', model_config_id: 'model-1' }));
  return {
    modelCatalog: { removeModel: vi.fn(async () => undefined) },
    providerConfigurations: {
      beginModelRemoval,
      completeModelRemoval: vi.fn(async () => undefined),
      cancelModelRemoval: vi.fn(async () => undefined),
    },
    modelPickerPreferences: {
      removeModelPreference: vi.fn(async () => undefined),
    },
    idFactory: { create: () => 'removal-1' },
  };
}

describe('createConfiguredModelRemovalUseCase', () => {
  it('正式 Provider 模型按 intent -> catalog -> picker preference -> association 顺序删除', async () => {
    const ports = dependencies();
    const order: string[] = [];
    ports.providerConfigurations.beginModelRemoval.mockImplementationOnce(async () => {
      order.push('begin');
      return { id: 'removal-1', model_config_id: 'model-1' };
    });
    ports.modelCatalog.removeModel.mockImplementationOnce(async () => {
      order.push('catalog');
    });
    ports.modelPickerPreferences.removeModelPreference.mockImplementationOnce(async () => {
      order.push('preference');
    });
    ports.providerConfigurations.completeModelRemoval.mockImplementationOnce(async () => {
      order.push('complete');
    });
    const useCase = createConfiguredModelRemovalUseCase(ports);

    await expect(useCase.remove('model-1')).resolves.toEqual({
      provider_association_recovery_pending: false,
      model_picker_preference_recovery_pending: false,
    });
    expect(order).toEqual(['begin', 'catalog', 'preference', 'complete']);
  });

  it('Custom API 模型不创建 Provider 归属，只删除 Model Catalog', async () => {
    const ports = dependencies();
    ports.providerConfigurations.beginModelRemoval.mockResolvedValueOnce(null);
    const useCase = createConfiguredModelRemovalUseCase(ports);

    await useCase.remove('custom-model');

    expect(ports.modelCatalog.removeModel).toHaveBeenCalledWith('custom-model');
    expect(ports.modelPickerPreferences.removeModelPreference).toHaveBeenCalledWith('custom-model');
    expect(ports.providerConfigurations.completeModelRemoval).not.toHaveBeenCalled();
  });

  it('Model Catalog 删除失败时撤销归属 intent', async () => {
    const ports = dependencies();
    ports.modelCatalog.removeModel.mockRejectedValueOnce(new Error('disk unavailable'));
    const useCase = createConfiguredModelRemovalUseCase(ports);

    await expect(useCase.remove('model-1')).rejects.toThrow('disk unavailable');
    expect(ports.providerConfigurations.cancelModelRemoval).toHaveBeenCalledWith('removal-1');
  });

  it('模型已删除但归属提交失败时报告待启动恢复，不谎报删除失败', async () => {
    const ports = dependencies();
    ports.providerConfigurations.completeModelRemoval.mockRejectedValueOnce(
      new Error('disk unavailable')
    );
    const useCase = createConfiguredModelRemovalUseCase(ports);

    await expect(useCase.remove('model-1')).resolves.toEqual({
      provider_association_recovery_pending: true,
      model_picker_preference_recovery_pending: false,
    });
  });

  it('偏好删除失败不阻断归属提交，并报告由启动 reconcile 恢复', async () => {
    const ports = dependencies();
    ports.modelPickerPreferences.removeModelPreference.mockRejectedValueOnce(
      new Error('disk unavailable'),
    );
    const useCase = createConfiguredModelRemovalUseCase(ports);

    await expect(useCase.remove('model-1')).resolves.toEqual({
      provider_association_recovery_pending: false,
      model_picker_preference_recovery_pending: true,
    });
    expect(ports.providerConfigurations.completeModelRemoval).toHaveBeenCalledWith('removal-1');
  });
});
