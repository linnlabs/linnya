import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';
import { useModelPickerStore } from '../store/modelPickerStore';
import {
  activateModelPickerProviderModel,
  loadModelPicker,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
} from './modelPickerOperations';

const snapshot: ModelPickerSnapshot = {
  providers: [],
  custom_models: [],
};

function gateway(): ModelPickerGateway {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    setProviderVisibility: vi.fn().mockResolvedValue(snapshot),
    setModelVisibility: vi.fn().mockResolvedValue(snapshot),
    activateProviderModel: vi.fn().mockResolvedValue(snapshot),
  };
}

describe('modelPickerOperations', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('只在 orchestration 中执行读取并原子替换快照', async () => {
    const target = gateway();
    await loadModelPicker(target);

    const store = useModelPickerStore();
    expect(store.snapshot).toEqual(snapshot);
    expect(store.activeOperation).toBeNull();
    expect(store.error).toBeNull();
  });

  it('Provider 开关和模型开关分别提交稳定 ID', async () => {
    const target = gateway();

    await setModelPickerProviderVisibility('configured-openai', false, target);
    await setModelPickerModelVisibility('model-gpt', true, target);

    expect(target.setProviderVisibility).toHaveBeenCalledWith('configured-openai', false);
    expect(target.setModelVisibility).toHaveBeenCalledWith('model-gpt', true);
  });

  it('未 materialize 的目录模型通过正式 onboarding 激活，不伪造本地模型 ID', async () => {
    const target = gateway();

    await activateModelPickerProviderModel('configured-openai', 'gpt-new', target);

    expect(target.activateProviderModel).toHaveBeenCalledWith('configured-openai', 'gpt-new');
  });

  it('网关失败时保留结构化操作状态并向调用方失败', async () => {
    const target = gateway();
    vi.mocked(target.load).mockRejectedValue(new Error('host unavailable'));

    await expect(loadModelPicker(target)).rejects.toThrow('host unavailable');

    const store = useModelPickerStore();
    expect(store.activeOperation).toBeNull();
    expect(store.error).toEqual({ operation: 'load', detail: 'host unavailable' });
  });
});
