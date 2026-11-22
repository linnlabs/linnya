import { describe, expect, it } from 'vitest';

import { catalogPayload, catalogPlugin, catalogRuntime, createTestCatalogPublisher } from '../__tests__/catalogTestSupport';
import { buildPluginRemoteCatalogView, runtimeKey } from './buildPluginRemoteCatalogView';
import { verifyPluginCatalog } from './verifyPluginCatalog';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const publisher = createTestCatalogPublisher();

function catalog(payload: Record<string, unknown>) {
  return verifyPluginCatalog({ catalogText: publisher.sign(catalogPayload(payload)), trustedKeys: publisher.trustedKeys, expectedChannel: 'stable', now: NOW });
}

const base = { appVersion: '0.3.0', rendererUiVersion: '3.5.0', platform: 'darwin', architecture: 'arm64' } as const;

describe('商店远程插件条目', () => {
  it('可安装：下载与新增占用 = 插件 + 未安装运行时；已安装的运行时不计入', () => {
    const verified = catalog({
      plugins: [catalogPlugin({ version: '0.2.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] })],
      runtimes: [catalogRuntime('1.14.1', [{ platform: 'darwin', architecture: 'arm64' }])],
    });
    const fresh = buildPluginRemoteCatalogView({ ...base, catalog: verified, installedRuntimes: new Set() });
    expect(fresh).toEqual([expect.objectContaining({
      id: 'knowledge', name: '知识库', version: '0.2.0',
      availability: {
        status: 'installable',
        downloadBytes: 12_000_000 + 25_000_000,
        unpackedBytes: 40_000_000 + 64_000_000,
        runtimes: [{ id: 'qdrant', version: '1.14.1', downloadBytes: 25_000_000, unpackedBytes: 64_000_000, installed: false }],
      },
    })]);

    const withRuntime = buildPluginRemoteCatalogView({ ...base, catalog: verified, installedRuntimes: new Set([runtimeKey('qdrant', '1.14.1')]) });
    expect(withRuntime[0]!.availability).toMatchObject({ status: 'installable', downloadBytes: 12_000_000, unpackedBytes: 40_000_000 });
  });

  it('选本机可装的最高版本；最高版本要求更新 Linnya 时退回上一版', () => {
    const verified = catalog({
      plugins: [catalogPlugin({ version: '0.2.0', minApp: '0.2.9' }), catalogPlugin({ version: '0.3.0', minApp: '0.4.0' })],
    });
    expect(buildPluginRemoteCatalogView({ ...base, catalog: verified, installedRuntimes: new Set() })[0])
      .toMatchObject({ version: '0.2.0', availability: { status: 'installable' } });
  });

  it('所有版本都不可装时展示最高版本与原因：需要更新 Linnya（恰好等于 minApp 时可装）', () => {
    const verified = catalog({ plugins: [catalogPlugin({ version: '0.3.0', minApp: '0.3.1' })] });
    expect(buildPluginRemoteCatalogView({ ...base, catalog: verified, installedRuntimes: new Set() })[0])
      .toMatchObject({ version: '0.3.0', availability: { status: 'requires-app-update', minApp: '0.3.1' } });
    expect(buildPluginRemoteCatalogView({ ...base, appVersion: '0.3.1', catalog: verified, installedRuntimes: new Set() })[0]!.availability.status)
      .toBe('installable');
  });

  it('界面组件版本范围不符为 incompatible；本平台没有所需运行时为 unsupported-platform', () => {
    const incompatible = catalog({ plugins: [catalogPlugin({ version: '0.2.0', rendererUi: '^4.0.0' })] });
    expect(buildPluginRemoteCatalogView({ ...base, catalog: incompatible, installedRuntimes: new Set() })[0]!.availability)
      .toEqual({ status: 'incompatible' });

    const windowsOnly = catalog({
      plugins: [catalogPlugin({ version: '0.2.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] })],
      runtimes: [catalogRuntime('1.14.1', [{ platform: 'win32', architecture: 'x64' }])],
    });
    expect(buildPluginRemoteCatalogView({ ...base, catalog: windowsOnly, installedRuntimes: new Set() })[0]!.availability)
      .toEqual({ status: 'unsupported-platform' });
  });

  it('每个插件只出现一次，顺序与 catalog 一致', () => {
    const verified = catalog({
      plugins: [
        catalogPlugin({ version: '0.1.0', id: 'mindmap', name: '思维导图' }),
        catalogPlugin({ version: '0.2.0' }),
        catalogPlugin({ version: '0.2.0', id: 'mindmap', name: '思维导图' }),
      ],
    });
    expect(buildPluginRemoteCatalogView({ ...base, catalog: verified, installedRuntimes: new Set() }).map(item => `${item.id}@${item.version}`))
      .toEqual(['mindmap@0.2.0', 'knowledge@0.2.0']);
  });
});
