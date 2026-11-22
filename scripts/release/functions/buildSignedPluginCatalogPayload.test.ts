import { describe, expect, it } from 'vitest';

import { buildSignedPluginCatalogPayload, MAX_PLUGIN_CATALOG_VALID_DAYS } from './buildSignedPluginCatalogPayload';

const plugin = {
  id: 'knowledge',
  name: '知识库',
  version: '0.1.0',
  developer: 'Linnya',
  description: '管理资料、检索知识并在项目中关联使用。',
  artifactUrl: 'https://download.linnya.com/plugins/knowledge/knowledge-0.1.0.zip',
  sha512: 'a'.repeat(128),
  size: 12_376_277,
  requiresRuntimes: [],
};

describe('待签名插件 catalog payload', () => {
  it('按通道、序号与有效期组装，签发时间取整到秒，并通过共享 schema', () => {
    const payload = buildSignedPluginCatalogPayload({
      channel: 'stable', sequence: 3, issuedAt: new Date('2026-11-22T08:30:15.987Z'), validDays: 30, plugins: [plugin],
    });
    expect(payload).toMatchObject({
      schemaVersion: 1, channel: 'stable', sequence: 3,
      issuedAt: '2026-11-22T08:30:15.000Z', expiresAt: '2026-12-22T08:30:15.000Z',
      runtimes: [], revoked: [],
    });
    expect(payload.plugins[0]).toMatchObject({ id: 'knowledge', size: 12_376_277 });
  });

  it('有效期越界、序号非法或下载地址非 URL 时在发布前失败', () => {
    const base = { channel: 'stable' as const, sequence: 1, issuedAt: new Date('2026-11-22T00:00:00.000Z'), validDays: 30, plugins: [plugin] };
    expect(() => buildSignedPluginCatalogPayload({ ...base, validDays: 0 })).toThrow('有效期');
    expect(() => buildSignedPluginCatalogPayload({ ...base, validDays: MAX_PLUGIN_CATALOG_VALID_DAYS + 1 })).toThrow('有效期');
    expect(buildSignedPluginCatalogPayload({ ...base, validDays: MAX_PLUGIN_CATALOG_VALID_DAYS }).sequence).toBe(1);
    expect(() => buildSignedPluginCatalogPayload({ ...base, sequence: 0 })).toThrow();
    expect(() => buildSignedPluginCatalogPayload({ ...base, plugins: [{ ...plugin, artifactUrl: 'not a url' }] })).toThrow();
  });
});
