import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverOfficialPluginPackageDirsFromWorkspace,
  listRendererPluginEntriesFromLayout,
  shouldPreferSourceRendererPluginEntriesForEnvironment,
} from '../rendererPluginEntries';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-renderer-plugin-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeFile(filePath: string, source: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
}

function writeRendererStylesheetManifest(
  pluginDir: string,
  stylesheets: readonly string[] = [],
): void {
  writeJson(path.join(pluginDir, 'dist/renderer/renderer-stylesheets.json'), {
    schemaVersion: 1,
    stylesheets,
  });
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('renderer plugin entry discovery', () => {
  it('prefers source renderer entries by default in an unpackaged Electron dev shell', () => {
    expect(shouldPreferSourceRendererPluginEntriesForEnvironment({
      rendererBundleMode: undefined,
      nodeEnv: undefined,
      linnyaDevMode: undefined,
      appIsPackaged: false,
    })).toBe(true);
  });

  it('lets explicit renderer bundle mode override environment heuristics', () => {
    expect(shouldPreferSourceRendererPluginEntriesForEnvironment({
      rendererBundleMode: 'disk',
      nodeEnv: 'development',
      linnyaDevMode: 'true',
      appIsPackaged: false,
    })).toBe(false);

    expect(shouldPreferSourceRendererPluginEntriesForEnvironment({
      rendererBundleMode: 'inline',
      nodeEnv: 'production',
      linnyaDevMode: undefined,
      appIsPackaged: true,
    })).toBe(true);
  });

  it('uses disk renderer entries by default in packaged production', () => {
    expect(shouldPreferSourceRendererPluginEntriesForEnvironment({
      rendererBundleMode: undefined,
      nodeEnv: 'production',
      linnyaDevMode: undefined,
      appIsPackaged: true,
    })).toBe(false);
  });

  it('lists enabled renderer entries from direct dirs and active plugin roots', () => {
    const tempRoot = makeTempRoot();
    const directDir = path.join(tempRoot, 'direct/demo-direct');
    const activeVersionDir = path.join(tempRoot, 'plugins/demo-active/1.0.0');

    writeJson(path.join(directDir, 'plugin.json'), {
      id: 'demo-direct',
      version: '2.0.0',
      name: 'Direct Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeFile(path.join(directDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
    writeFile(path.join(directDir, 'dist/renderer/assets/style.css'), '');
    writeRendererStylesheetManifest(directDir, ['assets/style.css']);

    writeJson(path.join(tempRoot, 'plugins/demo-active/active.json'), {
      version: '1.0.0',
    });
    writeJson(path.join(activeVersionDir, 'plugin.json'), {
      id: 'demo-active',
      version: '1.0.0',
      name: 'Active Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeFile(path.join(activeVersionDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
    writeRendererStylesheetManifest(activeVersionDir);

    const entries = listRendererPluginEntriesFromLayout({
      pluginRoot: path.join(tempRoot, 'plugins'),
      directPluginDirs: [directDir],
      enabledIds: new Set(['demo-direct', 'demo-active']),
    });

    expect(entries).toEqual([
      {
        pluginId: 'demo-direct',
        version: '2.0.0',
        rendererUiRange: '^1.0.0',
        entryUrl: 'plugin://demo-direct/dist/renderer/index.js',
        cssUrls: ['plugin://demo-direct/dist/renderer/assets/style.css'],
        sourceKind: 'direct',
        pluginDir: directDir,
        entryPath: path.join(directDir, 'dist/renderer/index.js'),
      },
      {
        pluginId: 'demo-active',
        version: '1.0.0',
        rendererUiRange: '^1.0.0',
        entryUrl: 'plugin://demo-active/dist/renderer/index.js',
        cssUrls: [],
        sourceKind: 'active',
        pluginDir: activeVersionDir,
        entryPath: path.join(activeVersionDir, 'dist/renderer/index.js'),
      },
    ]);
  });

  it('lists enabled official source renderer entries without plugin-specific host glue', () => {
    const tempRoot = makeTempRoot();
    const officialDir = path.join(tempRoot, 'packages/plugins/demo-official');

    writeJson(path.join(officialDir, 'plugin.json'), {
      id: 'demo-official',
      version: '3.0.0',
      name: 'Official Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeJson(path.join(officialDir, 'package.json'), {
      name: '@plugin/demo-official',
      exports: {
        './renderer': './src/renderer/index.ts',
      },
    });
    writeFile(path.join(officialDir, 'src/renderer/index.ts'), 'export const rendererPlugin = {};');

    const entries = listRendererPluginEntriesFromLayout({
      officialPluginPackageDirs: [officialDir],
      preferSourceEntries: true,
      enabledIds: new Set(['demo-official']),
    });

    expect(entries).toEqual([{
      pluginId: 'demo-official',
      version: '3.0.0',
      rendererUiRange: '^1.0.0',
      entryUrl: `/@fs/${path.join(officialDir, 'src/renderer/index.ts').replace(/\\/g, '/')}`,
      cssUrls: [],
      sourceKind: 'official-source',
      pluginDir: officialDir,
      entryPath: path.join(officialDir, 'src/renderer/index.ts'),
    }]);
  });

  it('limits workspace official source discovery to the requested plugin ids', () => {
    const tempRoot = makeTempRoot();
    const packageRoot = path.join(tempRoot, 'packages/plugins');
    const mindmapDir = path.join(packageRoot, 'mindmap');
    const sheetDir = path.join(packageRoot, 'sheet');
    const readmeDir = path.join(packageRoot, 'not-a-plugin');

    writeJson(path.join(mindmapDir, 'plugin.json'), {
      id: 'mindmap',
      version: '1.0.0',
      name: 'Mindmap',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeJson(path.join(sheetDir, 'plugin.json'), {
      id: 'sheet',
      version: '1.0.0',
      name: 'Sheet',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    fs.mkdirSync(readmeDir, { recursive: true });

    expect(discoverOfficialPluginPackageDirsFromWorkspace(tempRoot, ['mindmap'])).toEqual([mindmapDir]);
    expect(discoverOfficialPluginPackageDirsFromWorkspace(tempRoot).sort()).toEqual([mindmapDir, sheetDir].sort());
  });

  it('lets direct artifact dirs override official source entries for the same plugin id only once', () => {
    const tempRoot = makeTempRoot();
    const officialDir = path.join(tempRoot, 'packages/plugins/demo-override');
    const directDir = path.join(tempRoot, 'direct/demo-override');

    writeJson(path.join(officialDir, 'plugin.json'), {
      id: 'demo-override',
      version: '1.0.0',
      name: 'Official Override Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeJson(path.join(officialDir, 'package.json'), {
      name: '@plugin/demo-override',
      exports: {
        './renderer': './src/renderer/index.ts',
      },
    });
    writeFile(path.join(officialDir, 'src/renderer/index.ts'), 'export const rendererPlugin = {};');

    writeJson(path.join(directDir, 'plugin.json'), {
      id: 'demo-override',
      version: '2.0.0',
      name: 'Direct Override Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeFile(path.join(directDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
    writeRendererStylesheetManifest(directDir);

    const entries = listRendererPluginEntriesFromLayout({
      directPluginDirs: [directDir],
      officialPluginPackageDirs: [officialDir],
      preferSourceEntries: true,
      enabledIds: new Set(['demo-override']),
    });

    expect(entries).toEqual([{
      pluginId: 'demo-override',
      version: '2.0.0',
      rendererUiRange: '^1.0.0',
      entryUrl: 'plugin://demo-override/dist/renderer/index.js',
      cssUrls: [],
      sourceKind: 'direct',
      pluginDir: directDir,
      entryPath: path.join(directDir, 'dist/renderer/index.js'),
    }]);
  });

  it('prefers official source entries over active installed artifacts in development mode', () => {
    const tempRoot = makeTempRoot();
    const officialDir = path.join(tempRoot, 'packages/plugins/demo-source-first');
    const activeVersionDir = path.join(tempRoot, 'plugins/demo-source-first/0.9.0');

    writeJson(path.join(officialDir, 'plugin.json'), {
      id: 'demo-source-first',
      version: '1.0.0',
      name: 'Official Source First Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeJson(path.join(officialDir, 'package.json'), {
      name: '@plugin/demo-source-first',
      exports: {
        './renderer': './src/renderer/index.ts',
      },
    });
    writeFile(path.join(officialDir, 'src/renderer/index.ts'), 'export const rendererPlugin = {};');

    writeJson(path.join(tempRoot, 'plugins/demo-source-first/active.json'), {
      version: '0.9.0',
    });
    writeJson(path.join(activeVersionDir, 'plugin.json'), {
      id: 'demo-source-first',
      version: '0.9.0',
      name: 'Installed Old Demo',
      compat: { rendererUi: '^1.0.0' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    writeFile(path.join(activeVersionDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
    writeRendererStylesheetManifest(activeVersionDir);

    const diagnostics: string[] = [];
    const entries = listRendererPluginEntriesFromLayout({
      pluginRoot: path.join(tempRoot, 'plugins'),
      officialPluginPackageDirs: [officialDir],
      preferSourceEntries: true,
      enabledIds: new Set(['demo-source-first']),
      reportDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic.message);
      },
    });

    expect(entries).toEqual([{
      pluginId: 'demo-source-first',
      version: '1.0.0',
      rendererUiRange: '^1.0.0',
      entryUrl: `/@fs/${path.join(officialDir, 'src/renderer/index.ts').replace(/\\/g, '/')}`,
      cssUrls: [],
      sourceKind: 'official-source',
      pluginDir: officialDir,
      entryPath: path.join(officialDir, 'src/renderer/index.ts'),
    }]);
    expect(diagnostics).toContain('renderer 插件已由 direct dir 或官方源码入口提供，已忽略 active 安装目录实例');
  });

  it('严格按 artifact manifest 顺序返回 CSS，不读取目录枚举顺序', () => {
    const tempRoot = makeTempRoot();
    const pluginDir = path.join(tempRoot, 'ordered');
    writeJson(path.join(pluginDir, 'plugin.json'), {
      id: 'ordered',
      version: '1.0.0',
      name: 'Ordered',
      compat: { rendererUi: '^1.0.0' },
      entry: { renderer: './dist/renderer/index.js' },
    });
    writeFile(path.join(pluginDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');
    writeFile(path.join(pluginDir, 'dist/renderer/assets/a.css'), '');
    writeFile(path.join(pluginDir, 'dist/renderer/assets/z.css'), '');
    writeRendererStylesheetManifest(pluginDir, ['assets/z.css', 'assets/a.css']);

    expect(listRendererPluginEntriesFromLayout({
      directPluginDirs: [pluginDir],
      enabledIds: new Set(['ordered']),
    })[0]?.cssUrls).toEqual([
      'plugin://ordered/dist/renderer/assets/z.css',
      'plugin://ordered/dist/renderer/assets/a.css',
    ]);
  });

  it('在返回 renderer DTO 前拒绝缺失或非法的 compat.rendererUi', () => {
    const tempRoot = makeTempRoot();
    const pluginDir = path.join(tempRoot, 'old-renderer');
    writeJson(path.join(pluginDir, 'plugin.json'), {
      id: 'old-renderer',
      version: '1.0.0',
      name: 'Old Renderer',
      entry: { renderer: './dist/renderer/index.js' },
    });
    writeFile(path.join(pluginDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');

    const diagnostics: string[] = [];
    expect(listRendererPluginEntriesFromLayout({
      directPluginDirs: [pluginDir],
      enabledIds: new Set(['old-renderer']),
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic.message),
    })).toEqual([]);
    expect(diagnostics[0]).toContain('缺少 compat.rendererUi');

    writeJson(path.join(pluginDir, 'plugin.json'), {
      id: 'old-renderer',
      version: '1.0.0',
      name: 'Old Renderer',
      compat: { rendererUi: 'not-a-range' },
      entry: { renderer: './dist/renderer/index.js' },
    });
    expect(listRendererPluginEntriesFromLayout({
      directPluginDirs: [pluginDir],
      enabledIds: new Set(['old-renderer']),
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic.message),
    })).toEqual([]);
    expect(diagnostics[diagnostics.length - 1]).toContain('不是有效的 node-semver range');
  });

  it('缺少或引用不存在的 stylesheet manifest 时拒绝整个 renderer entry', () => {
    const tempRoot = makeTempRoot();
    const pluginDir = path.join(tempRoot, 'invalid');
    writeJson(path.join(pluginDir, 'plugin.json'), {
      id: 'invalid',
      version: '1.0.0',
      name: 'Invalid',
      compat: { rendererUi: '^1.0.0' },
      entry: { renderer: './dist/renderer/index.js' },
    });
    writeFile(path.join(pluginDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};');

    const diagnostics: string[] = [];
    expect(listRendererPluginEntriesFromLayout({
      directPluginDirs: [pluginDir],
      enabledIds: new Set(['invalid']),
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic.message),
    })).toEqual([]);
    expect(diagnostics[0]).toContain('缺少有序样式清单');

    writeRendererStylesheetManifest(pluginDir, ['assets/missing.css']);
    expect(listRendererPluginEntriesFromLayout({
      directPluginDirs: [pluginDir],
      enabledIds: new Set(['invalid']),
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic.message),
    })).toEqual([]);
    expect(diagnostics[diagnostics.length - 1]).toContain('stylesheet 产物不存在');
  });
});
