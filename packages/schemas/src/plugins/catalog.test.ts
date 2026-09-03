import { describe, expect, it } from 'vitest';

import { parsePluginCatalog, pluginMetaFromCatalogEntry } from './catalog';

const validEntry = {
  id: 'mindmap',
  name: 'Mindmap',
  version: '1.0.6',
  developer: 'Linnya',
  description: 'Mindmap plugin',
  permissions: ['workspaceWrite'] as const,
  dependsOn: ['platform'],
  ownedFileTypes: [
    {
      nodeType: 'mindmap',
      extension: '.mindmap',
      label: '思维导图',
    },
  ],
  minApp: '0.0.36',
  rendererUi: '^2.0.0',
  artifactUrl: 'https://download.example.test/plugins/mindmap/mindmap-1.0.6.zip',
  sha512: 'a'.repeat(128),
};

describe('PluginCatalogSchema', () => {
  it('解析可分发的插件 catalog', () => {
    expect(parsePluginCatalog({ plugins: [validEntry] })).toEqual({
      plugins: [validEntry],
    });
  });

  it('拒绝无效 URL 和错误 checksum', () => {
    expect(() => parsePluginCatalog({
      plugins: [{ ...validEntry, artifactUrl: 'not-a-url', sha512: 'abc' }],
    })).toThrow();
  });

  it('从 catalog entry 派生完整 PluginMeta，不读取插件源码', () => {
    const entry = parsePluginCatalog({ plugins: [validEntry] }).plugins[0];
    if (!entry) throw new Error('catalog fixture missing');

    expect(pluginMetaFromCatalogEntry(entry, { builtin: true, required: false })).toEqual({
      id: 'mindmap',
      name: 'Mindmap',
      version: '1.0.6',
      description: 'Mindmap plugin',
      developer: 'Linnya',
      builtin: true,
      required: false,
      permissions: ['workspaceWrite'],
      dependsOn: ['platform'],
      compatMin: '0.0.36',
      rendererUiRange: '^2.0.0',
      ownedFileTypes: validEntry.ownedFileTypes,
    });
  });
});
