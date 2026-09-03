import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_READ_SETTINGS,
  WebReadConfigurationError,
} from '../webread/definitions/webReadConfig';
import {
  normalizeWebReadConfig,
  normalizeWebReadSettings,
  toWebReadConfigView,
} from '../webread/functions/normalizeWebReadConfig';
import { projectActiveWebReadConfig } from '../webread/functions/projectActiveWebReadConfig';
import { resolveWebReadConfigUpdate } from '../webread/functions/resolveWebReadConfigUpdate';

describe('R3 网络读取配置合同', () => {
  it('新用户默认只使用本机抓取与浏览器解析，不依赖第三方凭证', () => {
    expect(DEFAULT_WEB_READ_SETTINGS).toEqual({
      renderEnabled: true,
      managedReader: 'none',
      slots: {},
    });
    expect(projectActiveWebReadConfig(DEFAULT_WEB_READ_SETTINGS)).toEqual({
      renderEnabled: true,
      managedReader: 'none',
    });
  });

  it('切换 Reader 时分别保存凭证，切回后原 Key 仍在', () => {
    const metaso = resolveWebReadConfigUpdate({
      renderEnabled: true,
      managedReader: 'metaso_reader',
      byokKey: 'metaso-key',
    });
    const jina = resolveWebReadConfigUpdate({
      renderEnabled: false,
      managedReader: 'jina_reader',
      byokKey: 'jina-key',
    }, metaso);
    const switchedBack = resolveWebReadConfigUpdate({
      renderEnabled: true,
      managedReader: 'metaso_reader',
    }, jina);

    expect(switchedBack.slots).toEqual({
      metaso_reader: { byokKey: 'metaso-key' },
      jina_reader: { byokKey: 'jina-key' },
    });
    expect(projectActiveWebReadConfig(switchedBack)).toMatchObject({
      managedReader: 'metaso_reader',
      byokKey: 'metaso-key',
    });
  });

  it('关闭托管只切换当前指针，不删除两个 Reader 的凭证', () => {
    const current = normalizeWebReadSettings({
      renderEnabled: true,
      managedReader: 'jina_reader',
      slots: {
        metaso_reader: { byokKey: 'metaso-key' },
        jina_reader: { byokKey: 'jina-key' },
      },
    });
    const disabled = resolveWebReadConfigUpdate({
      renderEnabled: false,
      managedReader: 'none',
      byokKey: 'must-not-leak',
    }, current);

    expect(disabled).toEqual({
      renderEnabled: false,
      managedReader: 'none',
      slots: current.slots,
    });
    expect(projectActiveWebReadConfig(disabled)).toEqual({
      renderEnabled: false,
      managedReader: 'none',
    });
  });

  it('Renderer 视图不返回明文，并区分磁盘 Key 与 Registry/env 可用凭证', () => {
    const settings = normalizeWebReadSettings({
      renderEnabled: true,
      managedReader: 'metaso_reader',
      slots: { metaso_reader: { byokKey: 'secret' } },
    });
    const view = toWebReadConfigView(settings, { jina_reader: true });

    expect(view).toEqual({
      renderEnabled: true,
      managedReader: 'metaso_reader',
      readers: {
        metaso_reader: { hasStoredByokKey: true, credentialAvailable: true },
        jina_reader: { hasStoredByokKey: false, credentialAvailable: true },
      },
    });
    expect(JSON.stringify(view)).not.toContain('secret');
  });

  it('拒绝未实现的 Reader、cloud 状态和错误字段类型', () => {
    const invalidInputs: unknown[] = [
      { renderEnabled: true, managedReader: 'firecrawl' },
      { renderEnabled: true, managedReader: 'metaso_reader', keySource: 'cloud' },
      { renderEnabled: 'yes', managedReader: 'metaso_reader' },
    ];
    expect(() => normalizeWebReadConfig(invalidInputs[0])).toThrow(WebReadConfigurationError);
    expect(() => normalizeWebReadConfig(invalidInputs[1])).toThrow(WebReadConfigurationError);
    expect(() => normalizeWebReadConfig(invalidInputs[2])).toThrow(WebReadConfigurationError);
  });
});
