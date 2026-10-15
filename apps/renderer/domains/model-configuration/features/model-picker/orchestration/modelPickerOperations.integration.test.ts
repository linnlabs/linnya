import type { ModelPickerSnapshot } from '@app/schemas/model-picker';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelPickerGateway } from '../definitions/modelPickerGateway';
import { useModelPickerStore } from '../store/modelPickerStore';
import {
  activateModelPickerProviderModel,
  loadModelPicker,
  removeCommittedModelsFromPicker,
  synchronizeModelPickerSnapshot,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
} from './modelPickerOperations';

const snapshot: ModelPickerSnapshot = {
  providers: [],
  custom_models: [],
};

function gateway(): ModelPickerGateway {
  return {
    refreshProviderModels: vi.fn(),
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

  it('后台目录通知不清除用户刚收到的刷新错误，也不结束用户操作', async () => {
    const store = useModelPickerStore();
    store.failOperation({ operation: 'load', detail: '供应商鉴权失败' });
    await synchronizeModelPickerSnapshot(gateway());
    expect(store.error?.detail).toBe('供应商鉴权失败');
    store.beginOperation('model-activation');
    await synchronizeModelPickerSnapshot(gateway());
    expect(store.activeOperation).toBe('model-activation');
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
  it('旧读取完成后才执行开关写入，后台通知不能用旧快照覆盖新选择', async () => {
    const target = gateway();
    let complete!: (value: ModelPickerSnapshot) => void;
    vi.mocked(target.load).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        })
    );
    const loading = synchronizeModelPickerSnapshot(target);
    const changing = setModelPickerModelVisibility('model-gpt', false, target);
    await vi.waitFor(() => expect(target.load).toHaveBeenCalledOnce());
    expect(target.setModelVisibility).not.toHaveBeenCalled();
    complete(snapshot);
    await Promise.all([loading, changing]);
    expect(target.setModelVisibility).toHaveBeenCalledOnce();
    expect(useModelPickerStore().activeOperation).toBeNull();
  });

  it('请求队列按 Pinia 作用域隔离，失败后后续操作可以继续', async () => {
    const first = gateway();
    let reject!: (error: Error) => void;
    vi.mocked(first.load).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const pending = loadModelPicker(first);
    const assertion = expect(pending).rejects.toThrow('offline');
    const firstStore = useModelPickerStore();
    const changing = setModelPickerModelVisibility('a', false, first);
    setActivePinia(createPinia());
    const second = gateway();
    await loadModelPicker(second);
    expect(second.load).toHaveBeenCalledOnce();
    reject(new Error('offline'));
    await assertion;
    await changing;
    expect(firstStore.error).toBeNull();
  });

  it('正式删除投影排在旧 Picker 读取之后，移除最后一个模型仍保留空分组', async () => {
    const target = gateway();
    const oldSnapshot: ModelPickerSnapshot = {
      ...snapshot,
      custom_models: [{
        materialized: true,
        model_config_id: 'removed',
        display_name: 'Removed',
        picker_enabled: true,
        runtime_available: true,
        capabilities: ['chat'],
        image_input: false,
      }],
    };
    oldSnapshot.custom_providers = [{
      provider_id: 'custom:Relay',
      provider_name: 'Relay',
      models: oldSnapshot.custom_models,
    }];
    let complete!: (value: ModelPickerSnapshot) => void;
    vi.mocked(target.load).mockImplementationOnce(
      () => new Promise(resolve => { complete = resolve; })
    );
    const loading = synchronizeModelPickerSnapshot(target);
    const removing = removeCommittedModelsFromPicker(['removed']);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    complete(oldSnapshot);
    await Promise.all([loading, removing]);
    expect(useModelPickerStore().snapshot?.custom_models).toEqual([]);
    expect(useModelPickerStore().snapshot?.custom_providers).toEqual([{
      provider_id: 'custom:Relay',
      provider_name: 'Relay',
      models: [],
    }]);
  });
});
