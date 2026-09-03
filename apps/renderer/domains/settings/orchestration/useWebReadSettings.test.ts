import { describe, expect, it, vi } from 'vitest';
import type {
  WebReadConfig,
  WebReadConfigView,
} from '../../../../../src/tools/web/webread/definitions/webReadConfig';
import type { WebReadSettingsGateway } from './useWebReadSettings';
import { useWebReadSettings } from './useWebReadSettings';

function createGateway(initial: WebReadConfigView) {
  let current = initial;
  const set = vi.fn(async (config: WebReadConfig) => {
    if (config.managedReader !== 'none') {
      const existing = current.readers[config.managedReader];
      current = {
        renderEnabled: config.renderEnabled,
        managedReader: config.managedReader,
        readers: {
          ...current.readers,
          [config.managedReader]: {
            hasStoredByokKey: Boolean(config.byokKey) || existing.hasStoredByokKey,
            credentialAvailable: Boolean(config.byokKey) || existing.credentialAvailable,
          },
        },
      };
    } else {
      current = { ...current, renderEnabled: config.renderEnabled, managedReader: 'none' };
    }
    return { success: true as const, data: current };
  });
  const testConnection = vi.fn(async () => ({
    success: true as const,
    data: { provider: 'fixture_reader', charCount: 512, tookMs: 42 },
  }));
  const gateway: WebReadSettingsGateway = {
    get: async () => ({ success: true, data: current }),
    set,
    testConnection,
  };
  return { gateway, set, testConnection };
}

function createView(): WebReadConfigView {
  return {
    renderEnabled: true,
    managedReader: 'metaso_reader',
    readers: {
      metaso_reader: { hasStoredByokKey: true, credentialAvailable: true },
      jina_reader: { hasStoredByokKey: false, credentialAvailable: false },
    },
  };
}

describe('网络读取设置编排', () => {
  it('加载已存 Key 时不回读明文，留空保存继续使用原凭证', async () => {
    const fixture = createGateway(createView());
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();

    expect(settings.hasStoredKeyForCurrentReader.value).toBe(true);
    expect(settings.byokKey.value).toBe('');
    await settings.save();

    expect(fixture.set).toHaveBeenCalledWith({
      renderEnabled: true,
      managedReader: 'metaso_reader',
    });
  });

  it('切换 Reader 后使用对应凭证状态，不复用上一家的 Key', async () => {
    const fixture = createGateway(createView());
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();

    settings.selectManagedReader('jina_reader');
    expect(settings.hasStoredKeyForCurrentReader.value).toBe(false);
    await settings.testConnection();
    expect(settings.validationError.value).toBe('missing_byok_key');
    expect(fixture.testConnection).not.toHaveBeenCalled();

    settings.byokKey.value = 'jina-key';
    await settings.testConnection();
    expect(fixture.testConnection).toHaveBeenCalledWith({
      renderEnabled: true,
      managedReader: 'jina_reader',
      byokKey: 'jina-key',
    });
  });

  it('Registry/env 提供可用凭证时无需重复填写 Key', async () => {
    const view = createView();
    const fixture = createGateway({
      ...view,
      managedReader: 'jina_reader',
      readers: {
        ...view.readers,
        jina_reader: { hasStoredByokKey: false, credentialAvailable: true },
      },
    });
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();
    await settings.testConnection();

    expect(fixture.testConnection).toHaveBeenCalledWith({
      renderEnabled: true,
      managedReader: 'jina_reader',
    });
  });

  it('关闭托管只保存渲染开关，不发连接测试', async () => {
    const fixture = createGateway(createView());
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();
    settings.renderEnabled.value = false;
    await settings.setManagedEnabled(false);

    await settings.testConnection();
    expect(fixture.testConnection).not.toHaveBeenCalled();
    expect(fixture.set).toHaveBeenCalledWith({ renderEnabled: false, managedReader: 'none' });
  });

  it('第三方解析开关关闭后，再次打开恢复本次最后选择的 Reader', async () => {
    const fixture = createGateway(createView());
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();
    settings.selectManagedReader('jina_reader');

    await settings.setManagedEnabled(false);
    expect(settings.managedEnabled.value).toBe(false);
    expect(settings.managedReader.value).toBe('none');

    await settings.setManagedEnabled(true);
    expect(settings.managedEnabled.value).toBe(true);
    expect(settings.managedReader.value).toBe('jina_reader');
  });

  it('第三方解析关闭时，切换本机渲染会立即保存', async () => {
    const view = createView();
    const fixture = createGateway({ ...view, managedReader: 'none' });
    const settings = useWebReadSettings(fixture.gateway);
    await settings.load();

    await settings.setRenderEnabled(false);

    expect(fixture.set).toHaveBeenCalledWith({ renderEnabled: false, managedReader: 'none' });
    expect(settings.renderEnabled.value).toBe(false);
  });
});
