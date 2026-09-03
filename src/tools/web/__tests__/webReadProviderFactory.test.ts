import { describe, expect, it } from 'vitest';
import { WebReadConfigurationError } from '../webread/definitions/webReadConfig';
import {
  createWebReadProvider,
  hasWebReadFallbackCredential,
} from '../webread/providers/factory';

describe('R3 显式 Web Read Provider 工厂', () => {
  it('按 Web Read 配置精确选择 Reader，不查询模型目录', () => {
    const provider = createWebReadProvider({
      renderEnabled: true,
      managedReader: 'metaso_reader',
      byokKey: 'metaso-key',
    }, {
      environment: { JINA_API_KEY: 'unrelated-jina-key' },
    });
    expect(provider.name).toBe('metaso_reader');
  });

  it('没有持久化 Key 时使用精确 Reader 自己声明的环境变量', () => {
    const dependencies = {
      environment: { JINA_API_KEY: 'env-jina-key' },
    };
    expect(hasWebReadFallbackCredential('jina_reader', dependencies)).toBe(true);
    expect(createWebReadProvider({
      renderEnabled: true,
      managedReader: 'jina_reader',
    }, dependencies).name).toBe('jina_reader_direct');
  });

  it('所选 Reader 缺凭证或显式关闭时返回具体配置错误', () => {
    expect(() => createWebReadProvider({
      renderEnabled: true,
      managedReader: 'metaso_reader',
    }, {
      environment: {},
    })).toThrow(/API Key 未配置/u);

    expect(() => createWebReadProvider({
      renderEnabled: true,
      managedReader: 'none',
    }, { environment: {} })).toThrow(WebReadConfigurationError);
  });
});
